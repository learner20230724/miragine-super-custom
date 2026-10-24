export const SELECTION_REPEAT_DELAY_MS = 350;
export const SELECTION_REPEAT_INTERVAL_MS = 85;

const selectionOpposites = new Map([
  ['KeyW', 'KeyS'], ['KeyS', 'KeyW'], ['KeyA', 'KeyD'], ['KeyD', 'KeyA'],
  ['ArrowUp', 'ArrowDown'], ['ArrowDown', 'ArrowUp'], ['ArrowLeft', 'ArrowRight'], ['ArrowRight', 'ArrowLeft'],
]);

/** Native KeyManager bindings, with opt-in wall-time selection repetition in the custom app. */
export class OriginalKeyboard {
  constructor(controller, { repeatSelection = false } = {}) {
    this.controller = controller;
    this.down = new Set();
    this.repeatSelection = repeatSelection;
    this.selectionHeld = new Map();
    this.selectionSimulation = controller.simulation;
    const discrete = code => () => controller.key(code);
    const steer = (x, y) => () => controller.simulation.steer(x, y);
    this.bindings = [
      ...['KeyW', 'KeyS', 'KeyA', 'KeyD', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter']
        .map(code => ({ keys: [code], tracking: false, run: discrete(code), isDown: false })),
      ...[[['KeyI'], 0, -5], [['KeyK'], 0, 5], [['KeyJ'], -5, 0], [['KeyL'], 5, 0],
        [['KeyI', 'KeyL'], 5, -5], [['KeyL', 'KeyK'], 5, 5], [['KeyK', 'KeyJ'], -5, 5], [['KeyJ', 'KeyI'], -5, -5]]
        .map(([keys, x, y]) => ({ keys, tracking: true, run: steer(x, y), isDown: false })),
      { keys: ['Equal'], tracking: false, run: discrete('Equal'), isDown: false },
      { keys: ['Minus'], tracking: false, run: discrete('Minus'), isDown: false },
    ];
  }

  normalize(code) {
    if (code === 'NumpadAdd') return 'Equal';
    if (code === 'NumpadSubtract') return 'Minus';
    return code;
  }
  keyDown(code, { now = performance.now(), repeat = false } = {}) {
    code = this.normalize(code);
    // OS key repeat must never stack with our wall-time repeater, including
    // after a focus/visibility transition cleared the physical-key state.
    if (repeat) return false;
    if (this.repeatSelection && this.selectionSimulation !== this.controller.simulation) {
      this.clear();
      this.selectionSimulation = this.controller.simulation;
    }
    if (this.down.has(code)) return false;
    if (this.repeatSelection && selectionOpposites.has(code)) {
      if (!this.selectionAllowed() || !Number.isFinite(now)) return false;
      this.down.add(code);
      this.selectionHeld.set(code, now + SELECTION_REPEAT_DELAY_MS);
      // Opposite directions cancel on their axis; diagonal and two-player
      // input remain independent. Controller retains the original 8x2 limits.
      if (this.down.has(selectionOpposites.get(code))) return false;
      return this.controller.key(code) !== false;
    }
    this.down.add(code);
    return false;
  }

  keyUp(code) {
    code = this.normalize(code);
    this.down.delete(code);
    this.selectionHeld.delete(code);
  }

  clear() {
    this.down.clear();
    this.selectionHeld.clear();
    for (const binding of this.bindings) binding.isDown = false;
  }

  selectionAllowed() {
    const c = this.controller;
    return c.phase === 'game' && !c.overlay && c.simulation?.running && !c.simulation.winner;
  }

  /** Call once per animation frame, not per accelerated simulation tick. */
  advanceSelection(now, { blocked = false } = {}) {
    if (!this.repeatSelection) return false;
    if (blocked || !this.selectionAllowed() || this.selectionSimulation !== this.controller.simulation) {
      this.clear();
      this.selectionSimulation = this.controller.simulation;
      return false;
    }
    if (!Number.isFinite(now)) return false;
    let changed = false;
    for (const [code, nextAt] of this.selectionHeld) {
      if (this.down.has(selectionOpposites.get(code))) {
        this.selectionHeld.set(code, now + SELECTION_REPEAT_DELAY_MS);
      } else if (now >= nextAt) {
        changed = this.controller.key(code) !== false || changed;
        // Skip missed repeats after a stalled frame rather than firing a burst.
        // Deadlines stay on the wall-time cadence, independent of logic speed.
        const missed = Math.floor((now - nextAt) / SELECTION_REPEAT_INTERVAL_MS) + 1;
        this.selectionHeld.set(code, nextAt + missed * SELECTION_REPEAT_INTERVAL_MS);
      }
    }
    return changed;
  }

  step() {
    const c = this.controller;
    if (c.phase !== 'game' || c.simulation.winner || !c.simulation.running) return;
    const active = [];
    for (const binding of this.bindings) {
      if (this.repeatSelection && selectionOpposites.has(binding.keys[0])) continue;
      binding.isWeak = false;
      if (binding.keys.every(key => this.down.has(key))) active.push(binding);
      else binding.isDown = false;
    }
    for (const binding of active) {
      for (const other of active) {
        if (binding !== other && binding.keys.length < other.keys.length
          && binding.keys.every(key => other.keys.includes(key))) binding.isWeak = true;
      }
    }
    for (const binding of active) {
      if (!binding.isWeak && (binding.tracking || !binding.isDown)) {
        binding.isDown = true;
        binding.run();
      }
    }
  }
}
