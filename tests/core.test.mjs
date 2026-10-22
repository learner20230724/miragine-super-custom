import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MiragineSimulation, IsometricEntity, IsometricAttack, CoreScene, CoreSymbol, as3int, seededRandom, Vec2 } from '../src/core/index.mjs';

const defaults = JSON.parse(readFileSync(new URL('../config/defaults.generated.json', import.meta.url), 'utf8'));
const make = (options = {}) => new MiragineSimulation({ config: structuredClone(defaults), rng: () => 0.5, autoStart: false, ...options });
const close = (actual, expected, epsilon = 1e-10) => assert.ok(Math.abs(actual - expected) < epsilon, `${actual} ~= ${expected}`);
function standalonePair(sim = make()) {
  const a = new IsometricEntity(sim), b = new IsometricEntity(sim);
  a.side = 'left'; b.side = 'right';
  a.px = 0; b.px = 40; a.py = b.py = 0;
  a.damage = [7, 13]; a.weaponSpeed = 16.6; a.target = b;
  sim.scene = new CoreScene(); sim.scene.addChild(a); sim.scene.addChild(b);
  return { sim, a, b };
}

test('AS3 int truncates toward zero and wraps exactly, zero vector unit is guarded only by getDivided', () => {
  assert.equal(as3int(16.599999999999998), 16); assert.equal(as3int(-1.9), -1);
  assert.equal(as3int(0x80000000), -0x80000000); assert.equal(as3int(NaN), 0);
  const vector = new Vec2(); assert.deepEqual(vector.getUnit(), new Vec2());
  vector.normalize(); assert.ok(Number.isNaN(vector.x));
});

test('initialization is original super board and start performs an immediate frame', () => {
  const sim = make();
  assert.equal(sim.round, 180); assert.equal(sim.redBoss.px, 300); assert.equal(sim.blueBoss.px, 4200);
  assert.equal(sim.redBoss.py, 400); assert.equal(sim.redBoss.nowHP, 3500);
  assert.equal(sim.leftMoney, 0); assert.equal(sim.leftIncome, 500); assert.equal(sim.leftPopulation, 80);
  assert.deepEqual(sim.p1, [0, 0, 1]); assert.equal(sim.redBoss.id, undefined);
  const started = make({ autoStart: true }); assert.equal(started.round, 179); assert.equal(started.frame, 1);
});

test('initial 180-frame income credits money, chooses AI, recruits both sides on the same frame', () => {
  const sim = make({ singlePlay: false });
  sim.step(179); assert.equal(sim.leftMoney, 0); assert.equal(sim.friendList.length, 1);
  sim.step(); assert.equal(sim.round, 900); assert.equal(sim.leftMoney, 480);
  assert.equal(sim.leftIncome, 504); assert.equal(sim.leftPopulation, 79);
  assert.equal(sim.friendList.length, 2); assert.equal(sim.enemyList.length, 2);
  assert.equal(sim.renderSnapshot.length, 2, 'new recruits were created after original render point');
  assert.equal(sim.friendList[1].px, 300); assert.equal(sim.friendList[1].py, 400);
  sim.step(2); assert.equal(sim.friendList.length, 2); sim.step(); assert.equal(sim.friendList.length, 3);
});

test('round income is based on pre-purchase income; spending/income/population use AS3 int stores', () => {
  const config = structuredClone(defaults); config.units[0].cost = 1.5; config.units[0].income = 4.5;
  const sim = make({ config }); sim.leftMoney = 3;
  sim.createUnit('left', 0); assert.equal(sim.leftMoney, 1); assert.equal(sim.leftIncome, 504);
});

test('income cap clamps at purchase and population is a round budget, not a live-unit cap', () => {
  const sim = make(); sim.leftMoney = 100; sim.leftIncome = 7999; sim.leftPopulation = 1;
  const unit = sim.createUnit('left', 0); assert.equal(sim.leftIncome, 8000); assert.equal(sim.leftPopulation, 0);
  assert.equal(sim.createUnit('left', 0), null); unit.dead(); assert.equal(sim.leftPopulation, 0);
  assert.equal(sim.friendList.includes(unit), false); assert.equal(sim.scene.children.includes(unit), true);
  sim.p1[2] = sim.p2[2] = 0; sim.round = 1; sim.step(); assert.equal(sim.leftPopulation, 80);
});

test('impossible difficulty bonuses apply exactly and initial population 100 resets to 80', () => {
  const sim = make({ difficulty: 3, singlePlay: false });
  assert.equal(sim.rightIncome, 600); assert.equal(sim.rightPopulation, 100);
  assert.deepEqual(sim.blueBoss.damage, [110, 110]); assert.equal(sim.blueBoss.weaponSpeed, 25);
  sim.p1[2] = sim.p2[2] = 0; sim.step(180);
  assert.equal(sim.rightMoney, 600); assert.equal(sim.rightPopulation, 80);
});

test('custom raw values and conversion factors affect actual runtime without using stale derived runtime data', () => {
  const config = structuredClone(defaults); config.units[0].hp = 99; config.units[0].moveSpeed = 5;
  config.rules.movementMultiplier = 2; config.units[0].range = 3; config.units[0].weaponSpeed = 0.6;
  const sim = make({ config }); sim.leftMoney = 100; const unit = sim.createUnit('left', 0);
  assert.equal(unit.nowHP, 99); assert.equal(unit.moveSpeed, 10); assert.equal(unit.range, 180);
  assert.equal(unit.weaponSpeed, 12); assert.equal(unit.maxHP, 100, 'source retains inherited maxHP for troops');
});

test('changing sprite index and global animation speed reads canonical fields, not stale derived unit animation', () => {
  const config = structuredClone(defaults); config.units[0].ss = 2; config.rules.animationSpeeds.attack = 0.6;
  const sim = make({ config }); sim.leftMoney = 100; const unit = sim.createUnit('left', 0);
  assert.equal(unit.spriteSheet.attack.frames, config.animations.A2_attack.frames);
  assert.equal(unit.spriteSheet.attack.speed, 0.6);
  assert.notEqual(unit.spriteSheet.attack.frames, config.units[0].animation.attack.frames);
});

test('selection keyboard grid clamps and local-two mode gates player 2 controls only', () => {
  const single = make(); assert.equal(single.selectUnit('right', 12), false);
  single.control('left', 999, 999, 1); assert.deepEqual(single.p1, [7, 1, 0]);
  single.selectUnit('left', 3); assert.deepEqual(single.p1, [3, 0, 0]);
  const dual = make({ singlePlay: false }); dual.selectUnit('right', 15); assert.deepEqual(dual.p2, [7, 1, 1]);
});

test('target metric is dx squared + 30dy squared; ties keep first target, dead candidates ignored', () => {
  const { a, b } = standalonePair(); const c = new IsometricEntity(a.simulation);
  b.px = 100; b.py = 0; c.px = 5; c.py = 20; a.targetList = [c, b];
  a.findTarget(); assert.equal(a.target, b);
  c.px = 100; c.py = 0; a.findTarget(); assert.equal(a.target, c);
  c.nowHP = 0; a.findTarget(); assert.equal(a.target, b);
});

test('target score preserves source square-then-weight IEEE operation order on near ties', () => {
  const { a, b } = standalonePair(); const c = new IsometricEntity(a.simulation);
  b.px = 0.09339301381733023; b.py = 0;
  c.px = 0; c.py = 0.017051153460381142;
  a.targetList = [b, c]; a.findTarget(); assert.equal(a.target, b);
});

test('approachTarget uses horizontal range and 40 vertical tolerance, not radial distance', () => {
  const { a, b } = standalonePair(); a.range = 40; a.targetList = [b]; b.py = 40;
  a.ai(); assert.equal(a.simulation.projectiles.length, 1);
  const pair = standalonePair(); pair.a.range = 40; pair.a.moveSpeed = 3; pair.a.targetList = [pair.b]; pair.b.py = 41;
  pair.a.ai(); assert.equal(pair.sim.projectiles.length, 0); assert.notEqual(pair.a.vy, 0);
});

test('weaponSpeed is truncated to int and decremented within the attack frame', () => {
  const { a, b, sim } = standalonePair(); a.range = 40; a.targetList = [b]; b.nowHP = 1000;
  a.step(); assert.equal(a.t, 15); assert.equal(sim.projectiles.length, 1);
  for (let i = 0; i < 15; i++) a.step(); assert.equal(a.t, 0); assert.equal(sim.projectiles.length, 1);
  a.step(); assert.equal(a.t, 15); assert.equal(sim.projectiles.length, 2);
});

test('moving attack is delayed, strict crossing (not >=), and melee still has projectile travel', () => {
  const { a, b, sim } = standalonePair(); a.delayAttack = 2; a.attack();
  const attack = sim.projectiles[0]; assert.equal(attack.spriteSheet, null); assert.equal(attack.visible, false);
  attack.step(); attack.step(); assert.equal(attack.px, 0); assert.equal(b.nowHP, 100);
  attack.step(); assert.equal(attack.px, 20); attack.step(); assert.equal(attack.px, 40);
  assert.equal(b.nowHP, 100); attack.step(); assert.equal(b.nowHP, 93); assert.equal(attack.parent, null);
});

test('attack uses current father damage at impact and misses at vertical distance 31', () => {
  const { a, b, sim } = standalonePair(); a.attack(); a.damage = [19, 29];
  const attack = sim.projectiles[0]; attack.step(); attack.step(); attack.step(); assert.equal(b.nowHP, 81);
  const second = standalonePair(); second.a.attack(); second.b.py = 31;
  const miss = second.sim.projectiles[0]; miss.step(); miss.step(); miss.step(); assert.equal(second.b.nowHP, 100);
});

test('projectile life includes delay and removes on the 101st processing step', () => {
  const { a, b, sim } = standalonePair(); a.delayAttack = 999; a.attack(); const attack = sim.projectiles[0];
  for (let i = 0; i < 100; i++) attack.step(); assert.equal(attack.life, 0); assert.equal(attack.parent, sim.scene);
  attack.step(); assert.equal(attack.parent, null); assert.equal(b.nowHP, 100);
});

test('original armor subtraction can heal above original HP and armor index chooses damage', () => {
  const { b } = standalonePair(); b.armor = 10; b.minusHP([3, 20]); assert.equal(b.nowHP, 107);
  b.armorTypeID = 1; b.minusHP([3, 20]); assert.equal(b.nowHP, 97);
});

test('death immediately removes unit from target list but removes visual on countdown 1', () => {
  const sim = make(); sim.leftMoney = 20; const unit = sim.createUnit('left', 0);
  unit.dead(); assert.equal(unit.deadTime, 25); assert.equal(unit.pz, 1); assert.equal(unit.vz, 8);
  for (let i = 0; i < 23; i++) unit.step(); assert.equal(unit.deadTime, 2); assert.equal(unit.parent, sim.scene);
  unit.step(); assert.equal(unit.deadTime, 1); assert.equal(unit.parent, null);
});

test('Scene live-list mutation skips shifted child and processes an appended child in same frame', () => {
  const scene = new CoreScene(), calls = [];
  const a = { parent: null, step() { calls.push('a'); scene.removeChild(this); } };
  const b = { parent: null, step() { calls.push('b'); } }; scene.addChild(a); scene.addChild(b); scene.step();
  assert.deepEqual(calls, ['a']);
  scene.children = []; a.parent = null; b.parent = null; calls.length = 0;
  a.step = function () { calls.push('a'); scene.addChild(b); }; scene.addChild(a); scene.step();
  assert.deepEqual(calls, ['a', 'b']);
});

test('original render order sorts py ascending by reversing a descending sort, including equal-py reversal', () => {
  const scene = new CoreScene(); const a = { py: 2 }, b = { py: 1 }, c = { py: 2 };
  scene.addChild(a); scene.addChild(b); scene.addChild(c); scene.applyOriginalRenderOrder();
  assert.deepEqual(scene.children, [b, c, a]);
});

test('separation moves only later same-team entity, exact overlap stays overlapped', () => {
  const sim = make(); const a = { px: 0, py: 0 }, b = { px: 10, py: 0 };
  sim.separate([a, b]); assert.equal(a.px, 0); assert.equal(b.px, 40);
  b.px = 0; sim.separate([a, b]); assert.equal(b.px, 0);
});

test('camera source sequential clamps retain negative max bounds on tiny custom maps', () => {
  const config = structuredClone(defaults); config.rules.mapWidth = 500; config.rules.mapHeight = 200;
  const sim = make({ config }); sim.setCamera(-100, -100);
  assert.equal(sim.camera.x, -65); assert.equal(sim.camera.y, -100);
});

test('crystal death remains in target list and game ends after 30 simulation steps, right wins a draw', () => {
  const sim = make(); sim.redBoss.dead(); sim.blueBoss.dead();
  assert.equal(sim.friendList.includes(sim.redBoss), true); sim.step(29); assert.equal(sim.winner, null);
  sim.step(); assert.equal(sim.winner, 'right'); assert.equal(sim.running, false); const frame = sim.frame;
  sim.step(100); assert.equal(sim.frame, frame);
});

test('timer pause does not pause entity simulation and no income/recruitment is processed', () => {
  const sim = make(); sim.stopTimer = true; sim.leftMoney = 100; const unit = sim.createUnit('left', 0);
  sim.step(5); assert.equal(sim.round, 180); assert.ok(unit.px > 300); assert.equal(sim.friendList.length, 2);
});

test('AI counter mapping, newbie threshold, elite force override, and strict money threshold', () => {
  const sim = make({ difficulty: 2 }); sim.leftMoney = 1000; sim.createUnit('left', 0); sim.createUnit('left', 0);
  assert.equal(sim.ai(), 3); sim.rightIncome = 199; assert.equal(sim.ai(), 0);
  sim.friendList = [sim.redBoss]; sim.rightMoney = 15030; assert.equal(sim.ai(), 0);
  sim.rightMoney = 15031; assert.equal(sim.ai(), 15);
  const elite = make({ difficulty: 2 }); elite.leftMoney = 10000;
  for (let i = 0; i < 3; i++) elite.createUnit('left', 14); assert.equal(elite.ai(), 15);
});

test('custom AI counter choices and thresholds alter effective decisions', () => {
  const config = structuredClone(defaults); config.ai.counterChoices[1] = [15];
  const sim = make({ config, difficulty: 2 }); sim.leftMoney = 100;
  sim.createUnit('left', 1); sim.createUnit('left', 1); assert.equal(sim.ai(), 15);
  config.ai.forceOverlordMoneyThreshold = 10; sim.friendList = [sim.redBoss]; sim.rightMoney = 11;
  assert.equal(sim.ai(), 15);
});

test('easy AI never counts elites in the random branch and random choices exclude units 14/15', () => {
  const sim = make({ difficulty: 0, rng: () => 0.999 }); sim.leftMoney = 10000;
  for (let i = 0; i < 3; i++) sim.createUnit('left', 14); assert.equal(sim.ai(), 13);
});

test('audio RNG consumption preserves original exclusions; crystals do not consume attack/death RNG', () => {
  let draws = 0; const sim = make({ rng: () => { draws++; return 0.95; } });
  sim.leftMoney = 100; const unit = sim.createUnit('left', 0); assert.equal(draws, 1);
  unit.target = sim.blueBoss; unit.attack(); assert.equal(draws, 2);
  sim.redBoss.target = sim.blueBoss; sim.redBoss.attack(); assert.equal(draws, 2);
  sim.redBoss.dead(); assert.equal(draws, 2); unit.dead(); assert.equal(draws, 3);
  assert.ok(sim.drainEvents().some(event => event.type === 'sound' && event.name === 'SD_dao'));
});

test('timeline currentFrame advances fractionally before AI; looped goto does not restart', () => {
  const sim = make(), symbol = new CoreSymbol(sim);
  symbol.spriteSheet = { idle: { frames: 3, speed: 0.15, loop: true } }; symbol.gotoAndPlay('idle');
  symbol.step(); close(symbol.currentFrame, 1.15); assert.equal(symbol.displayFrame, 1);
  symbol.gotoAndPlay('idle'); close(symbol.currentFrame, 1.15);
  for (let i = 0; i < 19; i++) symbol.step(); close(symbol.currentFrame, 1);
});

test('uninitialized AS3 Number timeline state is NaN until a valid gotoAndPlay', () => {
  const sim = make(), symbol = new CoreSymbol(sim);
  assert.equal(symbol.currentRow, 0); assert.ok(Number.isNaN(symbol.currentFrame));
  assert.ok(Number.isNaN(sim.redBoss.currentFrame)); assert.ok(Number.isNaN(sim.blueBoss.currentFrame));
  symbol.step(); symbol.gotoAndPlay('absent'); assert.ok(Number.isNaN(symbol.currentFrame));
  symbol.spriteSheet = { idle: { frames: 3, speed: 0.15, loop: true } };
  symbol.gotoAndPlay('idle'); assert.equal(symbol.currentFrame, 1);
  sim.step(); assert.equal(sim.redBoss.currentFrame, 1); assert.equal(sim.blueBoss.currentFrame, 1);
});

test('seeded headless play is reproducible and does not require any browser or SWF VM', () => {
  const one = make({ rng: seededRandom(123) }), two = make({ rng: seededRandom(123) });
  one.step(4000); two.step(4000); assert.deepEqual(one.snapshot(), two.snapshot());
  assert.ok(one.friendList.length > 1); assert.ok(one.enemyList.length > 1);
});

test('all 16 original units instantiate on both teams with original armor, resources, animation, and weapon data', () => {
  const sim = make({ singlePlay: false });
  sim.leftMoney = sim.rightMoney = 100000;
  sim.leftPopulation = sim.rightPopulation = 1000;
  for (let id = 0; id < 16; id++) {
    for (const side of ['left', 'right']) {
      const entity = sim.createUnit(side, id), source = defaults.units[id];
      assert.equal(entity.id, id); assert.equal(entity.nowHP, source.hp);
      assert.equal(entity.armorTypeID, source.armorTypeID); assert.equal(entity.armor, source.armor);
      assert.deepEqual(entity.damage, source.damage); assert.equal(entity.delayAttack, source.delayAttack);
      assert.equal(entity.weaponSheet, source.wss); assert.ok(entity.spriteSheet.attack.frames > 0);
    }
  }
});

test('four default profiles complete genuine headless matches without forced death or stat edits', () => {
  for (let difficulty = 0; difficulty < 4; difficulty++) {
    const sim = make({ difficulty, rng: seededRandom(123) });
    while (!sim.winner && sim.frame < 15000) { sim.step(300); sim.drainEvents(); }
    assert.equal(sim.winner, 'right', `default recruit-only strategy completes difficulty ${difficulty}`);
    assert.equal(sim.redBoss.nowHP, 0); assert.equal(sim.blueBoss.nowHP, 3500);
    assert.ok(sim.frame > 1000); assert.equal(sim.gameOverTime, 0);
  }
});
