import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { GameController } from '../src/app/controller.mjs';
import { MiragineSimulation, seededRandom, IsometricAttack } from '../src/core/index.mjs';
import { createCustomization, profileFromConfiguration, validateProfile, configurationFromProfile,
  DRAFT_KEY, PRESETS_KEY, MAX_SANDBOX_UNITS } from '../src/customization/index.mjs';
import { parseJSON, MAX_DOCUMENT_BYTES } from '../src/customization/schema.mjs';

const defaults = JSON.parse(readFileSync(new URL('../config/defaults.generated.json', import.meta.url), 'utf8'));
test('rule profile and sandbox battle identity never advertise modified runs as original', () => {
  const { custom, controller, sim } = start();
  assert.equal(custom.getMode().current, 'original');
  custom.spawn({ side: 'left', unitId: 0 });
  assert.equal(custom.getMode().current, 'custom');
  assert.equal(sim.config.profile, 'faithful', 'sandbox alone need not rewrite numeric rules');
  custom.applyCurrent(); assert.equal(controller.config.profile, 'custom');
  const initial = structuredClone(defaults); initial.units[0].hp = 99;
  assert.equal(setup({ initial }).custom.getMode().current, 'custom');
  custom.returnToOriginal(); assert.equal(custom.getMode().current, 'original');
});
function memory() {
  const values = new Map();
  return { values, getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
}
function setup({ storage = memory(), initial = defaults } = {}) {
  const events = [];
  const controller = new GameController(initial, { storage: { getItem: () => 'true' },
    createSimulation: options => new MiragineSimulation({ ...options, rng: seededRandom(199) }) });
  const custom = createCustomization({ controller, defaults, initialConfig: initial, storage, onChange: event => events.push(event) });
  return { controller, custom, storage, events };
}
function start(options) { const result = setup(options); result.controller.startMatch(true, 1); return { ...result, sim: result.controller.simulation }; }

test('all 16 units and four difficulties are modeled without invented systems', () => {
  const { custom } = setup(), state = custom.getState();
  assert.equal(Object.keys(state.draft.config.units).length, 16);
  assert.equal(Object.keys(state.draft.config.difficulties).length, 4);
  assert.deepEqual(state.unsupported, ['建筑建造', '主动技能', '固定波次 / 关卡增援']);
  assert.equal(custom.getMetadata()[0].entries[0].fields.find(field => field.path.endsWith('weaponSpeed')).unit, '乘攻击间隔倍率后向零取整为帧');
});
test('unapplied editor construction preserves original deterministic simulation', () => {
  const { sim } = start();
  const original = new MiragineSimulation({ config: defaults, difficulty: 1, rng: seededRandom(199) });
  sim.step(850); original.step(850);
  assert.deepEqual(sim.snapshot(), original.snapshot());
  assert.deepEqual(sim.events, original.events);
});
test('draft changes, import, preset save and load do not silently apply current or next games', () => {
  const { custom, sim, controller } = start();
  custom.updateDraft('config.units.0.hp', 999);
  const record = custom.savePreset('更强新兵'); custom.resetDraft(); custom.loadPreset(record.id);
  const exported = custom.exportJSON(); custom.resetDraft(); custom.importJSON(exported);
  assert.equal(custom.getState().draft.config.units[0].hp, 999);
  assert.equal(sim.config.units[0].hp, 45);
  controller.startMatch(); assert.equal(controller.simulation.config.units[0].hp, 45);
});
test('durable draft reload remains unapplied; defaults reset means recovered original not external JSON', () => {
  const storage = memory(), initial = structuredClone(defaults); initial.units[0].cost = 7;
  const one = setup({ storage, initial }); one.custom.updateDraft('config.units.0.cost', 9);
  const two = setup({ storage, initial });
  assert.equal(two.custom.getState().draft.config.units[0].cost, 9);
  two.controller.startMatch(); assert.equal(two.controller.simulation.config.units[0].cost, 7);
  two.custom.resetDraft(); assert.equal(two.custom.getState().draft.config.units[0].cost, 20);
});
test('apply current preserves health ratios and original uncapped healing, updates in-flight father damage', () => {
  const { custom, sim } = start();
  sim.leftMoney = 100; const unit = sim.createUnit('left', 0); unit.nowHP = 90; unit.t = 17;
  sim.redBoss.nowHP = 1750;
  const attack = new IsometricAttack(sim, unit, sim.blueBoss); sim.scene.addChild(attack);
  custom.updateDraft('config.units.0.hp', 100);
  custom.updateDraft('config.units.0.damage.0', 77);
  custom.updateDraft('config.units.0.moveSpeed', 3);
  custom.updateDraft('config.rules.baseHp', 7000);
  const frame = sim.frame, round = sim.round; custom.applyCurrent();
  assert.equal(unit.nowHP, 200); assert.equal(unit.spawnHP, 100); assert.equal(unit.maxHP, 100);
  assert.equal(unit.t, 17); assert.equal(unit.moveSpeed, 3 * 1.3); assert.equal(attack.father.damage[0], 77);
  assert.equal(sim.redBoss.nowHP, 3500); assert.equal(sim.redBoss.maxHP, 7000);
  assert.equal(sim.frame, frame); assert.equal(sim.round, round);
  assert.equal(sim.renderSnapshot.find(child => child.uid === unit.uid).nowHP, 200);
});
test('absolute HP strategy preserves current HP and never revives dead troops', () => {
  const { custom, sim } = start(); sim.leftMoney = 100;
  const unit = sim.createUnit('left', 0); unit.nowHP = 30;
  const dead = sim.createUnit('left', 0); dead.dead();
  custom.updateDraft('config.units.0.hp', 500); custom.applyCurrent({ health: 'absolute' });
  assert.equal(unit.nowHP, 30); assert.equal(dead.nowHP, 0);
  assert.throws(() => custom.applyCurrent({ health: 'heal' }));
});
test('current apply defers initial resources and countdown; subsequent match takes new initial values', () => {
  const { custom, sim, controller } = start();
  custom.updateDraft('config.rules.initialMoney', 777);
  custom.updateDraft('config.rules.startingIncome', 888);
  custom.updateDraft('config.rules.initialRoundFrames', 300);
  custom.updateDraft('config.rules.roundFrames', 600);
  custom.updateDraft('config.rules.populationLimit', 90);
  const report = custom.applyCurrent();
  assert.ok(report.deferred.includes('config.rules.initialMoney'));
  assert.equal(sim.leftMoney, 0); assert.equal(sim.leftIncome, 500); assert.equal(sim.leftPopulation, 80); assert.equal(sim.round, 179);
  sim.p1[2] = sim.p2[2] = 0; sim.round = 1; sim.step();
  assert.equal(sim.round, 600); assert.equal(sim.leftPopulation, 90);
  controller.startMatch(); assert.equal(controller.simulation.leftMoney, 777); assert.equal(controller.simulation.leftIncome, 888);
  assert.equal(controller.simulation.round, 299);
});
test('apply next never rewrites live config or live units', () => {
  const { custom, controller, sim } = start();
  custom.updateDraft('config.units.0.cost', 7); custom.applyNext();
  assert.equal(sim.config.units[0].cost, 20); assert.equal(controller.config.units[0].cost, 20);
  controller.startMatch(); assert.equal(controller.simulation.config.units[0].cost, 7);
});
test('base difficulty attacks change in current match while initial blue resources defer', () => {
  const { custom, sim } = start();
  custom.updateDraft('config.difficulties.1.blueBaseDamage.0', 123);
  custom.updateDraft('config.difficulties.1.blueBaseWeaponSpeedFrames', 12);
  custom.updateDraft('config.difficulties.1.rightStartingIncome', 777); custom.applyCurrent();
  assert.equal(sim.blueBoss.damage[0], 123); assert.equal(sim.blueBoss.weaponSpeed, 12); assert.equal(sim.rightIncome, 500);
});
test('explicit custom match installs recruitment and AI choices before immediate first frame', () => {
  const { custom, controller } = setup();
  custom.updateDraft('rules.leftRecruitment', false); custom.updateDraft('rules.rightRecruitment', false);
  custom.updateDraft('rules.enemyAi', false); custom.updateDraft('config.rules.initialRoundFrames', 1);
  custom.startBattle({ difficulty: 3, singlePlay: true }); const sim = controller.simulation;
  assert.equal(sim.frame, 1); assert.equal(sim.scene.children.length, 2);
  assert.ok(!sim.events.some(event => event.type === 'aiSelection'));
  assert.equal(custom.getState().battle.enemyAi, false);
});
test('sandbox spawning creates real either-side units without paying/giving resources and renders while paused', () => {
  const { custom, sim } = start();
  const before = [sim.leftMoney, sim.leftIncome, sim.leftPopulation, sim.rightMoney, sim.rightIncome, sim.rightPopulation];
  const red = custom.spawn({ side: 'left', unitId: 15, count: 2 });
  const blue = custom.spawn({ side: 'right', unitId: 4, count: 3 });
  assert.equal(red.length, 2); assert.equal(blue.length, 3);
  assert.equal(sim.renderSnapshot.filter(child => child.kind === 'unit').length, 5);
  assert.deepEqual([sim.leftMoney, sim.leftIncome, sim.leftPopulation, sim.rightMoney, sim.rightIncome, sim.rightPopulation], before);
  assert.equal(sim.frame, 1);
});
test('sandbox cap is preflight atomic and automatic custom recruitment has the same safety ceiling', () => {
  const { custom, sim } = start();
  for (let i = 0; i < MAX_SANDBOX_UNITS / 100; i++) custom.spawn({ side: 'left', unitId: 0, count: 100 });
  const nextUid = sim.nextUid;
  assert.throws(() => custom.spawn({ side: 'right', unitId: 1, count: 1 }), /500/);
  assert.equal(sim.nextUid, nextUid);
  sim.rightMoney = 1000; assert.equal(sim.createUnit('right', 1), null);
});
test('clear troops preserves both bases and target-list identities, removes dangling attacks without RNG', () => {
  const { custom, sim } = start();
  custom.spawn({ side: 'left', unitId: 0, count: 2 }); custom.spawn({ side: 'right', unitId: 1, count: 2 });
  const red = sim.friendList[1], blue = sim.enemyList[1], list = sim.friendList;
  blue.target = red; sim.blueBoss.target = red;
  sim.scene.addChild(new IsometricAttack(sim, blue, red)); sim.scene.addChild(new IsometricAttack(sim, red, blue));
  const keep = new IsometricAttack(sim, blue, sim.redBoss); sim.scene.addChild(keep);
  sim.rng = () => { throw new Error('clear must not use RNG'); };
  assert.equal(custom.clearTroops('left'), 2);
  assert.equal(sim.friendList, list); assert.deepEqual(sim.friendList, [sim.redBoss]);
  assert.equal(blue.target, null); assert.equal(sim.blueBoss.target, null);
  assert.deepEqual(sim.projectiles, [keep]); assert.equal(sim.enemyList.length, 3);
  assert.equal(custom.clearTroops(), 2); assert.equal(sim.scene.children.length, 2);
});
test('resource edits validate all fields before applying and never change default config', () => {
  const { custom, sim } = start();
  assert.throws(() => custom.setResources({ side: 'left', money: 777, population: -1 })); assert.equal(sim.leftMoney, 0);
  custom.setResources({ side: 'right', money: 777, income: 888, population: 99 });
  assert.equal(sim.rightMoney, 777); assert.equal(sim.rightIncome, 888); assert.equal(sim.rightPopulation, 99);
  assert.equal(sim.rules.initialMoney, 0); assert.throws(() => custom.setResources({ side: 'left', money: 1, unknown: 2 }));
});
test('manual AI/recruitment toggles and selection affect only current battle', () => {
  const { custom, sim } = start();
  custom.selectUnit({ side: 'right', unitId: 13 }); custom.setEnemyAi(false); custom.setRecruitment('right', false);
  sim.round = 1; sim.step(); assert.deepEqual(sim.p2, [5, 1, 0]);
  custom.setEnemyAi(true); custom.setRecruitment('right', true);
  assert.equal(custom.getState().battle.right.recruitment, true);
  assert.equal(custom.getState().next.rules.rightRecruitment, true);
});
test('unknown fields, immutable topology/30 Hz, pollution, getters and oversize JSON fail atomically', () => {
  const { custom } = setup(), before = custom.getState().draft;
  for (const path of ['config.rules.frameRate', 'config.rules.mapWidth', '__proto__.polluted', 'config.units.0.ss']) assert.throws(() => custom.updateDraft(path, 60));
  const invalid = structuredClone(before); invalid.config.rules.unknown = 1; assert.throws(() => custom.setDraft(invalid));
  assert.throws(() => parseJSON('{"__proto__":{"x":1}}'));
  assert.throws(() => parseJSON(' '.repeat(MAX_DOCUMENT_BYTES + 1)));
  const getter = {}; Object.defineProperty(getter, 'schemaVersion', { enumerable: true, get() { throw new Error('Getter evaluated'); } });
  assert.throws(() => custom.setDraft(getter), /enumerable data property/);
  assert.deepEqual(custom.getState().draft, before);
  assert.throws(() => custom.updateDraft('config.units.0.hp', Infinity));
  assert.throws(() => custom.updateDraft('config.units.0.armorTypeID', 2));
});
test('profile validation rejects sparse arrays and damaged nested collections', () => {
  const profile = profileFromConfiguration(defaults); delete profile.config.units[0].damage[0]; assert.throws(() => validateProfile(profile));
  const broken = profileFromConfiguration(defaults); delete broken.config.difficulties[3]; assert.throws(() => validateProfile(broken));
});
test('effective runtime-derived values are regenerated while original config remains unmodified/frozen', () => {
  const profile = profileFromConfiguration(defaults); profile.config.units[0].weaponSpeed = 1.234; profile.config.rules.weaponSpeedMultiplier = 10;
  const config = configurationFromProfile(defaults, profile);
  assert.equal(config.units[0].runtime.attackCooldownFrames, 12); assert.equal(config.units[0].runtime.attackCooldownSeconds, .4);
  assert.ok(Object.isFrozen(config.units[0].damage)); assert.equal(defaults.units[0].weaponSpeed, .83);
  assert.equal(config.rules.frameRate, 30); assert.equal(config.rules.mapWidth, 4500);
});
test('presets bounded to 25 and overwrite requires an existing ID; import preserves name safely', () => {
  const { custom } = setup(); let first;
  for (let i = 0; i < 25; i++) { const result = custom.savePreset(`规则 ${i}`); first ??= result.id; }
  assert.throws(() => custom.savePreset('超限'), /25/);
  custom.savePreset('替换', first); assert.equal(custom.getState().presets.length, 25);
  assert.throws(() => custom.savePreset('bad', 'unknown')); custom.deletePreset(first);
  assert.equal(custom.getState().presets.length, 24);
});
test('corrupted saved state is rejected, not applied or overwritten on construction', () => {
  const storage = memory(); storage.values.set(DRAFT_KEY, '{broken'); storage.values.set(PRESETS_KEY, '{"schemaVersion":99,"presets":[]}');
  const { custom, controller } = setup({ storage });
  assert.equal(custom.getState().warnings.length, 2); assert.equal(storage.values.get(DRAFT_KEY), '{broken');
  controller.startMatch(); assert.equal(controller.simulation.config.units[0].cost, 20);
});
test('quota and async persistence failures never claim a durable successful save', async () => {
  const bad = { getItem: () => null, setItem() { throw new Error('quota'); } };
  const { custom } = setup({ storage: bad }); custom.updateDraft('config.units.0.cost', 1);
  assert.equal(custom.savePreset('只在内存').queued, false); assert.equal(await custom.flush(), false);
  assert.ok(custom.getState().warnings.length); assert.equal(custom.getState().draft.config.units[0].cost, 1);
  const asyncStorage = memory(); asyncStorage.flush = async () => false;
  const second = setup({ storage: asyncStorage }).custom; second.savePreset('稍后写入失败'); assert.equal(await second.flush(), false);
});
test('draft undo restores previous edits and getter results cannot mutate internal state', () => {
  const { custom } = setup(); custom.updateDraft('config.units.0.hp', 12); custom.updateDraft('config.units.0.hp', 24);
  assert.equal(custom.undoDraft(), true); assert.equal(custom.getState().draft.config.units[0].hp, 12);
  const state = custom.getState(); state.draft.config.units[0].hp = 999; assert.equal(custom.getState().draft.config.units[0].hp, 12);
});
test('sandbox methods reject title/ended matches without changes', () => {
  const { custom, controller } = setup(); assert.throws(() => custom.spawn({ side: 'left', unitId: 0 }));
  controller.startMatch(); controller.simulation.winner = 'left'; assert.throws(() => custom.clearTroops());
  assert.equal(custom.getState().isBattle, false);
});
test('return original preserves editable drafts/presets and clears live/next custom mode to recovered defaults', () => {
  const initial = structuredClone(defaults); initial.units[0].cost = 7;
  const { custom, controller } = setup({ initial }); custom.updateDraft('config.units.0.cost', 1);
  custom.savePreset('保留'); custom.startBattle(); const old = controller.simulation;
  custom.returnToOriginal();
  assert.equal(controller.phase, 'title'); assert.equal(old.running, false);
  assert.equal(custom.getState().draft.config.units[0].cost, 1); assert.equal(custom.getState().presets.length, 1);
  controller.startMatch(); assert.equal(controller.simulation.config.units[0].cost, 20);
  assert.equal(custom.getState().mode, 'original');
});
test('unexposed external configuration remains intact on live and next apply, explicit original return resets it', () => {
  const initial = structuredClone(defaults); initial.rules.spawnJitterY = 1; initial.ai.forceOverlordMoneyThreshold = 12345;
  const { custom, controller, sim } = start({ initial });
  custom.updateDraft('config.units.0.hp', 78); custom.applyCurrent();
  assert.equal(sim.rules.spawnJitterY, 1); assert.equal(sim.config.ai.forceOverlordMoneyThreshold, 12345);
  custom.resetDraft(); custom.applyNext(); controller.startMatch();
  assert.equal(controller.simulation.rules.spawnJitterY, 1); assert.equal(controller.simulation.config.units[0].hp, 45);
  custom.returnToOriginal(); controller.startMatch(); assert.equal(controller.simulation.rules.spawnJitterY, 200);
});
test('unrelated or repeated apply does not introduce floating point HP drift', () => {
  const { custom, sim } = start(); custom.spawn({ side: 'left', unitId: 0 });
  const unit = sim.friendList[1]; unit.nowHP = 13; sim.redBoss.nowHP = 1234.12345;
  const hp = unit.nowHP, baseHp = sim.redBoss.nowHP, frame = sim.frame, round = sim.round;
  sim.rng = () => { throw new Error('apply must not consume RNG'); };
  custom.updateDraft('config.units.0.description', '只改文字');
  for (let n = 0; n < 10; n++) custom.applyCurrent();
  assert.equal(unit.nowHP, hp); assert.equal(sim.redBoss.nowHP, baseHp);
  assert.equal(sim.frame, frame); assert.equal(sim.round, round);
});
