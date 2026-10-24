import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { GameController } from '../src/app/controller.mjs';
import { MiragineSimulation, seededRandom } from '../src/core/index.mjs';
import { createCustomization } from '../src/customization/index.mjs';
import { CustomMiragineSimulation, installCustomRuntime, customSideConfiguration } from '../src/customization/runtime.mjs';
import { installDualAI, normalizeDualAIOptions, dualAISnapshot } from '../src/extensions/dual-ai.mjs';

const defaults = JSON.parse(readFileSync(new URL('../config/defaults.generated.json', import.meta.url), 'utf8'));
function setup({ config = defaults, custom = false, seed = 72 } = {}) {
  const records = new Map(), storage = { getItem: key => records.get(key) ?? null, setItem: (key, value) => records.set(key, value) };
  const controller = new GameController(config, { storage: { getItem: () => 'true' },
    createSimulation: options => new MiragineSimulation({ ...options, rng: seededRandom(seed) }) });
  const editor = custom ? createCustomization({ controller, defaults, initialConfig: config, storage }) : null;
  return { controller, editor, records };
}
function battle(options = {}, setupOptions) {
  const result = setup(setupOptions); result.controller.startAIMatch(options);
  return { ...result, sim: result.controller.simulation };
}
function income(sim) { sim.drainEvents(); sim.round = 1; sim.step(); return sim.drainEvents(); }
const selected = (sim, side) => { const p = side === 'left' ? sim.p1 : sim.p2; return p[0] + p[1] * 8; };

test('dual AI options are match-local, validated and immutable', () => {
  assert.deepEqual(normalizeDualAIOptions(), { leftDifficulty: 1, rightDifficulty: 1, applyDifficultyStats: true });
  assert.equal(Object.isFrozen(normalizeDualAIOptions()), true);
  for (const value of [null, [], { leftDifficulty: -1 }, { rightDifficulty: 4 }, { leftDifficulty: 1.5 },
    { applyDifficultyStats: 1 }, { unknown: true }]) assert.throws(() => normalizeDualAIOptions(value));
});

test('title actions configure two difficulties and start a distinct mode', () => {
  const { controller: c } = setup();
  assert.equal(c.action('dual-ai-start'), false);
  assert.equal(c.action('dual-ai'), true); assert.equal(c.panel, 'dual-ai');
  assert.equal(c.action('dual-ai-left', 3), true); assert.equal(c.action('dual-ai-right', 0), true);
  assert.equal(c.action('dual-ai-left', 4), false);
  assert.equal(c.action('dual-ai-stats', false), true);
  assert.equal(c.action('dual-ai-start'), true);
  assert.equal(c.phase, 'game'); assert.equal(c.matchMode, 'ai-vs-ai');
  assert.equal(c.singlePlay, false); assert.equal(c.simulation.singlePlay, false);
  assert.deepEqual(c.dualAIOptions, { leftDifficulty: 3, rightDifficulty: 0, applyDifficultyStats: false });
});

test('back from dual AI configuration does not start a battle', () => {
  const { controller: c } = setup(); c.action('dual-ai'); c.action('dual-ai-left', 2);
  assert.equal(c.action('dual-ai-back'), true); assert.equal(c.panel, 'home'); assert.equal(c.simulation, null);
  c.action('dual-ai'); assert.equal(c.dualAIOptions.leftDifficulty, 2);
});

test('all sixteen difficulty pairs mirror original starting conditions before frame one', () => {
  const original = JSON.stringify(defaults);
  for (let left = 0; left < 4; left++) for (let right = 0; right < 4; right++) {
    const { sim } = battle({ leftDifficulty: left, rightDifficulty: right });
    for (const [side, index] of [['left', left], ['right', right]]) {
      const d = defaults.difficulties[index], base = side === 'left' ? sim.redBoss : sim.blueBoss;
      assert.equal(sim[`${side}Income`], d.rightStartingIncome);
      assert.equal(sim[`${side}Population`], d.rightStartingPopulation);
      assert.deepEqual(base.damage, d.blueBaseDamage); assert.equal(base.weaponSpeed, d.blueBaseWeaponSpeedFrames);
      assert.equal(base.nowHP, defaults.rules.baseHp); assert.equal(sim[`${side}Money`], defaults.rules.initialMoney);
    }
    assert.equal(sim.frame, 1); assert.equal(sim.dualAI.decisions.left.count, 0);
  }
  assert.equal(JSON.stringify(defaults), original);
});

test('strategy-only mode uses normal resource conditions on both sides without changing AI levels', () => {
  const { sim, controller } = battle({ leftDifficulty: 3, rightDifficulty: 0, applyDifficultyStats: false });
  for (const side of ['left', 'right']) {
    assert.equal(sim[`${side}Income`], 500); assert.equal(sim[`${side}Population`], 80);
    assert.deepEqual((side === 'left' ? sim.redBoss : sim.blueBoss).damage, [100, 100]);
  }
  assert.deepEqual(controller.snapshot().dualAI.statsDifficulties, { left: 1, right: 1 });
  assert.deepEqual(income(sim).filter(e => e.type === 'aiSelection').map(e => e.difficulty), [3, 0]);
});

test('income hook executes left then right after money and before first recruitment', () => {
  const { sim } = battle({ leftDifficulty: 0, rightDifficulty: 3 });
  const events = income(sim), relevant = events.filter(e => ['income', 'aiSelection', 'recruit'].includes(e.type));
  assert.deepEqual(relevant.slice(0, 3).map(e => [e.type, e.side]), [['income', undefined], ['aiSelection', 'left'], ['aiSelection', 'right']]);
  for (const side of ['left', 'right']) {
    const recruit = relevant.find(e => e.type === 'recruit' && e.side === side);
    assert.equal(recruit?.id, selected(sim, side));
    assert.equal(sim.dualAI.decisions[side].count, 1); assert.equal(sim.dualAI.decisions[side].lastFrame, sim.frame);
  }
});

test('first-frame income is handled even with initialRoundFrames=1', () => {
  const config = structuredClone(defaults); config.rules.initialRoundFrames = 1;
  for (const custom of [false, true]) {
    const { sim } = battle({ leftDifficulty: 3, rightDifficulty: 0 }, { config, custom });
    assert.equal(sim.frame, 1); assert.equal(sim.dualAI.decisions.left.count, 1); assert.equal(sim.dualAI.decisions.right.count, 1);
    assert.deepEqual(sim.events.filter(e => e.type === 'income').map(e => [e.left, e.right]), [[600, 500]]);
  }
});

test('mirrored AI exactly reuses algorithm, side resources, enemy units, and RNG sequence', () => {
  for (const difficulty of [0, 1, 2, 3]) for (const seed of [1, 22, 731]) {
    let actualCalls = 0, expectedCalls = 0;
    const actualRng = seededRandom(seed), expectedRng = seededRandom(seed);
    const sim = new MiragineSimulation({ config: defaults, autoStart: false, rng: () => { actualCalls++; return actualRng(); } });
    installDualAI(sim, { leftDifficulty: difficulty, rightDifficulty: 3 - difficulty });
    const leftArmy = [{ id: 0 }, { id: 0 }, { id: 6 }], rightArmy = [{ id: 2 }, { id: 2 }, { id: 15 }];
    sim.friendList = leftArmy; sim.enemyList = rightArmy;
    sim.leftMoney = 450; sim.rightMoney = 50; sim.leftIncome = 3000; sim.rightIncome = 100;
    const expected = [];
    for (const [index, army, money, inc] of [[difficulty, rightArmy, 450, 3000], [3 - difficulty, leftArmy, 50, 100]]) {
      const receiver = { config: defaults, difficulty: index, friendList: army, rightMoney: money, rightIncome: inc,
        p2: [0, 0, 0], dictionaryKeys: map => [...map.keys()], rng: () => { expectedCalls++; return expectedRng(); }, emit() {} };
      expected.push(CustomMiragineSimulation.prototype.ai.call(receiver));
    }
    sim.p1[2] = sim.p2[2] = 0; sim.emit('income');
    assert.deepEqual([selected(sim, 'left'), selected(sim, 'right')], expected);
    assert.equal(actualCalls, expectedCalls); assert.equal(actualRng(), expectedRng());
    assert.deepEqual([sim.p1[2], sim.p2[2]], [0, 0]);
    assert.equal(sim.friendList, leftArmy); assert.equal(sim.enemyList, rightArmy);
    assert.deepEqual([sim.leftMoney, sim.rightMoney, sim.leftIncome, sim.rightIncome], [450, 50, 3000, 100]);
  }
});

test('manual unit selection persists until the next income decision', () => {
  const { sim, controller } = battle({ leftDifficulty: 0, rightDifficulty: 0 });
  assert.equal(controller.select('left', 15), true); assert.equal(controller.select('right', 14), true);
  sim.step(10); assert.deepEqual([selected(sim, 'left'), selected(sim, 'right')], [15, 14]);
  const events = income(sim).filter(e => e.type === 'aiSelection');
  assert.deepEqual([selected(sim, 'left'), selected(sim, 'right')], events.map(e => e.id));
  assert.notEqual(selected(sim, 'left'), 15); assert.notEqual(selected(sim, 'right'), 14);
});

test('per-side recruitment pause survives AI rounds and does not pause existing troops or time', () => {
  const { sim, controller } = battle();
  sim.leftMoney = 500; const troop = sim.createUnit('left', 0), before = troop.px;
  assert.equal(controller.action('dual-ai-recruit-left', false), true);
  assert.equal(controller.action('dual-ai-recruit-right', false), true);
  for (let i = 0; i < 3; i++) assert.equal(income(sim).filter(e => e.type === 'recruit').length, 0);
  sim.step(12);
  assert.notEqual(troop.px, before); assert.equal(sim.stopTimer, false); assert.equal(sim.running, true);
  assert.deepEqual([sim.p1[2], sim.p2[2]], [0, 0]); assert.equal(sim.dualAI.decisions.left.count, 3);
  assert.equal(controller.action('dual-ai-recruit-right'), true);
  assert.deepEqual(income(sim).filter(e => e.type === 'recruit').map(e => e.side), ['right']);
});

test('original keyboard selection and Space/Enter toggles work for both AI armies', () => {
  const { controller: c, sim } = battle();
  for (const key of ['KeyD', 'KeyS', 'ArrowRight', 'ArrowDown']) assert.equal(c.key(key), true);
  assert.deepEqual(sim.p1, [1, 1, 1]); assert.deepEqual(sim.p2, [1, 1, 1]);
  c.key('Space'); c.key('Enter'); assert.deepEqual([sim.p1[2], sim.p2[2]], [0, 0]);
});

test('custom units, crystal HP/range and initial money remain side-specific in dual AI', () => {
  const { controller, editor } = setup({ custom: true });
  editor.commitSetting('config.sides.left.base.hp', 1234);
  editor.commitSetting('config.sides.right.base.range', 432);
  editor.commitSetting('config.sides.left.units.6.hp', 765);
  editor.commitSetting('config.sides.left.initial.money', 456);
  editor.commitSetting('config.difficulties.3.blueBaseDamage.0', 333);
  controller.startAIMatch({ leftDifficulty: 3, rightDifficulty: 1 }); const sim = controller.simulation;
  assert.equal(sim.redBoss.nowHP, 1234); assert.equal(sim.blueBoss.range, 432); assert.equal(sim.leftMoney, 456);
  assert.equal(customSideConfiguration(sim, 'left').units[6].hp, 765); assert.equal(sim.redBoss.damage[0], 333);
  assert.equal(editor.getMode().current, 'custom');
});

test('repeated live customization keeps exactly two AI decisions and no duplicate hooks', () => {
  const { sim, controller, editor } = battle({ leftDifficulty: 2, rightDifficulty: 3 }, { custom: true });
  controller.setRecruitment('left', false); controller.setRecruitment('right', false);
  const emit = sim.emit;
  for (let i = 0; i < 4; i++) {
    editor.commitSetting('config.rules.rangeMultiplier', 31 + i);
    const events = income(sim).filter(e => e.type === 'aiSelection');
    assert.equal(events.length, 2); assert.deepEqual(events.map(e => e.side), ['left', 'right']);
    assert.deepEqual([sim.p1[2], sim.p2[2]], [0, 0]); assert.equal(sim.emit, emit);
  }
  assert.equal(sim.dualAI.decisions.left.count, 4); assert.equal(sim.dualAI.decisions.right.count, 4);
  assert.equal(editor.getBattleState().matchMode, 'ai-vs-ai');
});

test('AI decision policy reads live difficulty settings after custom runtime replacement', () => {
  const { sim, editor } = battle({ leftDifficulty: 0, rightDifficulty: 0 }, { custom: true });
  editor.commitSetting('config.difficulties.0.ai.randomHighIncomeChoices', [7]);
  assert.deepEqual(income(sim).filter(e => e.type === 'aiSelection').map(e => e.id), [7, 7]);
  editor.commitSetting('config.difficulties.0.ai.randomHighIncomeChoices', [3]);
  assert.deepEqual(income(sim).filter(e => e.type === 'aiSelection').map(e => e.id), [3, 3]);
});

test('legacy enemyAi off does not disable dual AI or rewrite the saved profile', () => {
  const { controller, editor, records } = setup({ custom: true });
  editor.commitSetting('rules.enemyAi', false); const saved = [...records.entries()];
  controller.startAIMatch(); const sim = controller.simulation;
  assert.equal(income(sim).filter(e => e.type === 'aiSelection').length, 2);
  assert.deepEqual([...records.entries()], saved); assert.equal(editor.getState().next.rules.enemyAi, false);
  assert.throws(() => editor.setEnemyAi(false), /双 AI/);
  assert.deepEqual([...records.entries()], saved);
});

test('live crystal edits route to actual side difficulty, including shared normal conditions', () => {
  const { sim, editor } = battle({ leftDifficulty: 3, rightDifficulty: 0 }, { custom: true });
  editor.setBase({ side: 'left', damage: [222, 223], weaponSpeedFrames: 9 });
  assert.deepEqual(sim.redBoss.damage, [222, 223]); assert.equal(sim.redBoss.weaponSpeed, 9);
  assert.deepEqual(sim.blueBoss.damage, [100, 100]);
  assert.deepEqual(editor.getState().next.config.difficulties[3].blueBaseDamage, [222, 223]);
  const neutral = battle({ leftDifficulty: 3, rightDifficulty: 0, applyDifficultyStats: false }, { custom: true });
  neutral.editor.setBase({ side: 'left', damage: [123, 124] });
  assert.deepEqual(neutral.sim.redBoss.damage, [123, 124]); assert.deepEqual(neutral.sim.blueBoss.damage, [123, 124]);
});

test('full difficulty initial population is original opening-only, then common round capacity', () => {
  const { sim, controller } = battle({ leftDifficulty: 3, rightDifficulty: 0 });
  assert.deepEqual([sim.leftPopulation, sim.rightPopulation], [100, 80]);
  controller.setRecruitment('left', false); controller.setRecruitment('right', false); income(sim);
  assert.deepEqual([sim.leftPopulation, sim.rightPopulation], [defaults.rules.populationLimit, defaults.rules.populationLimit]);
});

test('replay retains mode and both options; ordinary modes do not inherit extension', () => {
  const { controller: c, sim } = battle({ leftDifficulty: 3, rightDifficulty: 0, applyDifficultyStats: false });
  sim.winner = 'left'; c.showResult(); c.action('replay');
  assert.notEqual(c.simulation, sim); assert.equal(c.matchMode, 'ai-vs-ai');
  assert.deepEqual(c.dualAIOptions, { leftDifficulty: 3, rightDifficulty: 0, applyDifficultyStats: false });
  c.home(); c.action('dual'); assert.equal(c.matchMode, 'dual'); assert.equal(c.simulation.dualAI, undefined);
  assert.equal(income(c.simulation).filter(e => e.type === 'aiSelection').length, 0);
  c.home(); c.action('single'); c.action('difficulty', 2);
  assert.equal(c.matchMode, 'single'); assert.equal(c.simulation.dualAI, undefined);
  assert.equal(income(c.simulation).filter(e => e.type === 'aiSelection').length, 1);
});

test('editor startBattle can select all three modes and defaults to retaining dual AI', () => {
  const { controller: c, editor } = setup({ custom: true });
  editor.startBattle({ mode: 'ai-vs-ai', dualAI: { leftDifficulty: 2, rightDifficulty: 3, applyDifficultyStats: false } });
  assert.equal(c.matchMode, 'ai-vs-ai'); editor.startBattle(); assert.equal(c.matchMode, 'ai-vs-ai');
  assert.equal(c.dualAIOptions.leftDifficulty, 2); assert.equal(c.dualAIOptions.applyDifficultyStats, false);
  editor.startBattle({ mode: 'dual' }); assert.equal(c.matchMode, 'dual');
  editor.startBattle({ mode: 'single' }); assert.equal(c.matchMode, 'single');
  c.startAIMatch(); editor.startBattle({ singlePlay: false }); assert.equal(c.matchMode, 'dual');
  assert.throws(() => editor.startBattle({ mode: 'other' }));
});

test('win frame preserves original remaining income and AI processing order', () => {
  const { sim } = battle(); sim.redBoss.nowHP = 0; sim.gameOverTime = 1;
  const events = income(sim); assert.equal(sim.winner, 'right'); assert.equal(sim.running, false);
  const types = events.filter(e => ['win', 'income', 'aiSelection'].includes(e.type)).map(e => e.type);
  assert.deepEqual(types, ['win', 'income', 'aiSelection', 'aiSelection']);
});

test('installation is idempotent, refuses late installation/options mutation, and snapshot is defensive', () => {
  const sim = new MiragineSimulation({ config: defaults, autoStart: false });
  installDualAI(sim); const emit = sim.emit; installDualAI(sim); assert.equal(sim.emit, emit);
  installCustomRuntime(sim); assert.equal(sim.emit, emit); sim.emit('income');
  assert.equal(sim.dualAI.decisions.left.count, 1);
  assert.throws(() => installDualAI(sim, { leftDifficulty: 2 }));
  assert.throws(() => installDualAI(new MiragineSimulation({ config: defaults })));
  const snap = dualAISnapshot(sim); snap.decisions.left.count = -9; snap.recruitment.left = false;
  assert.equal(sim.dualAI.decisions.left.count, 1); assert.equal(sim.p1[2], 1);
});

test('invalid dual AI start options do not stop or mutate the current battle', () => {
  const { controller: c, sim } = battle();
  for (const options of [null, { rightDifficulty: 9 }, { applyDifficultyStats: 'yes' }]) assert.throws(() => c.startAIMatch(options));
  assert.equal(c.simulation, sim); assert.equal(sim.running, true);
});

test('ordinary single and local-two-player preserve baseline simulation and event sequences', () => {
  for (const singlePlay of [false, true]) for (const difficulty of [0, 3]) {
    const { controller: c } = setup({ seed: 18 }); c.startMatch(singlePlay, difficulty);
    const original = new MiragineSimulation({ config: defaults, singlePlay, difficulty, rng: seededRandom(18) });
    c.simulation.step(600); original.step(600);
    assert.deepEqual(c.simulation.snapshot(), original.snapshot()); assert.deepEqual(c.simulation.events, original.events);
  }
});
