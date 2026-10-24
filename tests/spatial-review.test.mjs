import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MiragineSimulation, seededRandom } from '../src/core/index.mjs';
import { CustomMiragineSimulation, installCustomRuntime } from '../src/customization/runtime.mjs';
import { installSpatialOptimization, hasSpatialOptimization, releaseSpatialIndexes } from '../src/performance/simulation-spatial.mjs';
import { SpatialIndex } from '../src/performance/spatial-index.mjs';
import { SeparationGrid } from '../src/performance/separation-grid.mjs';

const defaults = JSON.parse(readFileSync(new URL('../config/defaults.generated.json', import.meta.url), 'utf8'));
function make(optimized, custom = true) {
  const Type = custom ? CustomMiragineSimulation : MiragineSimulation;
  const random = seededRandom(0x719253);
  let randomCalls = 0;
  const sim = new Type({ config: structuredClone(defaults), autoStart: false, spatialOptimization: false,
    rng: () => { randomCalls++; return random(); } });
  installSpatialOptimization(sim, { enabled: optimized });
  assert.equal(hasSpatialOptimization(sim), optimized);
  sim.randomCalls = () => randomCalls;
  sim.leftMoney = sim.rightMoney = 1e8;
  sim.leftPopulation = sim.rightPopulation = 1e8;
  sim.stopTimer = true;
  return sim;
}
function populate(sim, perSide = 32, close = true) {
  for (const side of ['left', 'right']) for (let i = 0; i < perSide; i++) {
    const entity = sim.createUnit(side, i % 16);
    entity.px = (close ? 2250 : side === 'left' ? 1000 : 3500) + (i % 6) * 9;
    entity.py = 200 + Math.floor(i / 6) * 8;
  }
}
function snapshot(sim) {
  return { state: sim.snapshot(), events: sim.drainEvents(), randomCalls: sim.randomCalls(), nextUid: sim.nextUid,
    friends: sim.friendList.map(x => x.uid), enemies: sim.enemyList.map(x => x.uid),
    children: sim.scene.children.map(e => ({ uid: e.uid, target: e.target?.uid, father: e.father?.uid,
      vx: e.vx, vy: e.vy, vz: e.vz, t: e.t, deadTime: e.deadTime, life: e.life, delay: e.delay, direction: e.direction })) };
}
function compare(a, b, frames) {
  for (let i = 0; i < frames; i++) { a.step(); b.step(); assert.deepEqual(snapshot(b), snapshot(a), `frame ${a.frame}`); }
}

test('independent review: enabled custom path stays exact through dense fighting and repeated runtime reinstall', () => {
  const a = make(false), b = make(true);
  populate(a); populate(b);
  compare(a, b, 45);
  for (let cycle = 0; cycle < 4; cycle++) {
    for (const sim of [a, b]) {
      const config = structuredClone(defaults);
      config.rules.movementMultiplier = cycle % 2 ? 1.3 : 0;
      config.units[0].hp = cycle % 2 ? 45 : 100;
      installCustomRuntime(sim, config);
    }
    assert.equal(hasSpatialOptimization(a), false);
    assert.equal(hasSpatialOptimization(b), true);
    compare(a, b, 12);
  }
});

test('independent review: death and recruitment during a live Scene.step preserve list mutation order', () => {
  for (const custom of [false, true]) {
    const a = make(false, custom), b = make(true, custom);
    for (const sim of [a, b]) {
      populate(sim, 24, false);
      const first = sim.scene.children[0], step = first.step;
      let injected = false;
      first.step = function () {
        const result = step.call(this);
        if (!injected) {
          injected = true;
          sim.enemyList[1].dead();
          sim.enemyList[1].dead();
          const added = sim.createUnit('right', 9);
          added.px = 1005; added.py = 200;
        }
        return result;
      };
    }
    compare(a, b, 40);
  }
});

test('independent review: crossing indexing threshold by deaths remains exact without new births', () => {
  const a = make(false), b = make(true);
  for (const sim of [a, b]) {
    populate(sim, 24, false);
    const first = sim.scene.children[0], step = first.step;
    let injected = false;
    first.step = function () {
      const result = step.call(this);
      if (!injected) { injected = true; sim.enemyList[1].dead(); sim.enemyList[1].dead(); }
      return result;
    };
  }
  compare(a, b, 30);
});

test('independent review: nearest order survives deaths, signed zero, underflow, and repeated rebuilds', () => {
  const index = new SpatialIndex();
  const cases = [0, Number.MIN_VALUE, 1e-200, 1e-150, 40, 1e99];
  for (const scale of cases) {
    const entries = Array.from({ length: 41 }, (_, i) => ({ px: (i % 2 ? -1 : 1) * scale,
      py: (i % 3 - 1) * scale, nowHP: i % 7 === 0 ? 0 : 100 }));
    for (const weight of [0, Number.MIN_VALUE, 1e-200, 1, 30, 1e100]) {
      index.rebuild(entries);
      const query = { px: -0, py: 0, target: entries.at(-1) };
      let expected = null, best = Number.MAX_VALUE;
      for (const entry of entries) if (entry.nowHP !== 0) {
        const dx = entry.px - query.px, dy = entry.py - query.py;
        const score = dx * dx + weight * (dy * dy);
        if (score < best) { best = score; expected = entry; }
      }
      assert.equal(index.nearest(query, weight), expected, `scale ${scale}; weight ${weight}`);
      entries.reverse();
    }
  }
});

test('independent review: exact-radius and adjacent floating values preserve reverse separation', () => {
  for (const radius of [Number.MIN_VALUE, 1e-200, 1e-150, 0.5, 40, 1e99]) {
    const a = make(false, false), b = make(true, false);
    for (const sim of [a, b]) {
      populate(sim, 32, false);
      sim.rules.unitSeparationDistance = radius;
      for (const [i, entity] of sim.friendList.entries()) {
        entity.px = radius * (i % 4) * (i % 3 === 0 ? 1 - Number.EPSILON : i % 3 === 1 ? 1 : 1 + Number.EPSILON);
        entity.py = radius * Math.floor(i / 4);
      }
    }
    assert.equal(b.separate(b.friendList, true)?.uid, a.separate(a.friendList, true)?.uid);
    assert.deepEqual(b.friendList.map(x => [x.px, x.py]), a.friendList.map(x => [x.px, x.py]), `radius ${radius}`);
  }
});

test('independent review: grid guard limits, floating cell edges and lower-j queries match brute force', () => {
  const random = seededRandom(0x559331), grid = new SeparationGrid();
  for (const radius of [1e-150, 1e-100, 0.25, 40, 1e80]) {
    for (const offset of [-(2 ** 40) + 4, -2, 0, 2, 2 ** 40 - 4]) {
      const cell = radius * 2;
      const list = Array.from({ length: 48 }, (_, i) => ({
        px: cell * (offset + (i % 4) - 1 + (i % 3 === 0 ? Number.EPSILON : 0)),
        py: cell * (offset + Math.floor(i / 4) % 4 - 1),
      }));
      assert.equal(grid.rebuild(list, radius), true);
      for (let query = 0; query < 80; query++) {
        const x = cell * (offset + random() * 4 - 1.5), y = cell * (offset + random() * 4 - 1.5);
        const before = 1 + query % list.length;
        let expected = -1;
        for (let j = before - 1; j >= 0; j--) {
          const dx = x - list[j].px, dy = y - list[j].py;
          if (dx * dx + dy * dy < radius * radius) { expected = j; break; }
        }
        assert.equal(grid.previousCollision(x, y, before), expected,
          `radius ${radius}, offset ${offset}, query ${query}`);
      }
    }
  }
  assert.equal(grid.rebuild([{ px: 1e99, py: 0 }], 1e-200), false);
  assert.equal(grid.columns.size, 0);
  assert.equal(grid.list, null);
});

test('independent review: releasing caches between or during steps preserves fallback and enabled state', () => {
  const a = make(false), b = make(true);
  populate(a); populate(b);
  compare(a, b, 8);
  releaseSpatialIndexes(a); releaseSpatialIndexes(b);
  assert.equal(hasSpatialOptimization(a), false); assert.equal(hasSpatialOptimization(b), true);
  compare(a, b, 8);
  for (const sim of [a, b]) {
    const first = sim.scene.children[0], step = first.step;
    first.step = function () { const value = step.call(this); releaseSpatialIndexes(sim); return value; };
  }
  compare(a, b, 8);
});
