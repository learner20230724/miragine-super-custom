import test from 'node:test';
import assert from 'node:assert/strict';
import { FixedStepFrameClock } from '../src/platform/frame-clock.mjs';

function originalLoop(frameRate, initial) {
  let previous = initial, accumulator = 0, total = 0;
  return (now, hidden = false) => {
    const delta = hidden ? 0 : Math.min(now - previous, 250);
    previous = now;
    accumulator += delta;
    let steps = 0;
    while (accumulator >= 1000 / frameRate) {
      steps++; total++; accumulator -= 1000 / frameRate;
    }
    return { steps, total, accumulator };
  };
}

test('30 Hz logic keeps exact old accumulator steps on 30/60/144/240 Hz displays', () => {
  for (const displayRate of [30, 60, 144, 240]) {
    let total = 0, paints = 0;
    const clock = new FixedStepFrameClock({ frameRate: 30, now: 0, step: () => total++ });
    const old = originalLoop(30, 0);
    for (let frame = 1; frame <= displayRate * 10; frame++) {
      const now = frame * 1000 / displayRate;
      const expected = old(now), result = clock.advance(now);
      assert.equal(result.steps, expected.steps);
      assert.equal(total, expected.total);
      assert.equal(clock.accumulator, expected.accumulator);
      paints += Number(result.render);
    }
    assert.ok(total >= 299 && total <= 300);
    assert.ok(paints <= total + 1, 'no duplicate full redraws between logic frames');
  }
});

test('late frames, fractional custom rates and suspension preserve the old step sequence', () => {
  for (const rate of [24, 29.97, 30, 45, 60]) {
    const timestamps = [0, 1, 16.67, 33.34, 51, 205, 999, 1000, 1100, 60000, 60001, 60017, 60100];
    let total = 0;
    const clock = new FixedStepFrameClock({ frameRate: rate, now: 0, step: () => total++ });
    const old = originalLoop(rate, 0);
    for (const [index, now] of timestamps.entries()) {
      const hidden = index >= 6 && index <= 9;
      const expected = old(now, hidden), actual = clock.advance(now, { hidden });
      assert.equal(actual.steps, expected.steps);
      assert.equal(total, expected.total);
      assert.equal(clock.accumulator, expected.accumulator);
      if (hidden) assert.equal(actual.render, false);
    }
  }
});

test('pointer/UI invalidation repaints promptly without advancing game rules', () => {
  let steps = 0;
  const clock = new FixedStepFrameClock({ frameRate: 30, now: 0, step: () => steps++ });
  assert.deepEqual(clock.advance(1), { steps: 0, render: true });
  assert.deepEqual(clock.advance(2), { steps: 0, render: false });
  clock.invalidate();
  assert.deepEqual(clock.advance(3), { steps: 0, render: true });
  assert.equal(steps, 0);
  clock.invalidate();
  assert.deepEqual(clock.advance(4, { hidden: true }), { steps: 0, render: false });
  assert.deepEqual(clock.advance(5), { steps: 0, render: true });
});

test('catch-up input and ticks keep original order and receive the actual RAF timestamp', () => {
  const actions = [];
  const clock = new FixedStepFrameClock({ frameRate: 30, now: 0, step: now => {
    actions.push(['keyboard', now], ['tick', now]);
  } });
  const result = clock.advance(200);
  assert.ok(result.steps >= 5 && result.steps <= 6);
  for (let i = 0; i < actions.length; i += 2) {
    assert.deepEqual(actions.slice(i, i + 2), [['keyboard', 200], ['tick', 200]]);
  }
  assert.equal(result.render, true);
});

test('invalid clock inputs fail before a simulation callback can be invoked', () => {
  for (const frameRate of [0, -1, NaN, Infinity]) {
    assert.throws(() => new FixedStepFrameClock({ frameRate, now: 0, step() {} }), /positive/);
  }
  const clock = new FixedStepFrameClock({ frameRate: 30, now: 0, step() {} });
  assert.throws(() => clock.advance(NaN), /finite/);
});
