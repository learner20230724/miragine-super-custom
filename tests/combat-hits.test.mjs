import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mergeConfiguration } from '../src/config/index.mjs';
import { MiragineSimulation, seededRandom } from '../src/core/index.mjs';
import { IsometricAttack } from '../src/core/entity.mjs';
import { CustomMiragineSimulation, installCustomRuntime } from '../src/customization/runtime.mjs';
import { GameController } from '../src/app/controller.mjs';
import { createCustomization } from '../src/customization/index.mjs';
import { installSpatialOptimization } from '../src/performance/simulation-spatial.mjs';
import { installCasterProjectileLifetime } from '../src/extensions/projectile-lifetime.mjs';
import { installCombatHitRules, segmentCircleContact } from '../src/extensions/combat-hits.mjs';

const read = path => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const defaults = read('../config/defaults.generated.json');
const effective = mergeConfiguration(defaults, read('../config/custom.json'));
const extend = sim => installCombatHitRules(installCasterProjectileLifetime(sim));
function create({ enabled = true, config = effective, optimized = true } = {}) {
  const sim = new CustomMiragineSimulation({ config: structuredClone(config), rng: seededRandom(27), autoStart: false });
  installSpatialOptimization(sim, { enabled: optimized });
  sim.leftMoney = sim.rightMoney = sim.leftPopulation = sim.rightPopulation = 1e9;
  sim.redBoss.px = -1e6; sim.blueBoss.px = 1e6;
  return enabled ? extend(sim) : sim;
}
function unit(sim, side, id, x, y = 0) {
  const e = sim.createUnit(side, id); e.px = x; e.py = y; e.nowHP = 10000;
  return e;
}
function shot(sim, father, target, { delay = 0, speed } = {}) {
  father.target = target; father.direction = target.px >= father.px ? 1 : -1;
  father.delayAttack = delay; father.t = 0; father.attack();
  const attack = sim.projectiles.at(-1);
  if (speed !== undefined) attack.vx = speed * father.direction;
  return attack;
}
function finish(attack, limit = 500) {
  for (let i = 0; i < limit && attack.parent; i++) attack.step();
  assert.equal(attack.parent, null, 'attack resolves before the test limit');
}
const amount = (father, target) => father.damage[target.armorTypeID] - target.armor;

test('segment/circle contact includes start, endpoint, tangent, reverse and vertical segments', () => {
  assert.equal(segmentCircleContact(0, 0, 100, 0, 50, 0, 10), 0.4);
  assert.equal(segmentCircleContact(100, 0, 0, 0, 50, 0, 10), 0.4);
  assert.equal(segmentCircleContact(0, 0, 0, 100, 0, 50, 10), 0.4);
  assert.equal(segmentCircleContact(0, 0, 100, 0, 100, 0, 0), 1);
  assert.equal(segmentCircleContact(0, 0, 100, 0, 50, 10, 10), 0.5);
  assert.equal(segmentCircleContact(0, 0, 100, 0, 50, 10.001, 10), null);
  assert.equal(segmentCircleContact(0, 0, 100, 0, -50, 0, 10), null);
  assert.equal(segmentCircleContact(0, 0, 100, 0, 150, 0, 10), null);
  assert.equal(segmentCircleContact(0, 0, 0, 0, 0, 0, 0), 0);
  assert.equal(segmentCircleContact(0, 0, 0, 0, 1, 0, 0), null);
  assert.equal(segmentCircleContact(0, 0, 100, 0, 5, 0, 10), 0);
  assert.ok(Math.abs(segmentCircleContact(0, 0, 1e200, 0, 5e199, 0, 1e199) - 0.4) < 1e-15);
  assert.equal(segmentCircleContact(-Number.MAX_VALUE, 0, Number.MAX_VALUE, 0, 0, 0, 1), 0.5);
  assert.equal(segmentCircleContact(0, 0, Infinity, 0, 50, 0, 10), null);
});

for (const id of [6, 9, 12, 'base']) for (const side of ['left', 'right']) {
  test(`${side} ${id}: static vertical gap 40 is hittable; range and damage formula unchanged`, () => {
    const sim = create(), sign = side === 'left' ? 1 : -1;
    const father = id === 'base' ? (side === 'left' ? sim.redBoss : sim.blueBoss) : unit(sim, side, id, 0);
    father.px = father.py = 0;
    const target = unit(sim, side === 'left' ? 'right' : 'left', 5, 100 * sign, 40);
    const range = father.range, hp = target.nowHP, attack = shot(sim, father, target, { delay: 5 });
    if (id !== 6) assert.equal(attack.life, 253);
    else assert.equal(attack.life, 100, 'nun retains original lifetime');
    finish(attack);
    assert.equal(target.nowHP, hp - amount(father, target));
    assert.equal(father.range, range);
    assert.equal(sim.drainEvents().filter(e => e.type === 'impact').length, 1);
  });
}

test('regression reproduces original 40/30 miss, while custom ranged and ordinary attacks damage', () => {
  for (const id of [0, 12]) for (const enabled of [false, true]) {
    const sim = create({ enabled }), father = unit(sim, 'left', id, 0), target = unit(sim, 'right', 5, 40, 35);
    father.target = target; const hp = target.nowHP;
    father.approachTarget(); const attack = sim.projectiles.at(-1);
    assert.ok(attack, 'original range gate accepts the target'); finish(attack);
    assert.equal(target.nowHP < hp, enabled);
  }
});

test('sweep hits first crossed enemy, not the locked enemy, even at high projectile speed', () => {
  const sim = create(), father = unit(sim, 'left', 12, 0), locked = unit(sim, 'right', 5, 400);
  const near = unit(sim, 'right', 5, 100), middle = unit(sim, 'right', 5, 200);
  const ally = unit(sim, 'left', 5, 50), dead = unit(sim, 'right', 5, 60); dead.nowHP = 0;
  const removed = unit(sim, 'right', 5, 70); sim.scene.removeChild(removed);
  const attack = shot(sim, father, locked, { speed: 1000 }); attack.step();
  assert.equal(attack.parent, null); assert.ok(Math.abs(attack.px - 74) < 1e-10);
  assert.equal(near.nowHP, 10000 - amount(father, near));
  for (const e of [locked, middle, ally, removed]) assert.equal(e.nowHP, 10000);
  assert.equal(dead.nowHP, 0);
});

test('dead locked target does not swallow a shot; it continues to the next enemy', () => {
  const sim = create(), father = unit(sim, 'left', 9, 0), locked = unit(sim, 'right', 5, 100);
  const behind = unit(sim, 'right', 5, 200), attack = shot(sim, father, locked);
  locked.nowHP = 0; finish(attack);
  assert.equal(behind.nowHP, 10000 - amount(father, behind));
  assert.equal(sim.drainEvents().find(e => e.type === 'impact').targetUid, behind.uid);
});

test('equal-distance overlap chooses stable UID independently of target-list order', () => {
  const sim = create(), father = unit(sim, 'left', 12, 0), a = unit(sim, 'right', 5, 100), b = unit(sim, 'right', 5, 100);
  sim.enemyList.reverse(); const attack = shot(sim, father, b); finish(attack);
  assert.ok(a.nowHP < 10000); assert.equal(b.nowHP, 10000);
});

test('aim is fixed after launch, target can dodge and an enemy farther along the ray can be hit', () => {
  const sim = create(), father = unit(sim, 'left', 12, 0), locked = unit(sim, 'right', 5, 100);
  const behind = unit(sim, 'right', 5, 300), attack = shot(sim, father, locked);
  attack.step(); const heading = [attack.vx, attack.vy]; locked.py = 200;
  finish(attack);
  assert.deepEqual([attack.vx, attack.vy], heading); assert.equal(locked.nowHP, 10000);
  assert.ok(behind.nowHP < 10000);
});

test('vertical and initially overlapping shots resolve without direction/X-crossing failures', () => {
  for (const y of [0, 100]) {
    const sim = create(), father = unit(sim, 'left', 12, 0), target = unit(sim, 'right', 5, 0, y);
    finish(shot(sim, father, target)); assert.ok(target.nowHP < 10000);
  }
});

test('crystal hurt radius differs from unit radius and no same-step double removal occurs at expiry', () => {
  const sim = create(), father = unit(sim, 'left', 12, 0), base = sim.blueBoss;
  base.px = 100; base.py = 0; base.nowHP = 10000;
  const attack = shot(sim, father, base, { speed: 1000 }); attack.life = 0; attack.step();
  assert.ok(Math.abs(attack.px - 54) < 1e-10); assert.equal(attack.parent, null);
  assert.equal(base.nowHP, 10000 - amount(father, base));
  attack.step(); assert.equal(sim.drainEvents().filter(e => e.type === 'impact').length, 1);
});

for (const delay of [0, 5, 10, 150]) {
  test(`ordinary long-range attack retains delay ${delay} but has no invisible travel/expiry`, () => {
    const sim = create(), father = unit(sim, 'left', 0, 0), target = unit(sim, 'right', 5, 50000, 40);
    father.range = 50000; father.delayAttack = delay; father.target = target;
    father.approachTarget(); const attack = sim.projectiles.at(-1); assert.ok(attack);
    for (let i = 0; i < delay; i++) { attack.step(); assert.equal(target.nowHP, 10000); assert.ok(attack.parent); }
    attack.step(); assert.equal(target.nowHP, 10000 - amount(father, target));
    assert.equal(attack.parent, null); assert.equal(attack.visible, false);
    assert.equal(father.range, 50000);
  });
}

test('ordinary attack still requires original initiation range; committed attack follows its live target', () => {
  const sim = create(), father = unit(sim, 'left', 0, 0), target = unit(sim, 'right', 5, father.range + 1);
  father.target = target; father.approachTarget(); assert.equal(sim.projectiles.length, 0);
  target.px = father.range; father.delayAttack = 5; father.approachTarget();
  const attack = sim.projectiles.at(-1); target.px = 50000; target.py = 1000;
  finish(attack); assert.ok(target.nowHP < 10000);
});

test('ordinary pending attack cancels dead or removed target without redirecting', () => {
  for (const removed of [false, true]) {
    const sim = create(), father = unit(sim, 'left', 0, 0), target = unit(sim, 'right', 5, 100);
    const other = unit(sim, 'right', 5, 110), attack = shot(sim, father, target, { delay: 5 });
    if (removed) sim.scene.removeChild(target); else target.nowHP = 0;
    finish(attack); assert.equal(other.nowHP, 10000);
    assert.equal(sim.drainEvents().filter(e => e.type === 'impact').length, 0);
  }
});

for (const id of [0, 12, 'base']) {
  test(`rapid ${id} attacks coexist and repeatedly damage the static front target`, () => {
    const sim = create(), father = id === 'base' ? sim.blueBoss : unit(sim, 'left', id, 0);
    father.px = father.py = 0;
    const target = unit(sim, id === 'base' ? 'left' : 'right', 5, 100, 35);
    for (let i = 0; i < 30; i++) shot(sim, father, target, { delay: 5 });
    for (let i = 0; i < 30; i++) for (const attack of [...sim.projectiles]) attack.step();
    assert.equal(target.nowHP, 10000 - 30 * amount(father, target));
    assert.equal(sim.projectiles.length, 0);
    assert.equal(sim.drainEvents().filter(e => e.type === 'impact').length, 30);
  });
}

test('armor formula is unchanged: zero damage remains zero and negative damage still heals', () => {
  for (const id of [0, 12]) for (const damage of [0, -5, 7]) {
    const sim = create(), father = unit(sim, 'left', id, 0), target = unit(sim, 'right', 5, 100);
    target.armor = 10; father.damage = [damage + 10, damage + 10];
    finish(shot(sim, father, target)); assert.equal(target.nowHP, 10000 - damage);
  }
});

for (const id of [0, 9, 12, 'base']) for (const side of ['left', 'right']) {
  test(`live scene ${side} ${id}: one-step cooldown kills stationary target in former miss band`, () => {
    const sim = create(), sign = side === 'left' ? 1 : -1;
    const father = id === 'base' ? (side === 'left' ? sim.redBoss : sim.blueBoss) : unit(sim, side, id, 0);
    father.px = father.py = 0; father.weaponSpeed = 1;
    const target = unit(sim, side === 'left' ? 'right' : 'left', 5, sign * 40, 35);
    target.nowHP = 40; target.ai = () => {};
    for (let i = 0; i < 120 && target.nowHP > 0; i++) sim.scene.step();
    assert.equal(target.nowHP, 0);
    assert.ok(sim.drainEvents().some(e => e.type === 'damage' && e.uid === target.uid));
  });
}

test('live upgrades preserve remaining life/delay, fixed heading and custom collision step', () => {
  const sim = create(), father = unit(sim, 'left', 12, 0), target = unit(sim, 'right', 5, 400, 35);
  const obstacle = unit(sim, 'right', 5, 100, 8.75), attack = shot(sim, father, target);
  attack.step(); const state = [attack.life, attack.delay, attack.vx, attack.vy];
  installCustomRuntime(sim, structuredClone(sim.config));
  assert.deepEqual([attack.life, attack.delay, attack.vx, attack.vy], state);
  finish(attack); assert.ok(obstacle.nowHP < 10000); assert.equal(target.nowHP, 10000);
  const melee = unit(sim, 'left', 0, 0), pending = shot(sim, melee, target, { delay: 150 });
  pending.step(); installCustomRuntime(sim, structuredClone(sim.config));
  assert.equal(pending.delay, 149); finish(pending); assert.ok(target.nowHP < 10000);
});

test('actual controller live settings retain hit rules, and original mode disables both extensions', () => {
  const originalStep = IsometricAttack.prototype.step;
  const controller = new GameController(effective, { storage: { getItem: () => 'true' },
    createSimulation: options => extend(new MiragineSimulation({ ...options, autoStart: false, rng: seededRandom(7) })) });
  const custom = createCustomization({ controller, defaults, initialConfig: effective });
  controller.startMatch(false, 1);
  const sim = controller.simulation; sim.leftMoney = sim.rightMoney = sim.leftPopulation = sim.rightPopulation = 1e9;
  const father = unit(sim, 'left', 12, 0), target = unit(sim, 'right', 5, 200, 35);
  const attack = shot(sim, father, target, { delay: 5 }); attack.step();
  custom.updateDraft('config.sides.left.units.12.delayAttack', 17); custom.applyCurrent();
  assert.equal(attack.life, 252); assert.equal(attack.delay, 4);
  const hp = target.nowHP; finish(attack); assert.ok(target.nowHP < hp);
  custom.returnToOriginal(); controller.startMatch(false, 1);
  const faithful = controller.simulation; faithful.leftMoney = faithful.leftPopulation = 1e9;
  const caster = unit(faithful, 'left', 12, 0), base = faithful.blueBoss;
  base.px = 100; base.py = 35; const before = base.nowHP, originalAttack = shot(faithful, caster, base);
  assert.equal(originalAttack.life, 100); finish(originalAttack); assert.equal(base.nowHP, before);
  assert.equal(IsometricAttack.prototype.step, originalStep);
  assert.equal(custom.getMode().current, 'original');
});

test('extension hooks are idempotent, events and RNG run once, faithful instance untouched', () => {
  const sim = create({ enabled: false }), father = unit(sim, 'left', 0, 0), target = unit(sim, 'right', 5, 100);
  let calls = 0, rng = 0; const old = sim.onEntityAttack;
  sim.onEntityAttack = function (...args) { calls++; return old.apply(this, args); };
  extend(sim); const hook = sim.onEntityAttack; extend(sim); assert.equal(sim.onEntityAttack, hook);
  sim.rng = () => { rng++; return 0.5; }; shot(sim, father, target);
  assert.equal(calls, 1); assert.equal(rng, 1);
  assert.equal(sim.drainEvents().filter(e => e.type === 'attack').length, 1);
  const faithful = new MiragineSimulation({ config: defaults, autoStart: false });
  assert.equal(extend(faithful).onEntityAttack, MiragineSimulation.prototype.onEntityAttack);
});

test('invalid custom hit policies fail explicitly; zero radii are allowed', () => {
  for (const policy of [null, {}, { ...effective.combatHitRules, unitRadius: -1 },
    { ...effective.combatHitRules, baseRadius: Infinity }, { ...effective.combatHitRules, projectileRadius: '6' }]) {
    const config = structuredClone(effective); config.combatHitRules = policy;
    assert.throws(() => create({ config }), TypeError);
  }
  const config = structuredClone(effective);
  config.combatHitRules.unitRadius = config.combatHitRules.baseRadius = config.combatHitRules.projectileRadius = 0;
  assert.doesNotThrow(() => create({ config }));
});

test('indexed custom battle matches linear collision every frame, including deaths and recruitment', () => {
  const pair = [create({ optimized: false }), create({ optimized: true })];
  for (const sim of pair) for (let i = 0; i < 100; i++) {
    const entity = unit(sim, i % 2 ? 'left' : 'right', i % 16, 1700 + i * 79 % 1000, 240 + i * 37 % 320);
    entity.nowHP = entity.maxHP; entity.weaponSpeed = 1;
  }
  const detail = sim => ({ snapshot: sim.snapshot(), events: sim.drainEvents(),
    entities: sim.scene.children.map(e => [e.uid, e.target?.uid, e.px, e.py, e.vx, e.vy, e.nowHP, e.life, e.delay, e.t]),
    friends: sim.friendList.map(e => e.uid), enemies: sim.enemyList.map(e => e.uid) });
  for (let i = 0; i < 150; i++) {
    for (const sim of pair) { if (i === 100) sim.round = 1; sim.step(); }
    assert.deepEqual(detail(pair[1]), detail(pair[0]), `frame ${i}`);
  }
});

test('new custom hit profile completes all four difficulty matches without forced kills or stat edits', () => {
  for (let difficulty = 0; difficulty < 4; difficulty++) {
    const sim = extend(new CustomMiragineSimulation({ config: structuredClone(effective), difficulty, rng: seededRandom(7), autoStart: false }));
    while (!sim.winner && sim.frame < 15000) { sim.step(300); sim.drainEvents(); }
    assert.ok(sim.winner, `difficulty ${difficulty} completes a match`);
    assert.ok(sim.redBoss.nowHP === 0 || sim.blueBoss.nowHP === 0);
    for (const e of sim.scene.children) for (const key of ['px', 'py', 'vx', 'vy']) {
      if (key in e) assert.ok(Number.isFinite(e[key]), `difficulty ${difficulty}: finite ${key}`);
    }
  }
});
