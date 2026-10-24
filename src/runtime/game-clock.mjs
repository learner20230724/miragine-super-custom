const SPEEDS = Object.freeze([1, 2, 4, 8]);
export const MAX_GAME_SPEED = 100;
const RENDER_EPSILON_MS = 1e-7;

function validateSpeed(value) {
  if (!Number.isFinite(value) || value < 0 || value > MAX_GAME_SPEED) {
    throw new RangeError(`speed must be a finite number in [0,${MAX_GAME_SPEED}]`);
  }
}

/**
 * Fixed game-step scheduling for an adapter which supplies its own step.
 * This does not adapt arbitrary game engines: callback units, input, audio and
 * wall-clock UI transitions remain the adapter's responsibility.
 *
 * At 1x the delta/add/while/callback/subtract sequence matches the inherited
 * FixedStepFrameClock. Suspension is capped BEFORE scaling future game time.
 * Hidden time and speed 0 are paused; fractional game time is retained.
 * A timestamped speed change first settles the OLD rate up to that boundary.
 * This prevents paused time leaking into the first frame after resuming, even
 * when both changes happen between two animation callbacks.
 */
export class GameClock {
  #stepHz; #renderHz; #stepMs; #renderMs; #previous; #step; #maxDeltaMs;
  #maxWorkMs; #maxStepsPerAdvance; #workNow;
  #speed; #accumulator = 0; #totalSteps = 0; #lastRender = null; #nextRenderAt = null; #dirty = true;
  #lastAdvance = { steps: 0, render: false, wallDeltaMs: 0,
    cappedWallDeltaMs: 0, acceptedWallDeltaMs: 0, droppedWallDeltaMs: 0,
    droppedGameTimeMs: 0, workLimited: false, hidden: false };

  constructor({ stepHz = 30, renderHz = 240, now, step, speed = 1, maxDeltaMs = 250,
    maxWorkMs = Infinity, maxStepsPerAdvance = Infinity, workNow = () => performance.now() } = {}) {
    if (!Number.isFinite(stepHz) || stepHz <= 0 || !Number.isFinite(renderHz)
      || renderHz <= 0 || renderHz > 240 || !Number.isFinite(now)
      || !Number.isFinite(maxDeltaMs) || maxDeltaMs <= 0 || !Number.isFinite(maxDeltaMs * MAX_GAME_SPEED)
      || !Number.isFinite(1000 / stepHz) || !Number.isFinite(1000 / renderHz)
      || typeof step !== 'function') {
      throw new TypeError('Expected positive finite stepHz, renderHz in (0,240], finite now/maxDeltaMs and a step callback');
    }
    validateSpeed(speed);
    if ((maxWorkMs !== Infinity && (!Number.isFinite(maxWorkMs) || maxWorkMs <= 0))
      || (maxStepsPerAdvance !== Infinity && (!Number.isInteger(maxStepsPerAdvance) || maxStepsPerAdvance <= 0))
      || typeof workNow !== 'function') {
      throw new TypeError('Expected positive maxWorkMs/maxStepsPerAdvance (or Infinity) and a workNow callback');
    }
    this.#stepHz = stepHz; this.#renderHz = renderHz;
    this.#stepMs = 1000 / stepHz; this.#renderMs = 1000 / renderHz;
    this.#previous = now; this.#step = step; this.#speed = speed; this.#maxDeltaMs = maxDeltaMs;
    this.#maxWorkMs = maxWorkMs; this.#maxStepsPerAdvance = maxStepsPerAdvance; this.#workNow = workNow;
  }

  get stepHz() { return this.#stepHz; }
  get renderHz() { return this.#renderHz; }
  get speed() { return this.#speed; }
  get paused() { return this.#speed === 0; }
  get stepMs() { return this.#stepMs; }
  get accumulatorMs() { return this.#accumulator; }
  get totalSteps() { return this.#totalSteps; }
  get gameTimeMs() { return this.#totalSteps * this.#stepMs; }
  get alpha() { return Math.max(0, Math.min(1, this.#accumulator / this.#stepMs)); }
  get stats() {
    return Object.freeze({ ...this.#lastAdvance, alpha: this.alpha,
      gameTimeMs: this.gameTimeMs, totalSteps: this.#totalSteps, speed: this.#speed, paused: this.paused,
      stepHz: this.#stepHz, renderHz: this.#renderHz, accumulatorMs: this.#accumulator });
  }

  setSpeed(value, now) {
    validateSpeed(value);
    // UI callers must pass their event timestamp when changing rates between
    // RAF callbacks. Omitting it preserves the previous adapter contract: the
    // new rate applies to the next accepted delta, with no extra callback.
    if (now !== undefined) this.advance(now);
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
    const batchSpeed = this.#speed;
    const accelerated = !hidden && batchSpeed > 1;
    const timed = accelerated && this.#maxWorkMs !== Infinity;
    const workStarted = timed ? this.#workNow() : 0;
    if (timed && !Number.isFinite(workStarted)) throw new TypeError('workNow must return a finite timestamp');
    const cappedWallDeltaMs = hidden ? 0 : Math.min(wallDeltaMs, this.#maxDeltaMs);
    let acceptedWallDeltaMs = cappedWallDeltaMs;
    this.#previous = now;
    // Preserve the inherited behavior for a slightly older first RAF timestamp:
    // no artificial max(0,delta), and no changed accumulator operation order.
    this.#accumulator += acceptedWallDeltaMs * batchSpeed;
    let steps = 0;
    let droppedGameTimeMs = 0;
    while (this.#accumulator >= this.#stepMs) {
      this.#step(now);
      this.#accumulator -= this.#stepMs;
      steps++;
      this.#totalSteps++;
      if (accelerated && this.#accumulator >= this.#stepMs) {
        const measured = timed ? this.#workNow() : workStarted;
        if (timed && !Number.isFinite(measured)) throw new TypeError('workNow must return a finite timestamp');
        if (steps >= this.#maxStepsPerAdvance || (timed && measured - workStarted >= this.#maxWorkMs)) {
          // Shed expired wall-time demand, not game-state steps: never advance
          // the game's frame counter/RNG without calling its full original tick.
          // Keeping only the fraction prevents an unbounded catch-up backlog or
          // a pause/resume burst. Actual measured speed falls below the target.
          const retained = this.#accumulator % this.#stepMs;
          droppedGameTimeMs = this.#accumulator - retained;
          this.#accumulator = retained;
          acceptedWallDeltaMs -= droppedGameTimeMs / batchSpeed;
          break;
        }
      }
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
    this.#lastAdvance = { steps, render, wallDeltaMs, cappedWallDeltaMs, acceptedWallDeltaMs,
      droppedWallDeltaMs: hidden ? 0 : Math.max(0, wallDeltaMs - acceptedWallDeltaMs),
      droppedGameTimeMs, workLimited: droppedGameTimeMs > 0, hidden: Boolean(hidden) };
    return this.stats;
  }
}

export const GAME_SPEEDS = SPEEDS;
