import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createSettingsPanel, parseFieldValue } from '../src/app/settings-panel.mjs';
import { createCustomization } from '../src/customization/index.mjs';
import { GameController } from '../src/app/controller.mjs';
import { MiragineSimulation, seededRandom } from '../src/core/index.mjs';

const defaults = JSON.parse(readFileSync(new URL('../config/defaults.generated.json', import.meta.url), 'utf8'));

// Deliberately reject innerHTML and the read-only textarea.type property, as the
// browser does. Tests drive actual panel handlers and the real customization API.
class Element {
  constructor(tag, doc) {
    this.tagName = tag; this.ownerDocument = doc; this.children = []; this.parentNode = null;
    this.attributes = new Map(); this.listeners = new Map(); this.value = ''; this.checked = false;
    this.hidden = false; this.disabled = false; this.style = {};
  }
  set innerHTML(value) { throw new Error(`Dynamic HTML forbidden: ${value}`); }
  get type() { return this.tagName === 'textarea' ? 'textarea' : this.inputType; }
  set type(value) { if (this.tagName === 'textarea') throw new TypeError('HTMLTextAreaElement.type is read-only'); this.inputType = value; }
  set textContent(value) { this.text = String(value); this.children = []; }
  get textContent() { return (this.text ?? '') + this.children.map(child => child.textContent).join(''); }
  get firstChild() { return this.children[0] ?? null; }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  removeAttribute(name) { this.attributes.delete(name); }
  appendChild(child) { child.remove(); this.children.push(child); child.parentNode = this; return child; }
  removeChild(child) { const i = this.children.indexOf(child); if (i >= 0) this.children.splice(i, 1); child.parentNode = null; return child; }
  remove() { this.parentNode?.removeChild(this); }
  addEventListener(name, fn) { if (!this.listeners.has(name)) this.listeners.set(name, new Set()); this.listeners.get(name).add(fn); }
  removeEventListener(name, fn) { this.listeners.get(name)?.delete(fn); }
  focus() { this.ownerDocument.activeElement = this; }
  click() { return this.fire('click'); }
  fire(type, details = {}) {
    const event = { type, target: this, defaultPrevented: false, propagationStopped: false,
      stopPropagation() { this.propagationStopped = true; }, preventDefault() { this.defaultPrevented = true; }, ...details };
    for (let node = this; node; node = node.parentNode) {
      for (const fn of node.listeners.get(type) ?? []) fn(event);
      if (event.propagationStopped) break;
    }
    return event;
  }
  matches(selector) {
    const match = /^\[([^=\]]+)(?:="([^"]*)")?\]$/.exec(selector);
    if (match) return match[2] === undefined ? this.attributes.has(match[1]) : this.getAttribute(match[1]) === match[2];
    if (selector.startsWith('#')) return this.id === selector.slice(1);
    return selector === this.tagName;
  }
  querySelectorAll(selector) {
    return this.children.flatMap(child => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]);
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
}
function makeDocument() {
  const doc = { createElement(tag) { return new Element(tag, this); }, activeElement: null };
  doc.documentElement = doc.createElement('html'); doc.head = doc.createElement('head'); doc.body = doc.createElement('body');
  doc.documentElement.appendChild(doc.head); doc.documentElement.appendChild(doc.body); return doc;
}
const settle = async () => { await new Promise(resolve => setImmediate(resolve)); await new Promise(resolve => setImmediate(resolve)); };
function fixture({ battle = true, accept = true, spawnImplementation = null, customOptions = {} } = {}) {
  const values = new Map(), storage = { getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value), flush: async () => true };
  const controller = new GameController(defaults, { storage: { getItem: () => 'true' },
    createSimulation: options => new MiragineSimulation({ ...options, rng: seededRandom(12) }) });
  const custom = createCustomization({ controller, defaults, storage, ...customOptions }); if (battle) controller.startMatch(true, 1);
  const document = makeDocument(), root = document.createElement('div'), focus = document.createElement('button');
  document.body.appendChild(focus); document.body.appendChild(root); focus.focus();
  const events = [], confirms = [], resourceCalls = [], commitCalls = [], spawnCalls = [], clearCalls = [], applyCalls = [], nextCalls = [];
  const adapter = { ...custom,
    setResources(...args) { resourceCalls.push(args); return custom.setResources(...args); },
    commitSetting(...args) { commitCalls.push(args); return custom.commitSetting(...args); },
    startSpawn(...args) { spawnCalls.push(args); return (spawnImplementation ?? custom.startSpawn)(...args); },
    clearTroops(...args) { clearCalls.push(args); return custom.clearTroops(...args); },
    applyCurrent(...args) { applyCalls.push(args); return custom.applyCurrent(...args); },
    applyNext(...args) { nextCalls.push(args); return custom.applyNext(...args); },
  };
  const panel = createSettingsPanel({ root, customization: adapter,
    onOpenChange: value => events.push(['open', value]), onPauseChange: value => events.push(['pause', value]),
    confirm: message => { confirms.push(message); return accept; } });
  const find = selector => panel.element.querySelector(selector);
  const button = action => find(`[data-settings-action="${action}"]`);
  const tab = id => { const buttonElement = button(`tab-${id}`); assert.ok(buttonElement, `Missing ${id} tab`); buttonElement.click(); };
  const edit = (path, value) => {
    const input = find(`[data-field-path="${path}"]`); assert.ok(input, `Missing field ${path}`);
    input.value = String(value); input.fire('change'); return input;
  };
  return { panel, custom, controller, document, root, focus, events, confirms, resourceCalls, commitCalls, spawnCalls, clearCalls, applyCalls, nextCalls, find, button, tab, edit };
}

test('v4 numeric inputs clamp rather than reject values above or below their field limits', () => {
  const field = { type: 'number', min: 0, max: Number.MAX_SAFE_INTEGER, integer: true };
  for (const value of ['9007199254740992', '999999999999999999999999999999999999999', '1e309']) {
    assert.equal(parseFieldValue(field, value), Number.MAX_SAFE_INTEGER, value);
  }
  assert.equal(parseFieldValue(field, '-1'), 0);
  assert.equal(parseFieldValue(field, '-1e309'), 0);
  assert.equal(parseFieldValue(field, '98.99'), 98);
  assert.equal(parseFieldValue({ ...field, min: -100 }, '-98.99'), -98);
  assert.equal(parseFieldValue(field, String(Number.MAX_SAFE_INTEGER)), Number.MAX_SAFE_INTEGER);
});

test('v4 numeric clamping retains meaningful probability bounds and finite floating-point limits', () => {
  const probability = { type: 'number', min: 0, max: 1, integer: false };
  assert.equal(parseFieldValue(probability, '2'), 1);
  assert.equal(parseFieldValue(probability, '-0.5'), 0);
  assert.equal(parseFieldValue(probability, '0.5'), 0.5);
  assert.equal(parseFieldValue({ type: 'number', min: 0, max: Number.MAX_VALUE }, '1e999'), Number.MAX_VALUE);
  for (const bad of ['', ' ', 'NaN', 'abc', '12abc']) assert.throws(() => parseFieldValue(probability, bad), bad);
});

test('v4 integer text truncates exactly near the safe-integer limit before Number rounding', () => {
  const field = { type: 'number', min: 0, max: Number.MAX_SAFE_INTEGER, integer: true };
  assert.equal(parseFieldValue(field, '9007199254740990.9'), 9007199254740990);
  assert.equal(parseFieldValue(field, '9.0071992547409909e15'), 9007199254740990);
  assert.equal(parseFieldValue(field, '9007199254740991.1'), Number.MAX_SAFE_INTEGER);
});

test('v4 open homepage rebinds blue crystal fields when the native menu starts another difficulty', async () => {
  const f = fixture({ battle: false }); f.panel.open();
  assert.ok(f.find('[data-live-field-path="config.difficulties.1.blueBaseDamage.0"]'));
  f.controller.startMatch(true, 3); f.panel.update();
  assert.equal(f.find('[data-live-field-path="config.difficulties.1.blueBaseDamage.0"]'), null);
  const blue = f.find('[data-live-field-path="config.difficulties.3.blueBaseDamage.0"]'); assert.ok(blue);
  blue.value = '321'; blue.fire('input'); blue.fire('keydown', { code: 'Enter' }); await settle();
  assert.equal(f.controller.simulation.blueBoss.damage[0], 321);
  assert.equal(f.custom.getState().applied.config.difficulties[1].blueBaseDamage[0], defaults.difficulties[1].blueBaseDamage[0]);
  f.panel.destroy();
});

test('v4 stale focused live input cannot commit into a replacement match of the same difficulty', async () => {
  const f = fixture(); f.panel.open();
  const old = f.find('[data-live-resource="left.money"]'); old.focus(); old.value = '54321'; old.fire('input');
  const firstId = f.custom.getBattleState().battleId;
  f.controller.startMatch(true, 1); const sim = f.controller.simulation, initial = sim.leftMoney;
  assert.notEqual(f.custom.getBattleState().battleId, firstId);
  // Guard the event even if a browser dispatches it before the next panel poll.
  old.fire('keydown', { code: 'Enter' }); await settle();
  assert.equal(f.resourceCalls.length, 0); assert.equal(sim.leftMoney, initial);
  assert.notEqual(f.find('[data-live-resource="left.money"]'), old);
  old.fire('blur'); await settle(); assert.equal(sim.leftMoney, initial);
  f.panel.destroy();
});

test('v4 live input refresh discards old-match edits before detaching their listeners', async () => {
  const f = fixture(); f.panel.open();
  const old = f.find('[data-live-field-path="config.sides.left.base.hp"]'); old.focus(); old.value = '98765'; old.fire('input');
  f.controller.startMatch(true, 2); f.panel.update(); old.fire('blur'); await settle();
  assert.equal(f.commitCalls.length, 0); assert.equal(f.controller.simulation.redBoss.spawnHP, defaults.rules.baseHp);
  assert.ok(f.find('[data-live-field-path="config.difficulties.2.blueBaseDamage.0"]')); f.panel.destroy();
});

test('v4 unfocused recruitment select and checkboxes capture user changes before busy refresh', async () => {
  const f = fixture(); f.panel.open(); f.button('close').focus();
  f.custom.selectUnit({ side: 'right', unitId: 15 }); f.panel.update();
  const selection = f.find('[data-live-selected-unit="right"]');
  assert.equal(selection.value, '15'); selection.value = '0'; selection.fire('change'); await settle();
  assert.equal(f.custom.getBattleState().right.selectedUnit, 0); assert.equal(selection.value, '0');
  for (const side of ['left', 'right']) {
    const recruitment = f.find(`[data-live-recruitment="${side}"]`);
    assert.equal(recruitment.checked, true); recruitment.checked = false; recruitment.fire('change'); await settle();
    assert.equal(f.custom.getBattleState()[side].recruitment, false); assert.equal(recruitment.checked, false);
  }
  const ai = f.find('[data-live-ai]'); assert.equal(ai.checked, true);
  ai.checked = false; ai.fire('change'); await settle();
  assert.equal(f.custom.getBattleState().enemyAi, false); assert.equal(ai.checked, false);
  f.panel.destroy();
});

test('v4 opening and closing the settings panel never requests pause or resume', () => {
  const f = fixture(); const frame = f.controller.simulation.frame;
  f.panel.open(); f.panel.update({ paused: false, speed: 2 });
  assert.equal(f.button('pause'), null, 'The duplicated header pause button must be absent');
  f.panel.close(); f.panel.update({ paused: true, speed: 0 }); f.panel.open(); f.panel.close();
  assert.deepEqual(f.events, [['open', true], ['open', false], ['open', true], ['open', false]]);
  assert.equal(f.controller.simulation.frame, frame, 'Opening an editor must not advance a simulation');
  assert.equal(f.document.activeElement, f.focus); f.panel.destroy();
});

test('v4 navigation has the five agreed pages instead of mixing starting values into live rules', () => {
  const f = fixture(); f.panel.open();
  const tabs = f.panel.element.querySelectorAll('[data-settings-action]')
    .map(item => item.getAttribute('data-settings-action')).filter(action => action.startsWith('tab-'));
  assert.deepEqual(tabs, ['tab-sandbox', 'tab-units', 'tab-starting', 'tab-difficulties', 'tab-presets']);
  assert.equal(f.find('[data-sandbox-side]'), null, 'Current red and blue controls must not share a side selector');
  for (const action of ['spawn-left', 'spawn-right', 'clear-left', 'clear-right', 'clear-all']) assert.ok(f.button(action), action);
  f.panel.destroy();
});

test('v4 home shows both sides and commits only the edited resource on Enter or blur', async () => {
  const f = fixture(); f.panel.open(); const sim = f.controller.simulation;
  for (const side of ['left', 'right']) {
    for (const key of ['money', 'income', 'population', 'baseHp']) assert.ok(f.find(`[data-live-resource="${side}.${key}"]`));
  }
  const money = f.find('[data-live-resource="left.money"]');
  const untouched = { income: sim.leftIncome, population: sim.leftPopulation, money: sim.rightMoney };
  money.focus(); money.value = '901'; money.fire('input'); money.fire('change'); await settle();
  assert.equal(f.resourceCalls.length, 0, 'Typing or a change event is not a confirmation');
  money.fire('keydown', { code: 'Enter', key: 'Enter' }); await settle();
  assert.deepEqual(f.resourceCalls.map(args => args[0]), [{ side: 'left', money: 901 }]);
  assert.equal(sim.leftMoney, 901); assert.equal(sim.leftIncome, untouched.income);
  assert.equal(sim.leftPopulation, untouched.population); assert.equal(sim.rightMoney, untouched.money);
  money.fire('blur'); await settle();
  assert.equal(f.resourceCalls.length, 1, 'Enter followed by blur must not duplicate the mutation');
  const income = f.find('[data-live-resource="right.income"]'); income.focus(); income.value = '777'; income.fire('input');
  income.fire('blur'); await settle();
  assert.deepEqual(f.resourceCalls.at(-1)[0], { side: 'right', income: 777 });
  assert.equal(sim.rightIncome, 777); f.panel.destroy();
});

test('v4 focused live resource is not overwritten during refresh and unchanged blur never restores a stale balance', async () => {
  const f = fixture(); f.panel.open(); const sim = f.controller.simulation;
  const money = f.find('[data-live-resource="left.money"]'); const originalText = money.value; money.focus();
  sim.leftMoney += 123; sim.rightMoney += 456; f.panel.update();
  assert.equal(money.value, originalText, 'Focused text stays stable even as the running match advances');
  assert.equal(f.find('[data-live-resource="right.money"]').value, String(sim.rightMoney));
  money.fire('blur'); await settle(); assert.equal(f.resourceCalls.length, 0, 'Focus alone does not mean the user edited the balance');
  const income = f.find('[data-live-resource="left.income"]'); income.focus(); income.value = '123.'; income.fire('input');
  const liveIncome = sim.leftIncome;
  for (let i = 0; i < 5; i++) f.panel.update();
  assert.equal(income.value, '123.'); assert.equal(sim.leftIncome, liveIncome); f.panel.destroy();
});

test('v4 current resource overflow is visibly clamped and applied without an out-of-range error', async () => {
  const f = fixture(); f.panel.open(); const input = f.find('[data-live-resource="left.money"]');
  input.focus(); input.value = '999999999999999999999999999'; input.fire('input');
  assert.equal(input.value, String(Number.MAX_SAFE_INTEGER), 'Excess numeric text is clamped immediately, not rejected after confirmation');
  input.fire('blur'); await settle();
  assert.equal(input.value, String(Number.MAX_SAFE_INTEGER));
  assert.equal(f.controller.simulation.leftMoney, Number.MAX_SAFE_INTEGER);
  assert.notEqual(input.getAttribute('aria-invalid'), 'true');
  assert.notEqual(f.find('[data-settings-message]').getAttribute('data-error'), 'true'); f.panel.destroy();
});

test('live fundamental and other-page unit rules both automatically commit without a separate apply step', async () => {
  const f = fixture(); f.panel.open(); f.tab('units'); f.edit('config.sides.left.units.0.hp', 999); await settle();
  f.tab('sandbox'); const income = f.find('[data-live-field-path="config.rules.incomeLimit"]'); assert.ok(income);
  income.focus(); income.value = '12345'; income.fire('input'); income.fire('keydown', { code: 'Enter', key: 'Enter' }); await settle();
  assert.deepEqual(f.commitCalls.map(args => args.slice(0, 2)), [
    ['config.sides.left.units.0.hp', 999], ['config.rules.incomeLimit', 12345],
  ]);
  assert.equal(f.controller.simulation.incomeLimit, 12345);
  assert.equal(f.custom.getState().draft.config.sides.left.units[0].hp, 999);
  assert.equal(f.custom.getState().applied.config.sides.left.units[0].hp, 999);
  f.panel.destroy();
});

test('v4 unit editor displays independent red and blue columns and preserves focused input text', async () => {
  const f = fixture(); f.panel.open(); f.tab('units');
  for (const side of ['left', 'right']) assert.ok(f.find(`[data-unit-side="${side}"]`));
  f.edit('config.sides.left.units.0.hp', 99); await settle();
  assert.equal(f.custom.getState().draft.config.sides.left.units[0].hp, 99);
  assert.equal(f.custom.getState().draft.config.sides.right.units[0].hp, defaults.units[0].hp);
  f.edit('config.sides.right.units.0.hp', 222); await settle();
  assert.equal(f.custom.getState().draft.config.sides.left.units[0].hp, 99);
  assert.equal(f.custom.getState().draft.config.sides.right.units[0].hp, 222);
  const left = f.find('[data-field-path="config.sides.left.units.0.hp"]'); left.focus(); left.value = '123.';
  for (let i = 0; i < 5; i++) f.panel.update();
  assert.equal(f.find('[data-field-path="config.sides.left.units.0.hp"]'), left); assert.equal(left.value, '123.');
  f.panel.destroy();
});

test('unit input clamps extreme cost to a safe integer and automatically applies it', async () => {
  const f = fixture(); f.panel.open(); f.tab('units');
  const cost = f.edit('config.sides.left.units.0.cost', '99999999999999999999999999'); await settle();
  assert.equal(cost.value, String(Number.MAX_SAFE_INTEGER)); assert.notEqual(cost.getAttribute('aria-invalid'), 'true');
  assert.equal(f.custom.getState().draft.config.sides.left.units[0].cost, Number.MAX_SAFE_INTEGER);
  assert.equal(f.custom.getState().applied.config.sides.left.units[0].cost, Number.MAX_SAFE_INTEGER);
  assert.equal(f.button('apply-current'), null); f.panel.destroy();
});

test('AI uses three meaningful categories with direct candidate pools while difficulty selection remains independent', () => {
  const f = fixture(); f.panel.open(); f.tab('difficulties');
  const category = f.find('[data-ai-category]');
  assert.deepEqual(category.children.map(option => [option.value, option.textContent]), [
    ['general', '战斗参数与选兵规则'], ['random', '随机候选与统计兵种'], ['counter', '反制候选'],
  ]);
  for (let id = 0; id < 4; id++) {
    const select = f.find('[data-entry-select="difficulties"]'); select.value = String(id); select.fire('change');
    assert.equal(f.panel.element.querySelectorAll('[data-ai-difficulty]').length, 1);
    assert.ok(f.find(`[data-field-path="config.difficulties.${id}.counterSelectionProbability"]`));
    assert.ok(f.find(`[data-field-path="config.difficulties.${id}.ai.forceOverlordMoneyThreshold"]`));
    assert.ok(f.find(`[data-field-path="config.difficulties.${id}.ai.forceMoneyEnabled"]`));
    const expected = f.custom.getMetadata().find(group => group.id === 'difficulties').entries.find(entry => Number(entry.id) === id)
      .fields.filter(field => field.type !== 'unit-list' && field.apply !== '下局').map(field => field.path).sort();
    assert.deepEqual(f.panel.element.querySelectorAll('[data-field-path]').map(input => input.getAttribute('data-field-path')).sort(), expected,
      'General combines all numeric/boolean combat and selection rules without hiding them behind another category');
    assert.equal(f.find('[data-ai-candidate-select]'), null);
  }
  const counter = f.find('[data-ai-category]'); counter.value = 'counter'; counter.fire('change');
  assert.ok(f.find('[data-field-path="config.difficulties.3.ai.counterChoices.5"]'));
  assert.equal(f.find('[data-ai-candidate-select]'), null);
  assert.equal(f.controller.difficulty, 1, 'Editing menus never change active difficulty');
  f.tab('starting');
  for (let id = 0; id < 4; id++) assert.ok(f.find(`[data-start-difficulty="${id}"]`), `starting difficulty ${id}`);
  f.panel.destroy();
});

test('battle summary separates actual difficulty from custom rules and live help is not repeated', async () => {
  const f=fixture(); f.controller.startMatch(true,3); f.panel.open();
  assert.match(f.find('[data-battle-summary]').textContent,/不可战胜/);
  assert.match(f.find('[data-battle-summary]').textContent,/原版规则/);
  f.custom.spawn({side:'left',unitId:0,count:1}); f.panel.update();
  assert.match(f.find('[data-battle-summary]').textContent,/不可战胜/);
  assert.match(f.find('[data-battle-summary]').textContent,/自定义（已修改）/);
  assert.doesNotMatch(f.find('[data-live-field-path="config.rules.incomeLimit"]').parentNode.textContent,/Enter|离开输入框/);
  for(const action of ['clear-left','clear-right','clear-all']) {f.button(action).click();await settle();}
  assert.equal(f.confirms.length,0); f.panel.destroy();
});

test('v4 next-match-only values live on the starting page, not the current battle homepage', () => {
  const f = fixture(); f.panel.open();
  const starting = f.custom.getMetadata().find(group => group.id === 'starting'); assert.ok(starting);
  const fields = starting.entries.flatMap(entry => entry.fields); assert.ok(fields.length >= 6);
  for (const field of fields) assert.equal(f.find(`[data-field-path="${field.path}"]`), null, `${field.path} must not appear among live values`);
  f.tab('starting'); for (const field of fields) assert.ok(f.find(`[data-field-path="${field.path}"]`), field.path);
  assert.equal(f.find('[data-live-resource="left.money"]'), null);
  assert.equal(f.find('[data-live-resource="right.money"]'), null); f.panel.destroy();
});

test('v4 AI thresholds, toggles, and candidate sets automatically apply separately for every difficulty', async () => {
  const f = fixture(); f.panel.open(); f.tab('difficulties');
  f.edit('config.difficulties.1.counterSelectionProbability', '2');
  f.edit('config.difficulties.1.ai.forceOverlordMoneyThreshold', '999999999999999999999999');
  f.edit('config.difficulties.1.ai.forceOverlordEliteCountThreshold', '37');
  const enabled = f.find('[data-field-path="config.difficulties.1.ai.forceMoneyEnabled"]'); assert.ok(enabled);
  enabled.checked = false; enabled.fire('change');
  const candidates=f.find('[data-ai-category]');candidates.value='random';candidates.fire('change');
  const elite = f.find('[data-field-path="config.difficulties.1.ai.eliteUnitIds"]'); assert.ok(elite);
  assert.equal(elite.querySelectorAll('[data-candidate-unit]').length, 16);
  const recruit = elite.querySelector('[data-candidate-unit="0"]'); recruit.checked = true; recruit.fire('change');
  await settle(); const draft = f.custom.getState().draft;
  assert.equal(draft.config.difficulties[1].ai.forceOverlordMoneyThreshold, Number.MAX_SAFE_INTEGER);
  assert.equal(draft.config.difficulties[1].ai.forceOverlordEliteCountThreshold, 37);
  assert.equal(draft.config.difficulties[1].ai.forceMoneyEnabled, false);
  assert.equal(draft.config.difficulties[1].counterSelectionProbability, 1);
  assert.deepEqual(draft.config.difficulties[1].ai.eliteUnitIds, [0, 14, 15]);
  assert.equal(draft.config.difficulties[0].ai.forceOverlordMoneyThreshold, 15030);
  assert.equal(draft.config.difficulties[0].ai.forceOverlordEliteCountThreshold, 2);
  assert.deepEqual(f.custom.getState().applied.config.difficulties[1], draft.config.difficulties[1]);
  f.panel.destroy();
});

test('v4 spawn buttons address each side directly and no longer enforce the old 100-unit batch cap', async () => {
  // Route to a spy to verify the requested quantity without allocating thousands
  // of real entities in a panel unit test. Job batching is tested in the model.
  const f = fixture({ spawnImplementation: () => ({ status: 'queued' }) }); f.panel.open();
  const count = f.find('[data-sandbox-count]'); assert.ok(count);
  assert.equal(Number(count.max), Number.MAX_SAFE_INTEGER);
  count.value = '1001'; count.fire('input');
  f.button('spawn-left').click(); await settle(); f.button('spawn-right').click(); await settle();
  assert.deepEqual(f.spawnCalls.map(args => args[0]), [
    { side: 'left', unitId: 0, count: 1001 }, { side: 'right', unitId: 0, count: 1001 },
  ]);
  assert.ok(f.find('[data-spawn-progress]')); assert.ok(f.button('cancel-spawn')); f.panel.destroy();
});

test('v4 clear controls map directly to red, blue, and both without a side selector', async () => {
  const f = fixture(); f.panel.open();
  for (const action of ['clear-left', 'clear-right', 'clear-all']) { f.button(action).click(); await settle(); }
  assert.deepEqual(f.clearCalls, [['left'], ['right'], ['both']]);
  assert.equal(f.find('[data-sandbox-side]'), null); assert.equal(f.find('[data-resource-side]'), null);
  assert.equal(f.controller.simulation.redBoss.nowHP, defaults.rules.baseHp);
  assert.equal(f.controller.simulation.blueBoss.nowHP, defaults.rules.baseHp); f.panel.destroy();
});

test('v4 typing the leading zero of a positive fraction is not prematurely clamped to the minimum', async () => {
  const f = fixture(); f.panel.open(); f.tab('units');
  const hp = f.find('[data-field-path="config.sides.left.units.0.hp"]'); hp.focus(); hp.value = '0'; hp.fire('input');
  assert.equal(hp.value, '0'); hp.value = '0.'; hp.fire('input'); assert.equal(hp.value, '0.');
  hp.value = '0.5'; hp.fire('input'); hp.fire('change'); await settle(); assert.equal(hp.value, '0.5');
  assert.equal(f.custom.getState().draft.config.sides.left.units[0].hp, 0.5); f.panel.destroy();
});

test('v4 homepage exposes each crystal independently including current-difficulty blue attacks', async () => {
  const f = fixture(); f.panel.open();
  for (const side of ['left', 'right']) {
    for (const key of ['hp', 'range']) assert.ok(f.find(`[data-live-field-path="config.sides.${side}.base.${key}"]`));
  }
  for (const key of ['blueBaseDamage.0', 'blueBaseDamage.1', 'blueBaseWeaponSpeedFrames']) {
    assert.ok(f.find(`[data-live-field-path="config.difficulties.1.${key}"]`), key);
    assert.equal(f.find(`[data-live-field-path="config.difficulties.0.${key}"]`), null, 'Do not show a different difficulty as the current blue crystal');
  }
  const hp = f.find('[data-live-field-path="config.sides.right.base.hp"]');
  const originalRed = f.controller.simulation.redBoss.maxHP;
  hp.focus(); hp.value = '777'; hp.fire('input'); hp.fire('keydown', { code: 'Enter', key: 'Enter' }); await settle();
  assert.equal(f.controller.simulation.blueBoss.maxHP, 777); assert.equal(f.controller.simulation.redBoss.maxHP, originalRed);
  assert.equal(f.commitCalls.length, 1); assert.equal(f.commitCalls[0][0], 'config.sides.right.base.hp'); f.panel.destroy();
});

test('v4 starting difficulty and mode are direct buttons whose selection survives tab changes', async () => {
  const f = fixture({ battle: false }); f.panel.open(); f.tab('starting');
  const difficulties = f.panel.element.querySelectorAll('[data-start-difficulty]'); assert.equal(difficulties.length, 4);
  for (let id = 0; id < 4; id++) {
    assert.equal(difficulties[id].tagName, 'button'); assert.equal(difficulties[id].textContent, defaults.difficulties[id].name);
  }
  f.find('[data-start-difficulty="3"]').click(); f.find('[data-start-mode="false"]').click(); f.tab('units'); f.tab('starting');
  assert.equal(f.find('[data-start-difficulty="3"]').getAttribute('aria-pressed'), 'true');
  assert.equal(f.find('[data-start-difficulty="1"]').getAttribute('aria-pressed'), 'false');
  assert.equal(f.find('[data-start-mode="false"]').getAttribute('aria-pressed'), 'true');
  f.button('start-battle').click(); await settle();
  assert.equal(f.controller.simulation.difficulty, 3); assert.equal(f.controller.simulation.singlePlay, false); f.panel.destroy();
});

test('v4 running spawn job keeps cancellation available and cancellation preserves completed soldiers', async () => {
  const scheduled = new Map(); let handle = 0;
  const f = fixture({ customOptions: { schedule: callback => { scheduled.set(++handle, callback); return handle; },
    cancelSchedule: key => scheduled.delete(key), spawnBatchSize: 2, workNow: () => 0 } });
  f.panel.open(); f.find('[data-sandbox-count]').value = '1000'; f.button('spawn-left').click(); await settle();
  assert.equal(f.custom.getSpawnJob().status, 'running'); assert.equal(f.button('cancel-spawn').disabled, false);
  assert.equal(f.button('spawn-left').disabled, true); assert.equal(f.button('spawn-right').disabled, true);
  const [key, run] = scheduled.entries().next().value; scheduled.delete(key); run(); f.panel.update();
  assert.equal(f.custom.getSpawnJob().completed, 2); assert.match(f.find('[data-spawn-progress]').textContent, /2 \/ 1000/);
  f.button('cancel-spawn').click(); await settle();
  assert.equal(f.custom.getSpawnJob().status, 'cancelled'); assert.equal(scheduled.size, 0);
  assert.equal(f.controller.simulation.friendList.filter(unit => unit.kind === 'unit').length, 2);
  assert.equal(f.button('cancel-spawn').disabled, true); assert.equal(f.button('spawn-left').disabled, false); f.panel.destroy();
});

test('automatic settings footer has only undo/reset and save status appears in the header', () => {
  const f = fixture(); f.panel.open(); const footer = f.find('footer'), header = f.find('header');
  const undo = f.button('undo'), reset = f.button('reset');
  assert.equal(undo.parentNode, reset.parentNode);
  assert.equal(undo.parentNode.parentNode, footer, 'The two footer actions occupy one shared direct row');
  assert.equal(f.find('[data-settings-footer-actions]'), undo.parentNode);
  assert.equal(footer.querySelectorAll('button').length, 2);
  assert.equal(f.button('apply-current'), null); assert.equal(f.button('apply-next'), null); assert.equal(f.find('[data-health-policy]'), null);
  assert.ok(header.querySelector('[data-settings-save-status]')); assert.equal(footer.querySelector('[data-settings-save-status]'), null);
  assert.match(undo.textContent, /撤销上次设置/); assert.match(reset.textContent, /恢复原版默认/);
  assert.doesNotMatch(header.textContent, /草稿未保存/); f.panel.destroy();
});

test('compact footer omits hidden apply guidance and retains only actionable controls and warnings', () => {
  const f = fixture(); f.panel.open();
  assert.equal(f.find('[data-settings-apply-help]'), null);
  const actions = f.find('[data-settings-footer-actions]');
  assert.equal(actions.getAttribute('aria-describedby'), null);
  assert.equal(f.find('footer').querySelectorAll('button').length, 2);
  assert.ok(f.find('[data-storage-warning]')); assert.ok(f.find('[data-settings-message]'));
  f.panel.destroy();
});

test('every settings page keeps controls and save status without standing explanation paragraphs', () => {
  const f = fixture(); f.panel.open(); const undo = f.button('undo'), reset = f.button('reset');
  const flatten = element => [element, ...element.children.flatMap(flatten)];
  for (const id of ['sandbox', 'units', 'starting', 'difficulties', 'presets']) {
    f.tab(id); assert.equal(f.button('undo'), undo); assert.equal(f.button('reset'), reset);
    assert.equal(f.button('apply-current'), null); assert.equal(f.button('apply-next'), null);
    assert.equal(f.find('[data-health-policy]'), null); assert.equal(f.find('[data-settings-apply-help]'), null);
    assert.equal(f.find('[data-editor-pause-status]'), null);
    assert.doesNotMatch(f.find('[data-settings-save-status]').textContent, /草稿/);
    const content = f.find('[role="tabpanel"]');
    assert.equal(content.querySelectorAll('p').filter(node => node.getAttribute('data-battle-summary') === null).length, 0, `No standing explanation paragraphs on ${id}`);
    assert.equal(flatten(content).filter(node => /(?:^|\s)ms-field-help(?:\s|$)/.test(node.className ?? '')).length, 0);
    assert.doesNotMatch(content.textContent, /原版默认：|打开设置不会暂停|无需另点应用|只影响新战局|预设只包含白名单|这里修改的是草稿/);
    for (let node = reset; node; node = node.parentNode) assert.notEqual(node.hidden, true, `Reset must remain visible on ${id}`);
  }
  f.tab('presets'); assert.doesNotMatch(f.panel.element.textContent, /载入草稿/); f.panel.destroy();
});

test('menu edits automatically prepare the next match without starting it', async () => {
  const f = fixture({ battle: false }); f.panel.open(); f.tab('units'); f.edit('config.sides.left.units.0.hp', 123); await settle();
  assert.equal(f.button('apply-current'), null); assert.equal(f.commitCalls.length, 1);
  assert.equal(f.controller.phase, 'title'); assert.equal(f.custom.getState().isBattle, false);
  assert.equal(f.custom.getState().next.config.sides.left.units[0].hp, 123);
  assert.match(f.find('[data-settings-message]').textContent, /下局/);
  f.controller.startMatch(true, 1); f.panel.update();
  assert.equal(f.controller.simulation.config.customization.sides.left.units[0].hp, 123); f.panel.destroy();
});

test('battle edits use fixed health ratio while confirmed initial resources defer automatically', async () => {
  const f = fixture(); f.custom.spawn({ side: 'left', unitId: 0, count: 1 }); const sim = f.controller.simulation;
  const unit = sim.friendList.find(entity => entity.kind === 'unit'); unit.nowHP = unit.spawnHP / 2;
  const before = { money: sim.leftMoney, income: sim.leftIncome, population: sim.leftPopulation, frame: sim.frame, round: sim.round };
  f.panel.open(); f.tab('units'); f.edit('config.sides.left.units.0.hp', 90); await settle();
  f.tab('starting'); f.edit('config.sides.left.initial.money', 98765); await settle();
  assert.deepEqual(f.commitCalls.map(args => args.slice(0, 2)), [
    ['config.sides.left.units.0.hp', 90], ['config.sides.left.initial.money', 98765],
  ]);
  assert.equal(unit.spawnHP, 90); assert.equal(unit.nowHP, 45);
  assert.deepEqual({ money: sim.leftMoney, income: sim.leftIncome, population: sim.leftPopulation, frame: sim.frame, round: sim.round }, before);
  assert.equal(f.custom.getState().next.config.sides.left.initial.money, 98765);
  assert.match(f.find('[data-settings-message]').textContent, /下局生效/); f.panel.destroy();
});

test('v4 live crystal maximum edits always preserve health ratio without exposing a policy dropdown', async () => {
  const f = fixture(); const sim = f.controller.simulation; sim.redBoss.nowHP = sim.redBoss.maxHP / 4;
  f.panel.open(); const hp = f.find('[data-live-field-path="config.sides.left.base.hp"]');
  hp.focus(); hp.value = '400'; hp.fire('input'); hp.fire('keydown', { code: 'Enter', key: 'Enter' }); await settle();
  assert.equal(f.find('[data-health-policy]'), null);
  assert.deepEqual(f.commitCalls.map(args => args.slice(0, 2)), [['config.sides.left.base.hp', 400]]);
  assert.equal(sim.redBoss.maxHP, 400); assert.equal(sim.redBoss.nowHP, 100); f.panel.destroy();
});

test('invalid input never commits in menu or battle, and correction applies without a second button', async () => {
  for (const battle of [false, true]) {
    const f = fixture({ battle }); f.panel.open(); f.tab('units'); f.edit('config.sides.left.units.0.cost', 'not a number'); await settle();
    assert.equal(f.button('apply-current'), null); assert.equal(f.commitCalls.length, 0);
    assert.match(f.find('[data-settings-save-status]').textContent, /输入无效/);
    f.edit('config.sides.left.units.0.cost', 7); await settle(); assert.equal(f.commitCalls.length, 1);
    assert.equal(f.custom.getState().next.config.sides.left.units[0].cost, 7);
    if (battle) assert.equal(f.controller.simulation.config.customization.sides.left.units[0].cost, 7);
    f.panel.destroy();
  }
});


test('rule text fields confirm on Enter or blur exactly once, with no premature apply while typing', async () => {
  const f = fixture(); f.panel.open(); f.tab('units');
  const hp = f.find('[data-field-path="config.sides.left.units.0.hp"]'); hp.focus(); hp.value = '180'; hp.fire('input');
  assert.equal(f.commitCalls.length, 0); assert.equal(f.custom.getState().applied.config.sides.left.units[0].hp, 45);
  hp.fire('keydown', { code: 'Enter', key: 'Enter' }); await settle();
  assert.equal(f.custom.getState().applied.config.sides.left.units[0].hp, 180); assert.equal(f.commitCalls.length, 1);
  hp.fire('change'); hp.fire('blur'); await settle(); assert.equal(f.commitCalls.length, 1, 'Native change/blur after Enter must not commit again');
  const cost = f.find('[data-field-path="config.sides.left.units.0.cost"]'); cost.focus(); cost.value = '99'; cost.fire('input'); cost.fire('blur'); await settle();
  assert.equal(f.custom.getState().applied.config.sides.left.units[0].cost, 99); assert.equal(f.commitCalls.length, 2); f.panel.destroy();
});

test('rapid rule edits across fields are not dropped while automatic storage flush is pending', async () => {
  const f = fixture(); f.panel.open(); f.tab('units');
  f.edit('config.sides.left.units.0.hp', 90); f.edit('config.sides.right.units.0.hp', 180); f.edit('config.sides.left.units.0.cost', 11); await settle();
  assert.equal(f.commitCalls.length, 3);
  assert.equal(f.custom.getState().applied.config.sides.left.units[0].hp, 90);
  assert.equal(f.custom.getState().applied.config.sides.right.units[0].hp, 180);
  assert.equal(f.custom.getState().applied.config.sides.left.units[0].cost, 11); f.panel.destroy();
});

test('current battle places spawn/clear below its summary and universal rules before current side status', () => {
  const f = fixture(); f.panel.open(); const text = f.find('[role="tabpanel"]').textContent;
  const summary = f.find('[data-battle-summary]').textContent;
  const spawn = f.button('spawn-left').textContent, clear = f.button('clear-all').textContent;
  const universal = text.indexOf('通用基础规则'), red = text.indexOf('红方当前状态'), blue = text.indexOf('蓝方当前状态');
  assert.ok(text.indexOf(summary) < text.indexOf(spawn)); assert.ok(text.indexOf(clear) < universal);
  assert.ok(universal >= 0 && universal < red && universal < blue); f.panel.destroy();
});


test('each AI candidate category directly displays every valid pool with all sixteen unit choices', () => {
  const f = fixture(); f.panel.open(); f.tab('difficulties');
  const metadata = f.custom.getMetadata().find(group => group.id === 'difficulties');
  for (let difficulty = 0; difficulty < 4; difficulty++) {
    const select = f.find('[data-entry-select="difficulties"]'); select.value = String(difficulty); select.fire('change');
    const fields = metadata.entries.find(entry => Number(entry.id) === difficulty).fields;
    const lists = fields.filter(field => field.type === 'unit-list');
    const counterPools = lists.filter(field => field.path.includes('.counterChoices.'));
    // Unit 0 uses dedicated recruit-selection rules, not an editable counter pool.
    assert.equal(counterPools.length, 15); assert.equal(counterPools.some(field => field.path.endsWith('.counterChoices.0')), false);
    for (const [categoryName, expected] of [
      ['random', lists.filter(field => !field.path.includes('.counterChoices.'))], ['counter', counterPools],
    ]) {
      const category = f.find('[data-ai-category]'); category.value = categoryName; category.fire('change');
      assert.equal(f.find('[data-ai-candidate-select]'), null);
      const actual = f.panel.element.querySelectorAll('[data-field-path]').map(node => node.getAttribute('data-field-path'));
      assert.deepEqual(actual.sort(), expected.map(field => field.path).sort(), `${difficulty}/${categoryName} shows all and only its own pools`);
      for (const field of expected) {
        const pool = f.find(`[data-field-path="${field.path}"]`); assert.ok(pool);
        assert.deepEqual(pool.querySelectorAll('[data-candidate-unit]').map(input => Number(input.getAttribute('data-candidate-unit'))), Array.from({ length: 16 }, (_, id) => id));
        assert.ok(pool.getAttribute('aria-label'), 'Every direct pool remains named accessibly');
      }
    }
  }
  assert.equal(f.controller.difficulty, 1); f.panel.destroy();
});

test('editing a displayed random or counter pool applies only that pool and survives category changes', async () => {
  const f = fixture(); f.panel.open(); f.tab('difficulties');
  const before = structuredClone(f.custom.getState().draft.config.difficulties[1].ai);
  const chooseCategory = value => { const category = f.find('[data-ai-category]'); category.value = value; category.fire('change'); };
  chooseCategory('random');
  const random = f.find('[data-field-path="config.difficulties.1.ai.eliteUnitIds"]');
  const randomRecruit = random.querySelector('[data-candidate-unit="0"]'); randomRecruit.checked = true; randomRecruit.fire('change'); await settle();
  const randomIds = f.custom.getState().applied.config.difficulties[1].ai.eliteUnitIds;
  assert.deepEqual(randomIds, [0, ...before.eliteUnitIds]);
  assert.deepEqual(f.custom.getState().applied.config.difficulties[1].ai.counterChoices, before.counterChoices);
  chooseCategory('counter');
  const targetId = 5, counter = f.find(`[data-field-path="config.difficulties.1.ai.counterChoices.${targetId}"]`);
  const counterRecruit = counter.querySelector('[data-candidate-unit="0"]'); counterRecruit.checked = true; counterRecruit.fire('change'); await settle();
  const after = f.custom.getState().applied.config.difficulties[1].ai;
  assert.deepEqual(after.counterChoices[targetId], [0, ...before.counterChoices[targetId]]);
  for (const id of Object.keys(before.counterChoices)) if (Number(id) !== targetId) assert.deepEqual(after.counterChoices[id], before.counterChoices[id]);
  assert.deepEqual(after.eliteUnitIds, randomIds);
  chooseCategory('random'); assert.equal(f.find('[data-field-path="config.difficulties.1.ai.eliteUnitIds"]').querySelector('[data-candidate-unit="0"]').checked, true);
  chooseCategory('counter'); assert.equal(f.find(`[data-field-path="config.difficulties.1.ai.counterChoices.${targetId}"]`).querySelector('[data-candidate-unit="0"]').checked, true);
  assert.equal(f.controller.difficulty, 1); f.panel.destroy();
});
