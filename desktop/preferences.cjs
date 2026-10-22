'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

function readPreferences(directory) {
  const file = path.join(directory, 'preferences.json');
  try {
    const info = fs.lstatSync(file);
    if (!info.isFile() || info.isSymbolicLink() || info.size > 4096) return { neverTutorial: false };
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    return { neverTutorial: data?.schemaVersion === 1 && data.neverTutorial === true };
  } catch { return { neverTutorial: false }; }
}

function saveNeverTutorial(directory, value) {
  if (typeof value !== 'boolean') throw new TypeError('Expected a boolean tutorial preference');
  fs.mkdirSync(directory, { recursive: true });
  const target = path.join(directory, 'preferences.json');
  const temporary = path.join(directory, `.preferences-${randomUUID()}.tmp`);
  try {
    fs.writeFileSync(temporary, JSON.stringify({ schemaVersion: 1, neverTutorial: value }) + '\n', { flag: 'wx' });
    fs.renameSync(temporary, target);
  } finally {
    try { fs.unlinkSync(temporary); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return { neverTutorial: value };
}

function isTrustedPreferenceRequest(event, contents, origin) {
  try {
    return event.sender === contents && event.senderFrame === contents.mainFrame &&
      new URL(event.senderFrame.url).origin === origin;
  } catch { return false; }
}

module.exports = { readPreferences, saveNeverTutorial, isTrustedPreferenceRequest };
