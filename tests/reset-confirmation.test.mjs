import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createConfirmationDialog, CONFIRMATION_DIALOG_CSS } from '../src/app/confirmation-dialog.mjs';
import { createSettingsPanel } from '../src/app/settings-panel.mjs';
import { createCustomization } from '../src/customization/index.mjs';
import { GameController } from '../src/app/controller.mjs';
import { MiragineSimulation, seededRandom } from '../src/core/index.mjs';

class Element {
  constructor(tag, doc) {
    this.tagName = tag; this.ownerDocument = doc; this.children = []; this.parentNode = null;
    this.attributes = new Map(); this.listeners = new Map(); this.value = ''; this.checked = false;
    this.hidden = false; this.disabled = false; this.inert = false; this.style = {};
  }
  set innerHTML(value) { throw new Error(`Unsafe HTML: ${value}`); }
  get type() { return this.tagName === 'textarea' ? 'textarea' : this.inputType; }
  set type(value) { if (this.tagName === 'textarea') throw new Error('read-only'); this.inputType = value; }
  set textContent(value) { this.text = String(value); this.children = []; }
  get textContent() { return (this.text ?? '') + this.children.map(child => child.textContent).join(''); }
  get firstChild() { return this.children[0] ?? null; }
  get isConnected() { for (let n = this; n; n = n.parentNode) if (n === this.ownerDocument.documentElement) return true; return false; }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  appendChild(child) { child.remove(); this.children.push(child); child.parentNode = this; return child; }
  removeChild(child) { const i = this.children.indexOf(child); if (i >= 0) this.children.splice(i, 1); child.parentNode = null; return child; }
  remove() { this.parentNode?.removeChild(this); }
  addEventListener(name, fn, options) {
    if (!this.listeners.has(name)) this.listeners.set(name, []);
    this.listeners.get(name).push({ fn, capture: options === true || Boolean(options?.capture) });
  }
  removeEventListener(name, fn) { this.listeners.set(name, (this.listeners.get(name) ?? []).filter(item => item.fn !== fn)); }
  focus() { this.ownerDocument.activeElement = this; this.fire('focusin'); }
  click() { return this.fire('click'); }
  fire(type, details = {}) {
    const event = { type, target: this, defaultPrevented: false, propagationStopped: false, immediateStopped: false,
      stopPropagation() { this.propagationStopped = true; }, stopImmediatePropagation() { this.immediateStopped = this.propagationStopped = true; },
      preventDefault() { this.defaultPrevented = true; }, ...details };
    const path = []; for (let n = this; n; n = n.parentNode) path.push(n);
    const dispatch = (node, capture) => { for (const item of [...(node.listeners.get(type) ?? [])]) {
      if (item.capture === capture) item.fn(event); if (event.immediateStopped) break;
    } };
    for (const node of [...path].reverse()) { dispatch(node, true); if (event.propagationStopped) return event; }
    for (const node of path) { dispatch(node, false); if (event.propagationStopped) return event; }
    return event;
  }
  matches(selector) {
    const match = /^\[([^=\]]+)(?:="([^"]*)")?\]$/.exec(selector);
    if (match) return match[2] === undefined ? this.attributes.has(match[1]) : this.getAttribute(match[1]) === match[2];
    return selector.startsWith('#') ? this.id === selector.slice(1) : selector === this.tagName;
  }
  querySelectorAll(selector) { return this.children.flatMap(child => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
}
function makeDocument() {
  const doc = { createElement(tag) { return new Element(tag, this); }, activeElement: null };
  doc.documentElement = doc.createElement('html'); doc.head = doc.createElement('head'); doc.body = doc.createElement('body');
  doc.documentElement.appendChild(doc.head); doc.documentElement.appendChild(doc.body); return doc;
}
const settle = async () => { await new Promise(resolve => setImmediate(resolve)); await new Promise(resolve => setImmediate(resolve)); };
const defaults = JSON.parse(readFileSync(new URL('../config/defaults.generated.json', import.meta.url), 'utf8'));
function fixture({ confirm, flush = async () => true } = {}) {
  const values = new Map(), storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), flush };
  const controller = new GameController(defaults, { storage: { getItem: () => 'true' }, createSimulation: options => new MiragineSimulation({ ...options, rng: seededRandom(12) }) });
  const custom = createCustomization({ controller, defaults, storage }); controller.startMatch(true, 1);
  const document = makeDocument(), root = document.createElement('div'), focus = document.createElement('button');
  document.body.appendChild(focus); document.body.appendChild(root); focus.focus();
  let resets = 0;
  const panel = createSettingsPanel({ root, customization: { ...custom, resetSettings() { resets++; return custom.resetSettings(); } }, confirm,
    window: { confirm() { throw new Error('Native confirm must never be called'); } } });
  const find = selector => panel.element.querySelector(selector), all = selector => document.body.querySelector(selector);
  const button = name => find(`[data-settings-action="${name}"]`), tab = name => button(`tab-${name}`).click();
  const edit = (path, value) => { const input = find(`[data-field-path="${path}"]`); input.value = String(value); input.fire('change'); return input; };
  panel.open();
  return { document, root, focus, panel, custom, controller, find, all, button, tab, edit, values, get resets() { return resets; } };
}
const hp = 'config.sides.left.units.0.hp';

test('confirmation uses an accessible in-page modal with safe cancel focus and no HTML interpolation', async () => {
  const f = fixture(); f.tab('units'); f.edit(hp, 90); await settle();
  f.button('reset').click();
  const dialog = f.all('[data-settings-confirm]'), cancel = f.all('[data-settings-confirm-cancel]');
  assert.equal(f.panel.isConfirming, true);
  assert.equal(dialog.getAttribute('role'), 'dialog'); assert.equal(dialog.getAttribute('aria-modal'), 'true');
  assert.ok(dialog.getAttribute('aria-labelledby')); assert.ok(dialog.getAttribute('aria-describedby'));
  assert.equal(f.document.activeElement, cancel); assert.equal(f.root.inert, true); assert.equal(f.resets, 0);
  cancel.click(); await settle(); assert.equal(f.panel.isConfirming, false);
  assert.equal(f.custom.getState().applied.config.sides.left.units[0].hp, 90); assert.equal(f.resets, 0);
  assert.equal(f.root.inert, false); assert.equal(f.all('[data-settings-confirm]'), null); assert.equal(f.button('reset').disabled, false);
  f.edit(hp, 100); await settle(); assert.equal(f.custom.getState().applied.config.sides.left.units[0].hp, 100); f.panel.destroy();
});

test('confirmation traps Tab and Escape cancels without closing the settings panel or leaking game shortcuts', async () => {
  const f = fixture(); let gameKeys = 0; f.document.body.addEventListener('keydown', () => gameKeys++);
  f.button('reset').click(); const cancel = f.all('[data-settings-confirm-cancel]'), accept = f.all('[data-settings-confirm-accept]');
  cancel.fire('keydown', { code: 'Tab' }); assert.equal(f.document.activeElement, accept);
  accept.fire('keydown', { code: 'Tab' }); assert.equal(f.document.activeElement, cancel);
  cancel.fire('keydown', { code: 'Tab', shiftKey: true }); assert.equal(f.document.activeElement, accept);
  accept.fire('keydown', { code: 'KeyJ' }); assert.equal(gameKeys, 0);
  accept.fire('keydown', { code: 'Escape' }); await settle();
  assert.equal(f.resets, 0); assert.equal(f.panel.isOpen, true); assert.equal(f.all('[data-settings-confirm]'), null); f.panel.destroy();
});

test('background rule edits and extra actions are blocked while the modal is awaiting an answer', async () => {
  const f = fixture(); f.tab('units'); f.edit(hp, 90); await settle(); f.button('reset').click();
  f.edit(hp, 1234); f.tab('starting'); f.button('reset').click();
  assert.equal(f.custom.getState().applied.config.sides.left.units[0].hp, 90);
  assert.equal(f.document.body.querySelectorAll('[data-settings-confirm]').length, 1); assert.ok(f.find(`[data-field-path="${hp}"]`));
  f.all('[data-settings-confirm-cancel]').click(); await settle(); f.panel.destroy();
});

test('accepting reset applies once, restores focus to a replacement field after rendering and accepts further edits', async () => {
  const f = fixture(); f.tab('units'); const previous = f.edit(hp, 90); await settle(); previous.focus();
  f.button('reset').click(); const accept = f.all('[data-settings-confirm-accept]'); accept.click(); accept.click(); await settle();
  const current = f.find(`[data-field-path="${hp}"]`);
  assert.equal(f.resets, 1); assert.equal(current.value, '45'); assert.notEqual(current, previous);
  assert.equal(f.document.activeElement, current); assert.equal(current.isConnected, true); assert.equal(f.root.inert, false);
  current.focus(); current.value = '777'; current.fire('input'); current.fire('keydown', { code: 'Enter' }); await settle();
  assert.equal(f.custom.getState().applied.config.sides.left.units[0].hp, 777); f.panel.destroy();
});

test('delayed reset storage completion never steals focus from a newly edited field', async () => {
  let block = false, resolve;
  const f = fixture({ flush: () => block ? new Promise(done => { resolve = done; }) : Promise.resolve(true) });
  f.tab('units'); f.edit(hp, 90); await settle(); block = true;
  f.button('reset').focus(); f.button('reset').click(); f.all('[data-settings-confirm-accept]').click(); await settle();
  const field = f.find(`[data-field-path="${hp}"]`);
  assert.equal(field.value, '45'); assert.equal(f.resets, 1); assert.equal(typeof resolve, 'function');
  assert.equal(f.button('reset').disabled, true, 'Reset is still waiting for its durable storage flush');
  field.focus(); field.value = '777'; field.fire('input');
  block = false; resolve(true); await settle();
  assert.equal(f.document.activeElement === field, true, 'Storage completion must respect the user\'s new focused input');
  assert.equal(field.value, '777'); assert.equal(f.button('reset').disabled, false);
  field.fire('keydown', { code: 'Enter' }); await settle();
  assert.equal(f.custom.getState().applied.config.sides.left.units[0].hp, 777); f.panel.destroy();
});

test('closing or destroying the panel cancels pending confirmation without any later mutation', async () => {
  for (const destroy of [false, true]) {
    const f = fixture(); f.tab('units'); f.edit(hp, 90); await settle(); f.button('reset').click();
    const staleAccept = f.all('[data-settings-confirm-accept]');
    if (destroy) f.panel.destroy(); else f.panel.close();
    staleAccept.click(); await settle();
    assert.equal(f.resets, 0); assert.equal(f.custom.getState().applied.config.sides.left.units[0].hp, 90);
    assert.equal(f.root.inert, false); assert.equal(f.all('[data-settings-confirm]'), null); assert.equal(f.document.activeElement, f.focus);
    if (!destroy) { f.panel.open(); assert.equal(f.button('reset').disabled, false); f.edit(hp, 101); await settle(); assert.equal(f.custom.getState().applied.config.sides.left.units[0].hp, 101); f.panel.destroy(); }
  }
});

test('injected asynchronous confirmations are awaited, reject safely, and remain compatible with Boolean callbacks', async () => {
  let reject, response = () => new Promise((_, no) => { reject = no; });
  const f = fixture({ confirm: () => response() }); f.tab('units'); f.edit(hp, 90); await settle();
  f.button('reset').click(); assert.equal(f.resets, 0); reject(new Error('Confirmation unavailable')); await settle();
  assert.equal(f.button('reset').disabled, false); assert.match(f.find('[data-settings-message]').textContent, /Confirmation unavailable/);
  response = () => false; f.button('reset').click(); await settle(); assert.equal(f.resets, 0);
  response = () => true; f.button('reset').click(); await settle(); assert.equal(f.resets, 1); f.panel.destroy();
});

test('late resolution from an injected confirmation after close or destroy cannot mutate settings', async () => {
  for (const destroy of [false, true]) {
    let resolve; const f = fixture({ confirm: () => new Promise(yes => { resolve = yes; }) });
    f.tab('units'); f.edit(hp, 90); await settle(); f.button('reset').click();
    if (destroy) f.panel.destroy(); else f.panel.close();
    await settle(); resolve(true); await settle(); assert.equal(f.resets, 0);
    assert.equal(f.custom.getState().applied.config.sides.left.units[0].hp, 90);
    if (!destroy) { f.panel.open(); assert.equal(f.button('reset').disabled, false); f.panel.destroy(); }
  }
});

test('every destructive settings action awaits asynchronous cancellation instead of treating a Promise as approval', async () => {
  for (const operation of ['return-original', 'start-battle', 'delete-preset', 'overwrite-preset', 'load-preset', 'import']) {
    let resolve, confirms = 0; const f = fixture({ confirm: () => { confirms++; return new Promise(yes => { resolve = yes; }); } });
    f.custom.commitSetting(hp, 90); const preset = await f.custom.savePreset('Preserved preset');
    f.custom.commitSetting(hp, 100); const before = JSON.stringify(f.custom.getState().presets), sim = f.controller.simulation;
    if (operation === 'return-original') f.button(operation).click();
    else if (operation === 'start-battle') { f.tab('starting'); f.button(operation).click(); }
    else {
      if (operation === 'load-preset' || operation === 'import') { f.tab('units'); const field = f.find(`[data-field-path="${hp}"]`); field.value = 'invalid'; field.fire('input'); }
      f.tab('presets'); f.find('[data-preset-select]').value = preset.id; f.find('[data-preset-name]').value = 'New name';
      if (operation === 'import') { const file = f.find('[data-preset-file]'); file.files = [{ size: 20, text: async () => { throw new Error('Cancelled files must not be read'); } }]; file.fire('change'); }
      else f.button(operation).click();
    }
    assert.equal(confirms, 1, operation); assert.equal(f.controller.simulation, sim); assert.equal(f.custom.getState().applied.config.sides.left.units[0].hp, 100);
    resolve(false); await settle();
    assert.equal(f.controller.simulation, sim, operation); assert.equal(JSON.stringify(f.custom.getState().presets), before, operation);
    assert.equal(f.custom.getState().applied.config.sides.left.units[0].hp, 100, operation); assert.equal(f.button('reset').disabled, false); f.panel.destroy();
  }
});

test('standalone confirmation rejects a second pending request and cleans event guards and original inert state', async () => {
  const doc = makeDocument(), app = doc.createElement('div'), button = doc.createElement('button'), alreadyInert = doc.createElement('div');
  alreadyInert.inert = true; app.appendChild(button); doc.body.appendChild(app); doc.body.appendChild(alreadyInert); button.focus();
  const dialog = createConfirmationDialog({ document: doc, focusRoot: app, fallbackFocus: () => button });
  const first = dialog.ask('<img src=x onerror=attack()>'); assert.equal(await dialog.ask('second'), false);
  assert.equal(doc.body.querySelector('[data-settings-confirm-message]').textContent, '<img src=x onerror=attack()>');
  assert.equal(doc.body.querySelector('img'), null); assert.equal(dialog.isOpen, true); dialog.cancel(); assert.equal(await first, false);
  assert.equal(app.inert, false); assert.equal(alreadyInert.inert, true); assert.equal(doc.activeElement, button);
  assert.equal([...doc.documentElement.listeners.values()].flat().length, 0); assert.equal(doc.head.querySelector('[data-settings-confirm-style]'), null);
  dialog.destroy(); assert.equal(await dialog.ask('after destroy'), false);
});

test('confirmation layout bounds both dimensions with internal scrolling for narrow or short viewports', () => {
  assert.match(CONFIRMATION_DIALOG_CSS, /position:fixed;inset:0/);
  assert.match(CONFIRMATION_DIALOG_CSS, /width:min\(480px,100%\)/);
  assert.match(CONFIRMATION_DIALOG_CSS, /max-height:calc\(100dvh - 24px\)/); assert.match(CONFIRMATION_DIALOG_CSS, /min-height:0;overflow:auto/);
  assert.match(CONFIRMATION_DIALOG_CSS, /flex-wrap:wrap/);
});

test('fullscreen-capable portal remains inside its shell and never makes its own ancestors inert', async () => {
  const doc = makeDocument(), shell = doc.createElement('main'), root = doc.createElement('div'), outside = doc.createElement('button');
  const input = doc.createElement('input'); shell.appendChild(root); root.appendChild(input); doc.body.appendChild(shell); doc.body.appendChild(outside); input.focus();
  const dialog = createConfirmationDialog({ document: doc, host: shell, focusRoot: root, fallbackFocus: () => input });
  const result = dialog.ask('Confirm while shell enters or exits browser fullscreen');
  assert.ok(shell.querySelector('[data-settings-confirm]')); assert.equal(shell.inert, false); assert.equal(doc.body.inert, false);
  assert.equal(root.inert, true); assert.equal(outside.inert, true);
  dialog.cancel(); assert.equal(await result, false); assert.equal(root.inert, false); assert.equal(outside.inert, false); assert.equal(doc.activeElement, input); dialog.destroy();
});

test('host window capture checks confirmation before game Escape, F2 and movement dispatch', () => {
  const main = readFileSync(new URL('../src/app/main.mjs', import.meta.url), 'utf8');
  const listener = main.slice(main.indexOf("window.addEventListener('keydown'"), main.indexOf("window.addEventListener('keyup'"));
  const guard = listener.indexOf("if (settings?.isConfirming && event.code !== 'F11') return;");
  assert.ok(guard >= 0); assert.ok(guard < listener.indexOf("if (event.code === 'F2'"));
  assert.ok(guard < listener.indexOf("if (event.code === 'Escape'")); assert.ok(guard < listener.indexOf('keyboard.keyDown'));
  const panel = readFileSync(new URL('../src/app/settings-panel.mjs', import.meta.url), 'utf8');
  assert.match(panel, /host: root\.closest\?\.\('#app-shell'\)/);
});
