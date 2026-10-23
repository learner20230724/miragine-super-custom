import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MiragineSimulation, seededRandom } from '../src/core/index.mjs';
import { CustomMiragineSimulation, installCustomRuntime, customSideConfiguration, applyCustomEntityStats } from '../src/customization/runtime.mjs';
import { MAX_INTEGER, clampInteger, clampFinite, safeAdd, safeSubtract, safeMultiply, scaleRatio } from '../src/customization/numeric.mjs';

const defaults = JSON.parse(readFileSync(new URL('../config/defaults.generated.json', import.meta.url), 'utf8'));
function config() {
  const result = structuredClone(defaults), r = result.rules;
  result.customization = { schemaVersion: 2, sides: {}, difficulties: {} };
  for (const side of ['left', 'right']) result.customization.sides[side] = {
    units: structuredClone(result.units),
    base: { hp: r.baseHp, range: r.baseRange, damage: r.baseDamage, weaponSpeedFrames: r.baseWeaponSpeedFrames },
    initial: { money: r.initialMoney, income: r.startingIncome, population: r.populationLimit },
  };
  for (let i = 0; i < 4; i++) {
    const difficulty = result.difficulties[i], ai = structuredClone(result.ai);
    Object.assign(ai, { counterMinimumCount: 2, forceMoneyEnabled: true, forceEliteEnabled: true, eliteCountOnlyCounterBranch: true,
      counterFallbackChoices: Array.from({ length: ai.counterFallbackRandomUnitCount }, (_, id) => id),
      randomLowIncomeChoices: Array.from({ length: ai.randomLowIncomeUnitCount }, (_, id) => id),
      randomHighIncomeChoices: Array.from({ length: ai.randomHighIncomeUnitCount }, (_, id) => id) });
    result.customization.difficulties[i] = { ai,
      rightInitial: { income: difficulty.rightStartingIncome, population: difficulty.rightStartingPopulation },
      rightBase: { damage: difficulty.blueBaseDamage, weaponSpeedFrames: difficulty.blueBaseWeaponSpeedFrames } };
  }
  return result;
}
const create = (configuration = config(), options = {}) => new CustomMiragineSimulation({
  config: configuration, rng: seededRandom(18), autoStart: false, ...options,
});
function fund(sim) {
  sim.leftMoney = sim.rightMoney = 10000; sim.leftPopulation = sim.rightPopulation = 10000;
  sim.p1[2] = sim.p2[2] = 0;
}

test('input bounds clamp instead of rejecting overflow; safe arithmetic does not round before saturation', () => {
  assert.equal(clampInteger('90071992547409999999999'), MAX_INTEGER);
  assert.equal(clampInteger(Infinity), MAX_INTEGER); assert.equal(clampInteger(-100), 0);
  assert.equal(clampInteger(3.9), 3); assert.equal(clampFinite(Infinity), Number.MAX_VALUE);
  assert.throws(() => clampInteger('not a number'), TypeError);
  assert.equal(safeAdd(MAX_INTEGER - 2, 1), MAX_INTEGER - 1);
  assert.equal(safeAdd(MAX_INTEGER - 2, 3), MAX_INTEGER);
  assert.equal(safeSubtract(MAX_INTEGER, 1), MAX_INTEGER - 1);
  assert.equal(safeSubtract(0, MAX_INTEGER), 0);
  assert.equal(safeMultiply(Number.MAX_VALUE, Number.MAX_VALUE), Number.MAX_VALUE);
});

test('integer text truncates decimal and exponent input exactly before Number rounding near the safe maximum', () => {
  assert.equal(clampInteger('9007199254740990.9'), MAX_INTEGER - 1);
  assert.equal(clampInteger('9007199254740990.9999999999999999999999'), MAX_INTEGER - 1);
  assert.equal(clampInteger('9.0071992547409909e15'), MAX_INTEGER - 1);
  assert.equal(clampInteger('90071992547409909e-1'), MAX_INTEGER - 1);
  assert.equal(clampInteger('0009007199254740990.999e+0'), MAX_INTEGER - 1);
  assert.equal(clampInteger('9007199254740991.9'), MAX_INTEGER);
  assert.equal(clampInteger('9007199254740992'), MAX_INTEGER);
  assert.equal(clampInteger('1e100000000000000000000000000000000000'), MAX_INTEGER);
  assert.equal(clampInteger('1e-100000000000000000000000000000000000'), 0);
  assert.equal(clampInteger('-1e100000000000000000000000000000000000'), 0);
  assert.equal(clampInteger('0e999999999999999999999999999999999999'), 0);
  assert.equal(clampInteger('.99999'), 0); assert.equal(clampInteger('.99999', { min: 1 }), 1);
  assert.equal(clampInteger('1.999e2'), 199); assert.equal(clampInteger('  +12.999e-1  '), 1);
  assert.equal(clampInteger('-9007199254740990.9', { min: -MAX_INTEGER }), -MAX_INTEGER + 1);
  assert.equal(clampInteger('1e999'), MAX_INTEGER); assert.equal(clampInteger('Infinity'), MAX_INTEGER);
  assert.equal(clampInteger('-Infinity'), 0); assert.throws(() => clampInteger('NaN'), TypeError);
  assert.throws(() => clampInteger('1e-'), TypeError);
});

for (let difficulty = 0; difficulty < 4; difficulty++) test(`default custom runtime matches recovered frames/events/RNG at difficulty ${difficulty}`, () => {
  for (const seed of [7, 10031]) {
    const oldRng = seededRandom(seed), newRng = seededRandom(seed); let oldCalls = 0, newCalls = 0;
    const original = new MiragineSimulation({ config: defaults, difficulty, rng: () => { oldCalls++; return oldRng(); } });
    const custom = new CustomMiragineSimulation({ config: config(), difficulty, rng: () => { newCalls++; return newRng(); } });
    for (let frame = 0; frame < 3500; frame++) {
      if (frame % 173 === 0) {
        const id = Math.trunc(frame / 173) % 16; original.selectUnit('left', id); custom.selectUnit('left', id);
      }
      original.step(); custom.step();
      assert.deepEqual(custom.snapshot(), original.snapshot(), `difficulty ${difficulty} seed ${seed} frame ${frame}`);
      assert.deepEqual(custom.drainEvents(), original.drainEvents()); assert.equal(newCalls, oldCalls);
    }
  }
});

test('original class and existing battle upgrades stay isolated and preserve RNG/cooldowns', () => {
  const vanilla = new MiragineSimulation({ config: defaults, autoStart: false });
  const oldCreate = vanilla.createUnit, oldAi = vanilla.ai;
  const sim = new MiragineSimulation({ config: defaults, autoStart: false }); fund(sim);
  const unit = sim.createUnit('left', 0); unit.nowHP = 22.5; unit.t = 19;
  const cfg = config(); cfg.customization.sides.left.units[0].hp = 90;
  let calls = 0; sim.rng = () => { calls++; return 0.5; };
  const frame = sim.frame, round = sim.round, money = sim.leftMoney;
  installCustomRuntime(sim, cfg);
  assert.equal(unit.nowHP, 45); assert.equal(unit.t, 19); assert.equal(calls, 0);
  assert.equal(sim.frame, frame); assert.equal(sim.round, round); assert.equal(sim.leftMoney, money);
  assert.equal(vanilla.createUnit, oldCreate); assert.equal(vanilla.ai, oldAi);
  assert.equal(sim.renderSnapshot.find(entity => entity.uid === unit.uid).nowHP, 45);
});

test('safe maximum initial resources and countdown never wrap at 32 bits', () => {
  const cfg = config(); cfg.rules.incomeLimit = cfg.rules.populationLimit = cfg.rules.initialRoundFrames = MAX_INTEGER;
  for (const side of ['left', 'right']) cfg.customization.sides[side].initial = { money: MAX_INTEGER, income: MAX_INTEGER, population: MAX_INTEGER };
  cfg.customization.difficulties[1].rightInitial = { income: MAX_INTEGER, population: MAX_INTEGER };
  const sim = create(cfg); sim.p1[2] = sim.p2[2] = 0;
  for (const side of ['left', 'right']) {
    assert.equal(sim[`${side}Money`], MAX_INTEGER); assert.equal(sim[`${side}Income`], MAX_INTEGER);
    assert.equal(sim[`${side}Population`], MAX_INTEGER);
  }
  assert.equal(sim.timeSeconds, Math.trunc(MAX_INTEGER / 30)); sim.step(); assert.equal(sim.round, MAX_INTEGER - 1);
});

test('maximum balances spend exactly, income saturates, and next-round payment never becomes negative', () => {
  const cfg = config(); cfg.rules.incomeLimit = cfg.rules.populationLimit = MAX_INTEGER;
  for (const side of ['left', 'right']) Object.assign(cfg.customization.sides[side].units[0], { cost: 1, population: 1, income: 1 });
  const sim = create(cfg); fund(sim);
  sim.leftMoney = sim.leftIncome = sim.leftPopulation = MAX_INTEGER;
  sim.createUnit('left', 0);
  assert.equal(sim.leftMoney, MAX_INTEGER - 1); assert.equal(sim.leftPopulation, MAX_INTEGER - 1); assert.equal(sim.leftIncome, MAX_INTEGER);
  sim.round = 1; sim.step();
  assert.equal(sim.leftMoney, MAX_INTEGER); assert.equal(sim.leftPopulation, MAX_INTEGER);
  assert.equal(sim.rightMoney, 10000 + sim.rightIncome);
});

test('per-side costs, population, income, HP, damage and derived stats are independent on existing and new troops', () => {
  const cfg = config();
  Object.assign(cfg.customization.sides.left.units[0], { cost: 3, population: 2, income: 5, hp: 123, damage: [111, 222] });
  Object.assign(cfg.customization.sides.right.units[0], { cost: 7, population: 4, income: 9, hp: 456, damage: [333, 444] });
  const sim = create(cfg); fund(sim); const li = sim.leftIncome, ri = sim.rightIncome;
  const left = sim.createUnit('left', 0), right = sim.createUnit('right', 0);
  assert.equal(sim.leftMoney, 9997); assert.equal(sim.rightMoney, 9993);
  assert.equal(sim.leftPopulation, 9998); assert.equal(sim.rightPopulation, 9996);
  assert.equal(sim.leftIncome, li + 5); assert.equal(sim.rightIncome, ri + 9);
  assert.equal(left.nowHP, 123); assert.equal(right.nowHP, 456);
  assert.deepEqual(left.damage, [111, 222]); assert.deepEqual(right.damage, [333, 444]);
  const changed = structuredClone(cfg); changed.customization.sides.left.units[0].damage = [77, 88];
  installCustomRuntime(sim, changed, { health: 'absolute' });
  assert.deepEqual(left.damage, [77, 88]); assert.deepEqual(right.damage, [333, 444]);
  assert.deepEqual(sim.createUnit('left', 0).damage, [77, 88]);
});

test('per-side crystals and per-difficulty blue fields merge without erasing original hard difficulty', () => {
  const cfg = config(); cfg.customization.sides.left.base.hp = 100;
  cfg.customization.sides.right.base.hp = 500; cfg.customization.sides.right.base.range = 700;
  const sim = create(cfg, { difficulty: 3 });
  assert.equal(sim.redBoss.maxHP, 100); assert.equal(sim.blueBoss.maxHP, 500); assert.equal(sim.blueBoss.range, 700);
  assert.deepEqual(sim.blueBoss.damage, defaults.difficulties[3].blueBaseDamage);
  assert.equal(sim.rightIncome, defaults.difficulties[3].rightStartingIncome);
  assert.equal(customSideConfiguration(sim, 'right').initial.population, defaults.difficulties[3].rightStartingPopulation);
});

test('attack cooldown and projectile delay larger than 32 bits remain positive and decrement exactly', () => {
  const cfg = config(); const unit = cfg.customization.sides.left.units[0];
  unit.weaponSpeed = MAX_INTEGER; unit.delayAttack = MAX_INTEGER;
  const sim = create(cfg); fund(sim); const left = sim.createUnit('left', 0);
  left.target = sim.blueBoss; left.attack();
  assert.equal(left.t, MAX_INTEGER); assert.equal(sim.projectiles[0].delay, MAX_INTEGER);
  const projectile = sim.projectiles[0]; projectile.step(); assert.equal(projectile.delay, MAX_INTEGER - 1);
  left.step(); assert.equal(left.t, MAX_INTEGER - 1);
  assert.equal(projectile.life, defaults.rules.projectileLifeFrames - 1, 'large delay does not secretly extend projectile lifetime');
});

test('overflow healing, ratio updates and derived products remain finite without arbitrary small caps', () => {
  const cfg = config(), unit = cfg.customization.sides.left.units[0];
  unit.hp = unit.armor = unit.moveSpeed = unit.range = unit.weaponSpeed = Number.MAX_VALUE;
  cfg.rules.movementMultiplier = cfg.rules.rangeMultiplier = cfg.rules.weaponSpeedMultiplier = Number.MAX_VALUE;
  const sim = create(cfg); fund(sim); const left = sim.createUnit('left', 0);
  left.minusHP([0, 0]); assert.equal(left.nowHP, Number.MAX_VALUE);
  for (const key of ['moveSpeed', 'range']) assert.equal(left[key], Number.MAX_VALUE);
  assert.equal(left.weaponSpeed, MAX_INTEGER);
  left.spawnHP = Number.MIN_VALUE; left.nowHP = 1; applyCustomEntityStats(left); assert.equal(left.nowHP, Number.MAX_VALUE);
  assert.equal(scaleRatio(Number.MIN_VALUE, Number.MAX_VALUE, Number.MAX_VALUE), Number.MIN_VALUE);
});

test('extreme finite positions and movement avoid NaN vectors and squared-distance target failure', () => {
  const sim = create(); fund(sim); const left = sim.createUnit('left', 0), right = sim.createUnit('right', 0);
  left.px = -Number.MAX_VALUE; left.py = 0; right.px = Number.MAX_VALUE; right.py = 0;
  left.targetList = [right]; left.findTarget(); assert.equal(left.target, right);
  left.moveSpeed = Number.MAX_VALUE; left.moveTo({ x: Number.MAX_VALUE, y: Number.MAX_VALUE });
  for (const key of ['vx', 'vy', 'px', 'py']) assert.ok(Number.isFinite(left[key]), key);
  left.step(); for (const key of ['vx', 'vy', 'px', 'py', 'pz']) assert.ok(Number.isFinite(left[key]), key);
});

test('AI candidate tables and income boundary comparisons retain strict original operators', () => {
  const cfg = config(), ai = cfg.customization.difficulties[1].ai;
  cfg.difficulties[1].counterSelectionProbability = 0; ai.forceMoneyEnabled = ai.forceEliteEnabled = false;
  ai.randomIncomeThreshold = 100; ai.randomLowIncomeChoices = [4]; ai.randomHighIncomeChoices = [9];
  const sim = create(cfg); sim.rightIncome = 100; assert.equal(sim.ai(), 4); sim.rightIncome = 101; assert.equal(sim.ai(), 9);
  cfg.difficulties[1].counterSelectionProbability = 1; ai.counterMinimumCount = 1;
  fund(sim); sim.createUnit('left', 0); ai.newbieIncomeThreshold = 200;
  ai.newbieBelowThresholdChoice = 6; ai.newbieAtOrAboveThresholdChoice = 8;
  sim.rightIncome = 199; assert.equal(sim.ai(), 6); sim.rightIncome = 200; assert.equal(sim.ai(), 8);
});

test('AI counter minimum/table/fallback fields are configurable for each difficulty', () => {
  const cfg = config(), ai = cfg.customization.difficulties[1].ai;
  cfg.difficulties[1].counterSelectionProbability = 1; ai.forceMoneyEnabled = ai.forceEliteEnabled = false;
  ai.counterMinimumCount = 3; ai.counterFallbackIncomeThreshold = 100; ai.counterFallbackLowIncomeChoice = 5; ai.counterFallbackChoices = [11];
  const sim = create(cfg); fund(sim); sim.createUnit('left', 3); sim.createUnit('left', 3);
  sim.rightIncome = 100; assert.equal(sim.ai(), 5); sim.rightIncome = 101; assert.equal(sim.ai(), 11);
  sim.createUnit('left', 3); ai.counterChoices[3] = [12]; assert.equal(sim.ai(), 12);
  ai.counterChoices[3] = []; assert.equal(sim.ai(), 11);
});

test('lowering the AI counter minimum does not classify the red crystal as a newbie', () => {
  const cfg = config(), ai = cfg.customization.difficulties[1].ai;
  cfg.difficulties[1].counterSelectionProbability = 1; ai.forceMoneyEnabled = ai.forceEliteEnabled = false;
  ai.counterMinimumCount = 1; ai.counterFallbackIncomeThreshold = MAX_INTEGER;
  ai.counterFallbackLowIncomeChoice = 12; ai.newbieAtOrAboveThresholdChoice = 7;
  assert.equal(create(cfg).ai(), 12);
});

test('AI force rules expose switches, tracked ids, target, strict thresholds and counter-branch scope', () => {
  const cfg = config(), ai = cfg.customization.difficulties[1].ai;
  cfg.difficulties[1].counterSelectionProbability = 0; ai.randomLowIncomeChoices = ai.randomHighIncomeChoices = [1];
  ai.forceOverlordMoneyThreshold = 10; ai.forcedUnitId = 13; ai.forceEliteEnabled = false;
  const sim = create(cfg); sim.rightMoney = 10; assert.equal(sim.ai(), 1); sim.rightMoney = 11; assert.equal(sim.ai(), 13);
  ai.forceMoneyEnabled = false; assert.equal(sim.ai(), 1);
  ai.forceEliteEnabled = true; ai.eliteUnitIds = [2]; ai.forceOverlordEliteCountThreshold = 1;
  fund(sim); sim.createUnit('left', 2); sim.createUnit('left', 2);
  assert.equal(sim.ai(), 1, 'original elite count applies only within counter branch');
  ai.eliteCountOnlyCounterBranch = false; assert.equal(sim.ai(), 13);
  ai.forceOverlordEliteCountThreshold = 2; assert.equal(sim.ai(), 1, 'strict greater-than threshold');
});

test('runtime has no 500-entity cap and does not interpret population as an army cap', () => {
  const cfg = config(); Object.assign(cfg.customization.sides.left.units[0], { cost: 0, population: 0, income: 0 });
  const sim = create(cfg); sim.leftPopulation = 0;
  for (let i = 0; i < 501; i++) assert.ok(sim.createUnit('left', 0));
  assert.equal(sim.friendList.length, 502); assert.equal(sim.leftPopulation, 0);
});
