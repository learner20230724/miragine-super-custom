/** JSON validation shared by the browser loader and local generation tools. */
const forbiddenKeys = new Set(['__proto__', 'prototype', 'constructor']);

/**
 * Accept JSON data only. In particular, do not evaluate getters or permit keys
 * that can become prototype-pollution primitives when data is used elsewhere.
 */
export function validateJsonValue(value, { label = 'JSON', maxDepth = 128 } = {}) {
  const ancestors = new WeakSet();

  function visit(current, location, depth) {
    if (depth > maxDepth) throw new TypeError(`${location}: nesting exceeds ${maxDepth}`);
    if (current === null || typeof current === 'string' || typeof current === 'boolean') return;
    if (typeof current === 'number' && Number.isFinite(current)) return;
    if (typeof current !== 'object') throw new TypeError(`${location}: expected a JSON value`);
    const array = Array.isArray(current);
    const prototype = Object.getPrototypeOf(current);
    if (array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) {
      throw new TypeError(`${location}: expected a plain JSON object or array`);
    }
    if (ancestors.has(current)) throw new TypeError(`${location}: cyclic JSON value`);
    ancestors.add(current);
    const descriptors = Object.getOwnPropertyDescriptors(current);
    for (const key of Reflect.ownKeys(descriptors)) {
      if (array && key === 'length') continue;
      if (typeof key !== 'string' || forbiddenKeys.has(key)) {
        throw new TypeError(`${location}: forbidden property ${String(key)}`);
      }
      if (array && !/^(0|[1-9]\d*)$/.test(key)) {
        throw new TypeError(`${location}: non-index array property ${key}`);
      }
      const descriptor = descriptors[key];
      if (!Object.hasOwn(descriptor, 'value') || !descriptor.enumerable) {
        throw new TypeError(`${location}.${key}: expected an enumerable data property`);
      }
      visit(descriptor.value, `${location}.${key}`, depth + 1);
    }
    if (array && Object.keys(descriptors).length - 1 !== current.length) {
      throw new TypeError(`${location}: sparse arrays are not JSON data`);
    }
    ancestors.delete(current);
  }

  visit(value, label, 0);
  return value;
}

export function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}
