import test from 'node:test';
import assert from 'node:assert/strict';
import { interpolateSnapshots, interpolateCamera, interpolateRenderState } from '../src/runtime/render-interpolation.mjs';

const entity = (uid, values = {}) => ({ uid, kind: 'unit', side: 'left', id: 0, spriteIndex: 5,
  action: 'run', visible: true, sx: -1, sy: 1, px: 0, py: 10, pz: 0, nowHP: 45, displayFrame: 1, ...values });
const camera = (x, y, values = {}) => ({ x, y, width: 640, height: 400, ...values });
function freeze(value) { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }

test('continuous matching entities interpolate only world positions and preserve current discrete pose/HP', () => {
  const before = [entity(1)], after = [entity(1, { px: 8, py: 18, pz: 4, nowHP: 30, displayFrame: 2 })];
  const output = interpolateSnapshots(before, after, 0.25);
  assert.deepEqual(output, [entity(1, { px: 2, py: 12, pz: 1, nowHP: 30, displayFrame: 2 })]);
  assert.notEqual(output, after); assert.notEqual(output[0], after[0]);
});

test('uid matching never reorders current painter order or resurrects removed objects', () => {
  const before = [entity(1), entity(2, { px: 100 }), entity(3)];
  const after = [entity(2, { px: 120 }), entity(1, { px: 8 }), entity(4, { px: 500 })];
  const output = interpolateSnapshots(before, after, 0.5);
  assert.deepEqual(output.map(value => value.uid), [2, 1, 4]);
  assert.deepEqual(output.map(value => value.px), [110, 4, 500]);
});

test('births, death starts, action/skin/side/flip/visibility changes snap instead of blending unrelated states', () => {
  for (const change of [{ nowHP: 0 }, { action: 'attack' }, { spriteIndex: 2 }, { side: 'right' },
    { kind: 'attack' }, { sx: 1 }, { visible: false }]) {
    const current = entity(1, { px: 100, ...change });
    assert.deepEqual(interpolateSnapshots([entity(1)], [current], 0.1)[0], current);
  }
  const newborn = entity(2, { px: 300 });
  assert.deepEqual(interpolateSnapshots(null, [newborn], 0)[0], newborn);
});

test('continuous corpse flight may interpolate after the discrete death boundary', () => {
  const before = entity(1, { action: 'dead', nowHP: 0, px: 100, pz: 8 });
  const after = entity(1, { action: 'dead', nowHP: 0, px: 95, pz: 12 });
  const [output] = interpolateSnapshots([before], [after], 0.5);
  assert.equal(output.px, 97.5); assert.equal(output.pz, 10); assert.equal(output.nowHP, 0);
});

test('first visible projectile frame snaps and later same-visible flight interpolates without early impact/HP changes', () => {
  const before = entity(1, { kind: 'attack', visible: false, nowHP: undefined, weaponSheet: 'fb', px: 100 });
  const current = { ...before, visible: true, px: 120 };
  assert.equal(interpolateSnapshots([before], [current], 0.5)[0].px, 120);
  assert.equal(interpolateSnapshots([current], [{ ...current, px: 140 }], 0.5)[0].px, 130);
});

test('cameras interpolate independently but resize/projection cuts snap to current dimensions', () => {
  assert.deepEqual(interpolateCamera(camera(10, 20), camera(30, 40), 0.25), camera(15, 25));
  const resized = camera(30, 40, { width: 1000 });
  assert.deepEqual(interpolateCamera(camera(10, 20), resized, 0.25), resized);
  assert.deepEqual(interpolateCamera(camera(10, 20), camera(30, 40), 0.25, { cut: true }), camera(30, 40));
});

test('frozen input snapshots and cameras remain byte/field-identical and are never called as game objects', () => {
  let forbiddenCalls = 0;
  const previous = freeze([entity(1, { step() { forbiddenCalls++; }, rng() { forbiddenCalls++; } })]);
  const current = freeze([entity(1, { px: 10, step() { forbiddenCalls++; }, rng() { forbiddenCalls++; } })]);
  const previousCamera = freeze(camera(10, 20)), currentCamera = freeze(camera(30, 40));
  const before = JSON.stringify({ previous, current, previousCamera, currentCamera });
  const output = interpolateRenderState(previous, current, 0.5, { previousCamera, currentCamera });
  output.snapshot[0].px = 999; output.camera.x = 999;
  assert.equal(JSON.stringify({ previous, current, previousCamera, currentCamera }), before);
  assert.equal(forbiddenCalls, 0);
});

test('missing/duplicate uid or non-finite coordinates cannot pair unrelated entities', () => {
  const current = entity(1, { px: 100 });
  assert.equal(interpolateSnapshots([entity(1), entity(1, { px: 5 })], [current], 0.5)[0].px, 100);
  assert.equal(interpolateSnapshots([entity(1)], [current, { ...current }], 0.5)[0].px, 100);
  assert.equal(interpolateSnapshots([entity(undefined)], [entity(undefined, { px: 100 })], 0.5)[0].px, 100);
  assert.equal(interpolateSnapshots([entity(1, { px: NaN })], [current], 0.5)[0].px, 100);
});

test('alpha is clamped to interpolation endpoints and invalid input is rejected', () => {
  const previous = [entity(1)], current = [entity(1, { px: 10 })];
  assert.equal(interpolateSnapshots(previous, current, -10)[0].px, 0);
  assert.equal(interpolateSnapshots(previous, current, 10)[0].px, 10);
  for (const alpha of [NaN, Infinity, '0.5']) assert.throws(() => interpolateSnapshots(previous, current, alpha));
  for (const value of [null, {}, 'bad']) assert.throws(() => interpolateSnapshots(previous, value, 0.5));
  assert.throws(() => interpolateSnapshots(previous, [null], 0.5));
});

test('finite endpoint positions remain exact and opposite large coordinates do not overflow interpolation', () => {
  const before = [entity(1, { px: 1e16 })], after = [entity(1, { px: 1 })];
  assert.equal(interpolateSnapshots(before, after, 1)[0].px, 1);
  assert.equal(interpolateSnapshots(before, after, 0)[0].px, 1e16);
  const extremes = interpolateSnapshots([entity(1, { px: 1e308 })], [entity(1, { px: -1e308 })], 0.5);
  assert.equal(extremes[0].px, 0);
});
