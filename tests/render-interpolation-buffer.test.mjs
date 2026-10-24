import test from 'node:test';
import assert from 'node:assert/strict';
import { interpolateRenderState, RenderInterpolationBuffer } from '../src/runtime/render-interpolation.mjs';

const entity = (uid, values = {}) => ({ uid, kind: 'unit', side: 'left', id: 0, spriteIndex: 5,
  action: 'run', visible: true, sx: -1, sy: 1, px: 0, py: 10, pz: 0, nowHP: 45, displayFrame: 1, ...values });
const camera = (x, y, values = {}) => ({ x, y, width: 640, height: 400, ...values });
function freeze(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}

test('buffer matches pure interpolation for order, births, removals and every discrete continuity boundary', () => {
  const buffer = new RenderInterpolationBuffer();
  for (const change of [{}, { nowHP: 0 }, { action: 'attack' }, { spriteIndex: 2 }, { side: 'right' },
    { kind: 'attack' }, { id: 9 }, { weaponSheet: 'fb' }, { sx: 1 }, { sy: -1 }, { visible: false }]) {
    const previous = freeze([entity(1), entity(2), entity(3, { px: 100 })]);
    const current = freeze([entity(3, { px: 120 }), entity(1, { px: 50, ...change }), entity(4, { px: 600 })]);
    for (const alpha of [-1, 0, 0.1, 0.7, 1, 2]) {
      assert.deepEqual(buffer.interpolate(previous, current, alpha), interpolateRenderState(previous, current, alpha));
    }
  }
});

test('buffer rejects ambiguous UIDs and nonfinite positions exactly like the pure function', () => {
  const buffer = new RenderInterpolationBuffer();
  const cases = [
    [[entity(1), entity(1, { px: 8 })], [entity(1, { px: 100 })]],
    [[entity(1)], [entity(1, { px: 100 }), entity(1, { px: 200 })]],
    [[entity(undefined)], [entity(undefined, { px: 100 })]],
    [[entity(NaN)], [entity(NaN, { px: 100 })]],
    [[entity(Infinity)], [entity(Infinity, { px: 100 })]],
    [[entity('same')], [entity('same', { px: 100 })]],
    [[entity(1, { px: NaN })], [entity(1, { px: 100 })]],
    [[entity(1)], [entity(1, { pz: Infinity, px: 100 })]],
    [[entity(1, { nowHP: 0, action: 'dead' })], [entity(1, { nowHP: 0, action: 'dead', px: 100 })]],
    [[entity(1, { nowHP: undefined })], [entity(1, { nowHP: undefined, px: 100 })]],
  ];
  for (const [previous, current] of cases) {
    for (const alpha of [0, 0.5, 1]) assert.deepEqual(buffer.interpolate(previous, current, alpha),
      interpolateRenderState(previous, current, alpha));
  }
});

test('buffer reuses arrays and output records, matches camera cuts, and never writes inputs', () => {
  const buffer = new RenderInterpolationBuffer();
  const previous = freeze([entity(1, { metadata: { value: 3 } })]), current = freeze([entity(1, { px: 20 })]);
  const options = { previousCamera: freeze(camera(10, 20)), currentCamera: freeze(camera(30, 40)) };
  const before = JSON.stringify({ previous, current, options });
  const output = buffer.interpolate(previous, current, 0, options);
  const snapshot = output.snapshot, item = snapshot[0], outputCamera = output.camera;
  for (const alpha of [0.1, 0.5, 0.9, 1, 0]) {
    const next = buffer.interpolate(previous, current, alpha, options);
    assert.equal(next, output); assert.equal(next.snapshot, snapshot); assert.equal(next.snapshot[0], item);
    assert.equal(next.camera, outputCamera);
    assert.deepEqual(next, interpolateRenderState(previous, current, alpha, options));
  }
  for (const opts of [{ ...options, cameraCut: true }, { ...options, currentCamera: camera(50, 60, { width: 900 }) },
    { currentCamera: null }, {}, { previousCamera: null, currentCamera: camera(10, 20) }]) {
    assert.deepEqual(buffer.interpolate(previous, current, 0.5, opts), interpolateRenderState(previous, current, 0.5, opts));
  }
  assert.equal(JSON.stringify({ previous, current, options }), before);
});

test('matching and continuity are prepared once per immutable snapshot pair, not every display frame', () => {
  const counts = { uid: 0, kind: 0, action: 0 };
  const watch = value => new Proxy(value, { get(target, key) {
    if (Object.hasOwn(counts, key)) counts[key]++;
    return target[key];
  } });
  const buffer = new RenderInterpolationBuffer();
  const previous = [watch(entity(1))], current = [watch(entity(1, { px: 20 }))];
  buffer.interpolate(previous, current, 0);
  const baseline = { ...counts };
  for (let i = 1; i <= 240; i++) buffer.interpolate(previous, current, i / 240);
  assert.deepEqual(counts, baseline, 'no UID or continuity reads on an unchanged pair');
  buffer.interpolate(current, [watch(entity(1, { px: 40 }))], 0.5);
  assert.ok(counts.uid > baseline.uid && counts.action > baseline.action);
});

test('reused records remove stale properties, preserve symbols and own __proto__, and release removed slots', () => {
  const buffer = new RenderInterpolationBuffer(), symbol = Symbol('metadata');
  const first = [entity(1, { obsolete: 'old', [symbol]: 'old' }), entity(2)];
  const firstCamera = camera(10, 20, { obsolete: true });
  const output = buffer.interpolate(null, first, 0, { currentCamera: firstCamera });
  const item = output.snapshot[0];
  const special = entity(2, { px: 40, [symbol]: 'new' });
  Object.defineProperty(special, '__proto__', { value: { notPrototype: true }, enumerable: true });
  Object.defineProperty(special, 'hidden', { value: 123, enumerable: false });
  const current = [special], options = { currentCamera: camera(30, 40) };
  assert.deepEqual(buffer.interpolate(first, current, 0.5, options), interpolateRenderState(first, current, 0.5, options));
  assert.equal(output.snapshot[0], item); assert.equal(output.snapshot.length, 1);
  assert.equal(Object.getPrototypeOf(item), Object.prototype); assert.equal(item[symbol], 'new');
  assert.equal(Object.hasOwn(item, 'obsolete'), false); assert.equal(Object.hasOwn(item, 'hidden'), false);
  assert.equal(Object.hasOwn(output.camera, 'obsolete'), false);
  const final = [entity(1)];
  buffer.interpolate(current, final, 0.5);
  assert.equal(Object.hasOwn(item, symbol), false); assert.equal(Object.hasOwn(item, '__proto__'), false);
  buffer.interpolate(final, [], 0.5);
  assert.equal(output.snapshot.length, 0);
});

test('reset invalidates same-reference refreshes without overwriting the last presented camera or entities early', () => {
  const buffer = new RenderInterpolationBuffer();
  const previous = [entity(1)], current = [entity(1, { px: 20 })];
  const options = { previousCamera: camera(0, 0), currentCamera: camera(20, 20) };
  const output = buffer.interpolate(previous, current, 0.5, options), held = structuredClone(output);
  current[0].px = 100; options.currentCamera.x = 100;
  buffer.reset();
  assert.deepEqual(output, held, 'input between updates still sees the last presented view');
  const next = buffer.interpolate(current, current, 0.5,
    { previousCamera: options.currentCamera, currentCamera: options.currentCamera });
  assert.equal(next, output); assert.equal(next.snapshot[0].px, 100); assert.equal(next.camera.x, 100);
});

test('buffer preserves exact endpoint and overflow-safe position/camera arithmetic', () => {
  const buffer = new RenderInterpolationBuffer();
  for (const [a, b] of [[1e308, -1e308], [-1e308, 1e308], [1e16, 1], [-0, 0], [0, -0]]) {
    const previous = [entity(1, { px: a, py: a, pz: a })], current = [entity(1, { px: b, py: b, pz: b })];
    const options = { previousCamera: camera(a, a), currentCamera: camera(b, b) };
    for (const alpha of [0, 0.00001, 0.5, 0.99999, 1]) {
      assert.deepEqual(buffer.interpolate(previous, current, alpha, options), interpolateRenderState(previous, current, alpha, options));
    }
  }
});

test('buffer rejects malformed inputs consistently without touching either input', () => {
  const previous = freeze([entity(1)]), current = freeze([entity(1, { px: 10 })]);
  const buffer = new RenderInterpolationBuffer();
  for (const alpha of [NaN, Infinity, '0.5']) assert.throws(() => buffer.interpolate(previous, current, alpha));
  for (const value of [null, {}, 'bad', [null]]) assert.throws(() => buffer.interpolate(previous, value, 0.5));
  for (const value of [{}, 'bad', [null]]) assert.throws(() => buffer.interpolate(value, current, 0.5));
  for (const value of [[], 'bad', 4]) assert.throws(() => buffer.interpolate(previous, current, 0.5, { currentCamera: value }));
  assert.throws(() => buffer.interpolate(previous, current, 0.5, { previousCamera: [], currentCamera: camera(0, 0) }));
  assert.deepEqual(buffer.interpolate(previous, current, 0.5), interpolateRenderState(previous, current, 0.5));
});

test('deterministic mixed frames remain field-for-field equivalent to the pure reference', () => {
  const buffer = new RenderInterpolationBuffer();
  let seed = 617373, previous = null, previousCamera = null;
  const random = () => ((seed = Math.imul(seed, 1664525) + 1013904223 | 0) >>> 0) / 2 ** 32;
  for (let frame = 0; frame < 120; frame++) {
    const current = freeze(Array.from({ length: Math.floor(random() * 60) }, (_, i) => entity(Math.floor(random() * 80), {
      px: random() * 1000, py: random() * 1000, pz: random() * 20, side: random() < 0.1 ? 'right' : 'left',
      action: random() < 0.1 ? 'attack' : 'run', nowHP: random() < 0.1 ? 0 : 45,
      ...(i % 3 === 0 ? { transient: i } : {}), metadata: { frame },
    })));
    const currentCamera = freeze(camera(random() * 1000, random() * 100, { width: frame % 11 ? 640 : 900 }));
    const options = { previousCamera, currentCamera, cameraCut: frame % 13 === 0 };
    for (const alpha of [0, 0.125, 0.5, 0.875, 1]) {
      assert.deepEqual(buffer.interpolate(previous, current, alpha, options), interpolateRenderState(previous, current, alpha, options));
    }
    previous = current; previousCamera = currentCamera;
  }
});
