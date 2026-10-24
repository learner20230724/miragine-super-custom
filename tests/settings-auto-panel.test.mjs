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

test('a fresh editor distinguishes not-yet-persisted defaults from an actual save failure', () => {
  const f = fixture(); f.panel.open();
  assert.equal(f.custom.getState().settingsSaved, false);
  assert.doesNotMatch(f.find('[data-settings-save-status]').textContent, /失败|草稿/);
  assert.equal(f.find('[data-settings-save-status]').getAttribute('data-save-state'), 'default');
  f.panel.destroy();
});

test('unconfirmed numeric text survives status refresh and tab rendering without applying early', async () => {
  const f = fixture(); f.panel.open(); f.tab('units');
  const path = 'config.sides.left.units.0.hp', input = f.find(`[data-field-path="${path}"]`);
  input.focus(); input.value = '123.'; input.fire('input');
  for (let i = 0; i < 6; i++) f.panel.update();
  assert.equal(input.value, '123.'); assert.equal(f.custom.getState().draft.config.sides.left.units[0].hp, 45);
  f.tab('presets'); f.tab('units');
  const retained = f.find(`[data-field-path="${path}"]`); assert.equal(retained.value, '123.');
  retained.fire('blur'); await settle();
  assert.equal(f.custom.getState().draft.config.sides.left.units[0].hp, 123);
  assert.equal(f.custom.getState().applied.config.sides.left.units[0].hp, 123); f.panel.destroy();
});

test('one invalid automatic field does not discard another valid confirmed field', async () => {
  const f = fixture(); f.panel.open(); f.tab('units');
  f.edit('config.sides.left.units.0.cost', 'not a number');
  f.edit('config.sides.right.units.0.hp', 150); await settle();
  assert.equal(f.custom.getState().applied.config.sides.left.units[0].cost, 20);
  assert.equal(f.custom.getState().applied.config.sides.right.units[0].hp, 150);
  assert.match(f.find('[data-settings-save-status]').textContent, /1 项输入无效/);
  f.tab('starting'); f.tab('units');
  assert.equal(f.find('[data-field-path="config.sides.left.units.0.cost"]').value, 'not a number');
  f.panel.destroy();
});

test('a late obsolete save failure cannot overwrite a newer successful field confirmation', async () => {
  const pending = [], f = fixture({ flush: () => new Promise(resolve => pending.push(resolve)) });
  f.panel.open(); f.tab('units');
  f.edit('config.sides.left.units.0.hp', 90);
  f.edit('config.sides.right.units.0.hp', 180);
  assert.equal(pending.length, 2); pending[1](true); await settle(); pending[0](false); await settle();
  assert.equal(f.custom.getState().settingsSaved, true);
  assert.equal(f.find('[data-settings-save-status]').getAttribute('data-save-state'), 'saved');
  assert.equal(f.find('[data-settings-message]').getAttribute('data-error'), 'false');
  assert.doesNotMatch(f.find('[data-settings-message]').textContent, /未能确认|失败/); f.panel.destroy();
});

test('reset clears unconfirmed text and does not let an obsolete save failure undo its success message', async () => {
  const pending = [], f = fixture({ flush: () => new Promise(resolve => pending.push(resolve)) });
  f.panel.open(); f.tab('units'); f.edit('config.sides.left.units.0.hp', 90);
  const field = f.find('[data-field-path="config.sides.right.units.0.hp"]');
  field.value = '100.'; field.fire('input');
  f.button('reset').click(); await settle(); assert.equal(pending.length, 2);
  pending[1](true); await settle(); pending[0](false); await settle();
  assert.equal(f.find('[data-field-path="config.sides.left.units.0.hp"]').value, '45');
  assert.equal(f.find('[data-field-path="config.sides.right.units.0.hp"]').value, '45');
  assert.equal(f.find('[data-settings-message]').getAttribute('data-error'), 'false');
  assert.match(f.find('[data-settings-message]').textContent, /恢复原版默认/); f.panel.destroy();
});

test('description editing preserves Shift+Enter while plain Enter confirms the unit description', async () => {
  const f = fixture(); f.panel.open(); f.tab('units');
  const path = 'config.sides.left.units.0.description', input = f.find(`[data-field-path="${path}"]`);
  assert.equal(input.tagName, 'textarea'); input.value = '第一行\n第二行'; input.fire('input');
  const newline = input.fire('keydown', { code: 'Enter', shiftKey: true });
  assert.equal(newline.defaultPrevented, false);
  assert.notEqual(f.custom.getState().draft.config.sides.left.units[0].description, input.value);
  input.fire('keydown', { code: 'Enter' }); await settle();
  assert.equal(f.custom.getState().applied.config.sides.left.units[0].description, '第一行\n第二行'); f.panel.destroy();
});


test('homepage recruitment and AI toggles save for future matches and undo their live effect', async () => {
  const f = fixture(); f.panel.open();
  for (const [selector, key] of [['[data-live-recruitment="left"]', 'leftRecruitment'], ['[data-live-recruitment="right"]', 'rightRecruitment'], ['[data-live-ai]', 'enemyAi']]) {
    const control = f.find(selector); control.checked = false; control.fire('change'); await settle();
    assert.equal(f.custom.getState().draft.rules[key], false); assert.equal(f.custom.getState().next.rules[key], false);
    assert.equal(f.custom.getState().applied.rules[key], false); assert.equal(f.custom.getState().settingsSaved, true);
    f.button('undo').click(); await settle(); assert.equal(f.custom.getState().applied.rules[key], true);
  }
  f.tab('starting');
  const enabled = f.find('[data-field-path="rules.enemyAi"]'); enabled.checked = false; enabled.fire('change'); await settle();
  assert.equal(f.custom.getBattleState().enemyAi, false);
  assert.match(enabled.parentNode.textContent, /本局立即生效/); f.panel.destroy();
});
