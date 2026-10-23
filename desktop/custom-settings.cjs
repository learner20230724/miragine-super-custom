'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

// This is a deliberately separate store from the editable config/custom.json.
// In particular, loading or saving editor drafts must never rewrite that file.
const CUSTOM_SETTING_KEYS = Object.freeze(['miragine-custom-draft-v1', 'miragine-custom-presets-v1']);
const MAX_ENTRY_BYTES = Object.freeze({ 'miragine-custom-draft-v1': 256 * 1024, 'miragine-custom-presets-v1': 2 * 1024 * 1024 });
// Stored values are JSON strings inside another JSON document. Account for
// their quotes/backslashes being escaped a second time.
const MAX_DOCUMENT_BYTES = 2 * Object.values(MAX_ENTRY_BYTES).reduce((sum, value) => sum + value, 0) + 65536;
const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

function invalid() { return new Error('Custom settings are invalid or unavailable'); }
function plain(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function validateJSONValue(value) {
  let nodes = 0;
  function visit(item, depth) {
    if (++nodes > 100000 || depth > 32) throw invalid();
    if (typeof item === 'number' && !Number.isFinite(item)) throw invalid();
    if (item === null || typeof item !== 'object') return;
    for (const key of Object.keys(item)) {
      if (FORBIDDEN_KEYS.has(key)) throw invalid();
      visit(item[key], depth + 1);
    }
  }
  visit(value, 0);
}

/** Accept only two bounded JSON strings; no filenames, commands or arbitrary keys. */
function validateEntries(entries) {
  if (!plain(entries)) throw invalid();
  const clean = {};
  for (const key of Reflect.ownKeys(entries)) {
    if (typeof key !== 'string' || !CUSTOM_SETTING_KEYS.includes(key)) throw invalid();
    const descriptor = Object.getOwnPropertyDescriptor(entries, key);
    if (!descriptor || !Object.hasOwn(descriptor, 'value') || typeof descriptor.value !== 'string') throw invalid();
    const value = descriptor.value;
    if (Buffer.byteLength(value, 'utf8') > MAX_ENTRY_BYTES[key]) throw invalid();
    let decoded;
    try { decoded = JSON.parse(value); } catch { throw invalid(); }
    if (!decoded || typeof decoded !== 'object') throw invalid();
    validateJSONValue(decoded);
    clean[key] = value;
  }
  return clean;
}

function validateDocument(value) {
  if (!plain(value) || Reflect.ownKeys(value).length !== 2 || value.schemaVersion !== 1 ||
      !Object.hasOwn(value, 'entries')) throw invalid();
  return { schemaVersion: 1, entries: validateEntries(value.entries) };
}

function readDocument(file) {
  const info = fs.lstatSync(file);
  if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_DOCUMENT_BYTES) throw invalid();
  return validateDocument(JSON.parse(fs.readFileSync(file, 'utf8')));
}

/** Missing is an empty store; corrupt is an explicit error, never an empty reset. */
function readCustomSettings(directory) {
  const file = path.join(directory, 'custom-settings.json');
  try {
    const info = fs.lstatSync(directory);
    if (!info.isDirectory() || info.isSymbolicLink()) throw invalid();
    return readDocument(file);
  } catch (error) {
    if (error.code === 'ENOENT') return { schemaVersion: 1, entries: {} };
    throw invalid(); // Do not expose filesystem paths through IPC.
  }
}

/** Atomic whole-document replacement, verified before rename; existing corruption is preserved. */
function saveCustomSettings(directory, entries, expectedEntries) {
  const document = { schemaVersion: 1, entries: validateEntries(entries) };
  const expected = validateEntries(expectedEntries);
  const bytes = JSON.stringify(document) + '\n';
  if (Buffer.byteLength(bytes, 'utf8') > MAX_DOCUMENT_BYTES) throw invalid();
  const target = path.join(directory, 'custom-settings.json');
  const temporary = path.join(directory, `.custom-settings-${randomUUID()}.tmp`);
  const lock = path.join(directory, '.custom-settings-write.lock');
  let descriptor, lockDescriptor, temporaryCreated = false, lockCreated = false;
  try {
    fs.mkdirSync(directory, { recursive: true });
    const info = fs.lstatSync(directory);
    if (!info.isDirectory() || info.isSymbolicLink()) throw invalid();
    // Serialize independent desktop processes as well as this process's IPC.
    // An existing lock is never forcibly removed; a crashed writer therefore
    // fails safely rather than granting two writers ownership of the same file.
    lockDescriptor = fs.openSync(lock, 'wx', 0o600);
    lockCreated = true;
    // Refuse to discard corruption OR changes made by another game instance /
    // external editor after this client's last acknowledged load or save.
    const existing = readCustomSettings(directory).entries;
    if (CUSTOM_SETTING_KEYS.some(key => existing[key] !== expected[key])) throw invalid();
    descriptor = fs.openSync(temporary, 'wx', 0o600);
    temporaryCreated = true;
    fs.writeFileSync(descriptor, bytes, 'utf8');
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    const verified = readDocument(temporary);
    if (JSON.stringify(verified) + '\n' !== bytes) throw invalid();
    fs.renameSync(temporary, target);
    return verified;
  } catch { throw invalid(); }
  finally {
    if (descriptor !== undefined) { try { fs.closeSync(descriptor); } catch { /* Preserve generic error. */ } }
    if (temporaryCreated) { try { fs.unlinkSync(temporary); } catch { /* Never expose temporary paths. */ } }
    if (lockDescriptor !== undefined) { try { fs.closeSync(lockDescriptor); } catch { /* Preserve generic error. */ } }
    if (lockCreated) { try { fs.unlinkSync(lock); } catch { /* Never remove an unowned lock. */ } }
  }
}

module.exports = { CUSTOM_SETTING_KEYS, MAX_ENTRY_BYTES, MAX_DOCUMENT_BYTES, validateEntries, readCustomSettings, saveCustomSettings };
