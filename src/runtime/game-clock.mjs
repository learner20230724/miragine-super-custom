const SPEEDS = Object.freeze([1, 2, 4, 8]);
const RENDER_EPSILON_MS = 1e-7;

/**
 * Fixed game-step scheduling for an adapter which supplies its own step.
 * This does not adapt arbitrary game engines: callback units, input, audio and
 * wall-clock UI transitions remain the adapter's responsibility.
 *
 * At 1x the delta/add/while/callback/subtract sequence matches the inherited
 * FixedStepFrameClock. Suspension is capped BEFORE scaling future game time.
 * Hidden time is paused; already accumulated fractional game time is retained.
 */
export class GameClock {
  #stepHz; #renderHz; #stepMs; #renderMs; #previous; #step; #maxDeltaMs;
  #speed; #accumulator = 0; #totalSteps = 0; #lastRender = null; #nextRenderAt = null; #dirty = true;
  #lastAdvance = { steps: 0, render: false, wallDeltaMs: 0,
    acceptedWallDeltaMs: 0, droppedWallDeltaMs: 0, hidden: false };

  constructor({ stepHz = 30, renderHz = 240, now, step, speed = 1, maxDeltaMs = 250 } = {}) {
    if (!Number.isFinite(stepHz) || stepHz <= 0 || !Number.isFinite(renderHz)
      || renderHz <= 0 || renderHz > 240 || !Number.isFinite(now)
      || !Number.isFinite(maxDeltaMs) || maxDeltaMs <= 0 || !Number.isFinite(maxDeltaMs * 8)
      || !Number.isFinite(1000 / stepHz) || !Number.isFinite(1000 / renderHz)
      || typeof step !== 'function') {
      throw new TypeError('Expected positive finite stepHz, renderHz in (0,240], finite now/maxDeltaMs and a step callback');
    }
    if (!SPEEDS.includes(speed)) throw new RangeError('speed must be 1, 2, 4 or 8');
    this.#stepHz = stepHz; this.#renderHz = renderHz;
    this.#stepMs = 1000 / stepHz; this.#renderMs = 1000 / renderHz;
    this.#previous = now; this.#step = step; this.#speed = speed; this.#maxDeltaMs = maxDeltaMs;
  }

  get stepHz() { return this.#stepHz; }
  get renderHz() { return this.#renderHz; }
  get speed() { return this.#speed; }
  get stepMs() { return this.#stepMs; }
  get accumulatorMs() { return this.#accumulator; }
  get totalSteps() { return this.#totalSteps; }
  get gameTimeMs() { return this.#totalSteps * this.#stepMs; }
  get alpha() { return Math.max(0, Math.min(1, this.#accumulator / this.#stepMs)); }
  get stats() {
    return Object.freeze({ ...this.#lastAdvance, alpha: this.alpha,
      gameTimeMs: this.gameTimeMs, totalSteps: this.#totalSteps, speed: this.#speed,
      stepHz: this.#stepHz, renderHz: this.#renderHz, accumulatorMs: this.#accumulator });
  }

  setSpeed(value) {
    if (!SPEEDS.includes(value)) throw new RangeError('speed must be 1, 2, 4 or 8');
    this.#speed = value;
    // Do not rescale existing game-time remainder when switching speeds.
    this.invalidate();
    return this;
  }

  setRenderHz(value) {
    if (!Number.isFinite(value) || value <= 0 || value > 240 || !Number.isFinite(1000 / value)) {
      throw new RangeError('renderHz must be finite and in (0,240]');
    }
    this.#renderHz = value;
    this.#renderMs = 1000 / value;
    // Discard only presentation debt. No game-time remainder or tick changes.
    this.#nextRenderAt = this.#lastRender === null ? null : this.#previous + this.#renderMs;
    this.invalidate();
    return this;
  }

  invalidate() { this.#dirty = true; }

  advance(now, { hidden = false } = {}) {
    if (!Number.isFinite(now)) throw new TypeError('Expected a finite animation timestamp');
    const wallDeltaMs = now - this.#previous;
    if (!Number.isFinite(wallDeltaMs) || !Number.isFinite(wallDeltaMs * this.#speed)) {
      throw new RangeError('Animation timestamp delta exceeds finite game-clock arithmetic');
    }
    const acceptedWallDeltaMs = hidden ? 0 : Math.min(wallDeltaMs, this.#maxDeltaMs);
    this.#previous = now;
    // Preserve the inherited behavior for a slightly older first RAF timestamp:
    // no artificial max(0,delta), and no changed accumulator operation order.
    this.#accumulator += acceptedWallDeltaMs * this.#speed;
    let steps = 0;
    while (this.#accumulator >= this.#stepMs) {
      this.#step(now);
      this.#accumulator -= this.#stepMs;
      steps++;
      this.#totalSteps++;
    }
    const renderDue = this.#nextRenderAt === null
      || now + RENDER_EPSILON_MS >= this.#nextRenderAt;
    // Rendering is independent of simulation ticks so intermediate positions and
    // wall-clock UI tweens can be presented. Invalidation never bypasses the cap.
    const render = !hidden && renderDue
      && (this.#dirty || this.#lastRender === null || now > this.#lastRender);
    if (render) {
      this.#lastRender = now;
      this.#dirty = false;
      if (this.#nextRenderAt === null) this.#nextRenderAt = now + this.#renderMs;
      else {
        // Keep fractional phase on non-divisible display rates (120Hz target on
        // a 144Hz RAF), but never paint repeatedly to repay missed render slots.
        const periods = Math.max(1, Math.floor((now - this.#nextRenderAt + RENDER_EPSILON_MS) / this.#renderMs) + 1);
        this.#nextRenderAt += periods * this.#renderMs;
      }
    }
    this.#lastAdvance = { steps, render, wallDeltaMs, acceptedWallDeltaMs,
      droppedWallDeltaMs: hidden ? 0 : Math.max(0, wallDeltaMs - acceptedWallDeltaMs), hidden: Boolean(hidden) };
    return this.stats;
  }
}

export const GAME_SPEEDS = SPEEDS;
