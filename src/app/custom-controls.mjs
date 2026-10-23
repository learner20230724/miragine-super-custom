export const CUSTOM_SPEEDS = Object.freeze([1, 2, 4, 8]);
export const CUSTOM_RENDER_RATES = Object.freeze([30, 60, 120, 240]);

export const CUSTOM_CONTROLS_CSS = `
[data-custom-controls] {
  box-sizing:border-box;
  position:absolute; left:8px; top:88px; z-index:4;
  max-width:calc(100% - 16px); padding:5px 7px;
  display:flex; flex-direction:column; gap:3px;
  color:#fff; background:rgba(14,14,14,.76);
  border:1px solid rgba(224,209,170,.55); border-radius:4px;
  font:11px/1.35 OriginalYahei,'Microsoft YaHei',Arial,sans-serif;
  font-variant-numeric:tabular-nums; user-select:none; pointer-events:auto;
}
[data-custom-controls][hidden] { display:none !important; }
[data-custom-controls] .custom-controls-row {
  display:flex; align-items:center; gap:4px; flex-wrap:wrap;
}
[data-custom-controls] button, [data-custom-controls] select {
  box-sizing:border-box; min-height:22px; margin:0; padding:2px 6px;
  color:#fff; background:#342d22; border:1px solid #8a7959;
  border-radius:3px; font:inherit; cursor:pointer;
}
[data-custom-controls] button[aria-pressed="true"] {
  background:#a46a12; border-color:#efc267;
}
[data-custom-controls] button:focus-visible, [data-custom-controls] select:focus-visible {
  outline:2px solid #efc267; outline-offset:1px;
}
[data-custom-controls] button:disabled, [data-custom-controls] select:disabled {
  opacity:.55; cursor:default;
}
[data-custom-controls] .custom-controls-caption { color:#ddd1b9; }
[data-custom-controls] .custom-controls-help { color:#d0d0d0; }
`;

const styleEntries = new WeakMap();

function acquireStyle(document) {
  let entry = styleEntries.get(document);
  if (!entry) {
    const element = document.createElement('style');
    element.setAttribute('data-custom-controls-style', '');
    element.textContent = CUSTOM_CONTROLS_CSS;
    (document.head ?? document.documentElement).appendChild(element);
    entry = { element, count: 0 };
    styleEntries.set(document, entry);
  }
  entry.count++;
  return () => {
    if (--entry.count === 0) {
      entry.element.remove();
      styleEntries.delete(document);
    }
  };
}

function isRate(value) { return typeof value === 'number' && Number.isFinite(value) && value >= 0; }

/** The configured target and measured work/display rates are intentionally distinct. */
export function formatCustomStatus({ speed = 1, actualSimulationHz = null, actualDisplayHz = null,
  baseSimulationHz = 30 } = {}) {
  const simulation = isRate(actualSimulationHz)
    ? `${actualSimulationHz.toFixed(1)} 步/秒${baseSimulationHz > 0 && Number.isFinite(baseSimulationHz)
      ? `（${(actualSimulationHz / baseSimulationHz).toFixed(2)}×）` : ''}`
    : '测量中';
  const display = isRate(actualDisplayHz) ? `${actualDisplayHz.toFixed(1)} 帧/秒` : '测量中';
  return `目标 ${speed}× · 实际模拟 ${simulation} · 实际显示 ${display}`;
}

function setText(element, value) { if (element.textContent !== value) element.textContent = value; }
function setAttribute(element, name, value) {
  if (element.getAttribute(name) !== value) element.setAttribute(name, value);
}

/**
 * Callbacks request changes; update() reflects the runtime's authoritative state.
 * The caller may position element inside its fitted game-stage container or pass
 * update({position:{left,top,maxWidth}}) in root-relative CSS pixels. No screen
 * dimensions or simulation rules are read or changed by this component.
 */
export function createCustomControls({ root, onSpeed = () => {}, onOverview = () => {},
  onFollow = () => {}, onRenderRate = () => {} } = {}) {
  const document = root?.ownerDocument;
  if (!root || typeof root.appendChild !== 'function' || !document?.createElement) {
    throw new TypeError('A game-stage DOM root is required');
  }
  for (const callback of [onSpeed, onOverview, onFollow, onRenderRate]) {
    if (typeof callback !== 'function') throw new TypeError('Control callbacks must be functions');
  }
  const releaseStyle = acquireStyle(document);
  const element = document.createElement('div');
  element.setAttribute('data-custom-controls', '');
  element.setAttribute('role', 'toolbar');
  element.setAttribute('aria-label', '游戏速度与视角控制');
  element.hidden = true;
  const row = document.createElement('div');
  row.className = 'custom-controls-row';
  element.appendChild(row);
  const caption = text => {
    const span = document.createElement('span');
    span.className = 'custom-controls-caption';
    span.textContent = text;
    row.appendChild(span);
    return span;
  };
  caption('速度');
  const listeners = [];
  const listen = (target, type, listener) => {
    target.addEventListener(type, listener);
    listeners.push(() => target.removeEventListener(type, listener));
  };
  let destroyed = false;
  let state = { enabled: false, speed: 1, mode: 'follow', renderHz: 240,
    actualSimulationHz: null, actualDisplayHz: null, baseSimulationHz: 30 };
  function returnFocus(control) {
    control.blur?.();
    const game = root.querySelector?.('#game') ?? root.querySelector?.('canvas');
    game?.focus?.({ preventScroll: true });
  }
  function button(text, attributes, callback) {
    const control = document.createElement('button');
    control.type = 'button';
    control.textContent = text;
    for (const [name, value] of Object.entries(attributes)) control.setAttribute(name, value);
    listen(control, 'click', event => {
      event.stopPropagation();
      if (!state.enabled || destroyed) return;
      try { callback(); } finally { returnFocus(control); }
    });
    row.appendChild(control);
    return control;
  }
  const speedButtons = CUSTOM_SPEEDS.map(speed => button(`${speed}×`, {
    'data-speed': String(speed), title: `Simulation speed: ${speed}×`, 'aria-label': `${speed} 倍模拟速度`,
  }, () => onSpeed(speed)));
  const overview = button('全图', { 'data-action': 'overview', title: 'Overview camera' }, onOverview);
  const follow = button('跟随', { 'data-action': 'follow', title: 'Follow camera' }, onFollow);
  const rateLabel = document.createElement('label');
  rateLabel.className = 'custom-controls-row';
  const rateCaption = document.createElement('span');
  rateCaption.className = 'custom-controls-caption';
  rateCaption.textContent = '显示上限';
  rateLabel.appendChild(rateCaption);
  const rateSelect = document.createElement('select');
  rateSelect.setAttribute('data-action', 'render-rate');
  rateSelect.setAttribute('aria-label', '显示帧率上限');
  rateSelect.title = 'Display frame-rate limit; actual FPS is measured separately';
  for (const rate of CUSTOM_RENDER_RATES) {
    const option = document.createElement('option');
    option.value = String(rate);
    option.textContent = `${rate} 帧/秒`;
    rateSelect.appendChild(option);
  }
  rateLabel.appendChild(rateSelect);
  row.appendChild(rateLabel);
  listen(rateSelect, 'change', event => {
    event.stopPropagation();
    if (!state.enabled || destroyed) return;
    const rate = Number(rateSelect.value);
    try { if (CUSTOM_RENDER_RATES.includes(rate)) onRenderRate(rate); }
    finally { rateSelect.value = String(state.renderHz); returnFocus(rateSelect); }
  });
  const status = document.createElement('div');
  status.setAttribute('data-custom-status', '');
  status.title = 'Target simulation multiplier; measured simulation steps/s and displayed frames/s';
  element.appendChild(status);
  const help = document.createElement('div');
  help.className = 'custom-controls-help';
  help.textContent = '滚轮缩放 · 鼠标右键 / 中键拖动';
  element.appendChild(help);
  // Prevent game pointer actions underneath the toolbar. Keyboard events are
  // deliberately not consumed; after activating a control focus returns to game.
  for (const type of ['pointerdown', 'pointerup', 'click', 'wheel']) {
    listen(element, type, event => event.stopPropagation());
  }
  root.appendChild(element);

  function update(patch = {}) {
    if (destroyed) return;
    const next = { ...state, ...patch };
    if (typeof next.enabled !== 'boolean') throw new TypeError('enabled must be a boolean');
    if (!CUSTOM_SPEEDS.includes(next.speed)) throw new RangeError('Unsupported simulation speed');
    if (!CUSTOM_RENDER_RATES.includes(next.renderHz)) throw new RangeError('Unsupported display limit');
    if (!['follow', 'overview', 'manual'].includes(next.mode)) throw new RangeError('Unsupported camera mode');
    if (typeof next.baseSimulationHz !== 'number' || !Number.isFinite(next.baseSimulationHz) || next.baseSimulationHz <= 0) {
      throw new RangeError('baseSimulationHz must be positive');
    }
    if (patch.position !== undefined) {
      if (!patch.position || typeof patch.position !== 'object') throw new TypeError('position must be an object');
      const placements = [];
      for (const [key, property] of [['left', 'left'], ['top', 'top'], ['maxWidth', 'maxWidth']]) {
        const value = patch.position[key];
        if (value === undefined) continue;
        if (typeof value !== 'number' || !Number.isFinite(value) || (key === 'maxWidth' && value < 0)) {
          throw new RangeError(`position.${key} must be a finite CSS-pixel value`);
        }
        placements.push([property, `${value}px`]);
      }
      for (const [property, value] of placements) element.style[property] = value;
    }
    state = next;
    element.hidden = !state.enabled;
    for (let index = 0; index < speedButtons.length; index++) {
      const control = speedButtons[index];
      control.disabled = !state.enabled;
      setAttribute(control, 'aria-pressed', String(state.speed === CUSTOM_SPEEDS[index]));
    }
    for (const [control, mode] of [[overview, 'overview'], [follow, 'follow']]) {
      control.disabled = !state.enabled;
      setAttribute(control, 'aria-pressed', String(state.mode === mode));
    }
    rateSelect.disabled = !state.enabled;
    const value = String(state.renderHz);
    if (rateSelect.value !== value) rateSelect.value = value;
    setText(status, formatCustomStatus(state));
  }
  update();
  return Object.freeze({ element, update, destroy() {
    if (destroyed) return;
    destroyed = true;
    for (const removeListener of listeners) removeListener();
    element.remove();
    releaseStyle();
  } });
}
