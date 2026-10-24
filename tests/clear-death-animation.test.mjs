import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { MiragineSimulation, seededRandom } from '../src/core/index.mjs';
import { GameController } from '../src/app/controller.mjs';
import { MiraginePlayback } from '../src/app/playback-session.mjs';
import { createCustomization } from '../src/customization/index.mjs';
import { installCombatHitRules } from '../src/extensions/combat-hits.mjs';
import { installCasterProjectileLifetime } from '../src/extensions/projectile-lifetime.mjs';
import { mergeConfiguration } from '../src/config/index.mjs';

const defaults = JSON.parse(fs.readFileSync(new URL('../config/defaults.generated.json', import.meta.url)));
const effective = mergeConfiguration(defaults, JSON.parse(fs.readFileSync(new URL('../config/custom.json', import.meta.url))));
function fixture() {
  const controller = new GameController(effective, { storage: { getItem: () => 'true' },
    createSimulation: options => installCombatHitRules(installCasterProjectileLifetime(new MiragineSimulation({ ...options, rng: seededRandom(47) }))) });
  const custom = createCustomization({ controller, defaults, initialConfig: effective });
  controller.startMatch(true, 1);
  custom.setRecruitment('left', false); custom.setRecruitment('right', false);
  return { controller, custom, sim: controller.simulation };
}
const bodies = sim => sim.scene.children.filter(e => e.kind === 'unit');
const resources = sim => ['leftMoney', 'rightMoney', 'leftIncome', 'rightIncome', 'leftPopulation', 'rightPopulation'].map(k => sim[k]);

test('both-side clear uses the recovered death timeline and knockback for all 16 unit types', () => {
  const { custom, sim } = fixture();
  for (const side of ['left', 'right']) for (let id = 0; id < 16; id++) custom.spawn({ side, unitId: id });
  const units = bodies(sim), lists = [sim.friendList, sim.enemyList], money = resources(sim);
  const bases = [sim.redBoss, sim.blueBoss].map(b => b.visualState());
  const beforeFrame = sim.frame;
  assert.equal(custom.clearTroops(), 32);
  assert.equal(sim.frame, beforeFrame); assert.deepEqual(resources(sim), money);
  assert.deepEqual([sim.redBoss, sim.blueBoss].map(b => b.visualState()), bases);
  assert.equal(sim.friendList, lists[0]); assert.equal(sim.enemyList, lists[1]);
  assert.deepEqual(sim.friendList, [sim.redBoss]); assert.deepEqual(sim.enemyList, [sim.blueBoss]);
  for (const body of units) {
    assert.equal(body.parent, sim.scene); assert.equal(body.nowHP, 0); assert.equal(body.action, 'dead');
    assert.equal(body.currentFrame, 1); assert.equal(body.deadTime, defaults.rules.deathAnimationFrames);
    assert.equal(body.pz, 1); assert.equal(body.vx, -5 * body.direction); assert.equal(body.vz, 8);
    assert.ok(sim.renderSnapshot.some(e => e.uid === body.uid && e.action === 'dead' && e.nowHP === 0));
    for (let step = 0; step < defaults.rules.deathAnimationFrames - 2; step++) { body.step(); assert.equal(body.parent, sim.scene); }
    body.step(); assert.equal(body.parent, null);
  }
  assert.deepEqual(sim.scene.children.map(e => e.uid).sort(), [sim.redBoss.uid, sim.blueBoss.uid].sort());
});

test('repeated clear leaves existing death animation position/progress and does not repeat death events', () => {
  const { custom, sim } = fixture(); custom.spawn({ side: 'left', unitId: 5, count: 3 });
  const [alreadyDead, ...live] = bodies(sim); alreadyDead.dead(); alreadyDead.step();
  const old = { visual: alreadyDead.visualState(), deadTime: alreadyDead.deadTime };
  sim.drainEvents(); let randomCalls = 0; sim.rng = () => { randomCalls++; return 0.75; };
  assert.equal(custom.clearTroops('left'), live.length);
  assert.deepEqual({ visual: alreadyDead.visualState(), deadTime: alreadyDead.deadTime }, old);
  const after = bodies(sim).map(b => [b.visualState(), b.deadTime]);
  assert.equal(custom.clearTroops(), 0); assert.deepEqual(bodies(sim).map(b => [b.visualState(), b.deadTime]), after);
  assert.equal(randomCalls, live.length);
  assert.equal(sim.drainEvents().filter(e => e.type === 'destroy').length, live.length);
});

test('single-side clear cancels pending ranged/direct hits but keeps unrelated enemy shots', () => {
  const { custom, sim } = fixture();
  custom.spawn({ side: 'left', unitId: 12 }); custom.spawn({ side: 'left', unitId: 0 });
  custom.spawn({ side: 'right', unitId: 12 });
  const [mage, melee] = sim.friendList.filter(e => e.kind === 'unit'), enemy = sim.enemyList[1];
  for (const e of [mage, melee]) { e.target = enemy; e.attack(); }
  enemy.target = mage; enemy.attack(); enemy.t = 0; enemy.target = sim.redBoss; enemy.attack();
  const keep = sim.projectiles.at(-1), enemyHp = enemy.nowHP;
  sim.redBoss.target = mage; assert.equal(custom.clearTroops('left'), 2);
  assert.deepEqual(sim.projectiles, [keep]); assert.equal(enemy.nowHP, enemyHp);
  assert.equal(enemy.target, sim.redBoss); assert.equal(sim.redBoss.target, null);
  enemy.findTarget(); assert.equal(enemy.target, sim.redBoss);
  assert.ok(bodies(sim).filter(b => b.side === 'left').every(b => b.action === 'dead'));
});

for (const mode of ['manual-pause', 'zero-speed']) {
  test(`${mode}: clear refreshes visible corpse poses without advancing time; resume plays and removes them`, () => {
    const { custom, controller, sim } = fixture();
    custom.spawn({ side: 'left', unitId: 0 }); custom.spawn({ side: 'right', unitId: 1 });
    const clock = new MiraginePlayback(controller, { now: 0 });
    if (mode === 'manual-pause') clock.setPaused(true, 0); else clock.setSpeed(0, 0);
    const frame = sim.frame; custom.clearTroops(); clock.refresh();
    const corpse = bodies(sim)[0], x = corpse.px, z = corpse.pz, countdown = corpse.deadTime;
    clock.advance(2000);
    assert.equal(sim.frame, frame); assert.equal(corpse.px, x); assert.equal(corpse.pz, z); assert.equal(corpse.deadTime, countdown);
    assert.ok(clock.presentation().snapshot.some(e => e.uid === corpse.uid && e.action === 'dead'));
    if (mode === 'manual-pause') clock.setPaused(false, 2000); else clock.setSpeed(1, 2000);
    clock.advance(2100); assert.ok(sim.frame > frame); assert.notEqual(corpse.px, x); assert.ok(corpse.pz > z);
    // Model real refreshes, not a suspended window whose time is intentionally capped.
    for (let now = 2150; now <= 4000; now += 50) clock.advance(now);
    assert.equal(bodies(sim).length, 0);
  });
}

test('bulk clear keeps the 30 Hz world responsive after corpse expiry and leaves no attacks or index targets', () => {
  const { custom, sim } = fixture();
  for (let i = 0; i < 8; i++) for (const side of ['left', 'right']) custom.spawn({ side, unitId: i % 16, count: 64 });
  const before = resources(sim); assert.equal(custom.clearTroops(), 1024);
  assert.equal(bodies(sim).length, 1024); assert.deepEqual(resources(sim), before);
  for (let i = 0; i < 100; i++) sim.step();
  assert.equal(bodies(sim).length, 0); assert.equal(sim.projectiles.length, 0);
  assert.deepEqual(sim.friendList, [sim.redBoss]); assert.deepEqual(sim.enemyList, [sim.blueBoss]);
  assert.equal(sim.rules.frameRate, 30); assert.equal(sim.winner, null);
});
