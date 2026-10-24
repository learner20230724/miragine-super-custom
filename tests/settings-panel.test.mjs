import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createSettingsPanel, readPath, parseFieldValue, presetFilename } from '../src/app/settings-panel.mjs';
import { createCustomization } from '../src/customization/index.mjs';
import { GameController } from '../src/app/controller.mjs';
import { MiragineSimulation, seededRandom } from '../src/core/index.mjs';

const defaults = JSON.parse(readFileSync(new URL('../config/defaults.generated.json', import.meta.url), 'utf8'));
class Element {
  constructor(tag, doc) {
    this.tagName = tag; this.ownerDocument = doc; this.children = []; this.parentNode = null;
    this.attributes = new Map(); this.listeners = new Map(); this.value = ''; this.checked = false;
    this.hidden = false; this.disabled = false; this.style = {}; this.textWrites = 0;
  }
  set innerHTML(value) { throw new Error(`Dynamic HTML forbidden: ${value}`); }
  get type() { return this.tagName === 'textarea' ? 'textarea' : this.inputType; }
  set type(value) { if (this.tagName === 'textarea') throw new TypeError('HTMLTextAreaElement.type is read-only'); this.inputType = value; }
  set textContent(value) { this.text = String(value); this.textWrites++; this.children = []; }
  get textContent() { return (this.text ?? '') + this.children.map(child => child.textContent).join(''); }
  get firstChild() { return this.children[0] ?? null; }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
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
    if (selector.startsWith('#')) return this.id === selector.slice(1); return selector === this.tagName;
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
async function settleSpawn(custom) {
  for (let i = 0; custom.getSpawnJob()?.status === 'running' && i < 100; i++) await new Promise(resolve => setTimeout(resolve, 5));
  assert.notEqual(custom.getSpawnJob()?.status, 'running', 'The small spawn task must complete');
}
function fixture({ battle = true, accept = true, flush = async () => true } = {}) {
  const values = new Map(), storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), flush };
  const controller = new GameController(defaults, { storage: { getItem: () => 'true' },
    createSimulation: options => new MiragineSimulation({ ...options, rng: seededRandom(12) }) });
  const custom = createCustomization({ controller, defaults, storage }); if (battle) controller.startMatch(true, 1);
  const document = makeDocument(), root = document.createElement('div'), focus = document.createElement('button'), playback = document.createElement('div');
  document.body.appendChild(focus); document.body.appendChild(root); focus.focus();
  const events = [], confirms = [], downloads = [];
  const panel = createSettingsPanel({ root, customization: custom, playbackElement: playback,
    onOpenChange: value => { events.push(['open', value]); },
    onPauseChange: value => { events.push(['pause', value]); panel.update({ paused: value }); },
    confirm: message => { confirms.push(message); return accept; }, download: (text, name) => downloads.push({ text, name }) });
  const find = selector => panel.element.querySelector(selector);
  const button = action => find(`[data-settings-action="${action}"]`);
  const tab = name => button(`tab-${name}`).click();
  const edit = (path, value) => { const input = find(`[data-field-path="${path}"]`); input.value = String(value); input.fire('change'); return input; };
  return { panel, custom, controller, storage, values, root, document, focus, playback, find, button, tab, edit, events, confirms, downloads };
}

test('dock is collapsed by default; open/close restores focus without pausing or losing automatic settings', async () => {
  const f = fixture(); assert.equal(f.panel.isOpen, false); assert.equal(f.panel.element.hidden, true);
  f.panel.open(); assert.equal(f.panel.isOpen, true); assert.equal(f.panel.element.hidden, false);
  assert.equal(f.playback.parentNode.parentNode, f.panel.element);
  assert.equal(f.document.activeElement, f.button('close')); assert.deepEqual(f.events, [['open', true]]);
  f.tab('units'); f.edit('config.sides.left.units.0.hp', 99); await settle(); f.panel.close();
  assert.equal(f.document.activeElement, f.focus); f.panel.open(); assert.equal(f.find('[data-field-path="config.sides.left.units.0.hp"]').value, '99');
  assert.equal(f.controller.simulation.config.customization.sides.left.units[0].hp, 99);
  assert.doesNotMatch(f.find('[data-settings-save-status]').textContent, /草稿/); f.panel.destroy();
});

test('metadata supplies real editable sections with labels and no invented building/skill/wave tabs', () => {
  const f = fixture(); f.panel.open();
  for (const id of ['sandbox', 'units', 'starting', 'difficulties', 'presets']) assert.ok(f.button(`tab-${id}`));
  assert.equal(f.button('tab-buildings'), null); assert.equal(f.button('tab-waves'), null);
  f.tab('units'); assert.equal(f.find('[data-entry-select="units"]').children.length, 16);
  assert.equal(f.find('[data-field-path="config.sides.left.units.0.weaponSpeed"]').value, '0.83');
  assert.match(f.panel.element.textContent, /基础攻击间隔/);
  assert.match(f.find('[data-field-path="config.sides.left.units.0.hp"]').parentNode.textContent, /HP/);
  assert.match(f.find('[data-field-path="config.sides.left.units.0.range"]').parentNode.textContent, /世界单位/);
  assert.doesNotMatch(f.find('[role="tabpanel"]').textContent, /原版默认：|应用后生效|确认后自动/);
  f.tab('difficulties'); assert.ok(f.find('[data-entry-select="difficulties"]'));
  for (let id = 0; id < 4; id++) {
    const select=f.find('[data-entry-select="difficulties"]');select.value=String(id);select.fire('change');
    assert.ok(f.find(`[data-field-path="config.difficulties.${id}.counterSelectionProbability"]`));
  }
  f.panel.destroy();
});

test('status updates do not rebuild focused fields or reset in-progress numeric edits', () => {
  const f = fixture(); f.panel.open(); f.tab('units');
  const input = f.find('[data-field-path="config.sides.left.units.0.hp"]'); input.focus(); input.value = '123.';
  for (let i = 0; i < 10; i++) f.panel.update({ paused: false });
  assert.equal(f.find('[data-field-path="config.sides.left.units.0.hp"]'), input); assert.equal(input.value, '123.');
  assert.equal(f.document.activeElement, input); assert.equal(f.custom.getState().draft.config.sides.left.units[0].hp, 45);
  f.panel.destroy();
});

test('collapsed status updates perform no profile clone or draft query', () => {
  const doc = makeDocument(), root = doc.createElement('div'); doc.body.appendChild(root);
  const custom = fixture({ battle: false }).custom; let reads = 0;
  const adapter = { ...custom, getState() { reads++; return custom.getState(); } };
  const panel = createSettingsPanel({ root, customization: adapter }); const before = reads;
  for (let i = 0; i < 100; i++) panel.update({ paused: true }); assert.equal(reads, before); panel.destroy();
});

test('invalid numeric input is blocked, survives status/tabs and never alters simulation until corrected', async () => {
  const f = fixture(); f.panel.open(); f.tab('units'); const bad = f.edit('config.sides.left.units.0.cost', 'NaN');
  assert.equal(bad.getAttribute('aria-invalid'), 'true'); assert.equal(f.custom.getState().draft.config.sides.left.units[0].cost, 20);
  assert.equal(f.button('apply-current'), null); f.tab('sandbox'); f.tab('units');
  assert.equal(f.find('[data-field-path="config.sides.left.units.0.cost"]').value, 'NaN');
  await settle(); assert.match(f.find('[data-settings-save-status]').textContent, /输入无效/);
  assert.equal(f.controller.simulation.config.units[0].cost, 20, 'Invalid input cannot mutate a battle');
  f.edit('config.sides.left.units.0.cost', 7); await settle();
  assert.equal(f.controller.simulation.config.customization.sides.left.units[0].cost, 7); f.panel.destroy();
});

test('automatic settings report deferred initial values and preserve existing health ratios without an extra selector', async () => {
  const f = fixture(); f.custom.spawn({ side: 'left', unitId: 0, count: 1 });
  const sim = f.controller.simulation, unit = sim.friendList.find(entity => entity.kind === 'unit'); unit.nowHP = unit.spawnHP / 4;
  const frame = sim.frame, money = sim.leftMoney;
  f.panel.open(); f.tab('units'); f.edit('config.sides.left.units.0.hp', 500); await settle();
  assert.equal(unit.nowHP, 125); assert.equal(unit.spawnHP, 500);
  f.tab('starting'); f.edit('config.sides.left.initial.money', 777); await settle(); assert.equal(f.find('[data-health-policy]'), null);
  assert.equal(sim.frame, frame); assert.equal(sim.config.customization.sides.left.units[0].hp, 500);
  assert.equal(sim.leftMoney, money); assert.equal(f.custom.getState().next.config.sides.left.initial.money, 777);
  assert.match(f.find('[data-settings-message]').textContent, /下局生效/);
  assert.equal(f.button('apply-current'), null); f.panel.destroy();
});

test('named preset save and overwrite remain explicit while loading immediately applies rules', async () => {
  const f = fixture(); f.panel.open(); f.tab('units'); f.edit('config.sides.left.units.0.hp', 99); await settle(); f.tab('presets');
  const name = f.find('[data-preset-name]'); name.value = '<b>我的规则</b>'; f.button('save-preset').click(); await settle();
  assert.equal(f.custom.getState().presets.length, 1); assert.match(f.find('[data-settings-message]').textContent, /已保存到本机/);
  assert.equal(f.controller.simulation.config.customization.sides.left.units[0].hp, 99);
  const id = f.custom.getState().presets[0].id; f.find('[data-preset-select]').value = id;
  f.button('overwrite-preset').click(); await settle(); assert.equal(f.confirms.length, 1); assert.equal(f.custom.getState().presets.length, 1);
  f.button('export').click(); await settle(); assert.equal(f.downloads.length, 1);
  assert.equal(JSON.parse(f.downloads[0].text).profile.config.sides.left.units[0].hp, 99); assert.doesNotMatch(f.downloads[0].name, /[<>/]/);
  await f.custom.resetSettings(); assert.equal(f.custom.getState().draft.config.sides.left.units[0].hp, 45);
  f.button('load-preset').click(); await settle(); assert.equal(f.custom.getState().draft.config.sides.left.units[0].hp, 99);
  assert.equal(f.controller.simulation.config.customization.sides.left.units[0].hp, 99); f.panel.destroy();
});

test('preset filename draft survives tab navigation and periodic status refresh', () => {
  const f = fixture(); f.panel.open(); f.tab('presets'); const name = f.find('[data-preset-name]'); name.value = '尚未保存的名字';
  f.panel.update(); assert.equal(name.value, '尚未保存的名字'); f.tab('units'); f.tab('presets');
  assert.equal(f.find('[data-preset-name]').value, '尚未保存的名字'); f.panel.destroy();
});

test('false flush never reports durable save and warnings remain visible separately', async () => {
  const f = fixture({ flush: async () => false }); f.panel.open(); f.tab('presets'); f.find('[data-preset-name]').value = '存储失败测试';
  f.button('save-preset').click(); await settle();
  assert.equal(f.find('[data-settings-message]').getAttribute('data-error'), 'true');
  assert.match(f.find('[data-settings-message]').textContent, /未能确认写入本机存储/);
  assert.doesNotMatch(f.find('[data-settings-message]').textContent, /已保存到本机/); f.panel.destroy();
});

test('failed asynchronous save surfaces controller warnings without overwriting the draft', async () => {
  const f = fixture({ flush: async () => { throw new Error('private path must not be surfaced'); } });
  f.panel.open(); f.tab('units'); f.edit('config.sides.left.units.0.hp', 222); await settle(); f.tab('presets'); f.find('[data-preset-name]').value = '失败';
  f.button('save-preset').click(); await settle();
  assert.match(f.find('[data-storage-warning]').textContent, /存储写入失败/);
  assert.doesNotMatch(f.find('[data-settings-message]').textContent, /private path/);
  assert.equal(f.custom.getState().draft.config.sides.left.units[0].hp, 222); f.panel.destroy();
});

test('import validates size before reading and invalid JSON never replaces a valid draft', async () => {
  const f = fixture(); f.panel.open(); f.tab('presets'); const file = f.find('[data-preset-file]'); let reads = 0;
  file.files = [{ size: 256 * 1024 + 1, text: async () => { reads++; return '{}'; } }]; file.fire('change'); await settle();
  assert.equal(reads, 0); assert.match(f.find('[data-settings-message]').textContent, /256 KB/);
  file.files = [{ size: 3, text: async () => '{xx' }]; file.fire('change'); await settle();
  assert.equal(f.find('[data-settings-message]').getAttribute('data-error'), 'true');
  assert.equal(f.custom.getState().draft.config.sides.left.units[0].hp, 45); f.panel.destroy();
});

test('JSON import applies rules and reset/undo change real rules while preserving presets and battle resources', async () => {
  const f = fixture(); f.custom.updateDraft('config.sides.left.units.0.hp', 333); const exported = f.custom.exportJSON('导入');
  f.custom.resetDraft(); f.panel.open(); f.tab('presets');
  const sim = f.controller.simulation; sim.leftMoney = 9876; const frame = sim.frame;
  const file = f.find('[data-preset-file]'); file.files = [{ size: exported.length, text: async () => exported }]; file.fire('change'); await settle();
  assert.equal(f.custom.getState().draft.config.sides.left.units[0].hp, 333);
  assert.equal(sim.config.customization.sides.left.units[0].hp, 333);
  f.find('[data-preset-name]').value = '导入'; f.button('save-preset').click(); await settle();
  f.button('reset').click(); await settle(); assert.equal(f.custom.getState().draft.config.sides.left.units[0].hp, 45);
  assert.equal(sim.config.customization.sides.left.units[0].hp, 45);
  assert.equal(sim.leftMoney, 9876); assert.equal(sim.frame, frame);
  assert.equal(f.custom.getState().presets.length, 1); f.button('undo').click(); await settle();
  assert.equal(f.custom.getState().draft.config.sides.left.units[0].hp, 333);
  assert.equal(sim.config.customization.sides.left.units[0].hp, 333); f.panel.destroy();
});

test('sandbox spawn, clear and remaining resources are explicit real controller operations', async () => {
  const f = fixture(); f.panel.open(); const sim = f.controller.simulation;
  f.find('[data-sandbox-count]').value = '3'; f.button('spawn-left').click(); await settle(); await settleSpawn(f.custom);
  assert.equal(sim.friendList.filter(unit => unit.kind === 'unit').length, 3);
  for (const [field, value] of [['money', '900'], ['income', '77'], ['population', '12']]) {
    const input = f.find(`[data-live-resource="left.${field}"]`); input.value = value; input.fire('input'); input.fire('blur'); await settle();
  }
  assert.equal(sim.leftMoney, 900); assert.equal(sim.leftIncome, 77); assert.equal(sim.leftPopulation, 12);
  assert.equal(sim.populationLimit, defaults.rules.populationLimit); assert.match(f.panel.element.textContent, /本轮剩余人口/);
  f.button('clear-all').click(); await settle(); assert.equal(sim.friendList.filter(unit => unit.kind === 'unit').length, 0);
  assert.equal(sim.redBoss.nowHP, defaults.rules.baseHp); assert.equal(f.confirms.length, 0); f.panel.destroy();
});

test('clearing needs no confirmation while cancelled settings reset still preserves edits', async () => {
  const f = fixture({ accept: false }); f.custom.spawn({ side: 'left', unitId: 0, count: 1 }); f.custom.updateDraft('config.sides.left.units.0.hp', 111);
  f.panel.open(); f.button('clear-all').click(); await settle(); assert.equal(f.controller.simulation.friendList.filter(unit => unit.kind === 'unit').length, 0);
  assert.equal(f.confirms.length, 0);
  f.button('reset').click(); await settle(); assert.equal(f.custom.getState().draft.config.sides.left.units[0].hp, 111); f.panel.destroy();
});

test('return to main menu ends the battle without silently restoring original rules', async () => {
  const f = fixture({ battle: false }); f.panel.open(); assert.equal(f.button('spawn-left').disabled, true);
  f.tab('units'); f.edit('config.sides.left.units.0.cost', 7); await settle();
  f.tab('starting'); f.button('start-battle').click(); await settle();
  assert.equal(f.controller.phase, 'game'); assert.equal(f.controller.simulation.config.customization.sides.left.units[0].cost, 7);
  f.tab('sandbox'); assert.equal(f.button('spawn-left').disabled, false);
  assert.match(f.button('return-original').textContent, /返回主菜单.*结束本局/);
  f.button('return-original').click(); await settle(); assert.equal(f.controller.phase, 'title');
  assert.equal(f.custom.getState().draft.config.sides.left.units[0].cost, 7);
  assert.equal(f.custom.getState().next.config.sides.left.units[0].cost, 7);
  f.controller.startMatch(true, 1); assert.equal(f.controller.simulation.config.customization.sides.left.units[0].cost, 7); f.panel.destroy();
});

test('editor omits a redundant pause-status row without changing the host pause state', () => {
  const f = fixture(); f.panel.open(); assert.equal(f.button('pause'), null); assert.equal(f.panel.isOpen, true);
  f.panel.update({ paused: true, speed: 0 }); assert.equal(f.button('pause'), null);
  assert.equal(f.find('[data-editor-pause-status]'), null);
  assert.ok(f.find('[data-settings-save-status]')); assert.equal(f.find('header').querySelectorAll('p').length, 0);
  assert.deepEqual(f.events, [['open', true]]); f.panel.destroy();
});

test('keyboard fields retain native editing but stop game keys; F2/Escape close and F11 is host-owned', () => {
  const f = fixture(); f.panel.open(); f.tab('units'); const input = f.find('[data-field-path="config.sides.left.units.0.hp"]');
  const arrow = input.fire('keydown', { code: 'ArrowUp' }); assert.equal(arrow.propagationStopped, true); assert.equal(arrow.defaultPrevented, false);
  assert.equal(input.fire('keydown', { code: 'F11' }).propagationStopped, false);
  input.fire('keydown', { code: 'Escape' }); assert.equal(f.panel.isOpen, false); f.panel.open();
  f.button('close').fire('keydown', { code: 'F2' }); assert.equal(f.panel.isOpen, false); f.panel.destroy();
});

test('safe helpers reject prototype traversal and invalid literals while clamping numeric field values', () => {
  assert.equal(readPath({ a: [5] }, 'a.0'), 5); assert.equal(readPath({}, 'missing.x'), undefined);
  for (const path of ['__proto__.x', 'a.constructor.x', 'prototype']) assert.throws(() => readPath({}, path));
  const field = { type: 'number', min: 1, max: 100, integer: true };
  for (const value of ['', 'Infinity', 'NaN']) assert.throws(() => parseFieldValue(field, value));
  assert.equal(parseFieldValue(field, '0'), 1); assert.equal(parseFieldValue(field, '101'), 100); assert.equal(parseFieldValue(field, '1.2'), 1);
  assert.equal(parseFieldValue(field, '25'), 25); assert.equal(parseFieldValue({ type: 'text' }, '<script>literal</script>'), '<script>literal</script>');
  assert.equal(parseFieldValue({ type: 'boolean' }, '', true), true); assert.equal(presetFilename('../../'), 'miragine-preset-custom.json');
});

test('destroy releases all listeners and styles without accepting stale UI actions', async () => {
  const f = fixture(); f.panel.open(); const old = f.button('spawn-left'); f.panel.destroy(); f.panel.destroy(); old.click(); await settle();
  assert.equal(f.controller.simulation.friendList.filter(unit => unit.kind === 'unit').length, 0);
  assert.equal(f.panel.element.parentNode, null); assert.equal(f.document.head.querySelector('[data-settings-panel-style]'), null);
  f.panel.open(); assert.equal(f.panel.isOpen, false); f.panel.update();
});


test('automatic confirmation applies immediately but reports saving until durable storage completes', async () => {
  let complete; const f = fixture({ flush: () => new Promise(resolve => { complete = resolve; }) });
  f.panel.open(); f.tab('units'); f.edit('config.sides.left.units.0.range', 999);
  assert.equal(f.custom.getState().applied.config.sides.left.units[0].range, 999);
  assert.equal(f.find('[data-settings-save-status]').getAttribute('data-save-state'), 'saving');
  assert.doesNotMatch(f.find('[data-settings-save-status]').textContent, /已保存到本机/);
  complete(true); await settle();
  assert.equal(f.find('[data-settings-save-status]').getAttribute('data-save-state'), 'saved');
  assert.match(f.find('[data-settings-save-status]').textContent, /已保存到本机/); f.panel.destroy();
});

test('automatic save failure does not undo usable live settings or falsely promise persistence', async () => {
  const f = fixture({ flush: async () => false }); f.panel.open(); f.tab('units'); f.edit('config.sides.left.units.0.range', 987); await settle();
  assert.equal(f.custom.getState().applied.config.sides.left.units[0].range, 987);
  assert.equal(f.find('[data-settings-save-status]').getAttribute('data-save-state'), 'failed');
  assert.match(f.find('[data-settings-save-status]').textContent, /保存失败/);
  assert.match(f.find('[data-settings-message]').textContent, /未能确认写入本机存储/);
  assert.doesNotMatch(f.find('[data-settings-message]').textContent, /已保存到本机/); f.panel.destroy();
});
