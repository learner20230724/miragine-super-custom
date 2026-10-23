import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import vm from 'node:vm';
import { CUSTOM_SETTING_KEYS as RENDERER_KEYS } from '../src/app/custom-storage.mjs';

const require = createRequire(import.meta.url);
const { CUSTOM_SETTING_KEYS, MAX_ENTRY_BYTES, MAX_DOCUMENT_BYTES, validateEntries, readCustomSettings, saveCustomSettings } = require('../desktop/custom-settings.cjs');
const { isTrustedPreferenceRequest } = require('../desktop/preferences.cjs');
const root = fileURLToPath(new URL('../.tmp/', import.meta.url));
const [DRAFT, PRESETS] = CUSTOM_SETTING_KEYS;
const text = number => JSON.stringify({ schemaVersion: 1, profile: { number } });

function fixture(t) {
  fs.mkdirSync(root, { recursive: true });
  const directory = fs.mkdtempSync(path.join(root, 'custom-settings-test-'));
  t.after(() => {
    const absolute = path.resolve(directory);
    assert.equal(path.dirname(absolute), path.resolve(root));
    assert.ok(path.basename(absolute).startsWith('custom-settings-test-'));
    fs.rmSync(absolute, { recursive: true, force: true });
  });
  return directory;
}

test('custom settings are atomic, port-independent and separate from editable source configuration', t => {
  const directory = fixture(t);
  const settings = path.join(directory, 'userdata');
  assert.deepEqual(CUSTOM_SETTING_KEYS, RENDERER_KEYS);
  assert.deepEqual(readCustomSettings(settings), { schemaVersion: 1, entries: {} });
  fs.mkdirSync(path.join(directory, 'config'));
  const sourceFile = path.join(directory, 'config', 'custom.json');
  fs.writeFileSync(sourceFile, '{"sourceEdit":"preserve"}');
  const entries = { [DRAFT]: text(1), [PRESETS]: '{"schemaVersion":1,"presets":[]}' };
  assert.deepEqual(saveCustomSettings(settings, entries, {}), { schemaVersion: 1, entries });
  assert.deepEqual(readCustomSettings(settings), { schemaVersion: 1, entries });
  assert.deepEqual(fs.readdirSync(settings), ['custom-settings.json']);
  saveCustomSettings(settings, { [DRAFT]: text(2) }, entries);
  assert.deepEqual(readCustomSettings(settings).entries, { [DRAFT]: text(2) });
  assert.equal(fs.readFileSync(sourceFile, 'utf8'), '{"sourceEdit":"preserve"}');
});

test('corrupted, unknown-schema, oversized and non-file stores are never replaced by saving', t => {
  const directory = fixture(t), file = path.join(directory, 'custom-settings.json');
  for (const bytes of ['broken', '{"schemaVersion":2,"entries":{}}', '{"schemaVersion":1,"entries":{},"extra":true}',
    '{"schemaVersion":1,"entries":{"unknown":"{}"}}', 'x'.repeat(MAX_DOCUMENT_BYTES + 1)]) {
    fs.writeFileSync(file, bytes);
    assert.throws(() => readCustomSettings(directory), /invalid or unavailable/);
    assert.throws(() => saveCustomSettings(directory, { [DRAFT]: text(9) }, {}), /invalid or unavailable/);
    assert.equal(fs.readFileSync(file, 'utf8'), bytes);
    assert.deepEqual(fs.readdirSync(directory), ['custom-settings.json']);
  }
  fs.unlinkSync(file); fs.mkdirSync(file);
  assert.throws(() => readCustomSettings(directory), /invalid or unavailable/);
  assert.throws(() => saveCustomSettings(directory, {}, {}), /invalid or unavailable/);
  assert.equal(fs.statSync(file).isDirectory(), true);
});

test('validator rejects arbitrary keys, accessors, prototype payloads, and per-key byte overflows', () => {
  for (const entries of [null, [], { wrong: '{}' }, { [DRAFT]: 1 }, { [DRAFT]: 'null' },
    { [DRAFT]: '{"__proto__":{}}' }, { [DRAFT]: '{"nested":{"constructor":{}}}' },
    { [DRAFT]: '{"prototype":{}}' }, { [DRAFT]: '{"number":1e400}' },
    { [DRAFT]: '['.repeat(34) + ']'.repeat(34) }, { [DRAFT]: JSON.stringify({ x: 'x'.repeat(MAX_ENTRY_BYTES[DRAFT]) }) },
    { [PRESETS]: JSON.stringify({ x: 'x'.repeat(MAX_ENTRY_BYTES[PRESETS]) }) },
    Object.create({ inherited: '{}' }), { [Symbol('hidden')]: '{}' },
  ]) assert.throws(() => validateEntries(entries), /invalid or unavailable/);
  let getterCalled = false;
  const getter = Object.defineProperty({}, DRAFT, { get() { getterCalled = true; return '{}'; }, enumerable: true });
  assert.throws(() => validateEntries(getter));
  assert.equal(getterCalled, false);
  assert.deepEqual(validateEntries(Object.assign(Object.create(null), { [DRAFT]: '{}' })), { [DRAFT]: '{}' });
});

test('failed atomic rename keeps previous data intact, removes owned temporary file, and hides paths', t => {
  const directory = fixture(t), file = path.join(directory, 'custom-settings.json');
  saveCustomSettings(directory, { [DRAFT]: text(1) }, {});
  const original = fs.readFileSync(file, 'utf8');
  const rename = fs.renameSync;
  try {
    fs.renameSync = () => { throw new Error(`private path: ${directory}`); };
    assert.throws(() => saveCustomSettings(directory, { [DRAFT]: text(2) }, { [DRAFT]: text(1) }), error => {
      assert.equal(error.message, 'Custom settings are invalid or unavailable');
      assert.ok(!error.message.includes(directory));
      return true;
    });
  } finally { fs.renameSync = rename; }
  assert.equal(fs.readFileSync(file, 'utf8'), original);
  assert.deepEqual(fs.readdirSync(directory), ['custom-settings.json']);
});

test('stale or missing expected snapshots cannot erase another writer data', t => {
  const directory = fixture(t);
  const first = { [PRESETS]: '{"schemaVersion":1,"presets":[]}' };
  saveCustomSettings(directory, first, {});
  assert.throws(() => saveCustomSettings(directory, { [DRAFT]: text(2) }, {}), /invalid or unavailable/);
  assert.throws(() => saveCustomSettings(directory, { [DRAFT]: text(2) }), /invalid or unavailable/);
  assert.deepEqual(readCustomSettings(directory).entries, first);
  assert.deepEqual(fs.readdirSync(directory), ['custom-settings.json']);
  const merged = { ...first, [DRAFT]: text(2) };
  saveCustomSettings(directory, merged, first);
  assert.deepEqual(readCustomSettings(directory).entries, merged);
});

test('existing write locks are preserved and prevent concurrent file replacement', t => {
  const directory = fixture(t);
  saveCustomSettings(directory, { [DRAFT]: text(1) }, {});
  const lock = path.join(directory, '.custom-settings-write.lock');
  fs.writeFileSync(lock, 'another writer owns this lock');
  assert.throws(() => saveCustomSettings(directory, { [DRAFT]: text(2) }, { [DRAFT]: text(1) }), /invalid or unavailable/);
  assert.equal(fs.readFileSync(lock, 'utf8'), 'another writer owns this lock');
  assert.deepEqual(readCustomSettings(directory).entries, { [DRAFT]: text(1) });
});

test('an exclusive-create collision never removes an unowned existing temporary file', t => {
  const directory = fixture(t), open = fs.openSync;
  let collision;
  try {
    fs.openSync = (file, flags, mode) => {
      if (flags !== 'wx' || !String(file).endsWith('.tmp')) return open(file, flags, mode);
      collision = file;
      const descriptor = open(file, 'wx', mode);
      fs.writeFileSync(descriptor, 'unowned existing file');
      fs.closeSync(descriptor);
      throw Object.assign(new Error('existing file'), { code: 'EEXIST' });
    };
    assert.throws(() => saveCustomSettings(directory, {}, {}), /invalid or unavailable/);
  } finally { fs.openSync = open; }
  assert.equal(fs.readFileSync(collision, 'utf8'), 'unowned existing file');
  assert.equal(fs.existsSync(path.join(directory, 'custom-settings.json')), false);
});

test('directory junctions or symlinks are not accepted as the custom settings directory', t => {
  const directory = fixture(t), actual = path.join(directory, 'actual'), link = path.join(directory, 'linked');
  fs.mkdirSync(actual);
  try { fs.symlinkSync(actual, link, process.platform === 'win32' ? 'junction' : 'dir'); }
  catch (error) { if (['EPERM', 'ENOTSUP', 'EACCES'].includes(error.code)) { t.skip('Directory symlinks unavailable'); return; } throw error; }
  assert.throws(() => readCustomSettings(link), /invalid or unavailable/);
  assert.throws(() => saveCustomSettings(link, { [DRAFT]: text(1) }, {}), /invalid or unavailable/);
  assert.deepEqual(fs.readdirSync(actual), []);
});

test('preload exposes fixed customization channels without arbitrary filesystem or IPC access', async () => {
  const calls = [];
  let exposed;
  const source = fs.readFileSync(new URL('../desktop/preload.cjs', import.meta.url), 'utf8');
  vm.runInNewContext(source, { require(name) {
    assert.equal(name, 'electron');
    return { contextBridge: { exposeInMainWorld(name, value) { assert.equal(name, 'miragineDesktop'); exposed = value; } },
      ipcRenderer: { invoke(...args) { calls.push(args); return Promise.resolve({}); } } };
  } });
  assert.deepEqual(Object.keys(exposed).sort(), ['getFullscreen', 'loadCustomSettings', 'loadPreferences', 'onFullscreenChanged', 'saveCustomSettings', 'saveNeverTutorial', 'toggleFullscreen']);
  await exposed.loadCustomSettings();
  const entries = { [DRAFT]: '{}' };
  await exposed.saveCustomSettings(entries, {});
  assert.deepEqual(calls, [['miragine:custom-settings:load'], ['miragine:custom-settings:save', entries, {}]]);
  assert.equal(Object.isFrozen(exposed), true);
});

test('customization IPC uses the existing exact main-frame trust boundary and generic errors', async () => {
  const handlers = new Map(), lifecycle = new Map();
  let fail = false;
  const server = { once() {}, listen(_port, _host, done) { done(); }, address() { return { port: 53210 }; }, close() {}, closeAllConnections() {} };
  class Window {
    constructor() {
      this.webContents = { mainFrame: { url: '' }, setWindowOpenHandler() {}, on() {},
        session: { setPermissionRequestHandler() {}, setPermissionCheckHandler() {}, webRequest: { onBeforeRequest() {} } } };
    }
    once() {}
    on() {}
    async loadURL(url) { this.webContents.mainFrame.url = url; }
  }
  const app = { isPackaged: false, setPath() {}, setAppLogsPath() {}, commandLine: { appendSwitch() {} },
    on(name, callback) { lifecycle.set(name, callback); }, once(name, callback) { lifecycle.set(name, callback); }, async whenReady() {}, quit() {} };
  const electron = { app, BrowserWindow: Window, Menu: { setApplicationMenu() {} }, dialog: {},
    ipcMain: { handle(channel, fn) { handlers.set(channel, fn); }, removeHandler(channel) { handlers.delete(channel); } } };
  const module = { exports: {} };
  const dependencies = {
    'node:fs': { mkdirSync() {} }, 'node:path': path,
    './static-server.cjs': { createStaticServer() { return server; } },
    './preferences.cjs': { isTrustedPreferenceRequest, readPreferences() {}, saveNeverTutorial() {} },
    './custom-settings.cjs': {
      readCustomSettings() { if (fail) throw new Error('private-directory'); return { schemaVersion: 1, entries: {} }; },
      saveCustomSettings(_directory, entries, expectedEntries) { if (fail) throw new Error('private-directory'); validateEntries(expectedEntries); return { schemaVersion: 1, entries: validateEntries(entries) }; },
    },
  };
  vm.runInNewContext(fs.readFileSync(new URL('../desktop/main.cjs', import.meta.url), 'utf8'), {
    module, require(name) { assert.ok(Object.hasOwn(dependencies, name), name); return dependencies[name]; },
    __dirname: '/fixture/desktop', process: { execPath: '/fixture/game', env: {} }, console,
  });
  const result = await module.exports.startDesktop({ electron, appRoot: '/fixture' });
  const contents = result.window.webContents, event = { sender: contents, senderFrame: contents.mainFrame };
  const load = handlers.get('miragine:custom-settings:load'), save = handlers.get('miragine:custom-settings:save');
  assert.deepEqual(load(event), { schemaVersion: 1, entries: {} });
  assert.deepEqual(save(event, { [DRAFT]: '{}' }, {}).entries, { [DRAFT]: '{}' });
  assert.throws(() => save(event, { [DRAFT]: '{}' }), /Unable to save custom settings/);
  for (const bad of [{}, { ...event, sender: {} }, { ...event, senderFrame: { url: contents.mainFrame.url } }]) {
    assert.throws(() => load(bad), /Untrusted custom settings/);
    assert.throws(() => save(bad, {}), /Untrusted custom settings/);
  }
  const originalURL = contents.mainFrame.url;
  contents.mainFrame.url = 'http://127.0.0.1:53211/';
  assert.throws(() => load(event), /Untrusted custom settings/);
  contents.mainFrame.url = originalURL;
  fail = true;
  assert.throws(() => load(event), /^Error: Unable to load custom settings$/);
  assert.throws(() => save(event, {}), /^Error: Unable to save custom settings$/);
  lifecycle.get('will-quit')();
  assert.equal(handlers.size, 0);
});
