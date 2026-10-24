// One U/O press is the same zoom increment as a 100-pixel mouse-wheel step.
// Browser key repeat also uses this increment: simulation speed never enters it.
const KEY_WHEEL_PIXELS = 100;
const BATTLEFIELD_TOP = 100;

export function wheelZoomFactor(deltaY, deltaMode = 0) {
  const pixels = deltaY * (deltaMode === 1 ? 16 : deltaMode === 2 ? 400 : 1);
  return Math.exp(-Math.max(-500, Math.min(500, pixels)) * .0015);
}

export function uiOwnsGameKeyboard(target) {
  return Boolean(target?.isContentEditable
    || target?.closest?.('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="dialog"], [data-custom-controls], [data-settings-panel], [data-game-text-controls]'));
}

/** Zoom the observation camera only. Returns true when this key was handled. */
export function zoomCameraFromKey(event, { enabled, camera, coreCamera } = {}) {
  if (!enabled || !camera || !['KeyU', 'KeyO'].includes(event.code)
    || event.ctrlKey || event.altKey || event.metaKey || event.isComposing
    || uiOwnsGameKeyboard(event.target)) return false;
  const pixels = event.code === 'KeyU' ? -KEY_WHEEL_PIXELS : KEY_WHEEL_PIXELS;
  // The HUD covers the top 100 logical pixels; do not reuse a stale pointer.
  const anchor = { x: camera.width / 2, y: (BATTLEFIELD_TOP + camera.height) / 2 };
  camera.zoomAt(wheelZoomFactor(pixels), anchor, coreCamera);
  return true;
}
