import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { GameController } from '../src/app/controller.mjs';
import { OriginalKeyboard, SELECTION_REPEAT_DELAY_MS, SELECTION_REPEAT_INTERVAL_MS } from '../src/app/input.mjs';
import { GameClock } from '../src/runtime/game-clock.mjs';

const config = JSON.parse(await readFile(new URL('../config/defaults.generated.json', import.meta.url), 'utf8'));

function fixture({ single = false } = {}) {
  const controller = new GameController(config);
  controller.startMatch(single);
  controller.action('tutorial-okay');
  const input = new OriginalKeyboard(controller, { repeatSelection: true });
  const down = (code, now = 0, repeat = false) => input.keyDown(code, { now, repeat });
  return { controller, input, down, sim: controller.simulation };
}

test('custom selection moves immediately, then repeats after a real-time initial delay', () => {
  const { input, sim, down } = fixture();
  assert.equal(down('KeyD'), true);
  assert.equal(sim.p1[0], 1, 'first selection does not wait for a simulation tick');
  assert.equal(input.advanceSelection(SELECTION_REPEAT_DELAY_MS - 1), false);
  assert.equal(sim.p1[0], 1);
  assert.equal(input.advanceSelection(SELECTION_REPEAT_DELAY_MS), true);
  assert.equal(sim.p1[0], 2);
  input.advanceSelection(SELECTION_REPEAT_DELAY_MS + SELECTION_REPEAT_INTERVAL_MS - 1);
  assert.equal(sim.p1[0], 2);
  input.advanceSelection(SELECTION_REPEAT_DELAY_MS + SELECTION_REPEAT_INTERVAL_MS);
  assert.equal(sim.p1[0], 3);
});

test('held WASD and arrow keys independently reach the original 8x2 selection boundaries', () => {
  const { input, sim, down } = fixture();
  down('KeyD'); down('KeyS'); down('ArrowRight'); down('ArrowDown');
  for (let now = 0; now <= 3000; now += 10) input.advanceSelection(now);
  assert.deepEqual(sim.p1.slice(0, 2), [7, 1]);
  assert.deepEqual(sim.p2.slice(0, 2), [7, 1]);
  input.clear();
  down('KeyA', 3000); down('KeyW', 3000); down('ArrowLeft', 3000); down('ArrowUp', 3000);
  for (let now = 3000; now <= 6000; now += 10) input.advanceSelection(now);
  assert.deepEqual(sim.p1.slice(0, 2), [0, 0]);
  assert.deepEqual(sim.p2.slice(0, 2), [0, 0]);
});

test('release stops selection immediately and a fresh press gets its own initial step', () => {
  const { input, sim, down } = fixture();
  down('KeyD'); input.advanceSelection(350);
  input.keyUp('KeyD');
  input.advanceSelection(435); input.advanceSelection(2000); input.step();
  assert.equal(sim.p1[0], 2);
  down('KeyD', 2001);
  assert.equal(sim.p1[0], 3);
  input.advanceSelection(2350);
  assert.equal(sim.p1[0], 3);
  input.advanceSelection(2351);
  assert.equal(sim.p1[0], 4);
});

test('OS repeats and duplicate keydown events neither stack nor reset the repeat timer', () => {
  const { input, sim, down } = fixture();
  down('KeyD');
  for (const now of [100, 200, 300, 349]) {
    assert.equal(down('KeyD', now, true), false);
    assert.equal(down('KeyD', now), false);
    input.step();
  }
  assert.equal(sim.p1[0], 1);
  input.advanceSelection(350);
  assert.equal(sim.p1[0], 2);
  input.clear();
  down('KeyD', 500, true); input.advanceSelection(1000);
  assert.equal(sim.p1[0], 2, 'OS repeat after focus clear must not restart a released logical hold');
});

test('opposite directions cancel their axis while diagonal and other-player input stay independent', () => {
  const { input, sim, down } = fixture();
  sim.selectUnit('left', 3);
  down('KeyD'); down('KeyA'); down('KeyS'); down('ArrowRight');
  assert.deepEqual(sim.p1.slice(0, 2), [4, 1]);
  input.advanceSelection(350); input.advanceSelection(435); input.advanceSelection(900);
  assert.deepEqual(sim.p1.slice(0, 2), [4, 1], 'opposites must not jitter at a boundary');
  assert.equal(sim.p2[0], 4, 'blue selection is not blocked by red opposing input');
  input.keyUp('KeyD');
  input.advanceSelection(1249);
  assert.equal(sim.p1[0], 4);
  input.advanceSelection(1250);
  assert.equal(sim.p1[0], 3, 'remaining direction resumes after its normal initial delay');
});

test('wall-time repetition is identical at 1x, 2x, 4x, 8x, 20x, 50x and 100x logic speeds', () => {
  const traces = [];
  for (const speed of [1, 2, 4, 8, 20, 50, 100]) {
    const { input, sim, down } = fixture();
    const clock = new GameClock({ now: 0, speed, step: () => input.step() });
    down('KeyD'); down('ArrowRight');
    const trace = [];
    for (let now = 0; now <= 1000; now += 5) {
      input.advanceSelection(now);
      clock.advance(now);
      trace.push([sim.p1[0], sim.p2[0]]);
    }
    traces.push(trace);
  }
  for (const trace of traces.slice(1)) assert.deepEqual(trace, traces[0]);
});

test('a stalled frame emits at most one repeat per direction instead of replaying wall-time debt', () => {
  const { input, sim, down } = fixture();
  down('KeyD'); down('ArrowRight');
  input.advanceSelection(10000);
  assert.deepEqual([sim.p1[0], sim.p2[0]], [2, 2]);
  input.advanceSelection(10000);
  assert.deepEqual([sim.p1[0], sim.p2[0]], [2, 2]);
  input.advanceSelection(10085);
  assert.deepEqual([sim.p1[0], sim.p2[0]], [3, 3]);
});

test('pause, hidden-window and editor-focus blocking clear holds with no resume burst', () => {
  for (const reason of ['pause', 'hidden', 'editor-focus']) {
    const { input, sim, down } = fixture();
    down('KeyD'); down('Space');
    input.advanceSelection(300, { blocked: true });
    assert.equal(input.down.size, 0, reason);
    input.advanceSelection(10000); input.step();
    assert.equal(sim.p1[0], 1, reason);
    down('KeyD', 10001, true);
    assert.equal(sim.p1[0], 1, 'OS repeat does not resume a cleared hold');
    down('KeyD', 10002);
    assert.equal(sim.p1[0], 2, 'fresh physical keydown resumes normal selection');
  }
});

test('clear used by focus loss stops both player holds and all pending initial delays', () => {
  const { input, sim, down } = fixture();
  down('KeyD'); down('ArrowRight');
  input.clear();
  assert.equal(input.selectionHeld.size, 0);
  input.advanceSelection(5000);
  assert.deepEqual([sim.p1[0], sim.p2[0]], [1, 1]);
});

test('menu, tutorial, quit overlay, stopped match and winner do not collect selection holds', () => {
  for (const mode of ['menu', 'tutorial', 'quit', 'stopped', 'winner']) {
    const { controller, input, sim, down } = fixture();
    down('KeyD');
    if (mode === 'menu') controller.home();
    else if (mode === 'tutorial' || mode === 'quit') controller.action(mode);
    else if (mode === 'stopped') sim.stop();
    else sim.winner = 'left';
    assert.equal(input.advanceSelection(350), false, mode);
    assert.equal(down('ArrowRight', 351), false, mode);
    assert.deepEqual([sim.p1[0], sim.p2[0]], [1, 0], mode);
    assert.equal(input.selectionHeld.size, 0, mode);
  }
});

test('new simulation clears previous match holds without replaying them in the next match', () => {
  const { controller, input, down } = fixture();
  down('KeyD'); down('ArrowRight');
  controller.startMatch(false); controller.action('tutorial-okay');
  input.advanceSelection(1000);
  assert.deepEqual([controller.simulation.p1[0], controller.simulation.p2[0]], [0, 0]);
  down('KeyD', 1001, true);
  assert.equal(controller.simulation.p1[0], 0);
  down('KeyD', 1002);
  assert.equal(controller.simulation.p1[0], 1);
});

test('a fresh keydown detects a new simulation even before its first RAF', () => {
  const { controller, input, down } = fixture();
  down('KeyD');
  controller.startMatch(false); controller.action('tutorial-okay');
  down('ArrowRight', 1000);
  assert.equal(controller.simulation.p2[0], 1);
  assert.equal(input.down.has('KeyD'), false);
  input.advanceSelection(1350);
  assert.deepEqual([controller.simulation.p1[0], controller.simulation.p2[0]], [0, 2]);
});

test('single-player keeps original blue AI selection protection', () => {
  const { input, sim, down } = fixture({ single: true });
  assert.equal(down('ArrowRight'), false);
  down('KeyD');
  for (let now = 0; now < 2000; now += 10) input.advanceSelection(now);
  assert.deepEqual([sim.p1[0], sim.p2[0]], [7, 0]);
});

test('Space and Enter recruitment toggles remain one-shot, not wall-time repeat controls', () => {
  const { input, sim, down } = fixture();
  const before = [sim.p1[2], sim.p2[2]];
  down('Space'); down('Enter');
  input.step();
  const after = [sim.p1[2], sim.p2[2]];
  assert.notDeepEqual(after, before);
  for (let now = 0; now < 2000; now += 10) {
    input.advanceSelection(now); input.step();
    down('Space', now, true); down('Enter', now, true);
  }
  assert.deepEqual([sim.p1[2], sim.p2[2]], after);
});

test('invalid timestamps do not dispatch selection or create repeat deadlines', () => {
  const { input, sim, down } = fixture();
  for (const value of [NaN, Infinity, -Infinity]) {
    assert.equal(down('KeyD', value), false);
    assert.equal(input.advanceSelection(value), false);
  }
  assert.equal(sim.p1[0], 0);
  assert.equal(input.selectionHeld.size, 0);
});
