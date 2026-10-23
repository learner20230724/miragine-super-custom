import test from 'node:test';
import assert from 'node:assert/strict';
import { createGameTextControls, gameTextLayout, GAME_TEXT_CONTROLS_CSS } from '../src/app/game-text-controls.mjs';

class Element {
  constructor(tagName, ownerDocument) {
    Object.assign(this, { tagName, ownerDocument, children: [], parentNode: null, attributes: new Map(), listeners: new Map(), hidden: false, disabled: false, focusCalls: [] });
    this.style = { setProperty(name, value) { this[name] = value; } };
  }
  set innerHTML(_) { throw new Error('Text controls must not inject HTML'); }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  appendChild(child) { child.parentNode?.removeChild(child); child.parentNode = this; this.children.push(child); return child; }
  removeChild(child) { this.children.splice(this.children.indexOf(child), 1); child.parentNode = null; }
  remove() { this.parentNode?.removeChild(this); }
  addEventListener(type, callback) { if (!this.listeners.has(type)) this.listeners.set(type, new Set()); this.listeners.get(type).add(callback); }
  removeEventListener(type, callback) { this.listeners.get(type)?.delete(callback); }
  focus(options) { this.focusCalls.push(options); this.ownerDocument.activeElement = this; }
  querySelector(selector) {
    for (const child of this.children) {
      if (selector === '#game' && child.id === 'game') return child;
      const nested = child.querySelector(selector); if (nested) return nested;
    }
    return null;
  }
  fire(type) {
    const event = { type, target: this, propagationStopped: false, stopPropagation() { this.propagationStopped = true; } };
    for (let node = this; node; node = node.parentNode) {
      for (const listener of node.listeners.get(type) ?? []) listener(event);
      if (event.propagationStopped) break;
    }
    return event;
  }
}

function setup(callbacks = {}, { head = true } = {}) {
  const document = { createElement(tag) { return new Element(tag, this); } };
  document.documentElement = document.createElement('html');
  if (head) { document.head = document.createElement('head'); document.documentElement.appendChild(document.head); }
  const root = document.createElement('main'); document.documentElement.appendChild(root);
  const game = document.createElement('canvas'); game.id = 'game'; root.appendChild(game);
  const controls = createGameTextControls({ root, ...callbacks });
  const find = action => controls.element.children.find(button => button.getAttribute('data-game-action') === action);
  return { root, document, game, controls, find };
}

const standardFit = { left: 0, top: 0, width: 640, height: 480 };

test('native game labels retain lower-left stage anchors across aspect-fit sizes and letterboxing', () => {
  assert.deepEqual(gameTextLayout(standardFit), { left: 9, top: 341, fontSize: 11 });
  for (const [scale, left, top] of [[.5, 80, 0], [1, 0, 120], [2, 100, 20], [3, 0, 0]]) {
    const fit = { width: 640 * scale, height: 480 * scale, left, top };
    const result = gameTextLayout(fit);
    assert.deepEqual(result, { left: left + 9 * scale, top: top + 341 * scale, fontSize: 11 * scale });
    assert.ok(result.left >= fit.left && result.left < fit.left + fit.width);
    assert.ok(result.top + result.fontSize * 1.7 * 3 < fit.top + 400 * scale, 'all three text rows finish above the unit-card area');
  }
});

test('invalid or unavailable canvas dimensions do not create active text hit areas', () => {
  for (const fit of [undefined, null, {}, { ...standardFit, width: 0 }, { ...standardFit, height: -1 }, { ...standardFit, width: Infinity }, { ...standardFit, height: NaN }]) assert.equal(gameTextLayout(fit), null);
  let calls = 0; const h = setup({ onPause: () => calls++ });
  h.controls.update({ visible: true, fit: { ...standardFit, width: 0 } });
  assert.equal(h.controls.element.hidden, true);
  assert.ok(h.controls.element.children.every(button => button.disabled));
  h.find('pause').fire('click'); assert.equal(calls, 0);
  h.controls.destroy();
});

test('game controls are accessible transparent text buttons, not bitmap artwork or framed launchers', () => {
  const h = setup();
  assert.equal(h.controls.element.hidden, true);
  assert.equal(h.controls.element.getAttribute('aria-label'), '游戏操作');
  assert.deepEqual(h.controls.element.children.map(button => [button.tagName, button.type, button.getAttribute('data-game-action'), button.textContent]), [
    ['button', 'button', 'pause', '暂停游戏'],
    ['button', 'button', 'tutorial', '游戏帮助'],
    ['button', 'button', 'quit', '退出游戏'],
  ]);
  assert.ok(h.controls.element.children.every(button => button.children.length === 0));
  assert.match(GAME_TEXT_CONTROLS_CSS, /border:0/);
  assert.match(GAME_TEXT_CONTROLS_CSS, /background:transparent/);
  assert.match(GAME_TEXT_CONTROLS_CSS, /box-shadow:none/);
  assert.match(GAME_TEXT_CONTROLS_CSS, /font:500 var\(--game-text-size,16px\)/);
  assert.match(GAME_TEXT_CONTROLS_CSS, /button:focus-visible/);
  assert.doesNotMatch(GAME_TEXT_CONTROLS_CSS, /url\(|transform\s*:|background-image/);
  assert.equal(h.document.head.children[0].textContent, GAME_TEXT_CONTROLS_CSS);
  h.controls.destroy();
});

test('only visible game text dispatches callbacks and returns keyboard focus to the canvas', () => {
  const calls = [], h = setup({ onPause: () => calls.push('pause'), onHelp: () => calls.push('help'), onQuit: () => calls.push('quit') });
  for (const action of ['pause', 'tutorial', 'quit']) h.find(action).fire('click');
  assert.deepEqual(calls, []); assert.equal(h.game.focusCalls.length, 0);
  h.controls.update({ visible: true, fit: standardFit });
  assert.equal(h.controls.element.hidden, false);
  assert.ok(h.controls.element.children.every(button => !button.disabled));
  assert.equal(h.controls.element.style.left, '9px');
  assert.equal(h.controls.element.style.top, '341px');
  assert.equal(h.controls.element.style['--game-text-size'], '11px');
  for (const action of ['pause', 'tutorial', 'quit']) assert.equal(h.find(action).fire('click').propagationStopped, true);
  assert.deepEqual(calls, ['pause', 'help', 'quit']);
  assert.deepEqual(h.game.focusCalls, [{ preventScroll: true }, { preventScroll: true }, { preventScroll: true }]);
  assert.equal(h.document.activeElement, h.game);
  h.controls.update({ visible: false, fit: standardFit });
  for (const action of ['pause', 'tutorial', 'quit']) h.find(action).fire('click');
  assert.deepEqual(calls, ['pause', 'help', 'quit']);
  h.controls.destroy();
});

test('pause wording follows authoritative clock state without invoking pause or toggling during redraw', () => {
  let calls = 0; const h = setup({ onPause: () => calls++ });
  for (const paused of [false, true, true, false]) {
    h.controls.update({ visible: true, paused, fit: standardFit });
    assert.equal(h.find('pause').textContent, paused ? '继续游戏' : '暂停游戏');
    assert.equal(h.find('pause').getAttribute('aria-pressed'), String(paused));
  }
  assert.equal(calls, 0);
  h.find('pause').fire('click'); assert.equal(calls, 1);
  assert.equal(h.find('pause').textContent, '暂停游戏', 'the UI waits for authoritative update instead of assuming the callback changed the clock');
  h.controls.destroy();
});

test('text interaction does not leak pointer or wheel events into battlefield camera controls', () => {
  const h = setup(), leaked = [];
  for (const type of ['pointerdown', 'pointerup', 'wheel', 'click']) h.root.addEventListener(type, () => leaked.push(type));
  h.controls.update({ visible: true, fit: standardFit });
  for (const action of ['pause', 'tutorial', 'quit']) for (const type of ['pointerdown', 'pointerup', 'wheel', 'click']) assert.equal(h.find(action).fire(type).propagationStopped, true);
  assert.deepEqual(leaked, []);
  h.controls.destroy();
});

test('teardown is idempotent, removes owned style and handlers, and keeps the game canvas intact', () => {
  let calls = 0; const h = setup({ onPause: () => calls++ });
  const pause = h.find('pause');
  h.controls.update({ visible: true, fit: standardFit });
  h.controls.destroy(); h.controls.destroy();
  pause.fire('click'); h.controls.update({ visible: true, paused: true, fit: standardFit });
  assert.equal(calls, 0);
  assert.deepEqual(h.root.children, [h.game]);
  assert.equal(h.document.head.children.length, 0);
  assert.equal(h.controls.element.parentNode, null);
  for (const button of h.controls.element.children) assert.equal([...button.listeners.values()].reduce((n, set) => n + set.size, 0), 0);
  assert.equal([...h.controls.element.listeners.values()].reduce((n, set) => n + set.size, 0), 0);
});

test('creation requires a DOM root and supports documents whose head is unavailable', () => {
  assert.throws(() => createGameTextControls(), /DOM root/);
  assert.throws(() => createGameTextControls({ root: {} }), /DOM root/);
  const h = setup({}, { head: false });
  const style = h.document.documentElement.children.find(element => element.tagName === 'style');
  assert.equal(style.getAttribute('data-game-text-style'), '');
  h.controls.destroy(); assert.equal(style.parentNode, null);
});
