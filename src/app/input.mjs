/** Native port of dragonforce/utils/KeyManager.as and DragonForce.libraryComplete bindings. */
export class OriginalKeyboard {
  constructor(controller) {
    this.controller = controller;
    this.down = new Set();
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
  keyDown(code) { this.down.add(this.normalize(code)); }
  keyUp(code) { this.down.delete(this.normalize(code)); }
  clear() { this.down.clear(); for (const binding of this.bindings) binding.isDown = false; }

  step() {
    const c = this.controller;
    if (c.phase !== 'game' || c.simulation.winner || !c.simulation.running) return;
    const active = [];
    for (const binding of this.bindings) {
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
