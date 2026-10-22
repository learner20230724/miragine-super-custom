import { isPlainObject, validateJsonValue } from './json.mjs';

export { validateJsonValue } from './json.mjs';
export const CONFIG_SCHEMA_VERSION = 1;

/** Validate structure without inventing a game-domain schema or default values. */
export function validateConfiguration(configuration, { label = 'defaults' } = {}) {
  validateJsonValue(configuration, { label });
  if (!isPlainObject(configuration)) throw new TypeError(`${label}: expected an object`);
  if (!Object.hasOwn(configuration, 'schemaVersion') || configuration.schemaVersion !== CONFIG_SCHEMA_VERSION) {
    throw new TypeError(`${label}.schemaVersion: expected ${CONFIG_SCHEMA_VERSION}`);
  }
  return configuration;
}

/** A user-owned envelope; metadata never becomes a game rule. */
export function validateOverrideDocument(document, { label = 'custom' } = {}) {
  validateConfiguration(document, { label });
  const allowedKeys = new Set(['schemaVersion', '$comment', 'profile', 'overrides']);
  for (const key of Object.keys(document)) {
    if (!allowedKeys.has(key)) throw new TypeError(`${label}.${key}: unknown envelope field; use overrides`);
  }
  if (Object.hasOwn(document, '$comment') && typeof document.$comment !== 'string') {
    throw new TypeError(`${label}.$comment: expected a string`);
  }
  if (Object.hasOwn(document, 'profile') && (typeof document.profile !== 'string' || !document.profile.trim())) {
    throw new TypeError(`${label}.profile: expected a nonempty string`);
  }
  if (!isPlainObject(document.overrides)) throw new TypeError(`${label}.overrides: expected an object`);
  if (Object.hasOwn(document.overrides, 'schemaVersion')) {
    throw new TypeError(`${label}.overrides.schemaVersion: the schema version cannot be overridden`);
  }
  return document;
}

function clone(value) {
  if (Array.isArray(value)) return value.map(clone);
  if (!isPlainObject(value)) return value;
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, clone(entry)]));
}

function merge(base, override) {
  if (!isPlainObject(base) || !isPlainObject(override)) return clone(override);
  const result = clone(base);
  for (const [key, value] of Object.entries(override)) {
    result[key] = Object.hasOwn(base, key) ? merge(base[key], value) : clone(value);
  }
  return result;
}

function deepFreeze(value) {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

/**
 * Objects merge recursively; arrays and primitive values replace as a whole.
 * null is an explicit value, not a delete instruction. Inputs are never changed.
 * Supply validateEffective for recovered game-domain constraints; no original
 * stats or absent game systems are inferred by this generic foundation.
 */
export function mergeConfiguration(defaults, custom, { freeze = true, validateEffective } = {}) {
  validateConfiguration(defaults);
  validateOverrideDocument(custom);
  if (typeof freeze !== 'boolean') throw new TypeError('freeze: expected a boolean');
  if (validateEffective !== undefined && typeof validateEffective !== 'function') {
    throw new TypeError('validateEffective: expected a function');
  }
  const effective = merge(defaults, custom.overrides);
  validateConfiguration(effective, { label: 'effective' });
  if (validateEffective) validateEffective(effective);
  return freeze ? deepFreeze(effective) : effective;
}

async function fetchJson(url, fetchImpl, signal, label) {
  const response = await fetchImpl(url, { signal, cache: 'no-store' });
  if (!response || !response.ok) {
    throw new Error(`${label}: request failed (${response?.status ?? 'no response'})`);
  }
  try {
    return await response.json();
  } catch (cause) {
    throw new Error(`${label}: invalid JSON`, { cause });
  }
}

/**
 * Browser-compatible loading, also usable from Node with fetch or a test double.
 * Omit customUrl only when no custom file is intended. A configured missing or
 * invalid custom file fails explicitly rather than silently ignoring edits.
 */
export async function loadConfiguration({ defaultsUrl, customUrl, fetchImpl = globalThis.fetch,
  signal, freeze = true, validateEffective } = {}) {
  if (typeof fetchImpl !== 'function') throw new TypeError('fetchImpl: expected a function');
  if (defaultsUrl === undefined || defaultsUrl === null || defaultsUrl === '') {
    throw new TypeError('defaultsUrl: required');
  }
  if (customUrl === null || customUrl === '') throw new TypeError('customUrl: use a URL or omit it');
  const [defaults, custom] = await Promise.all([
    fetchJson(defaultsUrl, fetchImpl, signal, 'defaults'),
    customUrl === undefined ? { schemaVersion: CONFIG_SCHEMA_VERSION, overrides: {} }
      : fetchJson(customUrl, fetchImpl, signal, 'custom'),
  ]);
  return mergeConfiguration(defaults, custom, { freeze, validateEffective });
}
