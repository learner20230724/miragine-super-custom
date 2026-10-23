/** Native-resolution text controls: never rasterize these labels into the 640px game bitmap. */
export const GAME_TEXT_CONTROLS_CSS = `
[data-game-text-controls]{position:absolute;z-index:3;display:flex;flex-direction:column;align-items:flex-start;gap:0;pointer-events:none;user-select:none}
[data-game-text-controls][hidden]{display:none!important}
[data-game-text-controls] button{display:block;box-sizing:border-box;margin:0;padding:0;border:0;border-radius:0;background:transparent;box-shadow:none;color:#fff;font:500 var(--game-text-size,16px)/1.7 'Microsoft YaHei',Arial,sans-serif;text-shadow:0 1px 2px #000b;cursor:pointer;pointer-events:auto;text-align:left;white-space:nowrap}
[data-game-text-controls] button:hover{color:#ffe8a0;text-decoration:underline;text-underline-offset:3px}
[data-game-text-controls] button:focus-visible{outline:1px solid #ffe8a0;outline-offset:2px}
`;

export function gameTextLayout(fit) {
  if (!fit || !Number.isFinite(fit.width) || !Number.isFinite(fit.height) || fit.width <= 0 || fit.height <= 0) return null;
  // Help/quit remain at the original lower-left position, above the unit cards.
  // CSS font pixels are scaled, not a transformed low-resolution bitmap.
  const scale = fit.width / 640, fontSize = 11 * scale;
  return { left: fit.left + 9 * scale, top: fit.top + 341 * scale, fontSize };
}

export function createGameTextControls({ root, onPause = () => {}, onHelp = () => {}, onQuit = () => {} } = {}) {
  const doc = root?.ownerDocument;
  if (!doc?.createElement) throw new TypeError('A game-stage DOM root is required');
  const listeners = [], style = doc.createElement('style'), element = doc.createElement('div');
  style.textContent = GAME_TEXT_CONTROLS_CSS; style.setAttribute('data-game-text-style', '');
  (doc.head ?? doc.documentElement).appendChild(style);
  element.setAttribute('data-game-text-controls', ''); element.setAttribute('aria-label', '游戏操作');
  element.hidden = true;
  let enabled = false, destroyed = false;
  const listen = (node, type, callback) => { node.addEventListener(type, callback); listeners.push(() => node.removeEventListener(type, callback)); };
  const buttons = {};
  for (const [action, label, callback] of [['pause', '暂停游戏', onPause], ['tutorial', '游戏帮助', onHelp], ['quit', '退出游戏', onQuit]]) {
    if (typeof callback !== 'function') throw new TypeError('Game text callbacks must be functions');
    const button = doc.createElement('button'); button.type = 'button'; button.textContent = label;
    button.setAttribute('data-game-action', action);
    listen(button, 'click', event => {
      event.stopPropagation();
      if (!enabled || destroyed) return;
      callback(); root.querySelector?.('#game')?.focus?.({ preventScroll: true });
    });
    element.appendChild(button); buttons[action] = button;
  }
  for (const type of ['pointerdown', 'pointerup', 'wheel']) listen(element, type, event => event.stopPropagation());
  root.appendChild(element);
  return Object.freeze({ element, update({ visible = false, paused = false, fit } = {}) {
    if (destroyed) return;
    const layout = gameTextLayout(fit);
    enabled = Boolean(visible && layout); element.hidden = !enabled;
    for (const button of Object.values(buttons)) button.disabled = !enabled;
    const label = paused ? '继续游戏' : '暂停游戏';
    if (buttons.pause.textContent !== label) buttons.pause.textContent = label;
    buttons.pause.setAttribute('aria-pressed', String(Boolean(paused)));
    if (layout) {
      element.style.left = `${layout.left}px`; element.style.top = `${layout.top}px`;
      element.style.setProperty('--game-text-size', `${layout.fontSize}px`);
    }
  }, destroy() {
    if (destroyed) return; destroyed = true;
    for (const remove of listeners) remove(); element.remove(); style.remove();
  } });
}
