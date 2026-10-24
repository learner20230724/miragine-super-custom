import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createDualAIControls, dualAILayout, DUAL_AI_DIFFICULTIES, DUAL_AI_CONTROLS_CSS } from '../src/app/dual-ai-controls.mjs';
import { createSettingsPanel } from '../src/app/settings-panel.mjs';
import { GameController } from '../src/app/controller.mjs';
import { OriginalGameView } from '../src/app/view.mjs';
import { createCustomization } from '../src/customization/index.mjs';
import { MiragineSimulation, seededRandom } from '../src/core/index.mjs';

class Element {
  constructor(tagName, ownerDocument) {
    Object.assign(this, { tagName, ownerDocument, children: [], parentNode: null, attributes: new Map(), listeners: new Map(), hidden: false, disabled: false, value: '', checked: false });
    this.style = { setProperty(name, value) { this[name] = value; } };
  }
  set innerHTML(_) { throw new Error('Dynamic HTML is forbidden'); }
  set textContent(value) { this.text = String(value); this.children = []; }
  get textContent() { return (this.text ?? '') + this.children.map(child => child.textContent).join(''); }
  get firstChild() { return this.children[0] ?? null; }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  appendChild(child) { child.parentNode?.removeChild(child); child.parentNode = this; this.children.push(child); return child; }
  removeChild(child) { this.children.splice(this.children.indexOf(child), 1); child.parentNode = null; return child; }
  remove() { this.parentNode?.removeChild(this); }
  addEventListener(type, callback) { if (!this.listeners.has(type)) this.listeners.set(type, new Set()); this.listeners.get(type).add(callback); }
  removeEventListener(type, callback) { this.listeners.get(type)?.delete(callback); }
  focus() { this.ownerDocument.activeElement = this; }
  matches(selector) {
    const match = /^\[([^=\]]+)(?:="([^"]*)")?\]$/.exec(selector);
    if (match) return match[2] === undefined ? this.attributes.has(match[1]) : this.getAttribute(match[1]) === match[2];
    if (selector.startsWith('#')) return this.id === selector.slice(1); return selector === this.tagName;
  }
  querySelectorAll(selector) { return this.children.flatMap(child => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
  click() { return this.fire('click'); }
  fire(type, details = {}) {
    const event = { type, target: this, propagationStopped: false, defaultPrevented: false,
      stopPropagation() { this.propagationStopped = true; }, preventDefault() { this.defaultPrevented = true; }, ...details };
    for (let node = this; node; node = node.parentNode) {
      for (const listener of node.listeners.get(type) ?? []) listener(event);
      if (event.propagationStopped) break;
    }
    return event;
  }
}
function documentFixture() {
  const document = { createElement(tag) { return new Element(tag, this); }, activeElement: null };
  document.documentElement = document.createElement('html'); document.head = document.createElement('head'); document.body = document.createElement('body');
  document.documentElement.appendChild(document.head); document.documentElement.appendChild(document.body);
  const root = document.createElement('main'); document.body.appendChild(root);
  const game = document.createElement('canvas'); game.id = 'game'; root.appendChild(game);
  return { document, root, game };
}
const fit = { left: 0, top: 0, width: 640, height: 480 };
function controlsFixture() {
  const h = documentFixture(), calls = [];
  const controls = createDualAIControls({ root: h.root, onAction: (...args) => calls.push(args) });
  const find = selector => controls.element.querySelector(selector), button = action => find(`[data-dual-ai-action="${action}"]`);
  const update = patch => controls.update({ ready: true, fit, phase: 'title', panel: 'home', ...patch });
  return { ...h, calls, controls, find, button, update };
}
const defaults = JSON.parse(readFileSync(new URL('../config/defaults.generated.json', import.meta.url), 'utf8'));
const settle = async () => { await new Promise(resolve => setImmediate(resolve)); await new Promise(resolve => setImmediate(resolve)); };
function settingsFixture(options = { leftDifficulty: 0, rightDifficulty: 3, applyDifficultyStats: true }) {
  const h = documentFixture();
  const controller = new GameController(defaults, { storage: { getItem: () => 'true' }, createSimulation: options => new MiragineSimulation({ ...options, rng: seededRandom(8) }) });
  const custom = createCustomization({ controller, defaults }); controller.startAIMatch(options);
  const panel = createSettingsPanel({ root: h.root, customization: custom, confirm: () => true });
  const find = selector => panel.element.querySelector(selector), button = action => find(`[data-settings-action="${action}"]`);
  const tab = name => button(`tab-${name}`).click(); panel.open();
  return { ...h, controller, custom, panel, find, button, tab };
}

test('dual AI entry stays below original menu while scaled HUD stays above unit cards and lower controls', () => {
  for (const [scale, left, top] of [[.5, 10, 80], [1, 0, 0], [2, 80, 0], [3, 0, 40]]) {
    const layout = dualAILayout({ left, top, width: 640 * scale, height: 480 * scale });
    assert.equal(layout.left, left); assert.equal(layout.top, top);
    assert.equal(layout.entry.top, 384 * scale); assert.ok(layout.entry.top >= 374 * scale);
    assert.ok(layout.entry.top + layout.entry.height < 480 * scale);
    assert.ok(layout.panel.top + layout.panel.height < 480 * scale);
    for (const side of ['leftSide', 'rightSide']) {
      assert.ok(layout[side].top >= 96 * scale);
      assert.ok(layout[side].top + layout[side].height < 341 * scale);
      assert.ok(layout[side].left + layout[side].width <= 640 * scale);
    }
    assert.ok(layout.leftSide.left + layout.leftSide.width < layout.rightSide.left);
  }
  for (const value of [null, {}, { ...fit, width: 0 }, { ...fit, height: NaN }, { ...fit, left: Infinity }]) assert.equal(dualAILayout(value), null);
});

test('title mode entry is native text with isolated action namespace and native keyboard ownership', () => {
  const h = controlsFixture(); assert.equal(h.controls.element.hidden, true);
  h.update(); assert.equal(h.controls.element.hidden, false); assert.equal(h.button('dual-ai').hidden, false);
  assert.equal(h.controls.element.getAttribute('data-game-text-controls'), '');
  assert.equal(h.button('dual-ai').getAttribute('data-game-action'), null);
  h.button('dual-ai').click(); assert.deepEqual(h.calls, [['dual-ai', undefined]]); assert.equal(h.document.activeElement, h.game);
  assert.match(DUAL_AI_CONTROLS_CSS, /pointer-events:none/); assert.match(DUAL_AI_CONTROLS_CSS, /focus-visible/);
  h.controls.destroy();
});

test('four independent AI difficulties and numerical-bonus checkbox dispatch authoritative options without resetting native focus', () => {
  const h = controlsFixture(); h.update({ panel: 'dual-ai', options: { leftDifficulty: 0, rightDifficulty: 3, applyDifficultyStats: false } });
  const left = h.find('[data-dual-ai-difficulty="left"]'), right = h.find('[data-dual-ai-difficulty="right"]'), stats = h.find('[data-dual-ai-stats]');
  assert.deepEqual(left.children.map(item => item.textContent), [...DUAL_AI_DIFFICULTIES]);
  assert.equal(left.value, '0'); assert.equal(right.value, '3'); assert.equal(stats.checked, false);
  left.focus(); left.value = '2'; left.fire('change');
  assert.equal(h.document.activeElement, left); assert.deepEqual(h.calls.at(-1), ['dual-ai-left', 2]);
  h.update({ panel: 'dual-ai', options: { leftDifficulty: 0, rightDifficulty: 1 } }); assert.equal(left.value, '2'); assert.equal(right.value, '1');
  right.value = '0'; right.fire('change'); stats.checked = true; stats.fire('change');
  assert.deepEqual(h.calls.slice(-2), [['dual-ai-right', 0], ['dual-ai-stats', true]]);
  h.button('dual-ai-start').click(); assert.deepEqual(h.calls.at(-1), ['dual-ai-start', undefined]);
  h.controls.destroy();
});

test('AI recruitment controls are separate, operate while global time is paused, and only follow confirmed state', () => {
  const h = controlsFixture(), battle = { phase: 'game', matchMode: 'ai-vs-ai', paused: true, options: { leftDifficulty: 3, rightDifficulty: 0 }, recruitment: { left: true, right: false } };
  h.update(battle);
  assert.equal(h.find('[data-dual-ai-status="left"]').textContent, '红方 AI · 不可战胜');
  assert.equal(h.find('[data-dual-ai-status="right"]').textContent, '蓝方 AI · 简单');
  const left = h.button('dual-ai-recruit-left'), right = h.button('dual-ai-recruit-right');
  assert.equal(left.textContent, '暂停出兵'); assert.equal(right.textContent, '开始出兵');
  left.click(); right.click(); assert.deepEqual(h.calls, [['dual-ai-recruit-left', false], ['dual-ai-recruit-right', true]]);
  assert.equal(left.textContent, '暂停出兵', 'do not invent state until next authoritative update');
  h.update({ ...battle, recruitment: { left: false, right: true } });
  assert.equal(left.textContent, '开始出兵'); assert.equal(left.getAttribute('aria-pressed'), 'true');
  assert.equal(right.getAttribute('aria-label'), '暂停蓝方出兵'); h.controls.destroy();
});

test('hidden, setup-only, original-mode, overlay and confirming controls never dispatch gameplay actions', () => {
  const h = controlsFixture();
  for (const patch of [{ ready: false }, { overlay: 'credits' }, { confirming: true }, { fit: null }, { phase: 'game', matchMode: 'single' }, { phase: 'over', matchMode: 'ai-vs-ai' }, { phase: 'game', matchMode: 'ai-vs-ai', winner: 'left' }]) {
    h.update(patch); assert.equal(h.controls.element.hidden, true);
    for (const action of ['dual-ai', 'dual-ai-start', 'dual-ai-back', 'dual-ai-recruit-left', 'dual-ai-recruit-right']) h.button(action).click();
  }
  assert.deepEqual(h.calls, []);
  h.update({ panel: 'dual-ai' }); h.button('dual-ai').click(); h.button('dual-ai-recruit-left').click();
  h.update({ phase: 'game', matchMode: 'ai-vs-ai' }); h.button('dual-ai-start').click(); h.button('dual-ai-back').click();
  assert.deepEqual(h.calls, []); h.controls.destroy();
});

test('native dual AI pointer and wheel actions cannot leak into battlefield camera handlers; teardown owns no canvas', () => {
  const h = controlsFixture(), leaks = [];
  for (const type of ['pointerdown', 'pointerup', 'wheel', 'click']) h.root.addEventListener(type, () => leaks.push(type));
  h.update(); const entry = h.button('dual-ai');
  for (const type of ['pointerdown', 'pointerup', 'wheel']) assert.equal(entry.fire(type).propagationStopped, true);
  assert.deepEqual(leaks, []); h.controls.destroy(); h.controls.destroy(); entry.click();
  assert.deepEqual(h.calls, []); assert.deepEqual(h.root.children, [h.game]); assert.equal(h.document.head.children.length, 0);
});

test('dual AI settings summary identifies two difficulties and hides misleading original blue-only AI and crystal damage', () => {
  const h = settingsFixture();
  const summary = h.find('[data-battle-summary]').textContent;
  assert.match(summary, /双 AI 对战：红方.*简单.*蓝方.*不可战胜/); assert.match(summary, /分别使用所选难度/); assert.doesNotMatch(summary, /本局难度：/);
  assert.equal(h.find('[data-live-ai]'), null);
  assert.equal(h.find('[data-live-field-path="config.rules.baseDamage.0"]'), null);
  assert.equal(h.find('[data-live-field-path="config.difficulties.3.blueBaseDamage.0"]'), null);
  assert.ok(h.find('[data-live-field-path="config.sides.left.base.range"]'));
  assert.ok(h.find('[data-live-field-path="config.sides.right.base.hp"]'));
  assert.match(h.panel.element.textContent, /双方同档时共用该档参数/); h.panel.destroy();
});

test('dual AI settings new-match controls preserve the current two difficulties and numerical mode', async () => {
  const h = settingsFixture({ leftDifficulty: 2, rightDifficulty: 0, applyDifficultyStats: false });
  h.tab('starting');
  assert.equal(h.find('[data-start-mode="ai-vs-ai"]').getAttribute('aria-pressed'), 'true');
  assert.equal(h.find('[data-start-ai-left="2"]').getAttribute('aria-pressed'), 'true');
  assert.equal(h.find('[data-start-ai-right="0"]').getAttribute('aria-pressed'), 'true');
  assert.equal(h.find('[data-start-ai-stats]').checked, false);
  assert.equal(h.find('[data-field-path="rules.enemyAi"]'), null);
  h.button('start-battle').click(); await settle();
  assert.equal(h.controller.matchMode, 'ai-vs-ai');
  assert.deepEqual(h.controller.dualAIOptions, { leftDifficulty: 2, rightDifficulty: 0, applyDifficultyStats: false }); h.panel.destroy();
});

test('new AI difficulties persist across settings tabs and can intentionally switch back to original single or two-player modes', async () => {
  const h = settingsFixture(); h.tab('starting');
  h.find('[data-start-ai-left="3"]').click(); h.find('[data-start-ai-right="1"]').click();
  h.tab('units'); h.tab('starting'); assert.equal(h.find('[data-start-ai-left="3"]').getAttribute('aria-pressed'), 'true');
  h.find('[data-start-mode="false"]').click();
  assert.equal(h.find('[data-start-ai-left="3"]'), null); assert.ok(h.find('[data-start-difficulty="1"]'));
  h.find('[data-start-difficulty="2"]').click(); h.button('start-battle').click(); await settle();
  assert.equal(h.controller.matchMode, 'dual'); assert.equal(h.controller.difficulty, 2); h.panel.destroy();
});

test('decision-only AI matches clearly state both numerical profiles use ordinary difficulty', () => {
  const h = settingsFixture({ leftDifficulty: 0, rightDifficulty: 3, applyDifficultyStats: false });
  assert.match(h.find('[data-battle-summary]').textContent, /双方当前普通档（仅 AI 选兵难度不同）/); h.panel.destroy();
});

test('open starting tab rebinds to a native replacement AI match without reusing stale difficulties', async () => {
  const h = settingsFixture(); h.tab('starting');
  h.controller.home(); h.controller.startAIMatch({ leftDifficulty: 2, rightDifficulty: 1, applyDifficultyStats: false });
  h.panel.update();
  assert.equal(h.find('[data-start-ai-left="2"]').getAttribute('aria-pressed'), 'true');
  assert.equal(h.find('[data-start-ai-right="1"]').getAttribute('aria-pressed'), 'true');
  assert.equal(h.find('[data-start-ai-stats]').checked, false);
  // Intentional pending new-match options within the same match remain intact.
  h.find('[data-start-ai-left="0"]').click(); h.panel.update(); h.panel.update();
  assert.equal(h.find('[data-start-ai-left="0"]').getAttribute('aria-pressed'), 'true');
  h.button('start-battle').click(); await settle();
  assert.deepEqual(h.controller.dualAIOptions, { leftDifficulty: 0, rightDifficulty: 1, applyDifficultyStats: false }); h.panel.destroy();
});

test('open starting tab follows native single-to-AI and AI-to-dual changes without requiring tab navigation', async () => {
  const h = settingsFixture(); h.controller.startMatch(true, 2); h.panel.update(); h.tab('starting');
  assert.equal(h.find('[data-start-mode="true"]').getAttribute('aria-pressed'), 'true');
  h.controller.startAIMatch({ leftDifficulty: 1, rightDifficulty: 3, applyDifficultyStats: false }); h.panel.update();
  assert.equal(h.find('[data-start-mode="ai-vs-ai"]').getAttribute('aria-pressed'), 'true');
  assert.equal(h.find('[data-start-ai-right="3"]').getAttribute('aria-pressed'), 'true');
  h.controller.startMatch(false, 3); h.panel.update();
  assert.equal(h.find('[data-start-mode="false"]').getAttribute('aria-pressed'), 'true');
  assert.equal(h.find('[data-start-difficulty="3"]').getAttribute('aria-pressed'), 'true');
  assert.equal(h.find('[data-start-ai-stats]'), null); h.panel.destroy();
});

test('dual AI main wiring retains held smooth camera and selection-repeat guards without mutating original modes', () => {
  const main = readFileSync(new URL('../src/app/main.mjs', import.meta.url), 'utf8');
  assert.match(main, /createDualAIControls\(\{ root: stage, onAction: dualAIAction \}\)/);
  assert.match(main, /function dualAIAction\(action, value\)[\s\S]*?settings\?\.isConfirming/);
  assert.match(main, /!frameClock\.paused \|\| controller\.matchMode === 'ai-vs-ai'/);
  assert.match(main, /syncObservationScene\(now\)/); assert.match(main, /cameraZoom\.advance\(performance\.now\(\), cameraZoomContext\(\)\)/);
  assert.match(main, /keyboard\.advanceSelection\(now/);
  const view = readFileSync(new URL('../src/app/view.mjs', import.meta.url), 'utf8');
  assert.match(view, /controller\.panel === 'dual-ai' && !controller\.overlay[\s\S]*?this\.hotspot\('music'[\s\S]*?return;/);
});

test('dual AI title setup never draws or registers the original menu beneath native setup controls', () => {
  const layout = JSON.parse(readFileSync(new URL('../generated/ui/layout.generated.json', import.meta.url), 'utf8'));
  const hotspots = [], composites = [];
  const view = { sprite: id => layout.sprites[id], cached() {},
    titleComponent(id, placement) { return placement.symbol; }, compositeLayer(symbol) { composites.push(symbol); },
    hotspot(action, placement) { hotspots.push({ action, placement }); },
    instance() { assert.fail('The original menu should not be drawn or hit-tested under native dual AI setup'); } };
  OriginalGameView.prototype.title.call(view, { panel: 'dual-ai', overlay: null, muted: true });
  assert.deepEqual(composites, ['sprite12', 'sprite25', 'text31']);
  assert.deepEqual(hotspots.map(item => item.action), ['music']);
  assert.equal(hotspots[0].placement.symbol, 'sprite25');
});
