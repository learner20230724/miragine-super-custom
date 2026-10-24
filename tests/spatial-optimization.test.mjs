import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MiragineSimulation, seededRandom } from '../src/core/index.mjs';
import { CustomMiragineSimulation, installCustomRuntime } from '../src/customization/runtime.mjs';
import { GameController } from '../src/app/controller.mjs';
import { installSpatialOptimization, hasSpatialOptimization } from '../src/performance/simulation-spatial.mjs';
import { SpatialIndex } from '../src/performance/spatial-index.mjs';

const defaults = JSON.parse(readFileSync(new URL('../config/defaults.generated.json', import.meta.url), 'utf8'));
function make({ custom = false, optimized = false, seed = 725, config = defaults, difficulty = 3 } = {}) {
  const random = seededRandom(seed); let count = 0;
  const rng = () => { count++; return random(); };
  const Type = custom ? CustomMiragineSimulation : MiragineSimulation;
  const sim = new Type({ config: structuredClone(config), rng, autoStart: false, difficulty, spatialOptimization: false });
  if (optimized) installSpatialOptimization(sim, { enabled: true });
  assert.equal(hasSpatialOptimization(sim), optimized);
  sim.randomCalls = () => count;
  return sim;
}
function populate(sim, count, { dense = false, mixed = true } = {}) {
  sim.leftMoney = sim.rightMoney = 100000000; sim.leftPopulation = sim.rightPopulation = 100000000;
  for (let i = 0; i < count; i++) {
    const side = i % 2 ? 'left' : 'right', entity = sim.createUnit(side, mixed ? i % 16 : 0);
    entity.px = dense ? 2230 + (i % 7) * 3 : 1700 + ((i * 79) % 1000);
    entity.py = dense ? 400 + (i % 5) * 2 : 240 + ((i * 37) % 320);
  }
}
function detail(sim) {
  return { snapshot: sim.snapshot(), randomCalls: sim.randomCalls(), nextUid: sim.nextUid,
    friends: sim.friendList.map(e => e.uid), enemies: sim.enemyList.map(e => e.uid),
    children: sim.scene.children.map(e => ({ uid: e.uid, target: e.target?.uid, father: e.father?.uid,
      vx: e.vx, vy: e.vy, vz: e.vz, t: e.t, deadTime: e.deadTime, life: e.life, delay: e.delay, direction: e.direction })),
    events: sim.drainEvents() };
}
function compare(reference, accelerated, frames, label) {
  for (let i = 0; i < frames; i++) {
    reference.step(); accelerated.step();
    assert.deepEqual(detail(accelerated), detail(reference), `${label}, frame ${reference.frame}`);
  }
}

for (const custom of [false, true]) for (const dense of [false, true]) {
  test(`spatial/reference exact per-frame parity: ${custom ? 'custom' : 'original'} ${dense ? 'dense' : 'spread'} mixed units`, () => {
    const reference = make({ custom }), accelerated = make({ custom, optimized: true });
    populate(reference, 96, { dense }); populate(accelerated, 96, { dense });
    compare(reference, accelerated, 100, 'mixed combat');
    for (const sim of [reference, accelerated]) { sim.round = 1; sim.leftMoney = sim.rightMoney = 20000; }
    compare(reference, accelerated, 25, 'income, AI and recruitment');
    for (const sim of [reference, accelerated]) sim.destroyUnits(1);
    compare(reference, accelerated, 35, 'death animation and cleared side');
    populate(reference, 64, { dense: !dense }); populate(accelerated, 64, { dense: !dense });
    compare(reference, accelerated, 15, 'new recruits after clear');
  });
}

test('1000 mixed units preserve all frame state, target UIDs, events and RNG', () => {
  const reference = make(), accelerated = make({ optimized: true });
  populate(reference, 1000); populate(accelerated, 1000);
  compare(reference, accelerated, 6, '1000 units');
});

test('nearest ties use targetList order, zero weights and sequential index updates are exact', () => {
  const entities = Array.from({ length: 60 }, (_, order) => ({ px: order % 2 ? -10 : 10, py: order % 3, nowHP: 100 }));
  const index = new SpatialIndex(); index.rebuild(entities);
  const query = { px: 0, py: 0, target: entities[59] };
  assert.equal(index.nearest(query, 0), entities[0]);
  assert.equal(index.nearest(query, 100), entities[0]);
  entities[0].nowHP = 0; assert.equal(index.nearest(query, 100), entities[3]);
  entities[59].px = 0; entities[59].py = 0; index.update(entities[59]);
  assert.equal(index.nearest(query, 100), entities[59]);
  entities[59].px = Number.MAX_VALUE; index.update(entities[59]);
  assert.equal(index.nearest(query, 100), undefined, 'unsupported live movement falls back');
});

test('separation re-queries after each push and preserves reverse i/j and front rounding', () => {
  const reference = make(), accelerated = make({ optimized: true });
  for (const sim of [reference, accelerated]) {
    populate(sim, 60); sim.rules.unitSeparationDistance = 10;
    const list = sim.friendList;
    for (let i = 0; i < list.length; i++) { list[i].px = i * 100; list[i].py = 10; }
    // Last entity is pushed right by j=2, newly colliding with formerly distant j=1.
    list.at(-1).px = 1.25; list[2].px = 0; list[1].px = 18;
  }
  const a = reference.separate(reference.friendList, true), b = accelerated.separate(accelerated.friendList, true);
  assert.equal(b?.uid, a?.uid);
  assert.deepEqual(accelerated.friendList.map(e => [e.px, e.py]), reference.friendList.map(e => [e.px, e.py]));
});

test('custom live upgrade, repeated install, extreme fields, clear and disable keep exact semantics', () => {
  const reference = make(), accelerated = make({ optimized: true });
  populate(reference, 64); populate(accelerated, 64);
  compare(reference, accelerated, 5, 'before custom upgrade');
  for (const sim of [reference, accelerated]) installCustomRuntime(sim, structuredClone(sim.config));
  installSpatialOptimization(reference, { enabled: false });
  for (let i = 0; i < 3; i++) installSpatialOptimization(accelerated);
  compare(reference, accelerated, 8, 'custom upgrade');
  for (const sim of [reference, accelerated]) {
    sim.rules.targetVerticalWeight = Number.MAX_VALUE;
    sim.rules.unitSeparationDistance = Number.MAX_VALUE;
    for (const [i, entity] of sim.scene.children.entries()) if (entity.kind !== 'attack') {
      entity.px = (i % 2 ? -1 : 1) * 1e200; entity.py = i * 1e198; entity.moveSpeed = 0;
    }
  }
  compare(reference, accelerated, 3, 'huge-coordinate reference fallback');
  installSpatialOptimization(accelerated, { enabled: false });
  assert.equal(hasSpatialOptimization(accelerated), false);
  compare(reference, accelerated, 3, 'explicit disabled reference');
});

test('original adapter fallback preserves NaN, Infinity, negative weight/radius and duplicate lists', () => {
  for (const variant of ['nan', 'infinity', 'negative', 'duplicate']) {
    const reference = make(), accelerated = make({ optimized: true });
    for (const sim of [reference, accelerated]) {
      populate(sim, 60);
      if (variant === 'nan') sim.friendList[1].px = NaN;
      if (variant === 'infinity') sim.enemyList[2].py = Infinity;
      if (variant === 'negative') { sim.rules.targetVerticalWeight = -2; sim.rules.unitSeparationDistance = -8; }
      if (variant === 'duplicate') sim.friendList.push(sim.friendList[1]);
    }
    compare(reference, accelerated, 2, variant);
  }
});

test('controller enables original and custom battles, restarts do not mutate core prototypes', () => {
  const referenceMethod = MiragineSimulation.prototype.separate;
  const controller = new GameController(structuredClone(defaults));
  controller.startMatch(); const previous = controller.simulation;
  assert.equal(hasSpatialOptimization(previous), true);
  controller.startMatch(false, 3);
  assert.notEqual(controller.simulation, previous); assert.equal(hasSpatialOptimization(controller.simulation), true);
  assert.equal(MiragineSimulation.prototype.separate, referenceMethod);
  assert.equal(hasSpatialOptimization(make()), false);
  assert.equal(hasSpatialOptimization(new CustomMiragineSimulation({ config: structuredClone(defaults), autoStart: false })), true);
});

test('deterministic nearest-query fuzz covers floating boundaries, variable weights and live moves', () => {
  const random = seededRandom(0x451302), index = new SpatialIndex();
  for (const scale of [1e-100, 1e-6, 1, 10000, 1e99]) {
    const list = Array.from({ length: 128 }, () => ({ px: (random() - 0.5) * scale, py: (random() - 0.5) * scale, nowHP: 1 }));
    index.rebuild(list);
    for (let i = 0; i < 100; i++) {
      const query = { px: (random() - 0.5) * scale, py: (random() - 0.5) * scale, target: list[i % list.length] };
      const weight = [0, 1e-100, 1, 100, 1e100][i % 5];
      let expected = null, nearest = Number.MAX_VALUE;
      for (const entity of list) if (entity.nowHP !== 0) {
        const dx = entity.px - query.px, dy = entity.py - query.py, score = dx * dx + weight * (dy * dy);
        if (score < nearest) { nearest = score; expected = entity; }
      }
      assert.equal(index.nearest(query, weight), expected, `scale ${scale}, query ${i}`);
      const moving = list[i % list.length]; moving.px = query.px; moving.py = query.py;
      if (i % 11 === 0) moving.nowHP = 0;
      index.update(moving);
    }
  }
  index.clear();
  assert.equal(index.entries.length, 0); assert.equal(index.nodes.length, 0);
  assert.equal(index.byEntity.size, 0); assert.equal(index.best, null);
});

test('reverse separation fuzz includes strict radius boundaries, huge pushes and zero distance', () => {
  const random = seededRandom(31947);
  for (let scenario = 0; scenario < 40; scenario++) {
    const reference = make(), accelerated = make({ optimized: true });
    populate(reference, 64); populate(accelerated, 64);
    const radius = [0, 1e-100, 0.001, 8, 100, 1e99][scenario % 6];
    for (let i = 0; i < reference.friendList.length; i++) {
      const x = Math.floor(random() * 30) * (scenario % 3 ? 1 : radius);
      const y = Math.floor(random() * 30) * (scenario % 3 ? 1 : radius);
      for (const sim of [reference, accelerated]) {
        sim.rules.unitSeparationDistance = radius; sim.friendList[i].px = x; sim.friendList[i].py = y;
      }
    }
    assert.equal(accelerated.separate(accelerated.friendList, true)?.uid, reference.separate(reference.friendList, true)?.uid);
    assert.deepEqual(accelerated.friendList.map(e => [e.px, e.py]), reference.friendList.map(e => [e.px, e.py]));
  }
});

test('tree refit handles external positions, same-length reorder/replacement, and periodic rebuilds', () => {
  const index = new SpatialIndex(), random = seededRandom(17293);
  const list = Array.from({ length: 80 }, () => ({ px: random() * 400, py: random() * 300, nowHP: 1 }));
  const query = { px: 150, py: 100, target: null };
  for (let frame = 0; frame < 95; frame++) {
    if (frame === 15) list.reverse();
    if (frame === 50) list[0] = { px: 150, py: 100, nowHP: 1 };
    for (const entity of list) { entity.px += random() * 7 - 3.5; entity.py += random() * 7 - 3.5; }
    index.synchronize(list);
    let expected = null, nearest = Number.MAX_VALUE;
    for (const entity of list) {
      const dx = entity.px - query.px, dy = entity.py - query.py, score = dx * dx + 30 * (dy * dy);
      if (score < nearest) { nearest = score; expected = entity; }
    }
    assert.equal(index.nearest(query, 30), expected, `refit frame ${frame}`);
    query.target = expected;
  }
});
