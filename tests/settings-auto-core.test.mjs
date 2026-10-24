import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { GameController } from '../src/app/controller.mjs';
import { MiragineSimulation, seededRandom } from '../src/core/index.mjs';
import { mergeConfiguration } from '../src/config/index.mjs';
import { createCustomization, DRAFT_KEY, PRESETS_KEY } from '../src/customization/index.mjs';
import { installCombatHitRules } from '../src/extensions/combat-hits.mjs';
import { installCasterProjectileLifetime } from '../src/extensions/projectile-lifetime.mjs';

const read = path => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const defaults = read('../config/defaults.generated.json');
const effective = mergeConfiguration(defaults, read('../config/custom.json'));
function memory() {
  const values = new Map();
  return { values, getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), flush: async () => true };
}
function setup({ storage = memory(), initial = effective, autoRestore = true, start = true } = {}) {
  const events = [];
  const controller = new GameController(initial, { storage: { getItem: () => 'true' },
    createSimulation: options => installCombatHitRules(installCasterProjectileLifetime(new MiragineSimulation({ ...options, rng: seededRandom(31) }))) });
  const custom = createCustomization({ controller, defaults, initialConfig: initial, storage, autoRestore, onChange: event => events.push(event) });
  if (start) controller.startMatch(true, 1);
  return { custom, controller, sim: controller.simulation, storage, events };
}
function spawn(custom, sim, side = 'left', unitId = 0) {
  const [uid] = custom.spawn({ side, unitId });
  return sim.scene.children.find(entity => entity.uid === uid);
}
function fire(sim, father = sim.redBoss, target = sim.blueBoss) {
  father.target = target; father.t = 0; father.attack();
  return sim.projectiles.at(-1);
}

test('confirmed edit immediately changes existing/new units and next game, persists without Apply', async () => {
  const { custom, sim, controller, storage, events } = setup();
  const unit = spawn(custom, sim), frame = sim.frame, round = sim.round;
  const report = custom.commitSetting('config.sides.left.units.0.range', 1000);
  assert.equal(unit.range, 1000 * defaults.rules.rangeMultiplier);
  assert.equal(spawn(custom, sim).range, unit.range);
  assert.equal(sim.frame, frame); assert.equal(sim.round, round);
  assert.ok(report.applied.includes('config.sides.left.units.0.range'));
  assert.equal(JSON.parse(storage.values.get(DRAFT_KEY)).profile.config.sides.left.units[0].range, 1000);
  assert.equal(await custom.flush(), true); assert.equal(custom.getState().settingsSaved, true);
  assert.ok(events.some(event => event.kind === 'settings-committed'));
  controller.startMatch(); assert.equal(spawn(custom, controller.simulation).range, unit.range);
});

test('opening fields are automatically queued, preserving live balances, countdown, cooldown and RNG', () => {
  const { custom, sim, controller } = setup();
  sim.leftMoney = 321; sim.leftPopulation = 17; sim.redBoss.t = 41;
  const before = [sim.frame, sim.round, sim.leftMoney, sim.leftIncome, sim.leftPopulation, sim.redBoss.t];
  sim.rng = () => { throw new Error('A settings edit must not consume randomness'); };
  custom.commitSetting('config.sides.left.initial.money', 4321);
  custom.commitSetting('config.rules.initialRoundFrames', 600);
  assert.deepEqual([sim.frame, sim.round, sim.leftMoney, sim.leftIncome, sim.leftPopulation, sim.redBoss.t], before);
  assert.ok(custom.getState().pendingNext.includes('config.sides.left.initial.money'));
  assert.ok(custom.getState().pendingNext.includes('config.rules.initialRoundFrames'));
  controller.startMatch(); assert.equal(controller.simulation.leftMoney, 4321); assert.equal(controller.simulation.round, 599);
  assert.deepEqual(custom.getState().pendingNext, []);
});

test('ordinary edits preserve live switches; directly confirmed behavior applies now and next', () => {
  const { custom, sim, controller } = setup();
  custom.setRecruitment('left', false); custom.setEnemyAi(false);
  custom.commitSetting('config.rules.rangeMultiplier', 4);
  assert.equal(sim.p1[2], 0); assert.equal(custom.getBattleState().enemyAi, false);
  custom.commitSetting('rules.rightRecruitment', false);
  assert.equal(sim.p2[2], 0); assert.equal(custom.getState().next.rules.rightRecruitment, false);
  controller.startMatch(); assert.equal(controller.simulation.p2[2], 0);
});

test('undo restores actual parameters and next game, does not add a duplicate confirmation step', () => {
  const { custom, sim } = setup(); const originalRange = sim.redBoss.range;
  custom.commitSetting('config.sides.left.base.range', 1234);
  custom.commitSetting('config.sides.left.base.range', 1234);
  assert.equal(sim.redBoss.range, 1234); assert.equal(custom.getState().canUndoSettings, true);
  custom.undoSettings(); assert.equal(sim.redBoss.range, originalRange);
  assert.equal(custom.getState().next.config.sides.left.base.range, originalRange);
  assert.equal(custom.getState().canUndoSettings, false); assert.equal(custom.undoSettings(), false);
});

test('invalid setting/profile is rejected before changing runtime, history or persisted settings', () => {
  const { custom, sim, storage } = setup();
  custom.commitSetting('config.rules.rangeMultiplier', 3);
  const saved = storage.values.get(DRAFT_KEY), before = custom.getState();
  assert.throws(() => custom.commitSetting('config.rules.rangeMultiplier', NaN));
  assert.throws(() => custom.commitSetting('config.rules.frameRate', 60));
  assert.throws(() => custom.commitSetting('rules.enemyAi', 'yes'));
  assert.equal(sim.rules.rangeMultiplier, 3); assert.equal(storage.values.get(DRAFT_KEY), saved);
  assert.deepEqual(custom.getState().draft, before.draft);
  assert.throws(() => custom.resetSettings({ originalRules: 'true' }));
  custom.undoSettings(); assert.equal(custom.getState().canUndoSettings, false);
});

test('reset parameter defaults preserves combat improvements, live progress, corpses and HP ratios', () => {
  const { custom, sim } = setup();
  const unit = spawn(custom, sim), corpse = spawn(custom, sim); corpse.dead();
  custom.commitSetting('config.sides.left.units.0.hp', 450); unit.nowHP = 225;
  custom.commitSetting('config.sides.left.base.hp', 7000); sim.redBoss.nowHP = 3500;
  custom.commitSetting('config.sides.left.units.0.range', 9999);
  custom.setRecruitment('left', false); custom.setRecruitment('right', false); custom.setEnemyAi(false);
  sim.leftMoney = 789; sim.leftPopulation = 16; sim.redBoss.t = 123;
  const progress = [sim.frame, sim.round, sim.leftMoney, sim.leftIncome, sim.leftPopulation, sim.redBoss.t];
  const count = sim.scene.children.length;
  custom.resetSettings();
  assert.equal(sim.scene.children.length, count); assert.equal(corpse.nowHP, 0);
  assert.equal(unit.spawnHP, defaults.units[0].hp); assert.equal(unit.nowHP, defaults.units[0].hp / 2);
  assert.equal(sim.redBoss.nowHP, defaults.rules.baseHp / 2);
  assert.equal(unit.range, defaults.units[0].range * defaults.rules.rangeMultiplier);
  assert.deepEqual([sim.frame, sim.round, sim.leftMoney, sim.leftIncome, sim.leftPopulation, sim.redBoss.t], progress);
  assert.equal(sim.p1[2], 1); assert.equal(sim.p2[2], 1); assert.equal(custom.getBattleState().enemyAi, true);
  assert.deepEqual(sim.config.combatHitRules, effective.combatHitRules);
  assert.deepEqual(sim.config.casterProjectileLifetime, effective.casterProjectileLifetime);
});

test('full original reset removes policies for future shots, not attacks already in flight', () => {
  const { custom, sim } = setup();
  const mage = spawn(custom, sim, 'left', 9), old = fire(sim, mage);
  old.vy = 7; old.life = 198; old.delay = 12;
  const step = old.step;
  custom.resetSettings({ originalRules: true });
  assert.equal(sim.config.combatHitRules, undefined); assert.equal(sim.config.casterProjectileLifetime, undefined);
  assert.equal(old.step, step); assert.equal(old.life, 198); assert.equal(old.delay, 12); assert.equal(old.vy, 7);
  const fresh = fire(sim, mage);
  assert.notEqual(fresh.step, step); assert.equal(fresh.life, defaults.rules.projectileLifeFrames);
  assert.equal(fire(sim).life, defaults.rules.projectileLifeFrames);
});

test('full original reset persists across new match and process restart without reactivating startup policies', () => {
  const { custom, controller, storage } = setup(); custom.resetSettings({ originalRules: true });
  controller.startMatch(); assert.deepEqual(controller.simulation.config, defaults);
  const restored = setup({ storage });
  assert.equal(restored.custom.getState().template, 'original'); assert.equal(restored.custom.getState().restoredSettings, true);
  assert.deepEqual(restored.sim.config, defaults); assert.equal(fire(restored.sim).life, defaults.rules.projectileLifeFrames);
});

test('undo full reset reinstalls startup extensions even into a fresh faithful match and persists them', () => {
  const { custom, controller, storage } = setup();
  custom.commitSetting('config.sides.left.base.range', 4321);
  custom.resetSettings({ originalRules: true }); controller.startMatch();
  assert.equal(controller.simulation.config.combatHitRules, undefined);
  custom.undoSettings(); const sim = controller.simulation;
  assert.equal(sim.redBoss.range, 4321); assert.deepEqual(sim.config.combatHitRules, effective.combatHitRules);
  assert.equal(fire(sim).life, 253); assert.equal(fire(sim).step.name, 'combatStep');
  const restored = setup({ storage }); assert.equal(restored.sim.redBoss.range, 4321);
  assert.equal(fire(restored.sim).life, 253);
});

test('old draft migrates to automatic confirmed settings; legacy opt-out remains unapplied', () => {
  const { custom, storage } = setup({ autoRestore: false });
  custom.updateDraft('config.sides.left.units.0.range', 765);
  assert.equal(JSON.parse(storage.values.get(DRAFT_KEY)).schemaVersion, 1);
  const legacy = setup({ storage, autoRestore: false });
  assert.equal(spawn(legacy.custom, legacy.sim).range, defaults.units[0].range * defaults.rules.rangeMultiplier);
  const migrated = setup({ storage }); assert.equal(spawn(migrated.custom, migrated.sim).range, 765 * defaults.rules.rangeMultiplier);
  migrated.custom.commitSetting('config.rules.rangeMultiplier', 2);
  assert.equal(JSON.parse(storage.values.get(DRAFT_KEY)).schemaVersion, 2);
});

test('reset and menu return preserve named presets; return only ends match and retains next settings', () => {
  const { custom, controller, storage } = setup();
  custom.commitSetting('config.sides.left.base.range', 2222); const preset = custom.savePreset('远射水晶');
  const library = storage.values.get(PRESETS_KEY);
  custom.resetSettings(); assert.equal(storage.values.get(PRESETS_KEY), library);
  custom.loadPreset(preset.id); custom.applySettings();
  const saved = storage.values.get(DRAFT_KEY);
  custom.returnToMenu(); assert.equal(controller.phase, 'title'); assert.equal(controller.simulation.running, false);
  assert.equal(storage.values.get(DRAFT_KEY), saved); assert.equal(storage.values.get(PRESETS_KEY), library);
  controller.startMatch(); assert.equal(controller.simulation.redBoss.range, 2222);
});

test('preset/import loading followed by applySettings applies atomically and auto-saves full parameter set', () => {
  const { custom, sim } = setup();
  custom.updateDraft('config.sides.left.base.range', 5432); custom.updateDraft('config.sides.left.initial.money', 876);
  const exported = custom.exportJSON(); custom.resetSettings();
  custom.importJSON(exported); assert.notEqual(sim.redBoss.range, 5432);
  custom.applySettings(); assert.equal(sim.redBoss.range, 5432); assert.equal(sim.leftMoney, 0);
  assert.equal(custom.getState().next.config.sides.left.initial.money, 876);
  assert.equal(custom.getState().settingsSaved, true);
});

test('storage failure keeps rules usable but never reports settings saved', async () => {
  const storage = { getItem: () => null, setItem() {}, flush: async () => false };
  const { custom, sim } = setup({ storage }); custom.commitSetting('config.sides.left.base.range', 2468);
  assert.equal(await custom.flush(), false); assert.equal(custom.getState().settingsSaved, false);
  assert.equal(sim.redBoss.range, 2468);
});

test('late older flush failure cannot overwrite the latest acknowledged confirmation status', async () => {
  const requests = [], storage = { getItem: () => null, setItem() {}, flush: () => new Promise(resolve => requests.push(resolve)) };
  const { custom } = setup({ storage });
  custom.commitSetting('config.sides.left.base.range', 2100); const first = custom.flush();
  custom.commitSetting('config.sides.left.base.range', 2200); const second = custom.flush();
  requests[1](true); assert.equal(await second, true); assert.equal(custom.getState().settingsSaved, true);
  requests[0](false); assert.equal(await first, false); assert.equal(custom.getState().settingsSaved, true);
});

test('corrupt persisted settings never overwrite original record or change startup rules', () => {
  const storage = memory(); const broken = JSON.stringify({ schemaVersion: 2, template: 'unknown', profile: {} });
  storage.values.set(DRAFT_KEY, broken); const { custom, sim } = setup({ storage });
  assert.equal(storage.values.get(DRAFT_KEY), broken); assert.deepEqual(sim.config.combatHitRules, effective.combatHitRules);
  assert.equal(custom.getState().restoredSettings, false); assert.ok(custom.getState().warnings.length);
});
