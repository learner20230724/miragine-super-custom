import assert from 'node:assert/strict';
import test from 'node:test';
import { CUSTOM_SETTING_KEYS, createCustomStorage } from '../src/app/custom-storage.mjs';

const [DRAFT, PRESETS] = CUSTOM_SETTING_KEYS;
const draft = number => JSON.stringify({ schemaVersion: 1, profile: { number } });
const presets = JSON.stringify({ schemaVersion: 1, presets: [] });
const document = entries => ({ schemaVersion: 1, entries });

function desktopStore(initial = {}) {
  let saved = { ...initial };
  const calls = [];
  return {
    calls,
    async loadCustomSettings() { return document({ ...saved }); },
    async saveCustomSettings(entries, expected) {
      if (CUSTOM_SETTING_KEYS.some(key => saved[key] !== expected[key])) throw new Error('conflict');
      calls.push(entries); saved = { ...entries }; return document({ ...saved });
    },
  };
}

function browserStore(initial = {}) {
  const entries = new Map(Object.entries(initial));
  return {
    entries,
    getItem(key) { return entries.get(key) ?? null; },
    setItem(key, value) { entries.set(key, value); },
    removeItem(key) { entries.delete(key); },
  };
}

test('desktop customization cache persists both keys across fresh instances independently of browser origin', async () => {
  const desktop = desktopStore({ [DRAFT]: draft(1) });
  const storage = await createCustomStorage({ desktop, browserStorage() { throw new Error('must not use browser storage'); } });
  assert.equal(storage.status, 'ready');
  assert.equal(storage.warning, '');
  assert.equal(storage.getItem(DRAFT), draft(1));
  assert.equal(storage.getItem('unknown'), null);
  storage.setItem(DRAFT, draft(2));
  storage.setItem(PRESETS, presets);
  assert.equal(storage.getItem(DRAFT), draft(2), 'synchronous session cache');
  assert.equal(await storage.flush(), true);
  const restart = await createCustomStorage({ desktop });
  assert.equal(restart.getItem(DRAFT), draft(2));
  assert.equal(restart.getItem(PRESETS), presets);
  storage.removeItem(DRAFT);
  assert.equal(await storage.flush(), true);
  assert.equal((await createCustomStorage({ desktop })).getItem(DRAFT), null);
  assert.equal(Object.isFrozen(storage), true);
});

test('desktop saves serialize revisions and flush waits for edits made during an in-flight write', async () => {
  const calls = [], releases = [];
  const desktop = {
    async loadCustomSettings() { return document({}); },
    saveCustomSettings(entries) {
      calls.push(entries);
      return new Promise(resolve => releases.push(() => resolve(document(entries))));
    },
  };
  const storage = await createCustomStorage({ desktop });
  storage.setItem(DRAFT, draft(1));
  await Promise.resolve();
  assert.equal(calls.length, 1);
  storage.setItem(DRAFT, draft(2));
  storage.setItem(PRESETS, presets);
  const flushed = storage.flush();
  releases.shift()();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1], { [DRAFT]: draft(2), [PRESETS]: presets });
  releases.shift()();
  assert.equal(await flushed, true);
  assert.equal(storage.status, 'ready');
});

test('unreadable or invalid desktop stores block overwrite and expose only a generic warning', async () => {
  for (const bad of [null, { schemaVersion: 2, entries: {} }, document({ unknown: '{}' }), document({ [DRAFT]: 'broken' })]) {
    let writes = 0;
    const storage = await createCustomStorage({ desktop: {
      async loadCustomSettings() { if (bad === null) throw new Error('private-directory/local-key'); return bad; },
      async saveCustomSettings() { writes++; },
    } });
    assert.equal(storage.status, 'error');
    assert.match(storage.warning, /不会被覆盖/);
    assert.doesNotMatch(storage.warning, /private-directory/);
    storage.setItem(DRAFT, draft(3));
    assert.equal(storage.getItem(DRAFT), draft(3));
    assert.equal(await storage.flush(), false);
    assert.equal(writes, 0);
  }
  const missingBridge = await createCustomStorage({ desktop: {} });
  assert.equal(await missingBridge.flush(), false);
  assert.equal(missingBridge.status, 'error');
});

test('failed persistence retains the session draft and supports an explicit successful retry', async () => {
  let fail = true;
  const desktop = {
    async loadCustomSettings() { return document({}); },
    async saveCustomSettings(entries) { if (fail) throw new Error('private-directory'); return document(entries); },
  };
  const storage = await createCustomStorage({ desktop });
  storage.setItem(DRAFT, draft(4));
  assert.equal(await storage.flush(), false);
  assert.equal(storage.getItem(DRAFT), draft(4));
  assert.equal(storage.status, 'error');
  assert.match(storage.warning, /保存失败/);
  assert.doesNotMatch(storage.warning, /private-directory/);
  fail = false;
  assert.equal(await storage.flush(), true);
  assert.equal(storage.status, 'ready');
  assert.equal(storage.warning, '');
});

test('unacknowledged desktop writes are not reported as durable', async () => {
  const storage = await createCustomStorage({ desktop: {
    async loadCustomSettings() { return document({}); },
    async saveCustomSettings() { return document({}); },
  } });
  storage.setItem(DRAFT, draft(1));
  assert.equal(await storage.flush(), false);
  assert.equal(storage.status, 'error');
});

test('browser fallback preserves unrelated keys and verifies storage mutations', async () => {
  const browser = browserStore({ [DRAFT]: draft(1), unrelated: 'leave me' });
  const storage = await createCustomStorage({ desktop: null, browserStorage: browser });
  storage.setItem(DRAFT, draft(5));
  storage.setItem(PRESETS, presets);
  assert.equal(await storage.flush(), true);
  assert.equal(browser.entries.get('unrelated'), 'leave me');
  const restart = await createCustomStorage({ desktop: null, browserStorage: () => browser });
  assert.equal(restart.getItem(DRAFT), draft(5));
  storage.removeItem(PRESETS);
  assert.equal(await storage.flush(), true);
  assert.equal(browser.getItem(PRESETS), null);
  browser.setItem = () => {};
  storage.setItem(DRAFT, draft(6));
  assert.equal(await storage.flush(), false);
});

test('stale desktop or browser clients cannot overwrite another client presets', async () => {
  for (const options of [{ desktop: desktopStore() }, { desktop: null, browserStorage: browserStore() }]) {
    const first = await createCustomStorage(options), stale = await createCustomStorage(options);
    first.setItem(PRESETS, presets);
    assert.equal(await first.flush(), true);
    stale.setItem(DRAFT, draft(7));
    assert.equal(await stale.flush(), false);
    assert.equal(stale.getItem(DRAFT), draft(7), 'conflicting edit remains exportable in memory');
    const fresh = await createCustomStorage(options);
    assert.equal(fresh.getItem(PRESETS), presets);
    assert.equal(fresh.getItem(DRAFT), null);
  }
});

test('browser saves revalidate externally changed or corrupted data before any mutations', async () => {
  for (const changed of ['corrupt', presets]) {
    const browser = browserStore(), storage = await createCustomStorage({ desktop: null, browserStorage: browser });
    browser.setItem(PRESETS, changed);
    storage.setItem(DRAFT, draft(8));
    assert.equal(await storage.flush(), false);
    assert.equal(browser.getItem(PRESETS), changed);
    assert.equal(browser.getItem(DRAFT), null);
  }
});

test('browser partial quota failure can retry its own acknowledged partial writes without discarding other edits', async () => {
  const browser = browserStore(), setItem = browser.setItem.bind(browser);
  let rejectPresets = true;
  browser.setItem = (key, value) => { if (rejectPresets && key === PRESETS) throw new Error('quota'); setItem(key, value); };
  const storage = await createCustomStorage({ desktop: null, browserStorage: browser });
  storage.setItem(DRAFT, draft(1)); storage.setItem(PRESETS, presets);
  assert.equal(await storage.flush(), false);
  assert.equal(browser.getItem(DRAFT), draft(1));
  rejectPresets = false;
  assert.equal(await storage.flush(), true);
  assert.equal(browser.getItem(PRESETS), presets);
});

test('browser uses an origin-scoped exclusive Web Lock when the platform provides one', async () => {
  const calls = [];
  const storage = await createCustomStorage({ desktop: null, browserStorage: browserStore(), browserLocks: {
    async request(name, options, callback) { calls.push({ name, options }); return callback(); },
  } });
  storage.setItem(DRAFT, draft(1));
  assert.equal(await storage.flush(), true);
  assert.deepEqual(calls, [{ name: 'miragine-custom-settings-v1', options: { mode: 'exclusive' } }]);
});

test('missing, blocked, and corrupt browser storage preserve usable memory and report nondurability', async () => {
  for (const browserStorage of [null, () => { throw new Error('private-path'); }, browserStore({ [DRAFT]: 'corrupt' })]) {
    const storage = await createCustomStorage({ desktop: null, browserStorage });
    assert.notEqual(storage.warning, '');
    storage.setItem(DRAFT, draft(1));
    assert.equal(storage.getItem(DRAFT), draft(1));
    assert.equal(await storage.flush(), false);
    assert.doesNotMatch(storage.warning, /private-path/);
    if (browserStorage?.getItem) assert.equal(browserStorage.getItem(DRAFT), 'corrupt');
  }
});

test('settings cache rejects unsupported keys, non-JSON, oversized, nonfinite and prototype payloads', async () => {
  const storage = await createCustomStorage({ desktop: desktopStore() });
  assert.throws(() => storage.setItem('not-allowed', '{}'), /Unsupported/);
  assert.throws(() => storage.removeItem('not-allowed'), /Unsupported/);
  for (const value of ['wrong', 'null', '1', '{"nested":{"__proto__":{}}}', '{"constructor":{}}', '{"prototype":{}}', '{"number":1e400}',
    JSON.stringify({ data: 'x'.repeat(256 * 1024) }), '['.repeat(34) + ']'.repeat(34)]) {
    assert.throws(() => storage.setItem(DRAFT, value));
  }
  const largerLibrary = JSON.stringify({ presets: [], note: 'x'.repeat(300 * 1024) });
  storage.setItem(PRESETS, largerLibrary);
  assert.equal(await storage.flush(), true);
  assert.equal(storage.getItem(DRAFT), null);
});
