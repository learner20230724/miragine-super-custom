import { GameClock } from '../runtime/game-clock.mjs';
import { interpolateRenderState } from '../runtime/render-interpolation.mjs';

/** The game-specific adapter; the reusable clock never imports this controller. */
export class MiraginePlayback {
  #pauseReasons = new Set();

  constructor(controller, { now, inputStep = () => {}, renderHz = 240,
    maxWorkMs = Infinity, maxStepsPerAdvance = Infinity, workNow = () => performance.now() } = {}) {
    this.controller = controller;
    this.inputStep = inputStep;
    this.speed = 1;
    this.lastNonzeroSpeed = 1;
    this.simulation = null;
    this.previous = this.current = null;
    this.clock = new GameClock({ stepHz: controller.config.rules.frameRate, renderHz, now,
      maxWorkMs, maxStepsPerAdvance, workNow,
      step: wallNow => this.step(wallNow) });
    this.syncSimulation();
  }

  capture(sim) {
    return { frame: sim.frame, snapshot: sim.renderSnapshot, camera: sim.renderCamera };
  }

  syncSimulation() {
    const sim = this.controller.simulation;
    if (sim !== this.simulation) {
      this.simulation = sim;
      // A new match reuses UIDs; never interpolate an old match into this one.
      this.previous = this.current = sim ? this.capture(sim) : null;
    }
  }

  /** Capture an explicitly refreshed world after edits without advancing it. */
  refresh() {
    this.syncSimulation();
    this.previous = this.current = this.simulation ? this.capture(this.simulation) : null;
    this.invalidate();
    return this;
  }

  step(wallNow) {
    this.syncSimulation();
    // Do not consume input while the world is paused. Native menus and the
    // winner's wall-time result transition remain responsive independently.
    if (this.worldActive && this.paused) return;
    this.inputStep();
    this.controller.tick(wallNow);
    this.syncSimulation();
    const sim = this.simulation;
    if (!sim) return;
    if (sim.frame !== this.current.frame) {
      this.previous = this.current;
      this.current = this.capture(sim);
    }
    // An ended/stopped world must not oscillate between its last two positions
    // as the presentation alpha continues cycling on the wall-clock scheduler.
    if (!sim.running || sim.winner) this.previous = this.current;
  }

  get worldActive() { return this.controller.phase === 'game' && !this.controller.simulation?.winner; }
  get paused() { return this.speed === 0 || this.#pauseReasons.size > 0; }
  get pauseReasons() { return Object.freeze([...this.#pauseReasons]); }

  syncClockRate() {
    const effectiveSpeed = this.worldActive ? (this.paused ? 0 : this.speed) : 1;
    if (this.clock.speed !== effectiveSpeed) this.clock.setSpeed(effectiveSpeed);
  }

  setSpeed(speed, now) {
    // Validate before settling the old rate: an invalid slider value must not
    // change either the world or the selected speed.
    if (!Number.isFinite(speed) || speed < 0 || speed > 20) {
      throw new RangeError('speed must be a finite number in [0,20]');
    }
    this.syncClockRate();
    this.clock.setSpeed(speed, now);
    this.speed = speed;
    if (speed > 0) this.lastNonzeroSpeed = speed;
    this.syncClockRate();
    return this;
  }

  /** Named reasons compose: closing the editor cannot release a manual pause. */
  setPaused(paused, now, reason = 'manual') {
    if (typeof paused !== 'boolean' || typeof reason !== 'string' || !reason.trim()) {
      throw new TypeError('Expected a boolean paused state and a nonempty pause reason');
    }
    if (now !== undefined) this.advance(now);
    if (paused) this.#pauseReasons.add(reason);
    else this.#pauseReasons.delete(reason);
    this.syncClockRate();
    this.invalidate();
    return this;
  }

  togglePause(now) {
    if (this.#pauseReasons.has('manual')) return this.setPaused(false, now, 'manual');
    return this.setSpeed(this.speed === 0 ? this.lastNonzeroSpeed : 0, now);
  }

  /** Aliases for callers that keep independent editor/modal pause reasons. */
  pause(reason = 'manual', now) { return this.setPaused(true, now, reason); }
  resume(reason = 'manual', now) { return this.setPaused(false, now, reason); }

  setRenderHz(rate) { this.clock.setRenderHz(rate); return this; }
  invalidate() { this.clock.invalidate(); }

  advance(now, { hidden = false } = {}) {
    this.syncSimulation();
    // UI transitions use the real RAF timestamp, never accelerated game time.
    this.syncClockRate();
    const result = this.clock.advance(now, { hidden });
    // A catch-up batch can finish the match. Switch the next batch immediately
    // to wall-time UI scheduling rather than retaining a paused/fast game rate.
    this.syncClockRate();
    return result;
  }

  presentation() {
    this.syncSimulation();
    if (!this.current) return { snapshot: [], camera: null };
    return interpolateRenderState(this.previous?.snapshot, this.current.snapshot, this.clock.alpha,
      { previousCamera: this.previous?.camera, currentCamera: this.current.camera });
  }

  snapshot() {
    return { ...this.clock.stats, selectedSpeed: this.speed, paused: this.paused,
      pauseReasons: this.pauseReasons, lastNonzeroSpeed: this.lastNonzeroSpeed,
      simulationGameTimeMs: (this.simulation?.frame ?? 0) * this.clock.stepMs };
  }
}
