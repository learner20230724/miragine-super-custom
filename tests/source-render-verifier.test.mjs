import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { makeSourceRenderFixtures, parseOptions, summarizeTimings } from '../tools/verify-source-rendering.mjs';

test('source verifier options default to owned Edge and reject unrelated arguments', () => {
  assert.deepEqual(parseOptions([]), { channel: 'msedge' });
  assert.deepEqual(parseOptions(['--channel', 'chrome', '--help']), { channel: 'chrome', help: true });
  assert.throws(() => parseOptions(['--channel']), /Missing value/);
  assert.throws(() => parseOptions(['--url', 'http://example.com']), /Unknown option/);
});

test('submission summary uses nearest-rank p95 and does not reorder raw observations', () => {
  const values = [4, 0, 2, 1, 3];
  assert.deepEqual(summarizeTimings(values), { samples: 5, unit: 'ms/render submission', median: 2, p95: 4, minimum: 0, maximum: 4 });
  assert.deepEqual(values, [4, 0, 2, 1, 3]);
  assert.equal(summarizeTimings([3, 1]).median, 2);
  assert.equal(summarizeTimings(Array.from({ length: 20 }, (_, index) => index + 1)).p95, 19);
  for (const input of [[], [-1], [NaN], [Infinity], null]) assert.throws(() => summarizeTimings(input), /finite nonnegative/);
});

test('pure gallery fixtures cover every unit/team/action and all three effects plus empty storm 10', () => {
  const manifest = JSON.parse(fs.readFileSync(new URL('../generated/asset-manifest.json', import.meta.url), 'utf8'));
  const before = JSON.stringify(manifest), fixtures = makeSourceRenderFixtures(manifest);
  assert.equal(JSON.stringify(manifest), before);
  assert.deepEqual(fixtures.scenes.map(scene => scene.name), ['idle', 'run', 'attack', 'dead']);
  for (const scene of fixtures.scenes) {
    assert.equal(scene.snapshot.length, 38);
    for (const side of ['left', 'right']) assert.deepEqual(scene.snapshot.filter(entity => entity.kind === 'unit' && entity.side === side)
      .map(entity => entity.spriteIndex), Array.from({ length: 16 }, (_, index) => index));
    assert.equal(scene.snapshot.filter(entity => entity.kind === 'base').length, 2);
    assert.deepEqual(scene.snapshot.filter(entity => entity.kind === 'attack').map(entity => [entity.weaponSheet, entity.displayFrame]),
      [['fb', 1], ['tb', 1], ['storm', 1], ['storm', 10]]);
  }
  for (const view of [fixtures.normalView, fixtures.closeView]) {
    assert.equal(view.width, 640); assert.equal(view.height, 400); assert.equal(view.kind, 'observation-view');
  }
  assert.equal(fixtures.normalView.zoom, 1); assert.equal(fixtures.closeView.zoom, 2);
  assert.throws(() => makeSourceRenderFixtures({ sprites: {} }), /Missing fixture sprite/);
});
