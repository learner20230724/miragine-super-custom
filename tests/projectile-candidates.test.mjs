import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MiragineSimulation, seededRandom } from '../src/core/index.mjs';
import { SpatialIndex } from '../src/performance/spatial-index.mjs';
import { installSpatialOptimization, releaseSpatialIndexes, visitProjectileCandidates } from '../src/performance/simulation-spatial.mjs';

const defaults = JSON.parse(readFileSync(new URL('../config/defaults.generated.json', import.meta.url), 'utf8'));
const within = (entity, box) => entity.px >= box.minX && entity.px <= box.maxX && entity.py >= box.minY && entity.py <= box.maxY;
const ids = list => list.map(entity => entity.uid).sort((a, b) => a - b);
function indexed(index, bounds) {
  const result = [];
  assert.equal(index.visitRectangle(bounds, entity => result.push(entity)), true);
  return result;
}
function candidates(sim, side, bounds) {
  const result = [];
  const usedIndex = visitProjectileCandidates(sim, side, bounds, entity => result.push(entity));
  return { result, usedIndex };
}
function make(count = 32, optimized = true) {
  const sim = new MiragineSimulation({ config: structuredClone(defaults), rng: seededRandom(17), autoStart: false });
  sim.leftMoney = sim.rightMoney = sim.leftPopulation = sim.rightPopulation = 1e6;
  for (const side of ['left', 'right']) for (let i = 0; i < count; i++) {
    const entity = sim.createUnit(side, 0);
    entity.px = (i % 8) * 10; entity.py = Math.floor(i / 8) * 10;
  }
  // Deterministic positions without AI or combat; the original live-list Scene
  // loop and the optimization's own movement wrappers still run unchanged.
  for (const entity of sim.scene.children) entity.step = function () { this.onTestStep?.(); };
  if (optimized !== null) installSpatialOptimization(sim, { enabled: optimized });
  return sim;
}
function duringScene(sim, callback) {
  const marker = { kind: 'attack', parent: null, step: callback };
  sim.scene.addChild(marker);
  try { sim.scene.step(); } finally { if (marker.parent) sim.scene.removeChild(marker); }
}

test('rectangle query matches a linear closed-box oracle under random updates and refits', () => {
  const random = seededRandom(0x61487), index = new SpatialIndex();
  const entries = Array.from({ length: 127 }, (_, uid) => ({ uid, px: random() * 200 - 100, py: random() * 200 - 100, nowHP: 100 }));
  index.rebuild(entries);
  for (let cycle = 0; cycle < 100; cycle++) {
    for (let j = 0; j < 4; j++) {
      const entity = entries[Math.floor(random() * entries.length)];
      entity.px = random() * 200 - 100; entity.py = random() * 200 - 100;
      index.update(entity);
    }
    if (cycle % 7 === 0) index.synchronize(entries);
    const x = random() * 240 - 120, y = random() * 240 - 120;
    const bounds = { minX: x, minY: y, maxX: x + random() * 60, maxY: y + random() * 60 };
    assert.deepEqual(ids(indexed(index, bounds)), ids(entries.filter(entity => within(entity, bounds))));
    const query = { px: x, py: y };
    const before = index.nearest(query, 30);
    indexed(index, bounds);
    assert.equal(index.nearest(query, 30), before, 'rectangle traversal does not alter nearest semantics');
  }
});

test('rectangle bounds include corners, equal axes, zero, subnormal and safe extreme coordinates', () => {
  const index = new SpatialIndex();
  for (const size of [0, Number.MIN_VALUE, 1e-200, 10, 1e100]) {
    const entries = [
      { uid: 0, px: -size, py: -size }, { uid: 1, px: size, py: -size },
      { uid: 2, px: -size, py: size }, { uid: 3, px: size, py: size },
      { uid: 4, px: -0, py: 0 },
    ];
    index.rebuild(entries);
    const box = { minX: -size, minY: -size, maxX: size, maxY: size };
    assert.deepEqual(ids(indexed(index, box)), ids(entries));
    const point = { minX: size, minY: size, maxX: size, maxY: size };
    assert.deepEqual(ids(indexed(index, point)), ids(entries.filter(entity => within(entity, point))));
  }
  index.clear();
  assert.deepEqual(indexed(index, { minX: 0, minY: 0, maxX: 0, maxY: 0 }), []);
});

test('unsupported rectangle or index declines before invoking its visitor', () => {
  const index = new SpatialIndex();
  index.rebuild([{ px: 0, py: 0 }]);
  const bounds = { minX: 0, minY: 0, maxX: 1, maxY: 1 };
  for (const invalid of [null, {}, { ...bounds, minX: NaN }, { ...bounds, minX: 2 },
    { ...bounds, maxY: Infinity }, { ...bounds, maxX: Number.MAX_VALUE }]) {
    assert.equal(index.visitRectangle(invalid, () => assert.fail('unsupported index query must not visit')), false);
  }
  index.rebuild([{ px: Number.MAX_VALUE, py: 0 }]);
  assert.equal(index.visitRectangle(bounds, () => assert.fail('invalid index must not visit')), false);
});

test('projectile queries use opposing live indexes only during Scene.step', () => {
  const sim = make(), box = { minX: 10, minY: 0, maxX: 30, maxY: 10 };
  for (const side of ['left', 'right']) {
    const list = side === 'left' ? sim.enemyList : sim.friendList;
    assert.equal(candidates(sim, side, box).usedIndex, false);
    duringScene(sim, () => {
      const actual = candidates(sim, side, box);
      assert.equal(actual.usedIndex, true);
      assert.deepEqual(ids(actual.result), ids(list.filter(entity => within(entity, box))));
    });
    // Paused/manual edits cannot query the preceding frame's stale bounds.
    list[1].px = 20; list[1].py = 5;
    const paused = candidates(sim, side, box);
    assert.equal(paused.usedIndex, false);
    assert.deepEqual(ids(paused.result), ids(list.filter(entity => within(entity, box))));
  }
});

test('movement updates, deaths, and spawning inside Scene.step do not hide candidates', () => {
  const box = { minX: 14, minY: 4, maxX: 16, maxY: 6 }, sim = make(40);
  const moving = sim.enemyList[1], dying = sim.enemyList[2];
  moving.px = 10000; moving.py = 10000;
  moving.onTestStep = () => { moving.px = 15; moving.py = 5; };
  dying.px = 15; dying.py = 5;
  dying.onTestStep = () => { if (dying.nowHP > 0) dying.dead(); };
  duringScene(sim, () => {
    const actual = candidates(sim, 'left', box);
    assert.equal(actual.usedIndex, true);
    assert.ok(actual.result.includes(moving), 'per-entity refit sees current position');
    assert.deepEqual(ids(actual.result.filter(entity => entity.nowHP > 0 && entity.parent === sim.scene)),
      ids(sim.enemyList.filter(entity => entity.nowHP > 0 && within(entity, box))));
    const added = sim.createUnit('right', 0); added.px = 15; added.py = 5;
    const afterSpawn = candidates(sim, 'left', box);
    assert.equal(afterSpawn.usedIndex, false, 'new insertion invalidates the shared hierarchy');
    assert.ok(afterSpawn.result.includes(added));
    assert.deepEqual(ids(afterSpawn.result), ids(sim.enemyList.filter(entity => within(entity, box))));
  });
});

test('small, absent, disabled, released and extreme-coordinate indexes use linear fallback', () => {
  const box = { minX: 0, minY: 0, maxX: 70, maxY: 100 };
  for (const sim of [make(3), make(32, null), make(32, false)]) {
    duringScene(sim, () => {
      const actual = candidates(sim, 'left', box);
      assert.equal(actual.usedIndex, false);
      assert.deepEqual(ids(actual.result), ids(sim.enemyList.filter(entity => within(entity, box))));
    });
  }
  const sim = make();
  duringScene(sim, () => {
    releaseSpatialIndexes(sim);
    const actual = candidates(sim, 'left', box);
    assert.equal(actual.usedIndex, false);
    assert.deepEqual(ids(actual.result), ids(sim.enemyList.filter(entity => within(entity, box))));
  });
  const enormous = sim.enemyList[1];
  enormous.onTestStep = () => { enormous.px = Number.MAX_VALUE / 2; enormous.py = 0; };
  duringScene(sim, () => {
    const hugeBox = { minX: Number.MAX_VALUE / 4, minY: 0, maxX: Number.MAX_VALUE, maxY: 0 };
    const actual = candidates(sim, 'left', hugeBox);
    assert.equal(actual.usedIndex, false);
    assert.deepEqual(actual.result, [enormous]);
  });
});

test('invalid bounds are conservative and infinite bounds avoid unsafe arithmetic', () => {
  const sim = make();
  duringScene(sim, () => {
    for (const bounds of [null, {}, { minX: NaN, maxX: 5, minY: 0, maxY: 5 },
      { minX: 20, maxX: 10, minY: 0, maxY: 5 }]) {
      const actual = candidates(sim, 'left', bounds);
      assert.equal(actual.usedIndex, false);
      assert.deepEqual(ids(actual.result), ids(sim.enemyList));
    }
    const box = { minX: -Infinity, minY: -Infinity, maxX: Infinity, maxY: Infinity };
    const actual = candidates(sim, 'left', box);
    assert.equal(actual.usedIndex, false);
    assert.deepEqual(ids(actual.result), ids(sim.enemyList));
  });
  assert.throws(() => visitProjectileCandidates(sim, 'neutral', {}, () => {}), /side/);
  assert.throws(() => visitProjectileCandidates(sim, 'left', {}, null), /visitor/);
});
