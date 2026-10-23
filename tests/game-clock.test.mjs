import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { GameClock, GAME_SPEEDS } from '../src/runtime/game-clock.mjs';
import { FixedStepFrameClock } from '../src/platform/frame-clock.mjs';
import { MiragineSimulation, seededRandom } from '../src/core/index.mjs';
import { OriginalKeyboard } from '../src/app/input.mjs';

const close = (actual, expected, tolerance = 1e-8) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} ~= ${expected}`);

test('1x preserves inherited step timestamps, counts and exact floating-point remainder', () => {
  for (const displayHz of [30, 60, 144, 240]) {
    const originalCalls = [], actualCalls = [];
    const original = new FixedStepFrameClock({ frameRate: 30, now: 0, step: now => originalCalls.push(now) });
    const clock = new GameClock({ now: 0, step: now => actualCalls.push(now) });
    for (let frame = 1; frame <= displayHz * 3; frame++) {
      const now = frame * 1000 / displayHz;
      const expected = original.advance(now), actual = clock.advance(now);
      assert.equal(actual.steps, expected.steps);
      assert.equal(clock.accumulatorMs, original.accumulator);
    }
    assert.deepEqual(actualCalls, originalCalls);
    close(clock.gameTimeMs, actualCalls.length * 1000 / 30);
  }
});

test('1x preserves old suspension/hidden/backward-first-RAF accumulator operation order', () => {
  const events = [], expectedEvents = [];
  const clock = new GameClock({ now: 10, step: now => events.push(['keyboard', now], ['tick', now]) });
  const old = new FixedStepFrameClock({ frameRate: 30, now: 10,
    step: now => expectedEvents.push(['keyboard', now], ['tick', now]) });
  for (const [now, hidden] of [[9, false], [16, false], [33, false], [200, false],
    [2000, false], [3000, true], [9000, true], [9010, false], [9100, false]]) {
    const actual = clock.advance(now, { hidden }), expected = old.advance(now, { hidden });
    assert.equal(actual.steps, expected.steps); assert.equal(clock.accumulatorMs, old.accumulator);
    assert.ok(actual.alpha >= 0 && actual.alpha <= 1);
  }
  assert.deepEqual(events, expectedEvents);
});

test('speed only scales accepted future wall time, and the 250ms cap is applied before speed', () => {
  for (const speed of [0, 0.1, 0.5, ...GAME_SPEEDS, 12.3, 20]) {
    let count = 0;
    const clock = new GameClock({ now: 0, speed, step: () => count++ });
    const result = clock.advance(1000);
    let remainder = 250 * speed, expected = 0;
    while (remainder >= 1000 / 30) { remainder -= 1000 / 30; expected++; }
    assert.equal(count, expected); assert.equal(result.steps, expected);
    assert.equal(result.acceptedWallDeltaMs, 250); assert.equal(result.droppedWallDeltaMs, 750);
    assert.equal(result.accumulatorMs, remainder); assert.equal(result.stepHz, 30);
    close(result.gameTimeMs + result.accumulatorMs, 250 * speed);
    if (speed === 8) assert.ok(count >= 59, 'cap-after-speed would incorrectly allow only about seven ticks');
  }
});

test('switching speed keeps existing fractional game time instead of rescaling it', () => {
  const clock = new GameClock({ now: 0, step() {} });
  clock.advance(20); assert.equal(clock.accumulatorMs, 20);
  clock.setSpeed(4); assert.equal(clock.accumulatorMs, 20); assert.equal(clock.stats.speed, 4);
  const first = clock.advance(25); assert.equal(first.steps, 1);
  close(first.accumulatorMs, 40 - 1000 / 30);
  clock.setSpeed(1); const retained = clock.accumulatorMs;
  const next = clock.advance(35); assert.equal(next.steps, 0);
  assert.equal(next.accumulatorMs, retained + 10);
});

test('fractional rates accumulate complete original fixed steps with no scaled step size', () => {
  for (const speed of [0.1, 0.5, 1.3, 7.9, 19.9, 20]) {
    let calls = 0;
    const clock = new GameClock({ now: 0, speed, step: () => calls++ });
    for (let frame = 1; frame <= 600; frame++) clock.advance(frame * 10);
    close(clock.gameTimeMs + clock.accumulatorMs, 6000 * speed, 1e-6);
    assert.equal(calls, clock.totalSteps);
    assert.equal(clock.stepMs, 1000 / 30);
    assert.ok(clock.accumulatorMs >= 0 && clock.accumulatorMs < clock.stepMs);
  }
});

test('zero speed freezes steps and interpolation but keeps presentation alive', () => {
  let calls = 0;
  const clock = new GameClock({ now: 0, step: () => calls++ });
  clock.advance(12);
  clock.setSpeed(0, 12);
  const before = { remainder: clock.accumulatorMs, alpha: clock.alpha, calls };
  for (const now of [100, 1000, 9000]) {
    const result = clock.advance(now);
    assert.equal(result.steps, 0);
    assert.equal(result.render, true);
    assert.equal(result.paused, true);
    assert.equal(clock.alpha, before.alpha);
    assert.equal(clock.accumulatorMs, before.remainder);
  }
  assert.equal(calls, before.calls);
});

test('timestamped pause and resume between RAF callbacks cannot replay paused wall time', () => {
  const clock = new GameClock({ now: 0, step() {} });
  clock.advance(10);
  clock.setSpeed(0, 20); // Settle the ten active milliseconds before the pause.
  assert.equal(clock.accumulatorMs, 20);
  clock.setSpeed(20, 120); // No RAF occurred during these 100 paused milliseconds.
  assert.equal(clock.accumulatorMs, 20);
  assert.equal(clock.totalSteps, 0);
  const result = clock.advance(125);
  close(result.gameTimeMs + result.accumulatorMs, 120);
  assert.equal(result.steps, 3);
});

test('timestamped speed changes settle the old rate and reject invalid changes atomically', () => {
  const clock = new GameClock({ now: 0, speed: 2, step() {} });
  clock.setSpeed(0.5, 10);
  assert.equal(clock.accumulatorMs, 20);
  clock.setSpeed(20, 30);
  assert.equal(clock.accumulatorMs, 30);
  const before = clock.stats;
  for (const [speed, now] of [[21, 100], [NaN, 100], [1, Infinity], [1, '100']]) {
    assert.throws(() => clock.setSpeed(speed, now));
    assert.deepEqual(clock.stats, before);
  }
  clock.advance(35);
  close(clock.gameTimeMs + clock.accumulatorMs, 130);
});

test('20x suspension stays bounded at 250 accepted real milliseconds and visibility edges accrue no debt', () => {
  const clock = new GameClock({ now: 0, speed: 20, step() {} });
  const stalled = clock.advance(100000);
  assert.ok(stalled.steps >= 149 && stalled.steps <= 150);
  assert.equal(stalled.acceptedWallDeltaMs, 250);
  assert.equal(stalled.droppedWallDeltaMs, 99750);
  const before = clock.gameTimeMs + clock.accumulatorMs;
  clock.advance(100010, { hidden: true });
  clock.advance(200000, { hidden: true }); // Resume edge synchronizes the wall anchor.
  clock.advance(200010);
  close(clock.gameTimeMs + clock.accumulatorMs, before + 200, 1e-6);
});

test('optional accelerated step ceiling sheds whole time demand without skipping callbacks or accumulating debt', () => {
  let count = 0;
  const clock = new GameClock({ now: 0, speed: 20, maxStepsPerAdvance: 24, step: () => count++ });
  const result = clock.advance(1000);
  assert.equal(result.steps, 24);
  assert.equal(count, 24);
  assert.equal(result.totalSteps, 24);
  assert.equal(result.workLimited, true);
  assert.equal(result.cappedWallDeltaMs, 250);
  assert.ok(result.droppedGameTimeMs > 4000);
  close(result.gameTimeMs + result.accumulatorMs + result.droppedGameTimeMs, 5000);
  close(result.acceptedWallDeltaMs * 20, result.gameTimeMs + result.accumulatorMs);
  close(result.acceptedWallDeltaMs + result.droppedWallDeltaMs, 1000);
  assert.ok(clock.accumulatorMs >= 0 && clock.accumulatorMs < clock.stepMs);
  assert.equal(clock.advance(1000).steps, 0, 'shed time cannot return as same-timestamp catch-up work');
});

test('accelerated CPU deadline checks between complete original steps with an injectable work clock', () => {
  let work = 0;
  const order = [];
  const clock = new GameClock({ now: 0, speed: 20, maxWorkMs: 8, maxStepsPerAdvance: 24,
    workNow: () => work,
    step: () => { order.push(`start-${clock.totalSteps}`, `end-${clock.totalSteps}`); work += 3; } });
  const first = clock.advance(250);
  assert.equal(first.steps, 3, 'the 3ms third atomic step finishes even though it crosses the 8ms deadline');
  assert.equal(first.workLimited, true);
  assert.deepEqual(order, ['start-0', 'end-0', 'start-1', 'end-1', 'start-2', 'end-2']);
  assert.ok(clock.accumulatorMs < clock.stepMs);
  const second = clock.advance(500);
  assert.equal(second.steps, 3);
  assert.equal(clock.totalSteps, 6);
  assert.ok(second.droppedGameTimeMs > 0);
  assert.ok(clock.accumulatorMs < clock.stepMs);
});

test('work safeguards never alter faithful 1x, slow motion, pause or hidden scheduling', () => {
  let calls = 0, workReads = 0;
  const clock = new GameClock({ now: 0, maxWorkMs: 0.001, maxStepsPerAdvance: 1,
    workNow: () => { workReads++; return 1000000; }, step: () => calls++ });
  const first = clock.advance(250);
  assert.equal(first.steps, 7);
  assert.equal(first.workLimited, false);
  assert.equal(first.droppedGameTimeMs, 0);
  assert.equal(first.acceptedWallDeltaMs, 250);
  clock.setSpeed(0.5);
  assert.ok(clock.advance(500).steps >= 3);
  clock.setSpeed(0);
  assert.equal(clock.advance(1000).steps, 0);
  clock.setSpeed(20);
  assert.equal(clock.advance(2000, { hidden: true }).steps, 0);
  assert.equal(workReads, 0);
  assert.ok(calls >= 10);
});

test('timestamped pause and resume settle with the same accelerated work bounds and leave no whole-step debt', () => {
  const clock = new GameClock({ now: 0, speed: 20, maxStepsPerAdvance: 3, step() {} });
  clock.setSpeed(0, 250);
  assert.equal(clock.totalSteps, 3);
  assert.equal(clock.stats.workLimited, true);
  const remainder = clock.accumulatorMs;
  assert.ok(remainder < clock.stepMs);
  clock.setSpeed(20, 100000);
  assert.equal(clock.totalSteps, 3);
  assert.equal(clock.accumulatorMs, remainder);
  assert.equal(clock.advance(100000).steps, 0);
  assert.ok(clock.advance(100001).steps <= 1);
});

test('invalid optional work bounds and invalid injected clock results fail before a game step', () => {
  let calls = 0;
  for (const options of [{ maxWorkMs: 0 }, { maxWorkMs: -1 }, { maxWorkMs: NaN },
    { maxStepsPerAdvance: 0 }, { maxStepsPerAdvance: 2.5 }, { maxStepsPerAdvance: NaN }, { workNow: null }]) {
    assert.throws(() => new GameClock({ now: 0, step: () => calls++, ...options }));
  }
  const clock = new GameClock({ now: 0, speed: 20, maxWorkMs: 8,
    step: () => calls++, workNow: () => NaN });
  assert.throws(() => clock.advance(250));
  assert.equal(clock.totalSteps, 0);
  assert.equal(clock.accumulatorMs, 0);
  assert.equal(calls, 0);
});

test('work-limited 20x preserves exact core state, events and RNG at every actually executed tick count', () => {
  const config = JSON.parse(readFileSync(new URL('../config/defaults.generated.json', import.meta.url), 'utf8'));
  let leftDraws = 0, rightDraws = 0, work = 0;
  const leftRng = seededRandom(123), rightRng = seededRandom(123);
  const baseline = new MiragineSimulation({ config, autoStart: false, rng: () => { leftDraws++; return leftRng(); } });
  const timed = new MiragineSimulation({ config, autoStart: false, rng: () => { rightDraws++; return rightRng(); } });
  const clock = new GameClock({ now: 0, speed: 20, maxWorkMs: 8, maxStepsPerAdvance: 24,
    workNow: () => work, step: () => { timed.step(); work += 3; } });
  let sawAttack = false;
  for (let frame = 1; frame <= 600; frame++) {
    const result = clock.advance(frame * 1000 / 60);
    assert.ok(result.steps <= 3);
    assert.ok(result.accumulatorMs < clock.stepMs);
    baseline.step(result.steps);
    assert.deepEqual(timed.snapshot(), baseline.snapshot());
    const events = timed.drainEvents();
    assert.deepEqual(events, baseline.drainEvents());
    sawAttack ||= events.some(event => event.type === 'attack');
    assert.equal(rightDraws, leftDraws);
  }
  assert.ok(sawAttack);
  assert.equal(timed.frame, clock.totalSteps);
});

test('speed changes inside a step affect future wall deltas, not already accepted catch-up game time', () => {
  let clock;
  clock = new GameClock({ now: 0, step() { clock.setSpeed(8); } });
  const first = clock.advance(250);
  assert.equal(first.steps, 7); assert.equal(first.speed, 8);
  close(first.gameTimeMs + first.accumulatorMs, 250);
  const second = clock.advance(251);
  close(second.gameTimeMs + second.accumulatorMs, 258);
});

test('hidden time pauses game and rendering, retaining remainder and pending UI invalidation', () => {
  const clock = new GameClock({ now: 0, speed: 8, step() {} });
  clock.advance(2); const remainder = clock.accumulatorMs;
  clock.invalidate(); const hidden = clock.advance(20000, { hidden: true });
  assert.equal(hidden.steps, 0); assert.equal(hidden.render, false); assert.equal(hidden.accumulatorMs, remainder);
  assert.equal(hidden.acceptedWallDeltaMs, 0); assert.equal(hidden.droppedWallDeltaMs, 0);
  assert.equal(clock.advance(20001).render, true);
});

test('240Hz render scheduling is independent of fixed 30Hz simulation and never invents steps', () => {
  let count = 0, paints = 0, previousPaint = null;
  const clock = new GameClock({ now: 0, step: () => count++ });
  for (let frame = 0; frame <= 240; frame++) {
    const now = frame * 1000 / 240, result = clock.advance(now);
    if (result.render) {
      paints++;
      if (previousPaint !== null) assert.ok(now - previousPaint >= 1000 / 240 - 1e-7);
      previousPaint = now;
    }
  }
  assert.equal(paints, 241); assert.ok(count >= 29 && count <= 30);
});

test('invalidation repaints without a game step but does not bypass the render cap', () => {
  const clock = new GameClock({ now: 0, step() {} });
  assert.equal(clock.advance(0).render, true);
  clock.invalidate(); const early = clock.advance(1);
  assert.equal(early.steps, 0); assert.equal(early.render, false);
  const due = clock.advance(5); assert.equal(due.render, true); assert.equal(due.steps, 0);
  assert.equal(clock.advance(6).render, false);
});

test('non-divisible display rates preserve target render phase instead of halving presentation rate', () => {
  for (const [displayHz, renderHz] of [[144, 120], [240, 144], [1000, 240]]) {
    const clock = new GameClock({ now: 0, renderHz, step() {} });
    let paints = 0;
    for (let frame = 0; frame <= displayHz; frame++) paints += Number(clock.advance(frame * 1000 / displayHz).render);
    assert.ok(paints >= renderHz && paints <= renderHz + 1, `${displayHz}Hz display at ${renderHz}Hz target: ${paints}`);
  }
});

test('changing render target resets only presentation cadence, with no debt burst or changed game remainder', () => {
  const clock = new GameClock({ now: 0, step() {} });
  clock.advance(0); clock.advance(20);
  const remainder = clock.accumulatorMs, steps = clock.totalSteps;
  clock.setRenderHz(30);
  assert.equal(clock.renderHz, 30); assert.equal(clock.accumulatorMs, remainder); assert.equal(clock.totalSteps, steps);
  assert.equal(clock.advance(20).render, false);
  assert.equal(clock.advance(30).render, false);
  assert.equal(clock.advance(54).render, true);
  clock.setRenderHz(240);
  assert.equal(clock.advance(54).render, false);
  assert.equal(clock.advance(59).render, true);
  const suspended = clock.advance(5000); assert.equal(suspended.render, true);
  assert.equal(clock.advance(5000).render, false, 'no same-timestamp repayment of missed display frames');
});

test('stats are read-only and invalid/non-finite settings fail before callback execution', () => {
  let calls = 0;
  for (const options of [{ stepHz: 0 }, { stepHz: NaN }, { renderHz: 241 }, { renderHz: Infinity },
    { now: NaN }, { maxDeltaMs: Infinity }, { speed: 20.1 }, { stepHz: Number.MIN_VALUE }]) {
    assert.throws(() => new GameClock({ now: 0, step: () => calls++, ...options }));
  }
  const clock = new GameClock({ now: 0, step: () => calls++ });
  for (const value of [-1, 20.1, '2', NaN, Infinity]) assert.throws(() => clock.setSpeed(value));
  for (const value of [NaN, Infinity, '10']) assert.throws(() => clock.advance(value));
  for (const value of [0, -1, 241, NaN, Infinity, '120', Number.MIN_VALUE]) assert.throws(() => clock.setRenderHz(value));
  assert.throws(() => { clock.speed = 8; }, TypeError);
  assert.throws(() => { clock.stats.speed = 8; }, TypeError);
  assert.ok(Object.isFrozen(clock.stats)); assert.equal(calls, 0); assert.equal(clock.speed, 1);
});

test('at equal executed tick counts all speeds preserve actual seeded core state and RNG draws', () => {
  const config = JSON.parse(readFileSync(new URL('../config/defaults.generated.json', import.meta.url), 'utf8'));
  for (const speed of [0, 0.1, 0.5, ...GAME_SPEEDS, 12.3, 20]) {
    let leftDraws = 0, rightDraws = 0;
    const leftRng = seededRandom(123), rightRng = seededRandom(123);
    const baseline = new MiragineSimulation({ config, autoStart: false, rng: () => { leftDraws++; return leftRng(); } });
    const timed = new MiragineSimulation({ config, autoStart: false, rng: () => { rightDraws++; return rightRng(); } });
    const clock = new GameClock({ now: 0, speed, step: () => timed.step() });
    let sawAttack = false;
    for (let frame = 1; frame <= 480; frame++) {
      const result = clock.advance(frame * 1000 / 60);
      baseline.step(result.steps);
      assert.deepEqual(timed.snapshot(), baseline.snapshot());
      const events = timed.drainEvents();
      assert.deepEqual(events, baseline.drainEvents());
      sawAttack ||= events.some(event => event.type === 'attack');
      assert.equal(rightDraws, leftDraws);
    }
    assert.equal(timed.frame, clock.totalSteps);
    if (speed >= 4) assert.ok(sawAttack, 'higher-speed fixture must exercise combat, not only recruitment');
  }
});

test('multiple catch-up steps do not repeat discrete keys, while original tracking camera keys run per game tick', () => {
  const presses = [], steering = [];
  const controller = { phase: 'game', simulation: { running: true, winner: null, steer: (...args) => steering.push(args) },
    key: code => presses.push(code) };
  const keyboard = new OriginalKeyboard(controller);
  const clock = new GameClock({ now: 0, speed: 8, step: () => keyboard.step() });
  keyboard.keyDown('Space'); keyboard.keyDown('KeyD'); keyboard.keyDown('KeyL');
  const first = clock.advance(100);
  assert.deepEqual(presses, ['KeyD', 'Space']); assert.equal(steering.length, first.steps);
  keyboard.keyUp('Space'); clock.advance(110); keyboard.keyDown('Space'); clock.advance(120);
  assert.equal(presses.filter(code => code === 'Space').length, 2);
});
