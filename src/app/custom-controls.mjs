import { MAX_GAME_SPEED } from '../runtime/game-clock.mjs';

export const CUSTOM_SPEEDS = Object.freeze([0, 1, 2, 4, 8, 12, 20, 50, MAX_GAME_SPEED]);
export const CUSTOM_RENDER_RATES = Object.freeze([30, 60, 120, 240]);

export const CUSTOM_CONTROLS_CSS = `
[data-custom-controls], [data-playback-controls] {box-sizing:border-box;color:#edf1e6;font:13px/1.45 OriginalYahei,'Microsoft YaHei',Arial,sans-serif;font-variant-numeric:tabular-nums;user-select:none;pointer-events:auto}
[data-custom-controls] {display:none!important}
[data-playback-controls] {padding:12px 14px;display:flex;flex-direction:column;gap:12px;background:#17211e;border-bottom:1px solid #34443b}
[data-custom-controls][hidden],[data-playback-controls][hidden] {display:none!important}
[data-custom-controls] button,[data-playback-controls] button,[data-playback-controls] select,[data-playback-controls] input {box-sizing:border-box;min-height:30px;margin:0;padding:4px 8px;color:inherit;background:#29362b;border:1px solid #657052;border-radius:5px;font:inherit}
[data-custom-controls] button {background:#1e2b21ed;border-color:#a0a27b;font-size:12px;cursor:pointer;box-shadow:0 1px 6px #0006}
[data-playback-controls] button,[data-playback-controls] select {cursor:pointer}
[data-playback-controls] .custom-controls-row {display:flex;align-items:center;gap:6px;flex-wrap:wrap}
[data-playback-controls] .custom-controls-section {display:flex;flex-direction:column;gap:9px;padding:10px;border:1px solid #52604d;border-radius:7px;background:#1b2821}
[data-playback-controls] .custom-controls-section h3 {margin:0;font:inherit;font-size:14px;font-weight:700;color:#f0ddb2}
[data-playback-controls] .custom-controls-pause {width:100%;min-height:39px;font-size:15px;font-weight:600}
[data-playback-controls] .custom-controls-speed-row {display:grid;grid-template-columns:1fr 76px;gap:8px;align-items:center}
[data-playback-controls] input[type=range] {width:100%;padding:0;accent-color:#d7b66b;cursor:pointer}
[data-playback-controls] [data-action=speed-number] {width:76px}
[data-playback-controls] button[aria-pressed=true],[data-custom-controls] button[aria-pressed=true] {background:#716033;border-color:#e6c170}
[data-custom-controls] button:focus-visible,[data-playback-controls] :is(button,select,input):focus-visible {outline:2px solid #f0cb78;outline-offset:2px}
[data-custom-controls] button:disabled,[data-playback-controls] :disabled {opacity:.5;cursor:default}
[data-playback-controls] .custom-controls-caption {font-weight:600;color:#f0ddb2}
[data-playback-controls] .custom-controls-help {font-size:11px;color:#a9b9aa}
[data-custom-status] {font-size:12px;line-height:1.5;color:#c3d1c2}
`;

const styleEntries = new WeakMap();
function acquireStyle(document) {
  let entry = styleEntries.get(document);
  if (!entry) {
    const element = document.createElement('style');
    element.setAttribute('data-custom-controls-style', ''); element.textContent = CUSTOM_CONTROLS_CSS;
    (document.head ?? document.documentElement).appendChild(element);
    entry = { element, count: 0 }; styleEntries.set(document, entry);
  }
  entry.count++;
  return () => { if (--entry.count === 0) { entry.element.remove(); styleEntries.delete(document); } };
}
function isRate(value) { return typeof value === 'number' && Number.isFinite(value) && value >= 0; }
export function validSpeed(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= MAX_GAME_SPEED
    && Math.abs(value * 10 - Math.round(value * 10)) < 1e-8;
}
// Accept ordinary decimal/scientific numeric input, including finite-looking text
// that exceeds Number.MAX_VALUE. Such positive / negative overflow clamps to the
// permitted endpoint; literal Infinity / NaN are not editable numbers.
export function normalizeSpeedInput(value) {
  const text = String(value).trim();
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(text)) return null;
  const number = Number(text);
  return Math.round(Math.max(0, Math.min(MAX_GAME_SPEED, number)) * 10) / 10;
}
/** Target multiplier is never substituted for measured work or display frequency. */
export function formatCustomStatus({ speed = 1, paused = false, actualSimulationHz = null, actualDisplayHz = null,
  baseSimulationHz = 30 } = {}) {
  const simulation = isRate(actualSimulationHz)
    ? `${actualSimulationHz.toFixed(1)} 步/秒${baseSimulationHz > 0 && Number.isFinite(baseSimulationHz)
      ? `（${(actualSimulationHz / baseSimulationHz).toFixed(2)}×）` : ''}` : '测量中';
  const display = isRate(actualDisplayHz) ? `${actualDisplayHz.toFixed(1)} 帧/秒` : '测量中';
  return `目标 ${speed}×${paused || speed === 0 ? '（暂停）' : ''} · 实际模拟 ${simulation} · 实际显示 ${display}`;
}
function setText(element, value) { if (element.textContent !== value) element.textContent = value; }
function setAttribute(element, name, value) { if (element.getAttribute(name) !== value) element.setAttribute(name, value); }

/** Dock-only controls. F2 is handled by the app; element is a hidden compatibility node. */
export function createCustomControls({ root, onSpeed = () => {}, onOverview = () => {}, onFollow = () => {},
  onFree = () => {}, onFullscreen = () => {}, onRenderRate = () => {}, onSettings = () => {}, onPause = () => {} } = {}) {
  const document = root?.ownerDocument;
  if (!root || typeof root.appendChild !== 'function' || !document?.createElement) throw new TypeError('A game-stage DOM root is required');
  for (const callback of [onSpeed, onOverview, onFollow, onFree, onFullscreen, onRenderRate, onSettings, onPause]) {
    if (typeof callback !== 'function') throw new TypeError('Control callbacks must be functions');
  }
  const releaseStyle = acquireStyle(document), listeners = [];
  const node = (tag, text) => { const result = document.createElement(tag); if (text !== undefined) result.textContent = text; return result; };
  const listen = (target, type, listener) => {
    target.addEventListener(type, listener); listeners.push(() => target.removeEventListener(type, listener));
  };
  const element = node('div'); element.setAttribute('data-custom-controls', '');
  element.hidden = true; element.setAttribute('aria-hidden', 'true');
  const playbackElement = node('section'); playbackElement.setAttribute('data-playback-controls', '');
  playbackElement.setAttribute('aria-label', '时间控制与视角显示');
  let destroyed = false;
  let state = { available: false, enabled: false, speed: 1, paused: false, settingsOpen: false, mode: 'follow',
    fullscreen: false, renderHz: 240, actualSimulationHz: null, actualDisplayHz: null, baseSimulationHz: 30 };
  function button(parent, label, attributes, callback) {
    const control = node('button', label); control.type = 'button';
    for (const [key, value] of Object.entries(attributes)) control.setAttribute(key, value);
    listen(control, 'click', event => {
      event.stopPropagation(); if (destroyed || control.disabled) return;
      callback();
    }); parent.appendChild(control); return control;
  }
  function section(name, title) {
    const host = node('section'); host.className = 'custom-controls-section';
    host.setAttribute('data-control-section', name); host.setAttribute('aria-label', title);
    host.appendChild(node('h3', title)); playbackElement.appendChild(host); return host;
  }
  const timeSection = section('time', '时间控制');
  const caption = node('div', '游戏倍速 · 逻辑步长保持 30 Hz'); caption.className = 'custom-controls-caption'; timeSection.appendChild(caption);
  const speedRow = node('div'); speedRow.className = 'custom-controls-speed-row'; timeSection.appendChild(speedRow);
  const range = node('input'); range.type = 'range'; range.min = '0'; range.max = String(MAX_GAME_SPEED); range.step = '0.1';
  range.setAttribute('aria-label', '游戏倍速滑块，0 为暂停'); range.setAttribute('data-action', 'speed-range'); speedRow.appendChild(range);
  // Text + decimal inputMode keeps very large pasted numeric text intact until
  // we clamp it. Native number inputs can sanitize overflow to an empty value.
  const numeric = node('input'); numeric.type = 'text'; numeric.min = '0'; numeric.max = String(MAX_GAME_SPEED); numeric.step = '0.1'; numeric.inputMode = 'decimal';
  numeric.setAttribute('aria-label', `游戏倍速数值，0 到 ${MAX_GAME_SPEED}`); numeric.setAttribute('data-action', 'speed-number'); speedRow.appendChild(numeric);
  function changeSpeed(control) {
    if (!state.enabled || destroyed) return;
    const number = normalizeSpeedInput(control.value);
    if (number !== null) {
      numeric.setCustomValidity?.(''); setText(speedHelp, '0 倍即暂停；高倍速受机器性能限制。'); onSpeed(number);
    } else {
      // No range-rejection popup: real numbers clamp. Empty / nonnumeric text is
      // restored to the active speed with a quiet, specific instruction instead.
      numeric.setCustomValidity?.(''); setText(speedHelp, '请输入数字；已恢复当前倍速。');
    }
    range.value = String(state.speed); numeric.value = String(state.speed);
  }
  listen(range, 'input', event => { event.stopPropagation(); changeSpeed(range); });
  listen(numeric, 'input', event => {
    event.stopPropagation(); if (!state.enabled || destroyed) return;
    const raw = numeric.value, value = normalizeSpeedInput(raw);
    numeric.setCustomValidity?.('');
    // Keep partial edits and ordinary decimals intact until committed, while a
    // genuinely excessive number is visibly clamped as soon as it is entered.
    if (value !== null && (Number(raw) < 0 || Number(raw) > MAX_GAME_SPEED)) numeric.value = String(value);
    // A valid typed value behaves like the slider immediately. Do not replace
    // the editing text/caret: partial decimals and exponents remain editable.
    if (value !== null && value !== state.speed) onSpeed(value);
  });
  listen(numeric, 'change', event => { event.stopPropagation(); changeSpeed(numeric); });
  listen(numeric, 'keydown', event => {
    if (event.code === 'Enter' || event.code === 'NumpadEnter') {
      event.preventDefault(); event.stopPropagation(); changeSpeed(numeric);
    }
  });
  const presets = node('div'); presets.className = 'custom-controls-row'; timeSection.appendChild(presets);
  const speedButtons = CUSTOM_SPEEDS.map(speed => button(presets, `${speed}×`,
    { 'data-speed': String(speed), 'aria-label': speed === 0 ? '零倍速，暂停' : `${speed} 倍模拟速度` }, () => onSpeed(speed)));
  const pause = button(timeSection, '暂停游戏', { 'data-action': 'pause', 'aria-label': '暂停游戏' }, onPause);
  pause.className = 'custom-controls-pause';
  const status = node('div'); status.setAttribute('data-custom-status', ''); timeSection.appendChild(status);
  const speedHelp = node('div', '0 倍即暂停；高倍速受机器性能限制。');
  speedHelp.className = 'custom-controls-help'; speedHelp.setAttribute('data-speed-help', ''); timeSection.appendChild(speedHelp);
  const viewSection = section('view', '视角与显示');
  const row = node('div'); row.className = 'custom-controls-row'; viewSection.appendChild(row);
  const free = button(row, '自由观察', { 'data-action': 'free', title: '保持当前视角，自行移动和缩放' }, onFree);
  const follow = button(row, '跟随', { 'data-action': 'follow' }, onFollow);
  const overview = button(row, '全图', { 'data-action': 'overview', title: '紧凑战场全景，保持原斜视角' }, onOverview);
  const fullscreen = button(row, '全屏', { 'data-action': 'fullscreen', title: '进入或退出全屏（F11）' }, onFullscreen);
  const rateLabel = node('label'); rateLabel.className = 'custom-controls-row'; rateLabel.appendChild(node('span', '显示上限'));
  const rateSelect = node('select'); rateSelect.setAttribute('data-action', 'render-rate'); rateSelect.setAttribute('aria-label', '显示帧率上限');
  for (const rate of CUSTOM_RENDER_RATES) { const option = node('option', `${rate} 帧/秒`); option.value = String(rate); rateSelect.appendChild(option); }
  rateLabel.appendChild(rateSelect); viewSection.appendChild(rateLabel);
  listen(rateSelect, 'change', event => {
    event.stopPropagation(); if (!state.available || destroyed) return;
    const rate = Number(rateSelect.value); if (CUSTOM_RENDER_RATES.includes(rate)) onRenderRate(rate);
    rateSelect.value = String(state.renderHz);
  });
  const help = node('div', '按住 U / O 平滑放大 / 缩小（每秒 ×2 / ×0.5，松开即停，双键抵消，战场中心）· 滚轮缩放（鼠标位置）· 战场左 / 右 / 中键拖动 · IJKL 移动视角。WASD / 方向键选兵：首按立即，350 ms 后每 85 ms 连选；编辑参数时不抢键。显示上限受屏幕与机器性能限制。');
  help.className = 'custom-controls-help'; viewSection.appendChild(help);
  for (const host of [element, playbackElement]) {
    for (const type of ['pointerdown', 'pointerup', 'click', 'wheel']) listen(host, type, event => event.stopPropagation());
  }
  // Inputs in the dock retain native editing / arrow-key behavior without steering the game.
  for (const type of ['keydown', 'keyup']) listen(playbackElement, type, event => {
    if (event.code !== 'F2' && event.code !== 'Escape' && event.code !== 'F11') event.stopPropagation();
  });
  root.appendChild(element);
  function update(patch = {}) {
    if (destroyed) return;
    const next = { ...state, ...patch };
    if (patch.available === undefined && patch.enabled !== undefined) next.available = patch.enabled;
    for (const flag of ['enabled', 'available', 'paused', 'settingsOpen', 'fullscreen']) if (typeof next[flag] !== 'boolean') throw new TypeError(`${flag} must be a boolean`);
    if (!validSpeed(next.speed)) throw new RangeError(`Simulation speed must be 0 to ${MAX_GAME_SPEED} in 0.1 increments`);
    if (!CUSTOM_RENDER_RATES.includes(next.renderHz)) throw new RangeError('Unsupported display limit');
    if (!['follow', 'overview', 'manual', 'free'].includes(next.mode)) throw new RangeError('Unsupported camera mode');
    if (typeof next.baseSimulationHz !== 'number' || !Number.isFinite(next.baseSimulationHz) || next.baseSimulationHz <= 0) throw new RangeError('baseSimulationHz must be positive');
    if (patch.position !== undefined) {
      if (!patch.position || typeof patch.position !== 'object') throw new TypeError('position must be an object');
      const positions = [];
      for (const key of ['left', 'top', 'maxWidth']) {
        const value = patch.position[key]; if (value === undefined) continue;
        if (!Number.isFinite(value) || typeof value !== 'number' || (key === 'maxWidth' && value < 0)) throw new RangeError(`position.${key} must be a finite CSS-pixel value`);
        positions.push([key, `${value}px`]);
      }
      for (const [key, value] of positions) element.style[key] = value;
      if (patch.position.top !== undefined) element.style.bottom = 'auto';
    }
    state = next; element.hidden = true; playbackElement.hidden = !state.available;
    pause.disabled = !state.enabled;
    const stopped = state.paused || state.speed === 0;
    setText(pause, stopped ? '继续游戏' : '暂停游戏'); setAttribute(pause, 'aria-label', stopped ? '继续游戏' : '暂停游戏'); setAttribute(pause, 'aria-pressed', String(stopped));
    for (let index = 0; index < speedButtons.length; index++) {
      speedButtons[index].disabled = !state.enabled;
      setAttribute(speedButtons[index], 'aria-pressed', String(state.speed === CUSTOM_SPEEDS[index]));
    }
    range.disabled = numeric.disabled = !state.enabled; range.value = String(state.speed);
    if (document.activeElement !== numeric) numeric.value = String(state.speed);
    for (const [control, mode] of [[free, 'free'], [overview, 'overview'], [follow, 'follow']]) {
      control.disabled = !state.enabled; setAttribute(control, 'aria-pressed', String((state.mode === 'manual' ? 'free' : state.mode) === mode));
    }
    fullscreen.disabled = !state.available;
    setText(fullscreen, state.fullscreen ? '退出全屏' : '全屏');
    setAttribute(fullscreen, 'aria-pressed', String(state.fullscreen));
    rateSelect.disabled = !state.available; rateSelect.value = String(state.renderHz);
    setText(status, formatCustomStatus(state));
  }
  update();
  return Object.freeze({ element, playbackElement, update, destroy() {
    if (destroyed) return; destroyed = true; for (const remove of listeners) remove();
    element.remove(); playbackElement.remove(); releaseStyle();
  } });
}
