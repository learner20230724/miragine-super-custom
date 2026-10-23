import test from 'node:test';
import assert from 'node:assert/strict';
import { createCustomControls, formatCustomStatus, CUSTOM_SPEEDS, CUSTOM_RENDER_RATES } from '../src/app/custom-controls.mjs';

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
  const find = selector => controls.element.querySelector(selector);
  return { document, root, canvas, controls, find };
}

test('toolbar starts hidden with 1x/follow/240 target defaults and stable automation selectors', () => {
  const f = fixture();
  assert.equal(f.controls.element.parentNode, f.root);
  assert.equal(f.controls.element.getAttribute('data-custom-controls'), '');
  assert.equal(f.controls.element.getAttribute('role'), 'toolbar');
  assert.equal(f.controls.element.hidden, true);
  assert.deepEqual(f.controls.element.querySelectorAll('[data-speed]').map(button => button.getAttribute('data-speed')), ['1', '2', '4', '8']);
  assert.equal(f.find('[data-speed="1"]').getAttribute('aria-pressed'), 'true');
  assert.equal(f.find('[data-action="follow"]').getAttribute('aria-pressed'), 'true');
  assert.equal(f.find('[data-action="overview"]').getAttribute('aria-pressed'), 'false');
  const rates = f.find('[data-action="render-rate"]');
  assert.deepEqual(rates.children.map(option => option.value), ['30', '60', '120', '240']);
  assert.equal(rates.value, '240');
  assert.equal(rates.disabled, true);
  const status = f.find('[data-custom-status]').textContent;
  assert.match(status, /目标 1×/);
  assert.equal(status.match(/测量中/g).length, 2);
  assert.doesNotMatch(status, /240/);
  f.controls.destroy();
});

test('authoritative updates distinguish target speed, measured simulation and measured display', () => {
  const f = fixture();
  f.controls.update({ enabled: true, speed: 4, mode: 'overview', renderHz: 120,
    actualSimulationHz: 95, actualDisplayHz: 58.5 });
  assert.equal(f.controls.element.hidden, false);
  for (const speed of CUSTOM_SPEEDS) {
    const button = f.find(`[data-speed="${speed}"]`);
    assert.equal(button.disabled, false);
    assert.equal(button.getAttribute('aria-pressed'), String(speed === 4));
  }
  assert.equal(f.find('[data-action="overview"]').getAttribute('aria-pressed'), 'true');
  assert.equal(f.find('[data-action="follow"]').getAttribute('aria-pressed'), 'false');
  assert.equal(f.find('[data-action="render-rate"]').value, '120');
  const status = f.find('[data-custom-status]').textContent;
  assert.equal(status, '目标 4× · 实际模拟 95.0 步/秒（3.17×） · 实际显示 58.5 帧/秒');
  f.controls.update({ mode: 'manual' });
  assert.equal(f.find('[data-action="overview"]').getAttribute('aria-pressed'), 'false');
  assert.equal(f.find('[data-action="follow"]').getAttribute('aria-pressed'), 'false');
  f.controls.destroy();
});

test('all speed buttons request their exact speed without optimistically changing runtime state', () => {
  const speeds = [];
  const f = fixture({ onSpeed: speed => speeds.push(speed) });
  f.controls.update({ enabled: true });
  for (const speed of CUSTOM_SPEEDS) {
    const button = f.find(`[data-speed="${speed}"]`);
    button.focus();
    const event = button.fire('click');
    assert.equal(event.propagationStopped, true);
    assert.equal(f.document.activeElement, f.canvas);
    assert.deepEqual(f.canvas.focusOptions, { preventScroll: true });
  }
  assert.deepEqual(speeds, [1, 2, 4, 8]);
  assert.equal(f.find('[data-speed="1"]').getAttribute('aria-pressed'), 'true');
  f.controls.update({ speed: 8 });
  assert.equal(f.find('[data-speed="8"]').getAttribute('aria-pressed'), 'true');
  f.controls.destroy();
});

test('camera and render-cap events stay within the toolbar and return game focus', () => {
  const actions = [];
  const f = fixture({ onOverview: () => actions.push('overview'), onFollow: () => actions.push('follow'),
    onRenderRate: rate => actions.push(rate) });
  let rootClicks = 0, rootChanges = 0;
  f.root.addEventListener('click', () => rootClicks++);
  f.root.addEventListener('change', () => rootChanges++);
  f.controls.update({ enabled: true });
  f.find('[data-action="overview"]').fire('click');
  f.find('[data-action="follow"]').fire('click');
  const select = f.find('[data-action="render-rate"]');
  for (const rate of CUSTOM_RENDER_RATES) { select.value = String(rate); select.fire('change'); }
  select.value = '999'; select.fire('change');
  assert.deepEqual(actions, ['overview', 'follow', 30, 60, 120, 240]);
  assert.equal(rootClicks, 0);
  assert.equal(rootChanges, 0);
  assert.equal(f.document.activeElement, f.canvas);
  f.controls.destroy();
});

test('pointer input is not passed through but keyboard events are not swallowed', () => {
  const f = fixture();
  f.controls.update({ enabled: true });
  const button = f.find('[data-speed="2"]');
  let pointers = 0, wheels = 0, keys = 0;
  f.root.addEventListener('pointerdown', () => pointers++);
  f.root.addEventListener('pointerup', () => pointers++);
  f.root.addEventListener('wheel', () => wheels++);
  f.root.addEventListener('keydown', () => keys++);
  for (const type of ['pointerdown', 'pointerup', 'wheel']) {
    const event = button.fire(type);
    assert.equal(event.propagationStopped, true);
    assert.equal(event.defaultPrevented, false);
  }
  const key = button.fire('keydown', { code: 'KeyD' });
  assert.equal(key.propagationStopped, false);
  assert.equal(key.defaultPrevented, false);
  assert.equal(keys, 1);
  assert.equal(pointers, 0);
  assert.equal(wheels, 0);
  f.controls.destroy();
});

test('disabled controls are hidden and cannot request changes even with synthetic events', () => {
  const calls = [];
  const f = fixture({ onSpeed: value => calls.push(value), onOverview: () => calls.push('overview'),
    onFollow: () => calls.push('follow'), onRenderRate: value => calls.push(value) });
  f.find('[data-speed="8"]').fire('click');
  f.find('[data-action="overview"]').fire('click');
  f.find('[data-action="follow"]').fire('click');
  f.find('[data-action="render-rate"]').fire('change');
  assert.deepEqual(calls, []);
  f.controls.update({ enabled: true, speed: 2 });
  f.controls.update({ enabled: false });
  assert.equal(f.controls.element.hidden, true);
  for (const button of f.controls.element.querySelectorAll('button')) assert.equal(button.disabled, true);
  assert.equal(f.find('[data-action="render-rate"]').disabled, true);
  f.controls.destroy();
});

test('position is caller-owned CSS-pixel geometry rather than screen-derived placement', () => {
  const f = fixture();
  f.controls.update({ position: { left: 246.5, top: 137.25, maxWidth: 500 } });
  assert.deepEqual(f.controls.element.style, { left: '246.5px', top: '137.25px', maxWidth: '500px' });
  f.controls.update({ position: { top: 80 } });
  assert.deepEqual(f.controls.element.style, { left: '246.5px', top: '80px', maxWidth: '500px' });
  assert.throws(() => f.controls.update({ position: { top: Infinity } }), /finite CSS-pixel/);
  assert.throws(() => f.controls.update({ position: { maxWidth: -1 } }), /finite CSS-pixel/);
  assert.throws(() => f.controls.update({ position: { left: 99, top: NaN } }), /finite CSS-pixel/);
  assert.deepEqual(f.controls.element.style, { left: '246.5px', top: '80px', maxWidth: '500px' });
  f.controls.destroy();
});

test('render-cap selection restores the authoritative value unless the runtime acknowledges a change', () => {
  let acknowledge = false;
  const f = fixture({ onRenderRate: rate => { if (acknowledge) f.controls.update({ renderHz: rate }); } });
  f.controls.update({ enabled: true });
  const select = f.find('[data-action="render-rate"]');
  select.value = '30'; select.fire('change');
  assert.equal(select.value, '240');
  acknowledge = true;
  select.value = '60'; select.fire('change');
  assert.equal(select.value, '60');
  f.controls.destroy();
});

test('unchanged updates do not rewrite status text or pressed-state attributes', () => {
  const f = fixture();
  const patch = { enabled: true, speed: 2, actualSimulationHz: 59.8, actualDisplayHz: 120.1 };
  f.controls.update(patch);
  const status = f.find('[data-custom-status]'), button = f.find('[data-speed="2"]');
  const before = [status.textWrites, button.attributeWrites];
  for (let frame = 0; frame < 100; frame++) f.controls.update(patch);
  assert.deepEqual([status.textWrites, button.attributeWrites], before);
  f.controls.destroy();
});

test('measurement formatting treats zero as a measurement and never invents unknown or invalid rates', () => {
  assert.equal(formatCustomStatus({ speed: 8, actualSimulationHz: 239.8, actualDisplayHz: 119.9 }),
    '目标 8× · 实际模拟 239.8 步/秒（7.99×） · 实际显示 119.9 帧/秒');
  assert.match(formatCustomStatus({ actualSimulationHz: 0, actualDisplayHz: 0 }), /实际模拟 0\.0 步\/秒（0\.00×） · 实际显示 0\.0 帧\/秒/);
  for (const unknown of [undefined, null, NaN, Infinity, -1]) {
    assert.equal(formatCustomStatus({ actualSimulationHz: unknown, actualDisplayHz: unknown }).match(/测量中/g).length, 2);
  }
});

test('destroy removes handlers, DOM and shared styles exactly once', () => {
  const calls = [];
  const first = fixture({ onSpeed: speed => calls.push(speed) });
  const second = fixture({}, first.document);
  assert.equal(first.document.head.querySelectorAll('[data-custom-controls-style]').length, 1);
  const oldButton = first.find('[data-speed="4"]');
  first.controls.update({ enabled: true });
  first.controls.destroy(); first.controls.destroy();
  assert.equal(first.controls.element.parentNode, null);
  assert.equal(first.document.head.querySelectorAll('[data-custom-controls-style]').length, 1);
  oldButton.fire('click');
  first.controls.update({ enabled: true });
  assert.deepEqual(calls, []);
  second.controls.destroy();
  assert.equal(first.document.head.querySelectorAll('[data-custom-controls-style]').length, 0);
});

test('invalid state is rejected instead of silently changing targets', () => {
  assert.throws(() => createCustomControls(), /DOM root/);
  const f = fixture();
  for (const patch of [{ speed: 3 }, { renderHz: 144 }, { mode: 'unknown' }, { enabled: 'yes' }, { baseSimulationHz: 0 }]) {
    assert.throws(() => f.controls.update(patch));
  }
  assert.equal(f.find('[data-speed="1"]').getAttribute('aria-pressed'), 'true');
  assert.equal(f.find('[data-action="render-rate"]').value, '240');
  f.controls.destroy();
});
