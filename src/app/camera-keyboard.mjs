const BATTLEFIELD_TOP = 100;
export const KEYBOARD_ZOOM_PER_SECOND = 2;
export const MAX_KEYBOARD_ZOOM_DELTA_MS = 50;
const LOG_ZOOM_PER_MS = Math.log(KEYBOARD_ZOOM_PER_SECOND) / 1000;
const isZoomKey = code => code === 'KeyU' || code === 'KeyO';
const validTime = now => {
  if (!Number.isFinite(now) || now < 0) throw new TypeError('Expected a finite nonnegative wall timestamp');
  return now;
};

export function wheelZoomFactor(deltaY, deltaMode = 0) {
  const pixels = deltaY * (deltaMode === 1 ? 16 : deltaMode === 2 ? 400 : 1);
  return Math.exp(-Math.max(-500, Math.min(500, pixels)) * .0015);
}

export function uiOwnsGameKeyboard(target) {
  return Boolean(target?.isContentEditable
    || target?.closest?.('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="dialog"], [data-custom-controls], [data-settings-panel], [data-game-text-controls]'));
}

/**
 * Observation-only held-key zoom. Real elapsed time, not OS repeat or game
 * ticks, controls its rate. Event edges settle the last interval immediately
 * so even a complete tap between two RAFs is retained, without release inertia.
 */
export class CameraZoomKeyboard {
  #down = new Set();
  #scene = null;
  #lastAt = null;
  #frameUsedMs = 0;

  clear() {
    this.#down.clear(); this.#scene = null; this.#lastAt = null; this.#frameUsedMs = 0;
  }

  #accept(context) {
    if (!context?.enabled || !context.camera) { this.clear(); return false; }
    if (this.#scene !== context.scene) {
      this.clear(); this.#scene = context.scene;
    }
    return true;
  }

  #settle(now, { camera, coreCamera }) {
    validTime(now);
    const elapsed = this.#lastAt === null ? 0 : Math.max(0, now - this.#lastAt);
    this.#lastAt = Math.max(now, this.#lastAt ?? now);
    const direction = Number(this.#down.has('KeyU')) - Number(this.#down.has('KeyO'));
    if (!direction || !elapsed) return false;
    // Event edges share this RAF's budget. Repeated taps cannot evade the cap,
    // and all excess elapsed time is discarded rather than queued as zoom debt.
    const accepted = Math.min(elapsed, MAX_KEYBOARD_ZOOM_DELTA_MS - this.#frameUsedMs);
    this.#frameUsedMs += accepted;
    if (accepted <= 0) return false;
    const factor = Math.exp(direction * LOG_ZOOM_PER_MS * accepted);
    const nextZoom = Math.max(camera.minZoom, Math.min(camera.maxZoom, camera.zoom * factor));
    if (nextZoom === camera.zoom) return false;
    // The HUD covers the top 100 logical pixels; never reuse a stale pointer.
    camera.zoomAt(factor, { x: camera.width / 2, y: (BATTLEFIELD_TOP + camera.height) / 2 }, coreCamera);
    return true;
  }

  /** Returns whether U/O was owned; changing direction may also settle zoom. */
  keyDown(event, now, context) {
    if (!isZoomKey(event.code)) return false;
    validTime(now);
    if (!this.#accept(context)) return false;
    if (event.ctrlKey || event.altKey || event.metaKey || event.isComposing || uiOwnsGameKeyboard(event.target)) {
      this.clear(); return false;
    }
    // A repeat received after focus/scene cleanup must not restart a held key.
    if (event.repeat || this.#down.has(event.code)) return this.#down.has(event.code);
    this.#settle(now, context);
    this.#down.add(event.code);
    return true;
  }

  /** Returns whether the final, pre-release interval changed the camera. */
  keyUp(event, now, context) {
    if (!isZoomKey(event.code)) return false;
    validTime(now);
    if (!this.#accept(context) || uiOwnsGameKeyboard(event.target)) { this.clear(); return false; }
    const changed = this.#settle(now, context);
    this.#down.delete(event.code);
    return changed;
  }

  /** Call exactly once per visible RAF, also while the simulation is paused. */
  advance(now, context) {
    validTime(now);
    if (!this.#accept(context)) return false;
    const changed = this.#settle(now, context);
    this.#frameUsedMs = 0;
    return changed;
  }
}
