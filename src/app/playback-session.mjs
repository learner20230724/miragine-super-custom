import { GameClock } from '../runtime/game-clock.mjs';
import { interpolateRenderState } from '../runtime/render-interpolation.mjs';

/** The game-specific adapter; the reusable clock never imports this controller. */
export class MiraginePlayback {
  constructor(controller, { now, inputStep = () => {}, renderHz = 240 } = {}) {
    this.controller = controller;
    this.inputStep = inputStep;
    this.speed = 1;
    this.simulation = null;
    this.previous = this.current = null;
    this.clock = new GameClock({ stepHz: controller.config.rules.frameRate, renderHz, now,
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

  step(wallNow) {
    this.syncSimulation();
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

  setSpeed(speed) {
    this.clock.setSpeed(speed); // Central validation; preserve fractional game time.
    this.speed = speed;
    return this;
  }

  setRenderHz(rate) { this.clock.setRenderHz(rate); return this; }
  invalidate() { this.clock.invalidate(); }

  advance(now, { hidden = false } = {}) {
    this.syncSimulation();
    // UI transitions use the real RAF timestamp, never accelerated game time.
    const effectiveSpeed = this.controller.phase === 'game' ? this.speed : 1;
    if (this.clock.speed !== effectiveSpeed) this.clock.setSpeed(effectiveSpeed);
    return this.clock.advance(now, { hidden });
  }

  presentation() {
    this.syncSimulation();
    if (!this.current) return { snapshot: [], camera: null };
    return interpolateRenderState(this.previous?.snapshot, this.current.snapshot, this.clock.alpha,
      { previousCamera: this.previous?.camera, currentCamera: this.current.camera });
  }

  snapshot() {
    return { ...this.clock.stats, selectedSpeed: this.speed,
      simulationGameTimeMs: (this.simulation?.frame ?? 0) * this.clock.stepMs };
  }
}
