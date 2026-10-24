import test from 'node:test';
import assert from 'node:assert/strict';
import { createCustomControls, normalizeSpeedInput, CUSTOM_CONTROLS_CSS, CUSTOM_SPEEDS, CUSTOM_RENDER_RATES } from '../src/app/custom-controls.mjs';

class Element {
  constructor(tag, ownerDocument) {
    Object.assign(this, { tag, ownerDocument, children: [], parentNode: null, attributes: new Map(), listeners: new Map(), style: {}, hidden: false, disabled: false, value: '' });
  }
  set innerHTML(_) { throw new Error('No injected HTML'); }
  setAttribute(key, value) { this.attributes.set(key, String(value)); }
  getAttribute(key) { return this.attributes.get(key) ?? null; }
  appendChild(child) { child.parentNode?.removeChild(child); this.children.push(child); child.parentNode = this; return child; }
  removeChild(child) { this.children.splice(this.children.indexOf(child), 1); child.parentNode = null; }
  remove() { this.parentNode?.removeChild(this); }
  addEventListener(type, callback) { if (!this.listeners.has(type)) this.listeners.set(type, new Set()); this.listeners.get(type).add(callback); }
  removeEventListener(type, callback) { this.listeners.get(type)?.delete(callback); }
  setCustomValidity(message) { this.validationMessage = message; }
  reportValidity() { throw new Error('Numeric clamping must not show a rejection popup'); }
  focus() { this.ownerDocument.activeElement = this; }
  fire(type, properties = {}) {
    const event = { type, target: this, propagationStopped: false, defaultPrevented: false,
      stopPropagation() { this.propagationStopped = true; }, preventDefault() { this.defaultPrevented = true; }, ...properties };
    for (let node = this; node; node = node.parentNode) {
      for (const callback of node.listeners.get(type) ?? []) callback(event);
      if (event.propagationStopped) break;
    }
    return event;
  }
  matches(selector) {
    const attribute = /^\[([^=\]]+)(?:="([^"]*)")?\]$/.exec(selector);
    return attribute ? (attribute[2] === undefined ? this.attributes.has(attribute[1]) : this.getAttribute(attribute[1]) === attribute[2]) : this.tag === selector;
  }
  querySelectorAll(selector) { return this.children.flatMap(child => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
}

function setup(callbacks = {}, sharedDocument = null) {
  const document = sharedDocument ?? { activeElement: null, createElement(tag) { return new Element(tag, this); } };
  if (!document.head) { document.head = document.createElement('head'); document.documentElement = document.createElement('html'); document.documentElement.appendChild(document.head); }
  const root = document.createElement('main'); document.documentElement.appendChild(root);
  const controls = createCustomControls({ root, ...callbacks });
  const find = selector => controls.playbackElement.querySelector(selector);
  return { root, document, controls, find };
}

test('v4 uses F2-only entry: compatibility launcher is permanently hidden and has no interactive children', () => {
  const calls = []; const f = setup({ onSettings: () => calls.push('settings'), onPause: () => calls.push('pause') });
  for (const settingsOpen of [false, true, false]) {
    f.controls.update({ available: true, enabled: true, settingsOpen });
    assert.equal(f.controls.element.hidden, true);
    assert.equal(f.controls.element.getAttribute('aria-hidden'), 'true');
    assert.equal(f.controls.element.children.length, 0);
    assert.equal(f.find('[data-action="settings"]'), null);
  }
  assert.deepEqual(calls, []); f.controls.destroy();
});

test('v4 time section contains speed and full-width pause; camera section follows it separately', () => {
  const f = setup();
  const sections = f.controls.playbackElement.children;
  assert.deepEqual(sections.map(section => section.getAttribute('data-control-section')), ['time', 'view']);
  for (const action of ['speed-range', 'speed-number', 'pause']) assert.ok(sections[0].querySelector(`[data-action="${action}"]`));
  for (const action of ['free', 'follow', 'overview', 'fullscreen', 'render-rate']) {
    assert.ok(sections[1].querySelector(`[data-action="${action}"]`));
    assert.equal(sections[0].querySelector(`[data-action="${action}"]`), null);
  }
  assert.equal(f.find('[data-action="pause"]').className, 'custom-controls-pause');
  assert.match(CUSTOM_CONTROLS_CSS, /custom-controls-pause\s*\{width:100%/);
  assert.match(sections[1].children.at(-1).textContent, /战场左 \/ 右 \/ 中键拖动/);
  f.controls.destroy();
});

test('v4 speed normalization clamps numeric limits and rounds decimals without a range rejection', () => {
  for (const [input, expected] of [['20.1', 20.1], ['100.1', 100], ['999999999999999999999999999999', 100], ['1e9999', 100], ['-1e9999', 0], ['-0.1', 0], ['0.15', 0.2], [' 3.7 ', 3.7], ['.5', 0.5], ['2.', 2], ['1e1', 10], ['20.000', 20], ['50', 50], ['99.95', 100]]) assert.equal(normalizeSpeedInput(input), expected, input);
  for (const invalid of ['', ' ', 'NaN', 'Infinity', '-Infinity', 'n/a', '--1', '1e', '+', '.']) assert.equal(normalizeSpeedInput(invalid), null, invalid);
});

test('speed input applies valid typing immediately while preserving intermediate edits', () => {
  const requests = []; const f = setup({ onSpeed(speed) { requests.push(speed); f.controls.update({ speed }); } });
  f.controls.update({ enabled: true });
  const input = f.find('[data-action="speed-number"]'); input.focus();
  assert.equal(input.type, 'text'); assert.equal(input.inputMode, 'decimal');
  for (const [raw, displayed, request] of [['1e9999', '100', 100], ['-1e9999', '0', 0], ['19.99', '19.99', 20], ['0.15', '0.15', 0.2], ['50', '50', 50], ['99.99', '99.99', 100]]) {
    const previous = requests.length; input.value = raw; input.fire('input');
    assert.equal(input.value, displayed); assert.equal(requests.length, previous + 1); assert.equal(requests.at(-1), request);
    input.fire('change'); assert.equal(requests.at(-1), request); assert.equal(input.value, String(request));
  }
  input.value = '1.'; input.fire('input'); f.controls.update({ actualDisplayHz: 40 }); assert.equal(input.value, '1.');
  input.value = '12.3'; const event = input.fire('keydown', { code: 'Enter' });
  assert.equal(event.defaultPrevented, true); assert.equal(requests.at(-1), 12.3);
  f.controls.destroy();
});

test('v4 empty or nonnumeric speed restores the active value with quiet help, never a validation popup', () => {
  const requests = []; const f = setup({ onSpeed: speed => requests.push(speed) }); f.controls.update({ enabled: true, speed: 4 });
  const input = f.find('[data-action="speed-number"]');
  for (const invalid of ['', 'NaN', 'Infinity', 'not a number']) {
    input.value = invalid; input.fire('change'); assert.equal(input.value, '4'); assert.equal(input.validationMessage, '');
    assert.match(f.find('[data-speed-help]').textContent, /请输入数字/);
  }
  assert.deepEqual(requests, []);
  input.value = '101'; input.fire('change'); assert.deepEqual(requests, [100]);
  assert.equal(input.value, '4'); // The caller, not the control, owns accepted state.
  assert.doesNotMatch(f.find('[data-speed-help]').textContent, /请输入数字/);
  f.controls.destroy();
});

test('v4 pause shares time section, never speed target state, and remains explicit for zero speed', () => {
  let count = 0; const f = setup({ onPause: () => count++ }); const pause = f.find('[data-action="pause"]');
  pause.fire('click'); assert.equal(count, 0);
  for (const [paused, speed, label] of [[false, 4, '暂停游戏'], [true, 4, '继续游戏'], [false, 0, '继续游戏']]) {
    f.controls.update({ enabled: true, paused, speed }); assert.equal(pause.textContent, label);
    pause.focus(); pause.fire('click'); assert.equal(f.document.activeElement, pause);
  }
  assert.equal(count, 3); f.controls.destroy();
});

test('v4 view callbacks include free/fullscreen and reflect authoritative modes including legacy manual', () => {
  const calls = []; const f = setup({ onFree: () => calls.push('free'), onFollow: () => calls.push('follow'), onOverview: () => calls.push('overview'), onFullscreen: () => calls.push('fullscreen') });
  f.controls.update({ enabled: true });
  for (const action of ['free', 'follow', 'overview', 'fullscreen']) f.find(`[data-action="${action}"]`).fire('click');
  assert.deepEqual(calls, ['free', 'follow', 'overview', 'fullscreen']);
  for (const mode of ['free', 'manual']) { f.controls.update({ mode }); assert.equal(f.find('[data-action="free"]').getAttribute('aria-pressed'), 'true'); }
  f.controls.update({ mode: 'follow', fullscreen: true });
  assert.equal(f.find('[data-action="free"]').getAttribute('aria-pressed'), 'false');
  assert.equal(f.find('[data-action="follow"]').getAttribute('aria-pressed'), 'true');
  assert.equal(f.find('[data-action="fullscreen"]').textContent, '退出全屏');
  f.controls.destroy();
});

test('v4 menu keeps fullscreen and frame limit available while disabling battle actions', () => {
  const calls = []; const f = setup({ onFullscreen: () => calls.push('fullscreen'), onRenderRate: rate => calls.push(rate), onPause: () => calls.push('pause') });
  f.controls.update({ available: true, enabled: false });
  assert.equal(f.controls.playbackElement.hidden, false);
  for (const action of ['pause', 'free', 'follow', 'overview', 'speed-number', 'speed-range']) assert.equal(f.find(`[data-action="${action}"]`).disabled, true);
  f.find('[data-action="pause"]').fire('click'); f.find('[data-action="fullscreen"]').fire('click');
  const rate = f.find('[data-action="render-rate"]');
  for (const value of CUSTOM_RENDER_RATES) { rate.value = String(value); rate.fire('change'); }
  assert.deepEqual(calls, ['fullscreen', ...CUSTOM_RENDER_RATES]);
  f.controls.destroy();
});

test('v4 all speed presets remain exact; measurements never replace target or claim 20x achieved', () => {
  const requests = []; const f = setup({ onSpeed: speed => requests.push(speed) });
  f.controls.update({ enabled: true, speed: 20, actualSimulationHz: 168, actualDisplayHz: 59.9 });
  for (const speed of CUSTOM_SPEEDS) f.find(`[data-speed="${speed}"]`).fire('click');
  assert.deepEqual(requests, [...CUSTOM_SPEEDS]);
  assert.equal(f.find('[data-custom-status]').textContent, '目标 20× · 实际模拟 168.0 步/秒（5.60×） · 实际显示 59.9 帧/秒');
  f.controls.destroy();
});

test('50x and 100x shortcuts, slider and numeric entry share the same cap and distinguish achieved speed', () => {
  const requests = []; const f = setup({ onSpeed(speed) { requests.push(speed); f.controls.update({ speed }); } });
  f.controls.update({ enabled: true, actualSimulationHz: 600, actualDisplayHz: 59.9 });
  const range = f.find('[data-action="speed-range"]'), input = f.find('[data-action="speed-number"]');
  assert.equal(range.max, '100'); assert.equal(input.max, '100');
  assert.equal(range.step, '0.1'); assert.equal(input.step, '0.1');
  assert.equal(input.getAttribute('aria-label'), '游戏倍速数值，0 到 100');
  for (const speed of [50, 100]) {
    const button = f.find(`[data-speed="${speed}"]`);
    button.fire('click');
    assert.equal(requests.at(-1), speed);
    assert.equal(button.getAttribute('aria-pressed'), 'true');
    assert.equal(range.value, String(speed)); assert.equal(input.value, String(speed));
    assert.equal(f.find('[data-custom-status]').textContent, `目标 ${speed}× · 实际模拟 600.0 步/秒（20.00×） · 实际显示 59.9 帧/秒`);
    range.value = String(speed - 0.1); range.fire('input');
    assert.equal(requests.at(-1), speed - 0.1);
    input.value = String(speed); input.fire('keydown', { code: 'Enter' });
    assert.equal(requests.at(-1), speed);
  }
  assert.match(f.find('[data-speed-help]').textContent, /高倍速受机器性能限制/);
  f.controls.destroy();
});

test('v4 dock isolates input but lets F2, F11 and Escape reach app shortcut handling', () => {
  const f = setup(); const input = f.find('[data-action="speed-number"]');
  for (const code of ['KeyI', 'KeyJ', 'Space', 'ArrowUp']) {
    assert.equal(input.fire('keydown', { code }).propagationStopped, true);
    assert.equal(input.fire('keyup', { code }).propagationStopped, true);
  }
  for (const code of ['F2', 'F11', 'Escape']) for (const type of ['keydown', 'keyup']) assert.equal(input.fire(type, { code }).propagationStopped, false);
  for (const type of ['pointerdown', 'pointerup', 'click', 'wheel']) assert.equal(input.fire(type).propagationStopped, true);
  f.controls.destroy();
});

test('v4 control teardown is idempotent and shares styles safely', () => {
  const calls = [], first = setup({ onFullscreen: () => calls.push('fullscreen') }), second = setup({}, first.document);
  assert.equal(first.document.head.querySelectorAll('[data-custom-controls-style]').length, 1);
  first.controls.update({ available: true }); const old = first.find('[data-action="fullscreen"]');
  first.controls.destroy(); first.controls.destroy(); old.fire('click'); assert.deepEqual(calls, []);
  assert.equal(first.document.head.querySelectorAll('[data-custom-controls-style]').length, 1);
  second.controls.destroy(); assert.equal(first.document.head.querySelectorAll('[data-custom-controls-style]').length, 0);
});
