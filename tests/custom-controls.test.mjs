import test from 'node:test';
import assert from 'node:assert/strict';
import { createCustomControls, formatCustomStatus, validSpeed, CUSTOM_SPEEDS, CUSTOM_RENDER_RATES } from '../src/app/custom-controls.mjs';

class FakeElement {
  constructor(tagName, ownerDocument) {
    this.tagName = tagName;
    this.ownerDocument = ownerDocument;
    this.children = [];
    this.parentNode = null;
    this.attributes = new Map();
    this.listeners = new Map();
    this.style = {};
    this.hidden = false;
    this.disabled = false;
    this.value = '';
    this.textWrites = 0;
    this.attributeWrites = 0;
  }
  set innerHTML(_value) { throw new Error('Dynamic HTML is forbidden'); }
  set textContent(value) { this.textWrites++; this.text = String(value); }
  get textContent() { return this.text ?? ''; }
  setAttribute(name, value) { this.attributeWrites++; this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  appendChild(child) { child.parentNode?.removeChild(child); this.children.push(child); child.parentNode = this; return child; }
  removeChild(child) { this.children.splice(this.children.indexOf(child), 1); child.parentNode = null; return child; }
  remove() { this.parentNode?.removeChild(this); }
  addEventListener(type, callback) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(callback);
  }
  removeEventListener(type, callback) { this.listeners.get(type)?.delete(callback); }
  focus(options) { this.ownerDocument.activeElement = this; this.focusOptions = options; }
  blur() { if (this.ownerDocument.activeElement === this) this.ownerDocument.activeElement = null; }
  fire(type, detail = {}) {
    const event = { type, target: this, currentTarget: null, defaultPrevented: false, propagationStopped: false,
      stopPropagation() { this.propagationStopped = true; }, preventDefault() { this.defaultPrevented = true; }, ...detail };
    for (let node = this; node; node = node.parentNode) {
      event.currentTarget = node;
      for (const callback of node.listeners.get(type) ?? []) callback(event);
      if (event.propagationStopped) break;
    }
    return event;
  }
  matches(selector) {
    if (selector.startsWith('#')) return this.getAttribute('id') === selector.slice(1);
    const attribute = /^\[([^=\]]+)(?:="([^"]*)")?\]$/.exec(selector);
    if (attribute) return attribute[2] === undefined ? this.attributes.has(attribute[1]) : this.getAttribute(attribute[1]) === attribute[2];
    return this.tagName === selector;
  }
  querySelectorAll(selector) {
    const result = [];
    for (const child of this.children) {
      if (child.matches(selector)) result.push(child);
      result.push(...child.querySelectorAll(selector));
    }
    return result;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
}

function fixture(callbacks = {}, document = null) {
  document ??= { activeElement: null, createElement(tag) { return new FakeElement(tag, this); } };
  if (!document.documentElement) {
    document.documentElement = document.createElement('html');
    document.head = document.createElement('head');
    document.documentElement.appendChild(document.head);
  }
  const root = document.createElement('main');
  document.documentElement.appendChild(root);
  const canvas = document.createElement('canvas');
  canvas.setAttribute('id', 'game');
  root.appendChild(canvas);
  const controls = createCustomControls({ root, ...callbacks });
  const find = selector => controls.element.querySelector(selector) ?? controls.playbackElement.querySelector(selector);
  return { document, root, canvas, controls, find };
}

test('game stage has only an empty hidden compatibility node; all controls belong to dock', () => {
  const f = fixture();
  assert.equal(f.controls.element.parentNode, f.root);
  assert.equal(f.controls.element.hidden, true);
  assert.equal(f.controls.playbackElement.parentNode, null);
  assert.equal(f.controls.element.querySelectorAll('button').length, 0);
  assert.equal(f.find('[data-action="settings"]'), null);
  assert.equal(f.controls.element.querySelector('[data-speed]'), null);
  assert.deepEqual(f.controls.playbackElement.querySelectorAll('[data-speed]').map(button => button.getAttribute('data-speed')), ['0', '1', '2', '4', '8', '12', '20', '50', '100']);
  assert.equal(f.find('[data-action="render-rate"]').value, '240');
  assert.equal(f.find('[data-action="speed-range"]').min, '0');
  assert.equal(f.find('[data-action="speed-range"]').max, '100');
  assert.equal(f.find('[data-action="speed-range"]').step, '0.1');
  assert.equal(f.find('[data-custom-status]').textContent.match(/测量中/g).length, 2);
  f.controls.destroy();
});

test('settings state does not pause; fullscreen remains available in menus while battle controls are disabled', () => {
  const calls = []; const f = fixture({ onSettings: () => calls.push('settings'), onPause: () => calls.push('pause') });
  f.controls.update({ enabled: false, available: true });
  assert.equal(f.controls.element.hidden, true);
  assert.equal(f.controls.playbackElement.hidden, false);
  assert.equal(f.find('[data-action="pause"]').disabled, true);
  assert.equal(f.find('[data-action="fullscreen"]').disabled, false);
  assert.equal(f.find('[data-action="settings"]'), null);
  f.find('[data-action="pause"]').fire('click');
  assert.deepEqual(calls, []);
  f.controls.update({ enabled: true, available: true, paused: true, settingsOpen: true });
  assert.equal(f.find('[data-action="pause"]').textContent, '继续游戏');
  assert.deepEqual(calls, []);
  f.find('[data-action="pause"]').focus(); f.find('[data-action="pause"]').fire('click');
  assert.deepEqual(calls, ['pause']); assert.equal(f.document.activeElement, f.find('[data-action="pause"]'));
  f.controls.destroy();
});

test('authoritative updates distinguish target speed, pause, measured simulation and measured display', () => {
  const f = fixture();
  f.controls.update({ enabled: true, speed: 4, mode: 'overview', renderHz: 120, actualSimulationHz: 95, actualDisplayHz: 58.5 });
  assert.equal(f.controls.element.hidden, true);
  for (const speed of CUSTOM_SPEEDS) assert.equal(f.find(`[data-speed="${speed}"]`).getAttribute('aria-pressed'), String(speed === 4));
  assert.equal(f.find('[data-action="overview"]').getAttribute('aria-pressed'), 'true');
  assert.equal(f.find('[data-action="follow"]').getAttribute('aria-pressed'), 'false');
  assert.equal(f.find('[data-action="render-rate"]').value, '120');
  assert.equal(f.find('[data-custom-status]').textContent, '实际模拟 95.0 步/秒（3.17×） · 显示 58.5 帧/秒');
  assert.equal(f.find('[data-custom-status]').getAttribute('aria-label'), '目标 4× · 实际模拟 95.0 步/秒（3.17×） · 实际显示 58.5 帧/秒');
  f.controls.update({ speed: 0, mode: 'manual' });
  assert.equal(f.find('[data-action="pause"]').textContent, '继续游戏');
  assert.match(f.find('[data-custom-status]').getAttribute('aria-label'), /目标 0×（暂停）/);
  assert.equal(f.find('[data-action="overview"]').getAttribute('aria-pressed'), 'false');
  f.controls.destroy();
});

test('all speed presets request exact multipliers without optimistic state or game focus', () => {
  const speeds = []; const f = fixture({ onSpeed: speed => speeds.push(speed) });
  f.controls.update({ enabled: true });
  for (const speed of CUSTOM_SPEEDS) {
    const button = f.find(`[data-speed="${speed}"]`); button.focus();
    assert.equal(button.fire('click').propagationStopped, true);
    assert.equal(f.document.activeElement, button);
  }
  assert.deepEqual(speeds, [0, 1, 2, 4, 8, 12, 20, 50, 100]);
  assert.equal(f.find('[data-speed="1"]').getAttribute('aria-pressed'), 'true');
  f.controls.destroy();
});

test('slider and numeric speed clamp to 0..100 by tenths and restore unacknowledged requests', () => {
  const requests = []; let acknowledge = false;
  const f = fixture({ onSpeed: value => { requests.push(value); if (acknowledge) f.controls.update({ speed: value }); } });
  f.controls.update({ enabled: true });
  const range = f.find('[data-action="speed-range"]'), number = f.find('[data-action="speed-number"]');
  range.value = '3.7'; range.fire('input'); assert.equal(range.value, '1');
  acknowledge = true; number.value = '17.9'; number.fire('change'); assert.equal(range.value, '17.9'); assert.equal(number.value, '17.9');
  number.value = '0'; number.fire('change'); assert.equal(number.value, '0');
  for (const input of ['', '20.1', '50', '100.1', '-1', '0.15', 'NaN', 'Infinity']) { number.value = input; number.fire('change'); }
  assert.deepEqual(requests, [3.7, 17.9, 0, 20.1, 50, 100, 0, 0.2]); assert.equal(number.value, '0.2');
  number.focus(); number.value = '1.'; f.controls.update({ actualDisplayHz: 45 }); assert.equal(number.value, '1.');
  for (const value of [0, 0.1, 1, 19.9, 20, 20.1, 50, 99.9, 100]) assert.equal(validSpeed(value), true);
  for (const value of [-1, 100.1, .01, NaN, Infinity, '1']) assert.equal(validSpeed(value), false);
  f.controls.destroy();
});

test('camera and frame-cap remain authoritative; dock keyboard edits do not steer game', () => {
  const actions = []; const f = fixture({ onOverview: () => actions.push('overview'), onFollow: () => actions.push('follow'), onRenderRate: rate => actions.push(rate) });
  f.controls.update({ enabled: true });
  f.find('[data-action="overview"]').fire('click'); f.find('[data-action="follow"]').fire('click');
  const select = f.find('[data-action="render-rate"]');
  for (const rate of CUSTOM_RENDER_RATES) { select.value = String(rate); select.fire('change'); }
  select.value = '999'; select.fire('change');
  assert.deepEqual(actions, ['overview', 'follow', 30, 60, 120, 240]); assert.equal(select.value, '240');
  const number = f.find('[data-action="speed-number"]');
  assert.equal(number.fire('keydown', { code: 'KeyI' }).propagationStopped, true);
  assert.equal(number.fire('keydown', { code: 'ArrowUp' }).defaultPrevented, false);
  assert.equal(number.fire('keydown', { code: 'F11' }).propagationStopped, false);
  f.controls.destroy();
});

test('disabled controls reject synthetic requests', () => {
  const calls = []; const f = fixture({ onSpeed: value => calls.push(value), onOverview: () => calls.push('overview'), onFullscreen: () => calls.push('fullscreen') });
  f.find('[data-speed="20"]').fire('click'); f.find('[data-action="overview"]').fire('click'); f.find('[data-action="fullscreen"]').fire('click');
  const input = f.find('[data-action="speed-number"]'); input.value = '12'; input.fire('change');
  assert.deepEqual(calls, []); f.controls.destroy();
});

test('legacy compatibility geometry remains valid and invalid positions are atomic', () => {
  const f = fixture();
  f.controls.update({ position: { left: 246.5, top: 137.25, maxWidth: 500 } });
  const expected = { left: '246.5px', top: '137.25px', maxWidth: '500px', bottom: 'auto' };
  assert.deepEqual(f.controls.element.style, expected);
  for (const position of [{ top: Infinity }, { maxWidth: -1 }, { left: 99, top: NaN }]) assert.throws(() => f.controls.update({ position }));
  assert.deepEqual(f.controls.element.style, expected); f.controls.destroy();
});

test('unchanged updates do not rewrite measured status or selected attributes', () => {
  const f = fixture(), patch = { enabled: true, speed: 2, actualSimulationHz: 59.8, actualDisplayHz: 120.1 };
  f.controls.update(patch); const status = f.find('[data-custom-status]'), button = f.find('[data-speed="2"]');
  const before = [status.textWrites, status.attributeWrites, button.attributeWrites];
  for (let i = 0; i < 100; i++) f.controls.update(patch);
  assert.deepEqual([status.textWrites, status.attributeWrites, button.attributeWrites], before); f.controls.destroy();
});

test('formatting preserves zero measurements and reports paused independently from target', () => {
  assert.equal(formatCustomStatus({ speed: 20, actualSimulationHz: 305.2, actualDisplayHz: 59.9 }), '目标 20× · 实际模拟 305.2 步/秒（10.17×） · 实际显示 59.9 帧/秒');
  assert.match(formatCustomStatus({ speed: 4, paused: true, actualSimulationHz: 0 }), /目标 4×（暂停） · 实际模拟 0.0 步\/秒（0.00×）/);
  for (const unknown of [undefined, null, NaN, Infinity, -1]) assert.equal(formatCustomStatus({ actualSimulationHz: unknown, actualDisplayHz: unknown }).match(/测量中/g).length, 2);
  assert.equal(formatCustomStatus({ speed: 100, actualSimulationHz: 300, actualDisplayHz: 60 }, { compact: true }), '实际模拟 300.0 步/秒（10.00×） · 显示 60.0 帧/秒');
  assert.equal(formatCustomStatus({ speed: 100 }, { compact: true }), '实际模拟 测量中 · 显示 测量中');
});

test('destroy removes launcher playback handlers and reference-counted style exactly once', () => {
  const calls = [], first = fixture({ onSpeed: speed => calls.push(speed) }), second = fixture({}, first.document);
  assert.equal(first.document.head.querySelectorAll('[data-custom-controls-style]').length, 1);
  const old = first.find('[data-speed="4"]'); first.controls.update({ enabled: true }); first.controls.destroy(); first.controls.destroy();
  old.fire('click'); first.controls.update({ enabled: true }); assert.deepEqual(calls, []);
  assert.equal(first.controls.element.parentNode, null); assert.equal(first.document.head.querySelectorAll('[data-custom-controls-style]').length, 1);
  second.controls.destroy(); assert.equal(first.document.head.querySelectorAll('[data-custom-controls-style]').length, 0);
});

test('invalid state is rejected without silently mutating controls', () => {
  assert.throws(() => createCustomControls(), /DOM root/); const f = fixture();
  for (const patch of [{ speed: 100.1 }, { speed: 1.23 }, { renderHz: 144 }, { mode: 'unknown' }, { enabled: 'yes' }, { paused: 1 }, { baseSimulationHz: 0 }]) assert.throws(() => f.controls.update(patch));
  assert.equal(f.find('[data-speed="1"]').getAttribute('aria-pressed'), 'true'); f.controls.destroy();
});
