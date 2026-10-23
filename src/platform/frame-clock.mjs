/**
 * Keep the recovered fixed-step simulation, without repainting the same state
 * on every monitor refresh. Input can explicitly invalidate the presentation.
 * The accumulator operations and 250 ms suspension cap match the old loop.
 */
export class FixedStepFrameClock {
  constructor({ frameRate, now, step, maxDeltaMs = 250 }) {
    if (!Number.isFinite(frameRate) || frameRate <= 0 || !Number.isFinite(now)
        || !Number.isFinite(maxDeltaMs) || maxDeltaMs <= 0 || typeof step !== 'function') {
      throw new TypeError('Expected a positive frame rate, finite clock and step callback');
    }
    this.frameMs = 1000 / frameRate;
    this.previous = now;
    this.accumulator = 0;
    this.maxDeltaMs = maxDeltaMs;
    this.step = step;
    this.dirty = true;
  }

  invalidate() { this.dirty = true; }

  advance(now, { hidden = false } = {}) {
    if (!Number.isFinite(now)) throw new TypeError('Expected a finite animation timestamp');
    const delta = hidden ? 0 : Math.min(now - this.previous, this.maxDeltaMs);
    this.previous = now;
    this.accumulator += delta;
    let steps = 0;
    while (this.accumulator >= this.frameMs) {
      this.step(now);
      this.accumulator -= this.frameMs;
      steps++;
    }
    const render = !hidden && (steps > 0 || this.dirty);
    if (render) this.dirty = false;
    return { steps, render };
  }
}
