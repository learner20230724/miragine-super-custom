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
  for (const speed of [1, 2, 4, 8]) {
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
