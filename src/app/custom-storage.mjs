export const CUSTOM_SETTING_KEYS = Object.freeze(['miragine-custom-draft-v1', 'miragine-custom-presets-v1']);
const MAX_ENTRY_BYTES = Object.freeze({ 'miragine-custom-draft-v1': 256 * 1024, 'miragine-custom-presets-v1': 2 * 1024 * 1024 });
const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const LOAD_WARNING = '自定义设置未能安全读取，原保存文件不会被覆盖。本次修改仅在当前运行期间有效，请导出备份。';
const SAVE_WARNING = '自定义设置保存失败；本次修改仍在内存中，请导出备份。如果其他窗口或外部文件有修改，请备份后重新打开游戏。';
const MEMORY_WARNING = '当前环境无法保存自定义设置；本次修改仅在当前运行期间有效，请导出备份。';

function validateValue(key, value) {
  if (typeof value !== 'string' || new TextEncoder().encode(value).length > MAX_ENTRY_BYTES[key]) {
    throw new TypeError('Custom setting must be bounded JSON text');
  }
  let parsed;
  try { parsed = JSON.parse(value); } catch { throw new TypeError('Custom setting must be JSON text'); }
  if (!parsed || typeof parsed !== 'object') throw new TypeError('Custom setting must contain an object or array');
  let nodes = 0;
  function visit(item, depth) {
    if (++nodes > 100000 || depth > 32) throw new TypeError('Custom setting is too complex');
    if (typeof item === 'number' && !Number.isFinite(item)) throw new TypeError('Invalid custom setting number');
    if (item === null || typeof item !== 'object') return;
    for (const key of Object.keys(item)) {
      if (FORBIDDEN_KEYS.has(key)) throw new TypeError('Unsafe custom setting key');
      visit(item[key], depth + 1);
    }
  }
  visit(parsed, 0);
  return value;
}

function validateEntries(entries) {
  if (!entries || typeof entries !== 'object' || Array.isArray(entries) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(entries))) throw new TypeError('Invalid custom settings');
  const clean = {};
  for (const key of Reflect.ownKeys(entries)) {
    const descriptor = Object.getOwnPropertyDescriptor(entries, key);
    if (!CUSTOM_SETTING_KEYS.includes(key) || !Object.hasOwn(descriptor, 'value')) throw new TypeError('Invalid custom setting key');
    clean[key] = validateValue(key, descriptor.value);
  }
  return clean;
}

/**
 * Async initialization, synchronous editor reads/writes, and explicitly awaited
 * durability. Electron stores these two entries outside its ephemeral HTTP
 * origin. Browser builds use their normal origin-scoped localStorage instead.
 * Errors keep the session draft usable but never pretend it was saved.
 */
export async function createCustomStorage({
  desktop = globalThis.miragineDesktop,
  browserStorage = () => globalThis.localStorage,
  browserLocks = () => globalThis.navigator?.locks,
} = {}) {
  let cache = {}, status = 'ready', warning = '', blocked = false, backend;
  let revision = 0, savedRevision = 0, pending = null;
  if (desktop !== undefined && desktop !== null) {
    try {
      if (typeof desktop.loadCustomSettings !== 'function' || typeof desktop.saveCustomSettings !== 'function') throw new Error();
      const loaded = await desktop.loadCustomSettings();
      if (!loaded || loaded.schemaVersion !== 1 || Reflect.ownKeys(loaded).length !== 2) throw new Error();
      cache = validateEntries(loaded.entries);
      let expected = { ...cache };
      backend = async snapshot => {
        const result = await desktop.saveCustomSettings(snapshot, expected);
        if (!result || result.schemaVersion !== 1 || JSON.stringify(validateEntries(result.entries)) !== JSON.stringify(snapshot)) {
          throw new Error('Custom settings save was not acknowledged');
        }
        expected = { ...snapshot };
      };
    } catch {
      blocked = true; status = 'error'; warning = LOAD_WARNING;
    }
  } else {
    let storage;
    try {
      storage = typeof browserStorage === 'function' ? browserStorage() : browserStorage;
      if (!storage) { status = 'memory'; warning = MEMORY_WARNING; }
      else {
        const loaded = {};
        for (const key of CUSTOM_SETTING_KEYS) {
          const value = storage.getItem(key);
          if (value !== null) loaded[key] = validateValue(key, value);
        }
        cache = loaded;
        let expected = { ...cache };
        let locks;
        try { locks = typeof browserLocks === 'function' ? browserLocks() : browserLocks; } catch { /* Optional platform facility. */ }
        const write = snapshot => {
          const existing = {};
          for (const key of CUSTOM_SETTING_KEYS) {
            const value = storage.getItem(key);
            if (value !== null) existing[key] = validateValue(key, value);
          }
          if (CUSTOM_SETTING_KEYS.some(key => existing[key] !== expected[key])) throw new Error('Custom settings changed in another session');
          for (const key of CUSTOM_SETTING_KEYS) {
            if (Object.hasOwn(snapshot, key)) storage.setItem(key, snapshot[key]);
            else storage.removeItem(key);
            if (storage.getItem(key) !== (snapshot[key] ?? null)) throw new Error('Custom settings save was not acknowledged');
            if (Object.hasOwn(snapshot, key)) expected[key] = snapshot[key];
            else delete expected[key];
          }
          expected = { ...snapshot };
        };
        backend = async snapshot => typeof locks?.request === 'function'
          ? locks.request('miragine-custom-settings-v1', { mode: 'exclusive' }, async () => write(snapshot)) : write(snapshot);
      }
    } catch { blocked = true; status = 'error'; warning = LOAD_WARNING; }
  }

  function save() {
    if (blocked || !backend) return Promise.resolve(false);
    if (pending) return pending;
    if (savedRevision === revision) return Promise.resolve(true);
    status = 'saving';
    pending = Promise.resolve().then(async () => {
      while (savedRevision < revision) {
        const targetRevision = revision;
        const snapshot = { ...cache };
        await backend(snapshot);
        savedRevision = targetRevision;
      }
      status = 'ready'; warning = '';
      return true;
    }).catch(() => {
      status = 'error'; warning = SAVE_WARNING;
      return false;
    }).finally(() => {
      pending = null;
      if (status === 'ready' && savedRevision < revision) void save();
    });
    return pending;
  }

  return Object.freeze({
    get status() { return status; },
    get warning() { return warning; },
    getItem(key) { return CUSTOM_SETTING_KEYS.includes(key) ? cache[key] ?? null : null; },
    setItem(key, value) {
      if (!CUSTOM_SETTING_KEYS.includes(key)) throw new TypeError('Unsupported custom setting key');
      const checked = validateValue(key, value);
      if (cache[key] === checked) return;
      cache[key] = checked; revision++;
      void save();
    },
    removeItem(key) {
      if (!CUSTOM_SETTING_KEYS.includes(key)) throw new TypeError('Unsupported custom setting key');
      if (!Object.hasOwn(cache, key)) return;
      delete cache[key]; revision++;
      void save();
    },
    async flush() {
      if (blocked || !backend) return false;
      do { if (!await save()) return false; } while (savedRevision < revision);
      return true;
    },
  });
}
