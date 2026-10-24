import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dualAIMenuItems, menuButtonState, DUAL_AI_DIFFICULTIES } from '../src/app/dual-ai-controls.mjs';
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

function assertRect(item, left, top, width, height) {
  for (const [key, expected] of Object.entries({ left, top, right: left + width, bottom: top + height })) {
    assert.ok(Math.abs(item[key] - expected) < 1e-9, `${item.action}.${key}: ${item[key]} != ${expected}`);
  }
}
const center = item => ({ x: (item.left + item.right) / 2, y: (item.top + item.bottom) / 2 });

test('canvas home entry replaces the original credits third slot without adding a fourth row', () => {
  const items = dualAIMenuItems({ panel: 'home' });
  assert.equal(items.length, 1);
  const [item] = items;
  assert.equal(item.action, 'dual-ai'); assert.equal(item.label, '双 AI 对战');
  assert.equal(item.source, 'bn_creadit'); assert.equal(item.textOverride, true); assert.equal(item.interactive, true);
  assertRect(item, 212, 328, 227, 46);
  const layout = JSON.parse(readFileSync(new URL('../generated/ui/layout.generated.json', import.meta.url), 'utf8'));
  const source = layout.sprites[55].instances.bn_creadit, parent = layout.sprites[75].instances.bn_btns;
  assertRect(item, parent.localMatrix[4] + source.bounds.xMin, parent.localMatrix[5] + source.bounds.yMin,
    source.bounds.xMax - source.bounds.xMin, source.bounds.yMax - source.bounds.yMin);
  assert.equal(item.bottom, 374); assert.ok(items.every(entry => entry.top < 384));
});

test('canvas AI setup exposes four independent original difficulty buttons per side for all sixteen pairs', () => {
  assert.deepEqual([...DUAL_AI_DIFFICULTIES], ['简单', '普通', '困难', '不可战胜']);
  const sources = ['bn_easy', 'bn_normal', 'bn_hard', 'bn_abyss'];
  for (let leftDifficulty = 0; leftDifficulty < 4; leftDifficulty++) for (let rightDifficulty = 0; rightDifficulty < 4; rightDifficulty++) {
    const options = Object.freeze({ leftDifficulty, rightDifficulty, applyDifficultyStats: true });
    const items = dualAIMenuItems({ panel: 'dual-ai', options });
    assert.equal(items.length, 11);
    for (const [side, left] of [['left', 44], ['right', 369]]) {
      const choices = items.filter(item => item.action === `dual-ai-${side}`);
      assert.deepEqual(choices.map(item => item.value).sort(), [0, 1, 2, 3]);
      for (const item of choices) {
        assert.equal(item.source, sources[item.value]);
        assert.equal(Boolean(item.selected), item.value === options[`${side}Difficulty`]);
        assert.equal(item.interactive, true); assertRect(item, left, 200 + 56 * item.value, 227, 46);
      }
    }
  }
});

test('start, recovered back button and numerical-bonus toggle have independent visible canvas hit rectangles', () => {
  for (const applyDifficultyStats of [false, true]) {
    const items = dualAIMenuItems({ panel: 'dual-ai', options: { leftDifficulty: 1, rightDifficulty: 2, applyDifficultyStats } });
    const start = items.find(item => item.action === 'dual-ai-start'), back = items.find(item => item.action === 'dual-ai-back');
    const stats = items.find(item => item.action === 'dual-ai-stats');
    assertRect(start, 206.5, 420, 227, 46); assert.equal(start.source, 'bn_sp'); assert.equal(start.label, '开始对战'); assert.equal(start.textOverride, true);
    assertRect(back, 78.3, 433.55, 31.85, 18.5); assert.equal(back.source, 'bn_back');
    assertRect(stats, 478, 425, 144, 36); assert.equal(stats.source, null);
    assert.equal(stats.label, `数值加成：${applyDifficultyStats ? '开启' : '关闭'}`); assert.equal(stats.value, !applyDifficultyStats);
    for (const [index, item] of items.entries()) {
      assert.ok(item.left >= 0 && item.right <= 640 && item.top >= 0 && item.bottom <= 480);
      for (const other of items.slice(index + 1)) {
        const overlapping = Math.max(item.left, other.left) < Math.min(item.right, other.right)
          && Math.max(item.top, other.top) < Math.min(item.bottom, other.bottom);
        assert.equal(overlapping, false, `${item.action}:${item.value} overlaps ${other.action}:${other.value}`);
      }
    }
  }
});

test('split animation interpolates the two original menu columns but disables every moving setup target', () => {
  for (const progress of [0, .25, .5, .999, 1]) {
    const items = dualAIMenuItems({ panel: 'dual-ai', progress });
    for (const item of items) assert.equal(item.interactive, progress === 1);
    for (const [side, destination] of [['left', 44], ['right', 369]]) {
      for (const item of items.filter(item => item.action === `dual-ai-${side}`)) {
        assertRect(item, 212 + (destination - 212) * progress, 200 + 56 * item.value, 227, 46);
      }
    }
  }
});

test('non-AI title panels have no custom menu targets and menu items never introduce battle recruitment actions', () => {
  for (const panel of ['difficulty', 'credits', 'game', 'over', '', null]) assert.deepEqual(dualAIMenuItems({ panel }), []);
  for (const panel of ['home', 'dual-ai']) {
    for (const item of dualAIMenuItems({ panel })) assert.doesNotMatch(item.action, /recruit|pause/);
  }
  const source = readFileSync(new URL('../src/app/dual-ai-controls.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /createElement|createDualAIControls|DUAL_AI_CONTROLS_CSS|data-dual-ai-controls/);
});

test('canvas menu hover and press state use exact action/value identity, including half-open pointer boundaries', () => {
  const items = dualAIMenuItems({ panel: 'dual-ai', options: { leftDifficulty: 1, rightDifficulty: 2 } });
  const item = items.find(item => item.action === 'dual-ai-left' && item.value === 0);
  const pointer = center(item), outside = { x: -1, y: -1 };
  assert.equal(menuButtonState(item, null, null), 'normal');
  assert.equal(menuButtonState(item, pointer, null), 'hover');
  assert.equal(menuButtonState(item, pointer, { action: item.action, value: item.value }), 'pressed');
  assert.equal(menuButtonState(item, pointer, { action: 'dual-ai-right', value: item.value }), 'hover');
  assert.equal(menuButtonState(item, pointer, { action: item.action, value: 3 }), 'hover');
  assert.equal(menuButtonState(item, outside, item), 'normal');
  assert.equal(menuButtonState(item, { x: item.left, y: item.top }, null), 'hover');
  assert.equal(menuButtonState(item, { x: item.right, y: pointer.y }, null), 'normal');
  assert.equal(menuButtonState(item, { x: pointer.x, y: item.bottom }, null), 'normal');
  for (const selected of items.filter(entry => entry.selected)) {
    assert.equal(menuButtonState(selected, outside, null), 'hover');
    assert.equal(menuButtonState(selected, center(selected), selected), 'pressed');
  }
});

test('canvas menu action payloads select both AI levels and numerical mode through the authoritative controller', () => {
  const controller = new GameController(defaults, { storage: { getItem: () => 'true' },
    createSimulation: options => new MiragineSimulation({ ...options, rng: seededRandom(8) }) });
  const items = () => dualAIMenuItems({ panel: controller.panel, options: controller.dualAIOptions });
  const click = (action, value) => {
    const item = items().find(item => item.action === action && (value === undefined || item.value === value));
    assert.ok(item, `Missing canvas target: ${action}:${value}`); assert.equal(item.interactive, true);
    assert.equal(controller.action(item.action, item.value), true);
  };
  click('dual-ai'); assert.equal(controller.panel, 'dual-ai');
  click('dual-ai-left', 3); click('dual-ai-right', 0); click('dual-ai-stats', false);
  assert.deepEqual(controller.dualAIOptions, { leftDifficulty: 3, rightDifficulty: 0, applyDifficultyStats: false });
  for (const side of ['left', 'right']) {
    assert.deepEqual(items().filter(item => item.action === `dual-ai-${side}` && item.selected).map(item => item.value),
      [controller.dualAIOptions[`${side}Difficulty`]]);
  }
  click('dual-ai-start'); assert.equal(controller.phase, 'game'); assert.equal(controller.matchMode, 'ai-vs-ai');
  assert.deepEqual(controller.simulation.dualAI.options, controller.dualAIOptions);
  controller.home(); click('dual-ai'); click('dual-ai-back'); assert.equal(controller.panel, 'home');
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
  assert.doesNotMatch(h.panel.element.textContent, /双方同档时共用该档参数/); h.panel.destroy();
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
  assert.doesNotMatch(main, /createDualAIControls|dualAIAction/);
  assert.match(main, /!frameClock\.paused \|\| controller\.matchMode === 'ai-vs-ai'/);
  assert.match(main, /syncObservationScene\(now\)/); assert.match(main, /cameraZoom\.advance\(performance\.now\(\), cameraZoomContext\(\)\)/);
  assert.match(main, /keyboard\.advanceSelection\(now/);
  const view = readFileSync(new URL('../src/app/view.mjs', import.meta.url), 'utf8');
  assert.match(view, /this\.dualAIMenu\(controller/);
  assert.doesNotMatch(view, /native DOM|native setup controls/);
  assert.match(view, /if \(placement\.name === 'bn_creadit'\) continue;/);
  assert.doesNotMatch(view, /\['bn_creadit',\s*'credits'\]/, 'old credits action must not survive below the replacement');
});

test('dual AI title draws its canvas menu instead of leaving an empty DOM setup placeholder', () => {
  const layout = JSON.parse(readFileSync(new URL('../generated/ui/layout.generated.json', import.meta.url), 'utf8'));
  const hotspots = [], composites = [], menuCalls = [];
  const view = { sprite: id => layout.sprites[id], cached() {},
    titleComponent(id, placement) { return placement.symbol; }, compositeLayer(symbol) { composites.push(symbol); },
    hotspot(action, placement) { hotspots.push({ action, placement }); },
    dualAIMenu(controller, now) { menuCalls.push({ controller, now }); },
    instance() { assert.fail('The single-player menu should not be drawn or hit-tested behind the two AI columns'); } };
  const controller = { panel: 'dual-ai', overlay: null, muted: true };
  OriginalGameView.prototype.title.call(view, controller);
  assert.deepEqual(composites, ['sprite12', 'sprite25', 'text31']);
  assert.equal(menuCalls.length, 1); assert.equal(menuCalls[0].controller, controller);
  assert.equal(Number.isFinite(menuCalls[0].now), true);
  assert.deepEqual(hotspots.map(item => item.action), ['music']);
  assert.equal(hotspots[0].placement.symbol, 'sprite25');
});
