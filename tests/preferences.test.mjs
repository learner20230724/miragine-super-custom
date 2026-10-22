import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const { readPreferences, saveNeverTutorial, isTrustedPreferenceRequest } = require('../desktop/preferences.cjs');
const root = path.resolve(fileURLToPath(new URL('../.tmp/', import.meta.url)));

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(root, 'preferences-test-'));
  t.after(() => {
    assert.equal(path.dirname(path.resolve(directory)), root);
    assert.ok(path.basename(directory).startsWith('preferences-test-'));
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return directory;
}

fs.mkdirSync(root, { recursive: true });

test('tutorial preference persists across independent reads without origin or port dependence', t => {
  const directory = fixture(t);
  assert.deepEqual(readPreferences(directory), { neverTutorial: false });
  assert.deepEqual(saveNeverTutorial(directory, true), { neverTutorial: true });
  assert.deepEqual(readPreferences(directory), { neverTutorial: true });
  assert.equal(JSON.parse(fs.readFileSync(path.join(directory, 'preferences.json'))).schemaVersion, 1);
  saveNeverTutorial(directory, false);
  assert.deepEqual(readPreferences(directory), { neverTutorial: false });
  assert.deepEqual(fs.readdirSync(directory), ['preferences.json']);
});

test('invalid or oversized runtime preference files fail safely without rewriting user data', t => {
  const directory = fixture(t), file = path.join(directory, 'preferences.json');
  for (const text of ['invalid json', '{"neverTutorial":true}', '{"schemaVersion":1,"neverTutorial":"true"}', 'x'.repeat(4097)]) {
    fs.writeFileSync(file, text);
    assert.deepEqual(readPreferences(directory), { neverTutorial: false });
    assert.equal(fs.readFileSync(file, 'utf8'), text);
  }
  assert.throws(() => saveNeverTutorial(directory, 'true'), /boolean/);
});

test('preference IPC trusts only the current game main frame and exact origin', () => {
  const frame = { url: 'http://127.0.0.1:51286/' };
  const contents = { mainFrame: frame };
  const event = { sender: contents, senderFrame: frame };
  assert.equal(isTrustedPreferenceRequest(event, contents, 'http://127.0.0.1:51286'), true);
  assert.equal(isTrustedPreferenceRequest({ ...event, sender: {} }, contents, 'http://127.0.0.1:51286'), false);
  assert.equal(isTrustedPreferenceRequest({ ...event, senderFrame: { ...frame } }, contents, 'http://127.0.0.1:51286'), false);
  assert.equal(isTrustedPreferenceRequest(event, contents, 'http://127.0.0.1:51287'), false);
  assert.equal(isTrustedPreferenceRequest({}, contents, 'http://127.0.0.1:51286'), false);
});
