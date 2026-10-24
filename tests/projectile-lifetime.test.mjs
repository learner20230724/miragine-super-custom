import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mergeConfiguration } from '../src/config/index.mjs';
import { MiragineSimulation, validateCoreConfiguration, seededRandom } from '../src/core/index.mjs';
import { CustomMiragineSimulation } from '../src/customization/runtime.mjs';
import { GameController } from '../src/app/controller.mjs';
import { createCustomization } from '../src/customization/index.mjs';
import { casterProjectileLifeFrames, installCasterProjectileLifetime } from '../src/extensions/projectile-lifetime.mjs';

const read = path => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const defaults = read('../config/defaults.generated.json');
const effective = mergeConfiguration(defaults, read('../config/custom.json'), { validateEffective: validateCoreConfiguration });
const create = (config = effective, extension = true) => {
  const sim = new CustomMiragineSimulation({ config, rng: seededRandom(27), autoStart: false });
  sim.leftMoney = sim.rightMoney = sim.leftPopulation = sim.rightPopulation = 100000;
  return extension ? installCasterProjectileLifetime(sim) : sim;
};
function fire(sim, id = 12, side = 'left', distance = 100000) {
  const unit = sim.createUnit(side, id), target = side === 'left' ? sim.blueBoss : sim.redBoss;
  unit.px = 0; unit.py = target.py = 0; unit.direction = side === 'left' ? 1 : -1;
  target.px = distance * unit.direction; target.nowHP = 1e9;
  unit.target = target; unit.attack();
  return { unit, target, attack: sim.projectiles.at(-1) };
}

test('shipped lifetime policy leaves original numeric rules and unit data unchanged', () => {
  assert.deepEqual(effective.rules, defaults.rules);
  assert.deepEqual(effective.units, defaults.units);
  assert.deepEqual(effective.casterProjectileLifetime, { mapWidths: 1.1, unitIds: [9, 12], baseLifeFrames: 253 });
  assert.equal(defaults.rules.projectileLifeFrames, 100);
  const main = readFileSync(new URL('../src/app/main.mjs', import.meta.url), 'utf8');
  assert.match(main, /installCasterProjectileLifetime\(/, 'wire the extension into the app factory');
});

for (const id of [9, 12]) for (const side of ['left', 'right']) {
  test(`${side} caster ${id}: life 253, unchanged range/delay/speed/cooldown/damage`, () => {
    const sim = create(), { unit, attack } = fire(sim, id, side);
    assert.equal(unit.range, 300); assert.equal(unit.delayAttack, 5);
    assert.equal(attack.life, 253); assert.equal(attack.delay, 5);
    assert.equal(attack.vx, 20 * unit.direction);
    assert.equal(unit.t, Math.trunc(defaults.units[id].weaponSpeed * defaults.rules.weaponSpeedMultiplier));
    assert.deepEqual(unit.damage, defaults.units[id].damage);
    for (let i = 0; i < 5; i++) attack.step();
    assert.equal(attack.px, 0); assert.equal(attack.delay, 0);
    for (let i = 0; i < 248; i++) attack.step();
    assert.equal(attack.parent, sim.scene); assert.equal(attack.life, 0);
    assert.equal(attack.px, unit.direction * 4960);
    attack.step(); assert.equal(attack.parent, null); assert.equal(attack.px, unit.direction * 4980);
  });
  test(`${side} caster ${id}: lifetime extension does not permit firing outside the original range`, () => {
    const sim = create(), unit = sim.createUnit(side, id);
    const target = side === 'left' ? sim.blueBoss : sim.redBoss;
    unit.px = 0; unit.py = target.py = 0; unit.target = target;
    target.px = 301; unit.approachTarget(); assert.equal(sim.projectiles.length, 0);
    target.px = 300; unit.approachTarget(); assert.equal(sim.projectiles.length, 1);
    assert.equal(sim.projectiles[0].life, 253); assert.equal(unit.range, 300);
  });
  test(`${side} caster ${id}: a manually fired cross-map shot still uses original impact rules`, () => {
    const sim = create(), { unit, target, attack } = fire(sim, id, side, 3900);
    const hp = target.nowHP;
    for (let i = 0; i < 200; i++) attack.step();
    assert.equal(attack.parent, sim.scene, 'equality with target X is not a hit yet');
    attack.step(); assert.equal(attack.parent, null);
    assert.equal(attack.px, target.px); assert.equal(unit.range, 300);
    assert.equal(target.nowHP, hp - (unit.damage[target.armorTypeID] - target.armor));
  });
}

test('all other units retain their original projectile lifetime', () => {
  for (let id = 0; id < 16; id++) if (![9, 12].includes(id)) {
    for (const side of ['left', 'right']) assert.equal(fire(create(), id, side).attack.life, 100, `${side} ${id}`);
  }
});

for (const side of ['left', 'right']) {
  test(`${side} crystal: explicit life 253 without changing range/delay/speed/cooldown/damage`, () => {
    const sim = create(), base = side === 'left' ? sim.redBoss : sim.blueBoss;
    base.target = side === 'left' ? sim.blueBoss : sim.redBoss;
    const before = { range: base.range, delay: base.delayAttack, speed: base.weaponSpeed, damage: [...base.damage] };
    base.attack(); const attack = sim.projectiles.at(-1);
    assert.equal(attack.life, 253);
    assert.equal(attack.delay, before.delay);
    assert.equal(attack.vx, sim.rules.projectileSpeed * base.direction);
    assert.equal(base.range, before.range); assert.equal(base.delayAttack, before.delay);
    assert.equal(base.t, before.speed); assert.deepEqual(base.damage, before.damage);
  });

  test(`${side} crystal: legacy policy or disabled extension retains original life 100`, () => {
    const legacy = structuredClone(effective); delete legacy.casterProjectileLifetime.baseLifeFrames;
    const absent = structuredClone(effective); delete absent.casterProjectileLifetime;
    for (const sim of [create(legacy), create(absent), create(effective, false)]) {
      const base = side === 'left' ? sim.redBoss : sim.blueBoss;
      base.target = side === 'left' ? sim.blueBoss : sim.redBoss;
      base.attack(); assert.equal(sim.projectiles.at(-1).life, 100);
    }
  });

  test(`${side} crystal: explicit lifetime is not recomputed from map width or firing delay`, () => {
    const cfg = structuredClone(effective); cfg.rules.mapWidth = 6000; cfg.rules.projectileSpeed = 30;
    const sim = create(cfg), base = side === 'left' ? sim.redBoss : sim.blueBoss;
    base.target = side === 'left' ? sim.blueBoss : sim.redBoss; base.delayAttack = 17;
    base.attack(); const attack = sim.projectiles.at(-1);
    assert.equal(attack.life, 253); assert.equal(attack.delay, 17);
    assert.equal(attack.vx, 30 * base.direction);
    attack.step(); assert.equal(attack.life, 252); assert.equal(attack.delay, 16);
  });
}

test('normal early hit and vertical miss still remove the projectile immediately', () => {
  for (const dy of [0, 31]) {
    const sim = create(), { target, attack } = fire(sim, 9, 'left', 100);
    target.py = dy; const hp = target.nowHP;
    for (let i = 0; i < 11; i++) attack.step();
    assert.equal(attack.parent, null);
    assert.equal(target.nowHP < hp, dy === 0);
    assert.equal(sim.drainEvents().find(event => event.type === 'impact').hit, dy === 0);
  }
});

test('map width, multiplier, speed and per-shot delay determine lifetime with upward rounding', () => {
  assert.equal(casterProjectileLifeFrames(4500, 1.1, 20, 5), 253);
  assert.equal(casterProjectileLifeFrames(4500, 1.1, -20, 5), 253);
  assert.equal(casterProjectileLifeFrames(4500, 1.1, 20, 0), 248);
  assert.equal(casterProjectileLifeFrames(4500, 1.1, 20, 17), 265);
  assert.equal(casterProjectileLifeFrames(6000, 1.1, 30, 11), 231, 'decimal factor does not add a floating-point phantom step');
  assert.equal(casterProjectileLifeFrames(6000.001, 1.1, 30, 11), 232, 'real fractional steps still round upward');
  const cfg = structuredClone(effective); cfg.rules.mapWidth = 6000; cfg.rules.projectileSpeed = 30;
  cfg.units[12].delayAttack = 11;
  assert.equal(fire(create(cfg)).attack.life, 231);
  cfg.rules.mapWidth = 6000.9;
  assert.equal(fire(create(cfg)).attack.life, 231, 'use the actual map width after recovered AS3 integer conversion');
  assert.equal(casterProjectileLifeFrames(Number.MAX_VALUE, 2, Number.MIN_VALUE, 5), Number.MAX_SAFE_INTEGER);
  assert.equal(casterProjectileLifeFrames(4500, 1.1, 20, Number.MAX_SAFE_INTEGER), Number.MAX_SAFE_INTEGER);
});

test('invalid travel settings fail explicitly instead of creating infinite or zero-speed projectiles', () => {
  for (const speed of [0, Infinity, NaN]) assert.throws(() => casterProjectileLifeFrames(4500, 1.1, speed, 5), RangeError);
  for (const policy of [null, {}, [], { mapWidths: 0, unitIds: [9] }, { mapWidths: 1.1, unitIds: [9, 9] }, { mapWidths: 1.1, unitIds: [16] }]) {
    const cfg = structuredClone(effective); cfg.casterProjectileLifetime = policy;
    assert.throws(() => installCasterProjectileLifetime(create(cfg, false)), TypeError);
  }
  for (const baseLifeFrames of [0, -1, 253.5, '253', null, true, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    const cfg = structuredClone(effective); cfg.casterProjectileLifetime.baseLifeFrames = baseLifeFrames;
    assert.throws(() => installCasterProjectileLifetime(create(cfg, false)), /baseLifeFrames must be a positive safe integer/);
  }
  const cfg = structuredClone(effective); cfg.rules.projectileSpeed = 0;
  assert.throws(() => installCasterProjectileLifetime(create(cfg, false)), RangeError);
});

test('installation is per-instance and idempotent, preserving original events and RNG calls', () => {
  const reference = create(effective, false), extended = create(effective, false);
  let originalCalls = 0;
  const original = extended.onEntityAttack;
  extended.onEntityAttack = function (...args) { originalCalls++; return original.apply(this, args); };
  installCasterProjectileLifetime(extended); const hook = extended.onEntityAttack;
  installCasterProjectileLifetime(extended); assert.equal(extended.onEntityAttack, hook);
  let referenceRandom = 0, extendedRandom = 0;
  reference.rng = () => { referenceRandom++; return 0.5; };
  extended.rng = () => { extendedRandom++; return 0.5; };
  const a = fire(reference), b = fire(extended);
  assert.equal(a.attack.life, 100); assert.equal(b.attack.life, 253);
  assert.equal(originalCalls, 1); assert.equal(referenceRandom, extendedRandom);
  assert.deepEqual(reference.drainEvents(), extended.drainEvents());
});

test('live custom edits preserve the policy and existing remaining life; returning to original disables it', () => {
  const controller = new GameController(effective, { storage: { getItem: () => 'true' },
    createSimulation: options => installCasterProjectileLifetime(new MiragineSimulation({ ...options, autoStart: false, rng: seededRandom(7) })) });
  const custom = createCustomization({ controller, defaults, initialConfig: effective });
  controller.startMatch(false, 1);
  const sim = controller.simulation; sim.leftMoney = sim.leftPopulation = 100000;
  const { unit, attack } = fire(sim); attack.step(); assert.equal(attack.life, 252);
  custom.updateDraft('config.sides.left.units.12.delayAttack', 17); custom.applyCurrent();
  assert.equal(attack.life, 252, 'do not reset an existing projectile');
  unit.t = 0; unit.attack(); assert.equal(sim.projectiles.at(-1).life, 265);
  assert.equal(unit.range, 300); assert.equal(custom.getMode().current, 'custom');
  custom.returnToOriginal(); controller.startMatch(false, 1);
  const original = controller.simulation; original.leftMoney = original.leftPopulation = 100000;
  assert.equal(fire(original).attack.life, 100); assert.equal(custom.getMode().current, 'original');
  const vanilla = new MiragineSimulation({ config: defaults, autoStart: false });
  assert.equal(installCasterProjectileLifetime(vanilla).onEntityAttack, MiragineSimulation.prototype.onEntityAttack);
});
