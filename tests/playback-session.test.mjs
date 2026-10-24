import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { GameController } from '../src/app/controller.mjs';
import { MiragineSimulation, seededRandom } from '../src/core/index.mjs';
import { MiraginePlayback } from '../src/app/playback-session.mjs';

const config = JSON.parse(await readFile(new URL('../config/defaults.generated.json', import.meta.url), 'utf8'));
function controller() {
  const c = new GameController(config, { createSimulation: options => new MiragineSimulation({ ...options, rng: seededRandom(123) }) });
  c.startMatch(true, 1); c.action('tutorial-okay');
  return c;
}

test('all speed settings execute unchanged original steps, not altered entity values', () => {
  for (const speed of [0, 0.1, 0.5, 1, 2, 4, 8, 12.3, 20]) {
    const c = controller(), reference = controller();
    const initialFrame = c.simulation.frame;
    let inputs = 0;
    const playback = new MiraginePlayback(c, { now: 0, inputStep: () => inputs++ });
    playback.setSpeed(speed);
    for (let i = 1; i <= 600; i++) playback.advance(i * 1000 / 120);
    assert.ok(Math.abs(c.simulation.frame - speed * 150) <= 1);
    reference.simulation.step(c.simulation.frame - reference.simulation.frame);
    assert.deepEqual(c.simulation.snapshot(), reference.simulation.snapshot());
    assert.equal(inputs, c.simulation.frame - initialFrame);
    assert.equal(c.config.rules.frameRate, 30);
  }
});

test('render interpolation never changes core positions, RNG state or render snapshots', () => {
  const c = controller(), playback = new MiraginePlayback(c, { now: 0 });
  for (let i = 1; i <= 900; i++) playback.advance(i * 1000 / 120);
  const before = JSON.stringify(c.simulation.snapshot());
  const renderBefore = JSON.stringify(c.simulation.renderSnapshot);
  for (let i = 0; i < 200; i++) playback.presentation();
  assert.equal(JSON.stringify(c.simulation.snapshot()), before);
  assert.equal(JSON.stringify(c.simulation.renderSnapshot), renderBefore);
});

test('new matches reset interpolation epochs even when UIDs are reused', () => {
  const c = controller(), playback = new MiraginePlayback(c, { now: 0 });
  playback.advance(200);
  const old = playback.current;
  c.startMatch(true, 1);
  const presentation = playback.presentation();
  assert.notEqual(playback.current, old);
  assert.equal(playback.current, playback.previous);
  assert.deepEqual(presentation.snapshot, c.simulation.renderSnapshot);
});

test('menus keep real-time scheduling while selected world speed is remembered', () => {
  const c = controller(), playback = new MiraginePlayback(c, { now: 0 });
  playback.setSpeed(8); playback.advance(100);
  const count = playback.clock.totalSteps;
  c.home(); playback.advance(200);
  assert.ok(playback.clock.totalSteps - count <= 4);
  assert.equal(playback.clock.speed, 1);
  assert.equal(playback.speed, 8);
  c.startMatch(); playback.advance(300);
  assert.equal(playback.clock.speed, 8);
});

test('zero speed stops core, scheduled input and interpolation while presentation remains available', () => {
  const c = controller();
  let inputs = 0;
  const playback = new MiraginePlayback(c, { now: 0, inputStep: () => inputs++ });
  playback.advance(45);
  playback.setSpeed(0, 50);
  const snapshot = c.simulation.snapshot(), presentation = structuredClone(playback.presentation()), count = inputs;
  for (const now of [100, 200, 1000, 5000]) {
    const result = playback.advance(now);
    assert.equal(result.render, true);
    assert.equal(result.steps, 0);
    assert.equal(playback.paused, true);
    assert.deepEqual(c.simulation.snapshot(), snapshot);
    assert.deepEqual(playback.presentation(), presentation);
    assert.equal(inputs, count);
  }
  // A stray adapter callback must not consume input either.
  playback.step(6000);
  assert.equal(inputs, count);
  assert.deepEqual(c.simulation.snapshot(), snapshot);
});

test('pause/resume between frames preserves selected fractional speed and excludes paused time', () => {
  const c = controller(), playback = new MiraginePlayback(c, { now: 0 });
  playback.setSpeed(3.5, 0);
  playback.advance(10);
  playback.togglePause(20);
  assert.equal(playback.speed, 0);
  assert.equal(playback.lastNonzeroSpeed, 3.5);
  const before = c.simulation.frame;
  const gameTimeBefore = playback.clock.gameTimeMs + playback.clock.accumulatorMs;
  playback.togglePause(1020);
  assert.equal(playback.speed, 3.5);
  assert.equal(playback.paused, false);
  assert.equal(c.simulation.frame, before);
  playback.advance(1030);
  assert.ok(Math.abs(playback.clock.gameTimeMs + playback.clock.accumulatorMs - gameTimeBefore - 35) < 1e-8);
});

test('independent editor pause reasons never release manual zero speed or each other', () => {
  const c = controller(), playback = new MiraginePlayback(c, { now: 0 });
  playback.setSpeed(7.5, 0);
  playback.setPaused(true, 10, 'editor');
  const frame = c.simulation.frame;
  playback.setPaused(true, 20, 'import-dialog');
  playback.setPaused(false, 30, 'editor');
  assert.deepEqual(playback.pauseReasons, ['import-dialog']);
  assert.equal(playback.clock.speed, 0);
  playback.advance(1000);
  assert.equal(c.simulation.frame, frame);
  playback.setSpeed(20, 1010);
  assert.equal(playback.speed, 20);
  assert.equal(playback.clock.speed, 0, 'a speed edit must not unpause an editor transaction');
  playback.setPaused(false, 1020, 'import-dialog');
  assert.equal(playback.clock.speed, 20);
  assert.equal(c.simulation.frame, frame);
  playback.setSpeed(0, 1020);
  playback.pause('editor', 1030);
  playback.resume('editor', 1040);
  assert.equal(playback.speed, 0);
  assert.equal(playback.paused, true);
  playback.togglePause(1050);
  assert.equal(playback.speed, 20);
  assert.equal(playback.paused, false);
});

test('manual named pause and editor pause compose without changing selected speed', () => {
  const c = controller(), playback = new MiraginePlayback(c, { now: 0 });
  playback.setSpeed(4, 0);
  playback.setPaused(true, 0);
  playback.pause('editor', 100);
  playback.resume('editor', 200);
  assert.equal(playback.speed, 4);
  assert.equal(playback.paused, true);
  playback.togglePause(300);
  assert.equal(playback.paused, false);
  assert.equal(playback.speed, 4);
  assert.equal(playback.clock.gameTimeMs, 0);
});

test('paused title/result menus retain wall-time updates without unpausing the selected game speed', () => {
  const c = controller();
  let inputs = 0;
  const playback = new MiraginePlayback(c, { now: 0, inputStep: () => inputs++ });
  playback.setSpeed(0, 0);
  c.home();
  playback.advance(100);
  assert.equal(playback.clock.speed, 1);
  assert.ok(inputs > 0);
  c.startMatch();
  const before = c.simulation.frame;
  playback.advance(200);
  assert.equal(playback.clock.speed, 0);
  assert.equal(c.simulation.frame, before);
  c.simulation.winner = 'left';
  c.simulation.stop();
  for (let now = 300; now <= 3500; now += 100) playback.advance(now);
  assert.equal(c.phase, 'over', 'the original 2.9s winner-to-result UI transition is not frozen');
  assert.equal(playback.speed, 0);
  assert.equal(playback.clock.speed, 1);
});

test('both visibility boundaries and speed changes while hidden preserve the paused remainder', () => {
  const c = controller(), playback = new MiraginePlayback(c, { now: 0 });
  playback.setSpeed(20, 0);
  playback.advance(10);
  playback.advance(12, { hidden: true });
  const before = c.simulation.frame;
  const remainder = playback.clock.accumulatorMs;
  playback.advance(9000, { hidden: true });
  playback.setSpeed(0, 9000);
  playback.setPaused(true, 9000, 'editor');
  playback.advance(15000, { hidden: true });
  playback.setSpeed(20, 15000);
  playback.setPaused(false, 15000, 'editor');
  assert.equal(c.simulation.frame, before);
  assert.equal(playback.clock.accumulatorMs, remainder);
  playback.advance(15001);
  assert.ok(c.simulation.frame <= before + 1);
});

test('explicit refresh adopts same-frame customization snapshots without a step or interpolation ghost', () => {
  const c = controller(), playback = new MiraginePlayback(c, { now: 0 });
  playback.advance(50);
  playback.setSpeed(0, 50);
  const frame = c.simulation.frame;
  const snapshots = c.simulation.renderSnapshot.map(item => ({ ...item, px: item.px + 100 }));
  c.simulation.renderSnapshot = snapshots;
  c.simulation.renderCamera = { ...c.simulation.renderCamera, x: 1000 };
  playback.refresh();
  assert.equal(c.simulation.frame, frame);
  assert.equal(playback.previous, playback.current);
  assert.deepEqual(playback.presentation().snapshot, snapshots);
  assert.equal(playback.presentation().camera.x, 1000);
  assert.equal(playback.paused, true);
});

test('invalid speed and pause inputs do not settle or mutate the world', () => {
  const c = controller(), playback = new MiraginePlayback(c, { now: 0 });
  const before = c.simulation.snapshot();
  for (const speed of [-1, 20.1, Infinity, NaN, '2']) assert.throws(() => playback.setSpeed(speed, 100));
  for (const [paused, reason] of [[1, 'editor'], [true, ''], [false, null]]) {
    assert.throws(() => playback.setPaused(paused, 100, reason));
  }
  assert.deepEqual(c.simulation.snapshot(), before);
  assert.equal(playback.speed, 1);
  assert.deepEqual(playback.pauseReasons, []);
});

test('playback forwards optional accelerated work budgets but leaves 1x and paused menus unchanged', () => {
  const c = controller();
  let work = 0;
  const playback = new MiraginePlayback(c, { now: 0, inputStep: () => { work += 3; },
    maxWorkMs: 8, maxStepsPerAdvance: 24, workNow: () => work });
  const initial = c.simulation.frame;
  playback.setSpeed(20, 0);
  const fast = playback.advance(250);
  assert.equal(fast.steps, 3);
  assert.equal(fast.workLimited, true);
  assert.equal(c.simulation.frame, initial + 3);
  playback.setSpeed(1, 250);
  const normal = playback.advance(500);
  assert.ok(normal.steps >= 7);
  assert.equal(normal.workLimited, false);
  playback.setSpeed(0, 500);
  c.home();
  const menu = playback.advance(750);
  assert.ok(menu.steps >= 7);
  assert.equal(menu.workLimited, false);
  assert.equal(playback.speed, 0);
  assert.equal(playback.clock.speed, 1);
});

test('borrowed presentation is overwritten only by presentation, never advance, refresh or a new match', () => {
  const c = controller(), playback = new MiraginePlayback(c, { now: 0 });
  playback.advance(45);
  const borrowed = playback.presentation(), old = structuredClone(borrowed);
  playback.advance(95);
  assert.deepEqual(borrowed, old);
  const updated = playback.presentation();
  assert.equal(updated, borrowed);
  const held = structuredClone(updated);
  c.simulation.renderSnapshot = c.simulation.renderSnapshot.map(value => ({ ...value, px: value.px + 200 }));
  c.simulation.renderCamera = { ...c.simulation.renderCamera, x: 800 };
  playback.refresh();
  assert.deepEqual(updated, held);
  assert.deepEqual(playback.presentation().snapshot, c.simulation.renderSnapshot);
  const refreshed = structuredClone(updated);
  c.startMatch(true, 2); playback.syncSimulation();
  assert.deepEqual(updated, refreshed);
  assert.deepEqual(playback.presentation().snapshot, c.simulation.renderSnapshot);
});

test('no-simulation presentations clear borrowed entity/camera output without mutating the previous view early', () => {
  const c = controller(), playback = new MiraginePlayback(c, { now: 0 });
  const borrowed = playback.presentation(), held = structuredClone(borrowed);
  c.home(); c.simulation = null; playback.syncSimulation();
  assert.deepEqual(borrowed, held);
  assert.deepEqual(playback.presentation(), { snapshot: [], camera: null });
  assert.equal(playback.presentation(), borrowed);
});
