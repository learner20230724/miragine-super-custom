import { clampInteger } from '../customization/numeric.mjs';
import { createConfirmationDialog } from './confirmation-dialog.mjs';

/** Rules editor: confirmed fields are automatically applied and saved locally. */
export const SETTINGS_PANEL_CSS = `
[data-settings-panel] {box-sizing:border-box;display:flex;flex-direction:column;width:100%;height:100%;min-height:0;color:#edf1e8;background:#131b18;border-left:1px solid #465247;font:13px/1.5 OriginalYahei,'Microsoft YaHei',Arial,sans-serif;font-variant-numeric:tabular-nums}
[data-settings-panel][hidden] {display:none!important}
[data-settings-panel] * {box-sizing:border-box}
[data-settings-panel] :is(h2,h3,p) {margin:0}
[data-settings-panel] button,[data-settings-panel] input,[data-settings-panel] select,[data-settings-panel] textarea {font:inherit;color:inherit;background:#25312a;border:1px solid #526250;border-radius:5px;min-height:32px;padding:5px 8px;max-width:100%}
[data-settings-panel] button {cursor:pointer;line-height:1.3}
[data-settings-panel] button:hover:not(:disabled) {background:#374635}
[data-settings-panel] :disabled {opacity:.45;cursor:default}
[data-settings-panel] :is(button,input,select,textarea):focus-visible {outline:2px solid #ebc66c;outline-offset:2px}
[data-settings-panel] input[type=checkbox] {width:18px;height:18px;min-height:0;accent-color:#bca563}
[data-settings-panel] input[aria-invalid=true],[data-settings-panel] textarea[aria-invalid=true] {border-color:#f48e85;outline:1px solid #f48e85}
[data-settings-panel] .ms-header {padding:12px 14px;background:#1c2821;display:flex;justify-content:space-between;align-items:start;gap:8px;flex-shrink:0;border-bottom:1px solid #34443b}
[data-settings-panel] h2 {font-size:17px;color:#f5eacb;font-weight:700}
[data-settings-panel] h3 {font-size:14px;color:#e0dabd;margin-bottom:8px}
[data-settings-panel] .ms-header-actions {display:flex;gap:5px;flex-wrap:wrap;justify-content:flex-end}
[data-settings-panel] .ms-title-row {display:flex;align-items:baseline;gap:8px;flex-wrap:wrap}
[data-settings-panel] .ms-muted {font-size:11px;color:#acb9aa;line-height:1.6}
[data-settings-panel] .ms-scroll {min-height:0;overflow:auto;overscroll-behavior:contain;flex:1}
[data-settings-panel] .ms-tabs {display:flex;gap:4px;flex-wrap:wrap;padding:10px 12px;background:#1a241e;border-block:1px solid #34443b;position:sticky;top:0;z-index:1}
[data-settings-panel] .ms-tabs button {padding:5px 9px;min-height:30px;font-size:12px;background:transparent;border-color:transparent}
[data-settings-panel] .ms-tabs button[aria-selected=true] {background:#58603a;color:#fff5d5;border-color:#abb176}
[data-settings-panel] .ms-content {padding:14px;min-height:150px}
[data-settings-panel] .ms-row {display:flex;align-items:center;gap:7px;flex-wrap:wrap;margin-bottom:10px}
[data-settings-panel] .ms-field {display:flex;flex-direction:column;gap:4px;flex:1;min-width:110px}
[data-settings-panel] .ms-field>span {font-size:12px;color:#b9c6b6}
[data-settings-panel] .ms-table-wrap {width:100%;overflow:auto}
[data-settings-panel] table {width:100%;border-collapse:collapse;font-size:12px}
[data-settings-panel] th,[data-settings-panel] td {padding:7px 6px;text-align:left;vertical-align:top;border-bottom:1px solid #2e3d32}
[data-settings-panel] thead th {font-size:11px;color:#b3c2ad;white-space:nowrap;background:#1d2a21}
[data-settings-panel] tbody th {font-weight:400;min-width:86px}
[data-settings-panel] td input[type=number] {width:104px}
[data-settings-panel] td input[type=text],[data-settings-panel] td textarea {width:150px}
[data-settings-panel] td textarea {min-height:70px;resize:vertical}
[data-settings-panel] .ms-default {color:#b4bea7;min-width:55px;overflow-wrap:anywhere;max-width:150px}
[data-settings-panel] .ms-timing {font-size:11px;color:#b7c5b2;min-width:94px}
[data-settings-panel] .ms-unit {font-size:10px;color:#97ac94;display:block;margin-top:4px;overflow-wrap:anywhere}
[data-settings-panel] .ms-summary {margin-bottom:12px;padding:9px 10px;border:1px solid #3b4c3d;border-radius:5px;background:#1b281f;font-size:12px;white-space:pre-line;overflow-wrap:anywhere}
[data-settings-panel] .ms-card {margin-bottom:14px;border:1px solid #374838;border-radius:7px;padding:12px;background:#18221b}
[data-settings-panel] .ms-card .ms-row:last-child {margin-bottom:0}
[data-settings-panel] .ms-primary {background:#6b602f;border-color:#c0b16a;color:#fff5d5}
[data-settings-panel] .ms-danger {border-color:#a56358;color:#ffc7b8}
[data-settings-panel] .ms-message {padding:8px 14px;font-size:12px;min-height:34px;background:#1b271e;border-top:1px solid #3a4b3b;white-space:pre-line;overflow-wrap:anywhere;max-height:110px;overflow:auto;flex-shrink:0}
[data-settings-panel] .ms-message[data-error=true] {color:#ffb6a8;background:#3b2420}
[data-settings-panel] .ms-footer {padding:10px 14px;flex-shrink:0;background:#1b251f;border-top:1px solid #3b4b3c}
[data-settings-panel] .ms-footer-actions {display:flex;align-items:center;gap:6px;flex-wrap:wrap}
[data-settings-panel] .ms-footer-actions button {white-space:nowrap;flex:0 1 auto}
[data-settings-panel] .ms-dirty {font-size:11px;color:#e4c97f}
[data-settings-panel] .ms-check {display:flex;align-items:center;gap:7px;font-size:12px}
[data-settings-panel] .ms-sides {display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;container-type:inline-size}
[data-settings-panel] .ms-side {min-width:0;border-top:3px solid #b96160}
[data-settings-panel] .ms-side[data-side=right] {border-top-color:#668ed6}
[data-settings-panel] .ms-side .ms-field {min-width:0;margin-bottom:9px}
[data-settings-panel] .ms-side input:not([type=checkbox]),[data-settings-panel] .ms-side select {width:100%;min-width:0}
[data-settings-panel] .ms-pools {display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,170px),1fr));gap:10px;align-items:start}
[data-settings-panel] .ms-pools>.ms-field {min-width:0;margin:0;padding:10px;border:1px solid #374838;border-radius:5px;container-type:inline-size}
[data-settings-panel] .ms-choice {display:flex;gap:5px;flex-wrap:wrap;margin-bottom:10px}
[data-settings-panel] .ms-choice button[aria-pressed=true] {background:#665d30;border-color:#ccb868}
[data-settings-panel] .ms-candidates {display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:3px 8px}
[data-settings-panel] .ms-candidates .ms-check {font-size:11px;min-width:0;overflow-wrap:anywhere}
@container(max-width:220px) {[data-settings-panel] .ms-pools .ms-candidates {grid-template-columns:1fr}}
[data-settings-panel] [data-spawn-progress] {font-size:12px;overflow-wrap:anywhere}
@media(max-width:480px) {[data-settings-panel] .ms-sides {grid-template-columns:1fr}}
[data-settings-panel] [hidden] {display:none!important}
`;

export function presetFilename(name = 'custom') {
  const safe = String(name).normalize('NFKC').replace(/[^a-zA-Z0-9\u3400-\u9fff_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'custom';
  return `miragine-preset-${safe}.json`;
}
export function readPath(object, path) {
  const parts = String(path).split('.');
  if (parts.some(key => ['__proto__', 'prototype', 'constructor'].includes(key))) throw new Error('不允许的字段路径');
  for (const part of parts) { if (object == null || !Object.hasOwn(object, part)) return undefined; object = object[part]; }
  return object;
}
export function parseFieldValue(field, value, checked = false) {
  if (field.type === 'boolean') return Boolean(checked);
  if (field.type === 'string' || field.type === 'text') return String(value);
  if (String(value).trim() === '') throw new Error('数值不能为空');
  const raw = String(value).trim();
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(raw)) throw new Error('请输入有效数值');
  let number = Number(raw);
  const minimum = field.min ?? (field.integer ? Number.MIN_SAFE_INTEGER : -Number.MAX_VALUE);
  const maximum = field.max ?? (field.integer ? Number.MAX_SAFE_INTEGER : Number.MAX_VALUE);
  if (field.integer) return clampInteger(raw, { min: minimum, max: maximum });
  number = Math.min(maximum, Math.max(minimum, number));
  if (!Number.isFinite(number)) throw new Error('请输入有限数值');
  return number;
}
function formatted(value) { return value === undefined ? '—' : typeof value === 'boolean' ? value ? '开启' : '关闭' : String(value); }
function setText(node, text) { if (node.textContent !== text) node.textContent = text; }

/**
 * root is a caller-owned dock whose layout reserves canvas space. It is not an overlay.
 * onOpenChange is a layout/focus notification, never a request to pause.
 * update refreshes status only: it must never replace in-progress field edits.
 */
export function createSettingsPanel({ root, customization, playbackElement = null,
  onOpenChange = () => {}, onPauseChange = () => {}, onStartBattle = null,
  confirm = null, download = null, window: suppliedWindow = null } = {}) {
  const doc = root?.ownerDocument, win = suppliedWindow ?? doc?.defaultView ?? globalThis;
  if (!doc?.createElement || !root?.appendChild) throw new TypeError('A settings dock DOM root is required');
  if (!customization?.getState || !customization?.getMetadata) throw new TypeError('A customization controller is required');
  const node = (tag, className = '', text) => {
    const result = doc.createElement(tag); if (className) result.className = className;
    if (text !== undefined) result.textContent = String(text); return result;
  };
  const cleanups = [], invalid = new Map(), unconfirmed = new Map(), selection = new Map(), tabButtons = new Map();
  const state = () => customization.getState();
  let opened = false, destroyed = false, busy = false, activeTab = 'sandbox', selectedPreset = '', lastPresetSignature = '';
  let beforeFocus = null, presetNameDraft = '';
  let currentTabCleanup = [], liveBindings = [], metadataCache = null, sandboxContext = null, startDifficulty = 1, startSinglePlay = true;
  let startDualAI = false, startingContext = null, startAIOptions = { leftDifficulty: 1, rightDifficulty: 1, applyDifficultyStats: true };
  let saving = 0, saveFailed = false, saveRevision = 0;
  let awaitingConfirmation = null, actionFocus = null;
  function on(element, type, listener, transient = false) {
    const guarded = event => {
      if (awaitingConfirmation) { event.preventDefault(); event.stopPropagation(); return; }
      listener(event);
    };
    element.addEventListener(type, guarded);
    (transient ? currentTabCleanup : cleanups).push(() => element.removeEventListener(type, guarded)); return element;
  }
  const style = node('style'); style.setAttribute('data-settings-panel-style', ''); style.textContent = SETTINGS_PANEL_CSS;
  (doc.head ?? doc.documentElement).appendChild(style);
  const element = node('aside'); element.id = 'miragine-settings-panel'; element.setAttribute('data-settings-panel', '');
  element.setAttribute('aria-label', '自定义规则与沙盒'); element.hidden = true;
  const header = node('header', 'ms-header'), titleBlock = node('div');
  const titleRow = node('div', 'ms-title-row'); titleRow.appendChild(node('h2', '', '自定义规则与沙盒'));
  const dirtyLabel = node('span', 'ms-dirty'); dirtyLabel.setAttribute('data-settings-save-status', ''); titleRow.appendChild(dirtyLabel); titleBlock.appendChild(titleRow);
  header.appendChild(titleBlock);
  const headerActions = node('div', 'ms-header-actions'); header.appendChild(headerActions); element.appendChild(header);
  function button(parent, text, action, callback, className = '', transient = false) {
    const control = node('button', className, text); control.type = 'button';
    if (action) control.setAttribute('data-settings-action', action);
    on(control, 'click', event => { event.stopPropagation(); if (!destroyed && !control.disabled) callback(event); }, transient);
    parent.appendChild(control); return control;
  }
  const closeButton = button(headerActions, '收起 ×', 'close', () => close()); closeButton.setAttribute('aria-label', '收起设置（F2 或 Escape）');
  const confirmation = createConfirmationDialog({ document: doc, focusRoot: element,
    host: root.closest?.('#app-shell') ?? null, fallbackFocus: () => opened ? closeButton : beforeFocus });
  async function confirmAction(text) {
    if (destroyed || !opened || awaitingConfirmation) return false;
    let cancel;
    const cancelled = new Promise(resolve => { cancel = () => resolve(false); });
    const ticket = { cancel }; awaitingConfirmation = ticket;
    try {
      const response = confirm ? confirm(text) : confirmation.ask(text, { returnFocus: actionFocus });
      const accepted = await Promise.race([Promise.resolve(response), cancelled]);
      return Boolean(accepted) && awaitingConfirmation === ticket && opened && !destroyed;
    } finally { if (awaitingConfirmation === ticket) awaitingConfirmation = null; }
  }
  function cancelConfirmation() {
    const ticket = awaitingConfirmation; awaitingConfirmation = null;
    confirmation.cancel(); ticket?.cancel();
  }
  const scroll = node('div', 'ms-scroll'); element.appendChild(scroll);
  if (playbackElement) scroll.appendChild(playbackElement);
  const nav = node('nav', 'ms-tabs'); nav.setAttribute('role', 'tablist'); nav.setAttribute('aria-label', '自定义设置分类'); scroll.appendChild(nav);
  const content = node('div', 'ms-content'); content.setAttribute('role', 'tabpanel'); content.id = 'miragine-settings-content'; scroll.appendChild(content);
  const message = node('p', 'ms-message'); message.setAttribute('role', 'status'); message.setAttribute('aria-live', 'polite');
  message.setAttribute('data-settings-message', ''); element.appendChild(message);
  const footer = node('footer', 'ms-footer'), footerTools = node('div', 'ms-footer-actions');
  footerTools.setAttribute('data-settings-footer-actions', '');
  const undo = button(footerTools, '撤销上次设置', 'undo', () => action(async () => {
    const report = customization.undoSettings(); invalid.clear(); unconfirmed.clear(); renderContent();
    await persist(); notice(reportMessage(report, '已撤销上次规则修改并保存；开局项从下局生效。'));
  }));
  undo.setAttribute('title', '撤销上一次规则修改并立即应用；不会倒退战斗、撤销刷兵或恢复过去的金币');
  const reset = button(footerTools, '恢复原版默认', 'reset', () => action(async () => {
    if (!await confirmAction('将全部面板参数恢复为原版默认并自动保存？兵种、射程、水晶、难度 / AI 等立即恢复，开局资源等从下局生效；保留已改进的弹道命中和子弹延寿。不会删除已存预设、清兵或重开本局，不会重置当前金币、人口、倒计时；生命上限变化保留当前生命比例。')) return;
    const report = customization.resetSettings(); invalid.clear(); unconfirmed.clear(); selectedPreset = ''; renderContent();
    await persist(); notice('全部面板参数已恢复原版默认并保存；弹道命中和延寿改进保留。' + reportMessage(report, '当前可改项已生效；开局项从下局生效。'));
  }));
  reset.setAttribute('title', '恢复全部面板参数并应用、保存；保留弹道和延寿改进，不删除预设，不重开或重置当前资源');
  footer.appendChild(footerTools); element.appendChild(footer); root.appendChild(element);
  const storageNotice = node('p', 'ms-muted'); storageNotice.setAttribute('data-storage-warning', ''); footer.appendChild(storageNotice);
  function option(select, value, text) { const result = node('option', '', text); result.value = String(value); select.appendChild(result); return result; }
  function label(parent, text, input) {
    const result = node('label', 'ms-field'); result.appendChild(node('span', '', text)); result.appendChild(input); parent.appendChild(result); return input;
  }
  function notice(text, error = false) {
    if (destroyed) return; setText(message, String(text)); message.setAttribute('data-error', String(error)); message.hidden = !text;
  }
  function assertValid() { if (invalid.size) throw new Error(`有 ${invalid.size} 项输入无效，请修正红框字段或撤销 / 恢复默认。`); }
  function reportMessage(report, fallback) {
    if (typeof report === 'string') return report;
    const notes = report?.notes ?? report?.warnings ?? (report?.note ? [report.note] : []);
    const applied = Array.isArray(report?.applied) ? report.applied.length : null;
    const deferred = Array.isArray(report?.deferred) ? report.deferred.length : null;
    return (applied === null ? fallback : `已应用 ${applied} 项。`) + (deferred ? ` ${deferred} 项下局生效。` : '')
      + (notes.length ? ` ${notes.join('；')}` : '');
  }
  async function action(callback) {
    if (busy || destroyed) return; actionFocus = doc.activeElement; busy = true; update();
    try { await callback(); } catch (error) { notice(error?.message ?? error, true); }
    finally { busy = false; if (!destroyed) { update(); confirmation.restoreFocus({ forget: true, focus: opened }); } actionFocus = null; }
  }
  async function persist() {
    const revision = ++saveRevision; saving++; update();
    try {
      if (typeof customization.flush !== 'function' || await customization.flush() === false) throw new Error('save failed');
      if (revision === saveRevision) saveFailed = false;
    } catch {
      if (revision === saveRevision) saveFailed = true;
      throw new Error('未能确认写入本机存储；本局已确认的修改仍可使用，请导出 JSON 备份。');
    } finally { saving--; update(); }
  }
  function metadata() {
    // Metadata describes immutable original defaults. Do not repeatedly clone the
    // entire schema while building the many AI candidate controls.
    if (!metadataCache) { const result = customization.getMetadata(); metadataCache = Array.isArray(result) ? result : result?.groups ?? []; }
    return metadataCache;
  }
  function tabs() { return [{ id: 'sandbox', label: '当前战局 / 基础' }, { id: 'units', label: '兵种' },
    { id: 'starting', label: '开局设置' }, { id: 'difficulties', label: '难度 / AI' }, { id: 'presets', label: '预设 / 文件' }]; }
  for (const tab of tabs()) {
    const control = button(nav, tab.label, `tab-${tab.id}`, () => {
      activeTab = tab.id; renderContent();
    });
    control.setAttribute('role', 'tab'); control.setAttribute('aria-controls', content.id); control.id = `miragine-tab-${tab.id}`;
    tabButtons.set(tab.id, control);
  }
  on(nav, 'keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.code)) return;
    const ids = [...tabButtons.keys()], current = ids.indexOf(activeTab);
    const index = event.code === 'Home' ? 0 : event.code === 'End' ? ids.length - 1
      : (current + (event.code === 'ArrowRight' ? 1 : -1) + ids.length) % ids.length;
    event.preventDefault(); activeTab = ids[index]; renderContent(); tabButtons.get(activeTab).focus();
  });
  function clearContent() {
    if (presetName?.parentNode) presetNameDraft = presetName.value;
    for (const cleanup of currentTabCleanup) cleanup(); currentTabCleanup = []; liveBindings = [];
    while (content.firstChild) content.removeChild(content.firstChild);
  }
  function renderContent() {
    clearContent();
    for (const [id, button] of tabButtons) { button.setAttribute('aria-selected', String(id === activeTab)); button.tabIndex = id === activeTab ? 0 : -1; }
    content.setAttribute('aria-labelledby', `miragine-tab-${activeTab}`);
    if (activeTab === 'sandbox') renderSandbox();
    else if (activeTab === 'presets') renderPresets();
    else if (activeTab === 'units') renderUnits();
    else if (activeTab === 'starting') renderStarting();
    else if (activeTab === 'difficulties') renderDifficulties();
    update();
  }
  function group(id) { return metadata().find(item => item.id === id); }
  function battleContext(current) { return current.isBattle && current.battle ? `${current.battle.battleId ?? 'battle'}:${current.battle.difficulty}` : 'menu'; }
  function groupFields(id) { const entry = group(id); return entry?.entries?.flatMap(item => item.fields ?? []) ?? entry?.fields ?? []; }
  function card(parent, title, side = null) {
    const result = node('section', `ms-card${side ? ' ms-side' : ''}`);
    if (side) result.setAttribute('data-side', side);
    result.appendChild(node('h3', '', title)); parent.appendChild(result); return result;
  }
  function fieldSide(field) { return field.side ?? /config\.sides\.(left|right)\./.exec(field.path)?.[1]; }
  function sortedFields(fields) { return [...fields].sort((a, b) => Number(a.path.endsWith('.description')) - Number(b.path.endsWith('.description'))); }
  function fieldUnit(field) {
    if (field.type !== 'number' || field.unit === '兵种 ID') return '';
    const unit = field.unit ?? '';
    if (field.path.endsWith('.armorTypeID')) return '0 轻甲 / 1 重甲';
    if (field.label.endsWith('倍率')) return '倍';
    if (unit.includes('金币 / 轮')) return '金币/轮';
    if (unit === '金币' || field.path.endsWith('MoneyThreshold')) return '金币';
    if (unit.startsWith('世界距离 /')) return '世界单位/步';
    if (unit.startsWith('世界距离')) return '世界单位';
    if (unit.startsWith('逻辑帧') || unit.startsWith('倒计时帧数')) return '帧';
    if (unit.startsWith('人口')) return '人口';
    if (unit.startsWith('个') || field.path.endsWith('CountThreshold')) return '个';
    return ['HP', '0–1'].includes(unit) ? unit : '';
  }
  function fieldsInto(parent, fields, { live = false, prefix = '' } = {}) {
    const current = state();
    for (const field of sortedFields(fields)) {
      const sideName = fieldSide(field) === 'left' ? '红方' : fieldSide(field) === 'right' ? '蓝方' : '';
      const input = fieldInput(field, readPath(current.draft, field.path), { live, prefix: prefix || sideName });
      const unit = fieldUnit(field), title = (!prefix && sideName ? `${sideName} · ${field.label}` : field.label) + (unit ? `（${unit}）` : '');
      const wrap = node('div', 'ms-field'), name = node('label', '', title);
      // A label cannot contain a group of candidate checkboxes; its name is supplied to the fieldset instead.
      if (field.type !== 'unit-list') { const id = `miragine-field-${field.path.replace(/[^a-zA-Z0-9_-]/g, '-')}`; input.id = id; name.setAttribute('for', id); }
      wrap.appendChild(name); wrap.appendChild(input);
      parent.appendChild(wrap);
    }
  }
  function renderUnits() {
    const entries = group('units')?.entries ?? [];
    let selected = selection.get('units') ?? String(entries[0]?.id ?? '0');
    if (!entries.some(entry => String(entry.id) === selected)) selected = String(entries[0]?.id ?? '0');
    const selector = selectInput(entries.map(entry => [entry.id, entry.label]), '选择兵种');
    selector.setAttribute('data-entry-select', 'units'); selector.value = selected;
    on(selector, 'change', () => { selection.set('units', selector.value); renderContent(); }, true);
    label(content, '选择兵种', selector);
    const columns = node('div', 'ms-sides'); content.appendChild(columns);
    const entry = entries.find(item => String(item.id) === selected);
    for (const [side, title] of [['left', '红方兵种'], ['right', '蓝方兵种']]) {
      const section = card(columns, title, side); section.setAttribute('data-unit-side', side);
      fieldsInto(section, (entry?.fields ?? []).filter(field => fieldSide(field) === side), { prefix: title });
    }
  }
  function fieldInput(field, value, { live = false, prefix = '' } = {}) {
    const type = field.type ?? typeof value;
    if (type === 'unit-list') return candidateInput(field, value);
    const isText = type === 'string' || type === 'text', isBool = type === 'boolean';
    const multiline = isText && field.path.endsWith('description');
    const unitChoice = !isText && !isBool && field.unit === '兵种 ID';
    const input = node(unitChoice ? 'select' : multiline ? 'textarea' : 'input');
    if (unitChoice) for (const unit of group('units')?.entries ?? []) option(input, unit.id, unit.label);
    // Text + numeric inputMode preserves overflowing numeric text so it can be clamped;
    // type=number silently empties values such as 1e999 before input handlers can read them.
    if (!multiline && !unitChoice) input.type = isBool ? 'checkbox' : 'text';
    if (isBool) input.checked = Boolean(value); else input.value = String(value ?? '');
    input.setAttribute('data-field-path', field.path); input.setAttribute('aria-label', `${prefix ? `${prefix}：` : ''}${field.label}`);
    if (!isText && !isBool) {
      input.step = field.integer ? '1' : 'any'; input.inputMode = field.integer ? 'numeric' : 'decimal';
      if (field.min !== undefined) input.min = String(field.min); if (field.max !== undefined) input.max = String(field.max);
    } else if (isText) input.maxLength = field.maxLength ?? (field.path.endsWith('description') ? 2000 : 120);
    const retained = unconfirmed.get(field.path);
    if (retained && (!live || retained.context === battleContext(state()))) {
      input.value = retained.raw; input.checked = retained.checked;
    } else if (retained) { unconfirmed.delete(field.path); invalid.delete(field.path); }
    if (invalid.has(field.path)) { input.value = invalid.get(field.path).raw; input.setAttribute('aria-invalid', 'true'); }
    if (!isText && !isBool) clampOnInput(input, field);
    if (live) input.setAttribute('data-live-field-path', field.path);
    bindSetting(input, { ...field, type }, { guardBattle: live });
    return input;
  }
  function fieldNotice(field, report) {
    const nextMatch = field.apply?.startsWith('下局') || !state().isBattle;
    return `${field.label}已确认${nextMatch ? '，下局生效' : '并应用'}。` + reportMessage(report, '');
  }
  function bindSetting(input, field, { guardBattle = false } = {}) {
    const binding = { input, field, read: s => readPath(s.draft, field.path), edited: unconfirmed.has(field.path), pending: false,
      revision: 0, context: battleContext(state()) }; liveBindings.push(binding);
    const remember = () => {
      binding.edited = true; binding.revision++;
      unconfirmed.set(field.path, { raw: input.value, checked: input.checked, context: binding.context });
    };
    const write = async () => {
      if (!binding.edited || destroyed) return;
      if (guardBattle && binding.context !== battleContext(state())) {
        binding.edited = false; unconfirmed.delete(field.path); invalid.delete(field.path);
        update(); notice('战局已切换，旧战局未确认的输入已丢弃。'); return;
      }
      let report;
      try {
        const next = parseFieldValue(field, input.value, input.checked);
        if (field.type !== 'boolean') input.value = String(next);
        if (JSON.stringify(next) === JSON.stringify(readPath(state().draft, field.path))) {
          invalid.delete(field.path); unconfirmed.delete(field.path); binding.edited = false;
          input.setAttribute('aria-invalid', 'false'); update(); return;
        }
        // Applying is synchronous. Only durable storage is awaited, so a fast
        // second edit cannot be dropped behind another field's saving request.
        report = customization.commitSetting(field.path, next);
        invalid.delete(field.path); unconfirmed.delete(field.path); binding.edited = false;
        input.setAttribute('aria-invalid', 'false');
      } catch (error) {
        invalid.set(field.path, { raw: input.value, error: error.message }); input.setAttribute('aria-invalid', 'true');
        notice(`${field.label}：${error.message}`, true); update(); return;
      }
      const revision = binding.revision;
      notice(fieldNotice(field, report));
      const savingPromise = persist(), storageRevision = saveRevision;
      try { await savingPromise; if (binding.revision === revision && storageRevision === saveRevision) notice(fieldNotice(field, report)); }
      catch (error) { if (storageRevision === saveRevision) notice(error.message, true); }
    };
    on(input, 'input', remember, true);
    on(input, 'change', () => { if (!binding.edited) remember(); void write(); }, true);
    on(input, 'blur', () => { void write(); }, true);
    on(input, 'keydown', event => {
      // Shift+Enter retains native multi-line description editing.
      if (event.code === 'Enter' && !event.shiftKey) { event.preventDefault(); if (!event.repeat) void write(); }
    }, true);
  }
  function candidateInput(field, value) {
    const box = node('div', 'ms-candidates'); box.setAttribute('data-field-path', field.path); box.setAttribute('role', 'group'); box.setAttribute('aria-label', field.label);
    const selected = new Set(value ?? []), inputs = [];
    for (const unit of group('units')?.entries ?? []) {
      const input = node('input'); input.type = 'checkbox'; input.checked = selected.has(Number(unit.id));
      input.setAttribute('data-candidate-unit', unit.id); input.setAttribute('aria-label', `${field.label}：${unit.label}`); inputs.push([Number(unit.id), input]);
      const line = node('label', 'ms-check'); line.appendChild(input); line.appendChild(node('span', '', unit.label)); box.appendChild(line);
      on(input, 'change', async () => {
        const next = inputs.filter(([, item]) => item.checked).map(([id]) => id);
        try { customization.commitSetting(field.path, next); invalid.delete(field.path); box.setAttribute('aria-invalid', 'false'); }
        catch (error) { input.checked = !input.checked; notice(`${field.label}：${error.message}`, true); update(); return; }
        notice('候选兵种已确认并应用。');
        const savingPromise = persist(), storageRevision = saveRevision;
        try { await savingPromise; if (storageRevision === saveRevision) notice('候选兵种已应用并保存到本机。'); }
        catch (error) { if (storageRevision === saveRevision) notice(error.message, true); }
        update();
      }, true);
    }
    return box;
  }
  function clampOnInput(input, field) {
    on(input, 'input', () => {
      const raw = input.value.trim();
      if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(raw)) return;
      const value = Number(raw), minimum = field.min ?? (field.integer ? Number.MIN_SAFE_INTEGER : -Number.MAX_VALUE), maximum = field.max ?? (field.integer ? Number.MAX_SAFE_INTEGER : Number.MAX_VALUE);
      // Clamp an upper overflow immediately. A lower-bound clamp waits for commit,
      // otherwise typing the leading 0 of a valid fraction (e.g. 0.5) is impossible.
      if (value >= maximum && field.integer) input.value = String(clampInteger(raw, { min: minimum, max: maximum }));
      else if (value > maximum) input.value = String(maximum);
    }, true);
  }
  function bindLive(input, field, read, commit) {
    const binding = { input, field, read, edited: false, pending: false, revision: 0, context: sandboxContext }; liveBindings.push(binding);
    input.setAttribute('data-needs-battle', '');
    on(input, 'input', () => { binding.edited = true; binding.revision++; }, true);
    const write = async () => {
      const current = state();
      if (!binding.edited || binding.pending || !current.isBattle) return;
      if (binding.context !== battleContext(current)) {
        binding.edited = false; update(); notice('战局已切换，旧战局未确认的输入已丢弃。'); return;
      }
      try {
        const next = parseFieldValue(field, input.value, input.checked);
        if (field.type !== 'boolean') input.value = String(next);
        const revision = binding.revision;
        binding.pending = true; await commit(next); binding.edited = binding.revision !== revision; input.setAttribute('aria-invalid', 'false'); notice('已立即修改本局对应状态；当前金币、人口和生命等战况不作为下局开局设置。');
      } catch (error) { input.setAttribute('aria-invalid', 'true'); notice(`${field.label}：${error.message}`, true); }
      finally { binding.pending = false; update(); }
    };
    if (field.type === 'boolean') on(input, 'change', () => { binding.edited = true; void write(); }, true);
    on(input, 'blur', () => { void write(); }, true);
    on(input, 'keydown', event => { if (event.code === 'Enter') { event.preventDefault(); if (!event.repeat) void write(); } }, true);
  }
  function selectInput(values, aria) {
    const input = node('select'); input.setAttribute('aria-label', aria);
    for (const [value, text] of values) option(input, value, text); input.value = String(values[0]?.[0] ?? ''); return input;
  }
  function numberInput(value, aria, min = 0, max = Number.MAX_SAFE_INTEGER) {
    const input = node('input'); input.type = 'text'; input.inputMode = 'numeric'; input.value = String(value ?? ''); input.min = String(min); input.max = String(max); input.step = '1';
    input.setAttribute('aria-label', aria); clampOnInput(input, { integer: true, min, max }); return input;
  }
  function number(input) { return parseFieldValue({ type: 'number', integer: true, min: Number(input.min), max: Number(input.max) }, input.value); }
  function battleButton(parent, text, actionName, callback, className = '') {
    const result = button(parent, text, actionName, () => action(callback), className, true); result.setAttribute('data-needs-battle', ''); return result;
  }
  async function commitBehavior(path, enabled, label) {
    let storageRevision;
    try {
      customization.commitSetting(path, enabled); notice(`${label}已更新，本局与下局均使用此设置。`);
      const savingPromise = persist(); storageRevision = saveRevision; await savingPromise;
      if (storageRevision === saveRevision) notice(`${label}已应用并保存，本局与下局均使用此设置。`);
    } catch (error) { if (storageRevision === undefined || storageRevision === saveRevision) notice(error.message, true); }
    update();
  }
  function renderSandbox() {
    const summary = node('p', 'ms-summary'); summary.setAttribute('data-battle-summary', ''); content.appendChild(summary);
    const columns = node('div', 'ms-sides');
    const s = state(), dualAI = s.battle?.matchMode === 'ai-vs-ai';
    const baseFields = groupFields('bases').filter(field => !dualAI || field.path.startsWith('config.sides.')); sandboxContext = battleContext(s);
    const difficulty = s.battle?.difficulty ?? startDifficulty;
    if (!dualAI) baseFields.push(...(group('difficulties')?.entries?.find(entry => Number(entry.id) === difficulty)?.fields ?? []).filter(field => /\.blueBase/.test(field.path)));
    for (const [side, sideLabel] of [['left', '红方'], ['right', '蓝方']]) {
      const sideCard = card(columns, sideLabel + '当前状态', side); sideCard.setAttribute('data-live-side', side);
      for (const [key, text, integer] of [['money', '当前金币', true], ['income', '当前每轮收入', true], ['population', '本轮剩余人口', true], ['baseHp', '水晶当前生命', false]]) {
        const field = { label: sideLabel + text, type: 'number', integer, min: 0, max: integer ? Number.MAX_SAFE_INTEGER : Number.MAX_VALUE };
        const input = numberInput(s.battle?.[side]?.[key], field.label, field.min, field.max); if (!integer) { input.step = 'any'; input.inputMode = 'decimal'; }
        input.setAttribute('data-live-resource', side + '.' + key);
        bindLive(input, field, current => current.battle?.[side]?.[key], next => customization.setResources({ side, [key]: next }));
        label(sideCard, text, input);
      }
      const sideFields = baseFields.filter(field => {
        const explicit = fieldSide(field); if (explicit) return explicit === side;
        if (field.path.startsWith('config.difficulties.')) return side === 'right' && field.path.startsWith('config.difficulties.' + difficulty + '.');
        return side === 'left';
      });
      fieldsInto(sideCard, sideFields, { live: true, prefix: sideLabel });
      const selectedUnit = selectInput((group('units')?.entries ?? []).map(entry => [entry.id, entry.label]), sideLabel + '当前招募兵种');
      selectedUnit.setAttribute('data-live-selected-unit', side); selectedUnit.setAttribute('data-needs-battle', '');
      selectedUnit.value = String(s.battle?.[side]?.selectedUnit ?? 0); label(sideCard, '当前招募兵种', selectedUnit);
      on(selectedUnit, 'change', () => {
        // action() publishes busy status first. Capture the user value before
        // that refresh can restore an unfocused control from simulation state.
        const unitId = Number(selectedUnit.value);
        return action(async () => { await customization.selectUnit({ side, unitId }); notice('已切换' + sideLabel + '招募兵种。'); });
      }, true);
      const check = node('input'); check.type = 'checkbox'; check.checked = s.battle?.[side]?.recruitment ?? true;
      check.setAttribute('data-live-recruitment', side); check.setAttribute('data-needs-battle', '');
      const line = node('label', 'ms-check'); line.appendChild(check); line.appendChild(node('span', '', sideLabel + '自动招募')); sideCard.appendChild(line);
      on(check, 'change', () => {
        const enabled = check.checked;
        return commitBehavior(`rules.${side}Recruitment`, enabled, sideLabel + '自动招募');
      }, true);
    }
    const basics = card(content, '通用基础规则');
    fieldsInto(basics, groupFields('basic').length ? groupFields('basic') : groupFields('economy').filter(field => field.apply !== '下局'), { live: true });
    if (!dualAI) {
      const ai = node('input'); ai.type = 'checkbox'; ai.checked = s.battle?.enemyAi ?? true; ai.setAttribute('data-live-ai', ''); ai.setAttribute('data-needs-battle', '');
      const aiLabel = node('label', 'ms-check'); aiLabel.appendChild(ai); aiLabel.appendChild(node('span', '', '蓝方电脑自动选择兵种（单人局）')); basics.appendChild(aiLabel);
      on(ai, 'change', () => {
        const enabled = ai.checked;
        return commitBehavior('rules.enemyAi', enabled, '电脑自动选兵');
      }, true);
    }
    const spawnCard = card(content, '生成士兵 / 清场'), row = node('div', 'ms-row');
    const unit = selectInput((group('units')?.entries ?? []).map(entry => [entry.id, entry.label]), '刷兵兵种'); unit.setAttribute('data-sandbox-unit', '');
    const count = numberInput(1, '刷兵数量', 1); count.setAttribute('data-sandbox-count', '');
    label(row, '兵种', unit); label(row, '生成数量（不是人口消耗）', count); spawnCard.appendChild(row);
    const spawnActions = node('div', 'ms-row'); spawnCard.appendChild(spawnActions);
    for (const [side, sideLabel] of [['left', '红方'], ['right', '蓝方']]) {
      battleButton(spawnActions, '生成' + sideLabel + '士兵', 'spawn-' + side, async () => {
        const amount = number(count); count.value = String(amount);
        await customization.startSpawn({ side, unitId: Number(unit.value), count: amount });
        notice('已开始分批生成' + sideLabel + '士兵。可以取消尚未生成的部分；大量士兵仍会增加运行负担。');
      }, 'ms-primary').setAttribute('data-spawn-start', '');
    }
    const progressRow = node('div', 'ms-row'), progress = node('span'); progress.setAttribute('data-spawn-progress', '');
    progress.setAttribute('role', 'status'); progressRow.appendChild(progress);
    button(progressRow, '取消剩余生成', 'cancel-spawn', () => {
      try { customization.cancelSpawn(); notice('已取消剩余生成，已经生成的士兵保留。'); update(); }
      catch (error) { notice(error.message, true); }
    }, '', true);
    spawnCard.appendChild(progressRow);
    const clearActions = node('div', 'ms-row'); spawnCard.appendChild(clearActions);
    for (const [side, sideLabel, actionId] of [['left', '红方', 'clear-left'], ['right', '蓝方', 'clear-right'], ['both', '双方', 'clear-all']]) {
      battleButton(clearActions, '清除' + sideLabel + '士兵', actionId, async () => {
        await customization.clearTroops(side); notice('已清除' + sideLabel + '士兵；死亡动画随游戏运行播放，暂停时等待恢复。');
      }, 'ms-danger');
    }
    // Keep combat tools directly under the summary, followed by common rules
    // and then both sides. appendChild also works in lightweight DOM adapters.
    content.appendChild(spawnCard); content.appendChild(basics); content.appendChild(columns);
    const navigation = card(content, '新局与主菜单');
    button(navigation, '调整开局参数 / 开始新局', 'goto-starting', () => { activeTab = 'starting'; renderContent(); }, '', true);
    if (typeof customization.returnToMenu === 'function') button(navigation, '返回主菜单（结束本局）', 'return-original', () => action(async () => {
      if (state().isBattle && !await confirmAction('结束当前战局并返回主菜单？当前设置和已保存预设保留；不会恢复原版默认。')) return;
      await customization.returnToMenu(); notice('已结束本局并返回主菜单；当前设置和预设保留，下局继续使用。');
    }), '', true);
  }
  function inlineChoices(parent, values, selected, attribute, choose) {
    const row = node('div', 'ms-choice'); row.setAttribute('role', 'group'); parent.appendChild(row);
    const controls = [];
    for (const [value, text] of values) {
      const control = button(row, text, null, () => {
        choose(value); for (const [key, item] of controls) item.setAttribute('aria-pressed', String(String(key) === String(value)));
      }, '', true);
      control.setAttribute(attribute, value); control.setAttribute('aria-pressed', String(String(value) === String(selected))); controls.push([value, control]);
    }
  }
  function renderStarting() {
    const startCard = card(content, '开始新战局');
    const difficulties = group('difficulties')?.entries ?? [];
    const current = state(), battle = current.battle, context = battleContext(current);
    if (startingContext !== context && battle) {
      startDualAI = battle.matchMode === 'ai-vs-ai';
      if (startDualAI) startAIOptions = { leftDifficulty: battle.dualAI.leftDifficulty, rightDifficulty: battle.dualAI.rightDifficulty,
        applyDifficultyStats: battle.dualAI.applyDifficultyStats };
      else { startSinglePlay = battle.matchMode !== 'dual'; startDifficulty = battle.difficulty; }
    }
    startingContext = context;
    inlineChoices(startCard, [[true, '单人对战电脑'], [false, '双人对战'], ['ai-vs-ai', '双 AI 对战']],
      startDualAI ? 'ai-vs-ai' : startSinglePlay, 'data-start-mode', value => {
        startDualAI = value === 'ai-vs-ai'; if (!startDualAI) startSinglePlay = value; renderContent();
      });
    if (startDualAI) {
      for (const [side, name] of [['left', '红方 AI'], ['right', '蓝方 AI']]) {
        startCard.appendChild(node('span', 'ms-muted', `${name} 难度`));
        inlineChoices(startCard, difficulties.map(entry => [Number(entry.id), entry.label]), startAIOptions[`${side}Difficulty`],
          `data-start-ai-${side}`, value => { startAIOptions[`${side}Difficulty`] = value; });
      }
      const full = node('input'); full.type = 'checkbox'; full.checked = startAIOptions.applyDifficultyStats;
      full.setAttribute('data-start-ai-stats', '');
      const line = node('label', 'ms-check'); line.appendChild(full); line.appendChild(node('span', '', '同时使用所选难度的数值加成')); startCard.appendChild(line);
      on(full, 'change', () => { startAIOptions.applyDifficultyStats = full.checked; }, true);
    } else {
      startCard.appendChild(node('span', 'ms-muted', '新局难度'));
      inlineChoices(startCard, difficulties.map(entry => [Number(entry.id), entry.label]), startDifficulty, 'data-start-difficulty', value => { startDifficulty = value; });
    }
    button(startCard, '按当前设置开始新战局', 'start-battle', () => action(async () => {
      assertValid();
      if (state().isBattle && !await confirmAction('重新开始将结束当前战局。按当前设置开始新局？')) return;
      const options = startDualAI ? { mode: 'ai-vs-ai', dualAI: { ...startAIOptions } }
        : { difficulty: startDifficulty, singlePlay: startSinglePlay };
      if (onStartBattle) await onStartBattle(options); else await customization.startBattle(options);
      notice('已开始新战局。');
    }), 'ms-primary', true);
    const entries = group('starting')?.entries ?? group('start')?.entries ?? [];
    for (const entry of entries) {
      const section = card(content, entry.label); fieldsInto(section, entry.fields ?? []);
    }
    const behavior = group('behavior');
    if (behavior) {
      const section = card(content, '自动行为（本局与下局）');
      fieldsInto(section, (behavior.entries?.flatMap(entry => entry.fields ?? []) ?? []).filter(field => !startDualAI || field.path !== 'rules.enemyAi').map(field => ({ ...field,
        label: field.label.replace('开局', ''), unit: field.path === 'rules.enemyAi' ? field.unit : '本局与下局共用', apply: '本局立即生效，后续新局沿用' })));
    }
  }
  function renderDifficulties() {
    const entries = group('difficulties')?.entries ?? [];
    const selected = selection.get('difficulties') ?? String(state().battle?.difficulty ?? 1);
    const entry = entries.find(item => String(item.id) === selected) ?? entries[0];
    const selector = selectInput(entries.map(item => [item.id, item.label]), '编辑哪个难度的 AI');
    selector.setAttribute('data-entry-select', 'difficulties'); selector.value = String(entry?.id ?? '');
    on(selector, 'change', () => { selection.set('difficulties', selector.value); renderContent(); }, true);
    label(content, 'AI 难度', selector);
    const groups = [['general', '战斗参数与选兵规则'], ['random', '随机候选与统计兵种'], ['counter', '反制候选']];
    const category = selection.get('ai-category') ?? 'general';
    const menu = selectInput(groups, 'AI 参数分类'); menu.value = category; menu.setAttribute('data-ai-category', '');
    on(menu, 'change', () => { selection.set('ai-category', menu.value); renderContent(); }, true);
    label(content, '参数分类', menu);
    const section = card(content, entry?.label ?? 'AI'); section.setAttribute('data-ai-difficulty', entry?.id ?? '');
    const fields = (entry?.fields ?? []).filter(field => field.apply !== '下局');
    if (category === 'random' || category === 'counter') {
      const pools = node('div', 'ms-pools'); pools.setAttribute('data-ai-candidate-pools', category); section.appendChild(pools);
      const candidates = fields.filter(field => field.type === 'unit-list'
        && field.path.includes('.ai.counterChoices.') === (category === 'counter'));
      fieldsInto(pools, candidates.map(field => {
        const id = /\.ai\.counterChoices\.(\d+)$/.exec(field.path)?.[1];
        const unit = group('units')?.entries?.find(item => String(item.id) === id);
        return unit ? { ...field, label: `对 ${unit.label} 的反制候选` } : field;
      }));
    } else fieldsInto(section, fields.filter(field => field.type !== 'unit-list'));
  }
  let presetSelect = null, presetName = null;
  function renderPresets() {
    const card = node('section', 'ms-card'), row = node('div', 'ms-row'); card.appendChild(node('h3', '', '本机预设'));
    presetSelect = selectInput([['', '选择已保存预设']], '已保存预设'); presetSelect.setAttribute('data-preset-select', '');
    presetName = node('input'); presetName.type = 'text'; presetName.maxLength = 80; presetName.placeholder = '例如：近战大混战'; presetName.value = presetNameDraft; presetName.setAttribute('aria-label', '预设名称'); presetName.setAttribute('data-preset-name', '');
    label(row, '已保存预设', presetSelect); label(row, '名称', presetName); card.appendChild(row);
    const buttons = node('div', 'ms-row');
    button(buttons, '载入并应用', 'load-preset', () => action(async () => {
      if (!presetSelect.value) throw new Error('请先选择一个已保存的预设。');
      if (!await discardEdits('载入预设')) return;
      await customization.loadPreset(presetSelect.value); selectedPreset = presetSelect.value; invalid.clear(); unconfirmed.clear();
      const report = customization.applySettings(); await persist();
      presetName.value = state().presets.find(item => item.id === selectedPreset)?.name ?? '';
      notice('预设已载入、应用并保存。' + reportMessage(report, '开局项从下局生效。'));
    }), '', true);
    button(buttons, '另存为新预设', 'save-preset', () => savePreset(false), 'ms-primary', true);
    button(buttons, '覆盖所选预设', 'overwrite-preset', () => savePreset(true), '', true);
    button(buttons, '删除所选', 'delete-preset', () => action(async () => {
      if (!presetSelect.value) throw new Error('请先选择预设。');
      if (!await confirmAction('删除所选的本机预设？当前设置与战局不改变。')) return;
      await customization.deletePreset(presetSelect.value); await persist(); selectedPreset = ''; refreshPresets(true); notice('已删除所选预设，当前设置与战局保留。');
    }), 'ms-danger', true);
    card.appendChild(buttons); content.appendChild(card); refreshPresets(true);
    const transfer = node('section', 'ms-card'); transfer.appendChild(node('h3', '', '导入 / 导出规则文件'));
    const file = node('input'); file.type = 'file'; file.accept = '.json,application/json'; file.hidden = true; file.setAttribute('data-preset-file', ''); transfer.appendChild(file);
    on(file, 'change', () => action(async () => {
      try {
        const chosen = file.files?.[0]; if (!chosen) return;
        if (chosen.size > 256 * 1024) throw new Error('单个预设 JSON 不得超过 256 KB。');
        if (!await discardEdits('导入文件')) return;
        await customization.importJSON(await chosen.text()); invalid.clear(); unconfirmed.clear(); selectedPreset = ''; refreshPresets(true);
        const report = customization.applySettings(); await persist();
        notice('文件校验通过，已导入、应用并保存。' + reportMessage(report, '开局项从下局生效。') + ' 如需命名副本，可另存为预设。');
      } finally { file.value = ''; }
    }), true);
    const fileActions = node('div', 'ms-row');
    button(fileActions, '导入并应用 JSON', 'import', () => file.click(), '', true);
    button(fileActions, '导出 JSON', 'export', () => action(async () => {
      assertValid(); const name = presetName.value.trim() || 'custom';
      const json = await customization.exportJSON(name);
      if (download) await download(json, presetFilename(name));
      else {
        if (!win.URL?.createObjectURL || !win.Blob) throw new Error('当前环境不支持下载文件。');
        const url = win.URL.createObjectURL(new win.Blob([json], { type: 'application/json;charset=utf-8' }));
        const link = node('a'); link.href = url; link.download = presetFilename(name); link.hidden = true;
        (doc.body ?? doc.documentElement).appendChild(link); link.click(); link.remove();
        win.setTimeout(() => win.URL.revokeObjectURL(url), 1000);
      }
      notice('已将当前设置导出为 JSON 备份文件；导出不会再次改变战局。');
    }), '', true);
    transfer.appendChild(fileActions); content.appendChild(transfer);
  }
  async function discardEdits(actionName) { return !(unconfirmed.size || invalid.size) || await confirmAction(`${actionName}将替换尚未确认的输入，继续？`); }
  async function savePreset(overwrite) {
    await action(async () => {
      assertValid(); const name = presetName.value.trim(); if (!name) throw new Error('请填写预设名称。');
      const id = overwrite ? presetSelect.value : undefined;
      if (overwrite && !id) throw new Error('请先选择要覆盖的预设。');
      if (overwrite && !await confirmAction('覆盖所选预设？其他预设和当前战局不改变。')) return;
      const saved = await customization.savePreset(name, id); await persist();
      selectedPreset = saved?.id ?? id ?? ''; refreshPresets(true); notice('预设副本已保存到本机；当前设置本来就已自动保存，无需重复应用。');
    });
  }
  function refreshPresets(force = false) {
    if (activeTab !== 'presets' || !presetSelect) return;
    const presets = state().presets ?? [], signature = JSON.stringify(presets);
    if (!force && signature === lastPresetSignature) return;
    lastPresetSignature = signature; const retained = selectedPreset || presetSelect.value;
    while (presetSelect.firstChild) presetSelect.removeChild(presetSelect.firstChild);
    option(presetSelect, '', '选择已保存预设'); for (const preset of presets) option(presetSelect, preset.id, preset.name);
    presetSelect.value = presets.some(preset => preset.id === retained) ? retained : '';
  }
  function update() {
    if (destroyed) return;
    // The collapsed editor performs no profile cloning / DOM traversal in the game loop.
    if (!opened) return;
    const current = state();
    if ((activeTab === 'sandbox' && sandboxContext !== battleContext(current))
      || (activeTab === 'starting' && startingContext !== battleContext(current))) {
      // Native menu navigation can replace a match without closing this dock.
      // clearContent removes listeners before detaching focused fields, so a
      // resulting blur cannot accidentally apply old text to the new match.
      renderContent(); notice('战局已切换，当前状态已刷新；旧战局未确认的输入未应用。'); return;
    }
    const saveState = saving || ['pending', 'saving'].includes(current.storageStatus) ? 'saving'
      : saveFailed || current.storageStatus === 'error' ? 'failed' : current.settingsSaved === false ? 'default' : 'saved';
    setText(dirtyLabel, invalid.size ? `${invalid.size} 项输入无效` : saveState === 'saving' ? '本机保存中…'
      : saveState === 'failed' ? '本机保存失败 · 可导出备份' : unconfirmed.size ? '输入待确认（Enter / 离开确认）'
        : saveState === 'default' ? '当前设置就绪 · 修改后自动保存' : '已保存到本机');
    dirtyLabel.setAttribute('data-save-state', saveState);
    undo.disabled = busy || !current.canUndoSettings;
    reset.disabled = busy;
    for (const control of content.querySelectorAll('[data-needs-battle]')) control.disabled = busy || !current.isBattle;
    for (const binding of liveBindings) {
      const { input, field, read } = binding;
      if (doc.activeElement === input || binding.edited || binding.pending) continue;
      const value = read(current);
      if (field.type === 'boolean') input.checked = Boolean(value);
      else if (input.value !== String(value ?? '')) input.value = String(value ?? '');
    }
    const job = current.spawnJob ?? customization.getSpawnJob?.();
    const spawning = job?.status === 'running' || job?.status === 'queued';
    for (const control of content.querySelectorAll('[data-spawn-start]')) control.disabled = busy || !current.isBattle || spawning;
    const cancel = content.querySelector('[data-settings-action="cancel-spawn"]'); if (cancel) cancel.disabled = !spawning;
    const progress = content.querySelector('[data-spawn-progress]');
    if (progress) {
      const status = { running: '生成中', queued: '等待生成', completed: '生成完成', cancelled: '已取消剩余', failed: '生成停止' }[job?.status] ?? job?.status;
      setText(progress, job ? `${status}：${formatted(job.completed)} / ${formatted(job.requested)}${job.error ? ` · ${job.error}` : ''}` : '无生成任务');
    }
    const summary = content.querySelector('[data-battle-summary]');
    if (summary) {
      if (!current.isBattle || !current.battle) setText(summary, '尚无进行中的战局。');
      else {
        const battle = current.battle;
        const line = (side, name) => `${name}：金币 ${formatted(battle[side]?.money)} · 收入 ${formatted(battle[side]?.income)} · 人口 ${formatted(battle[side]?.population)} · 士兵 ${formatted(battle[side]?.units)} · 水晶 HP ${formatted(battle[side]?.baseHp)}`;
        const difficulty = group('difficulties')?.entries?.find(entry => Number(entry.id) === Number(battle.difficulty));
        const aiDifficulty = side => group('difficulties')?.entries?.find(entry => Number(entry.id) === battle.dualAI?.[`${side}Difficulty`])?.label ?? battle.dualAI?.[`${side}Difficulty`];
        const match = battle.matchMode === 'ai-vs-ai' ? `双 AI 对战：红方 ${aiDifficulty('left')} / 蓝方 ${aiDifficulty('right')}\n数值档：${battle.dualAI.applyDifficultyStats ? '分别使用所选难度' : '双方当前普通档（仅 AI 选兵难度不同）'}`
          : `本局难度：${difficulty?.label ?? battle.difficulty}`;
        setText(summary, `${match}\n规则：${current.mode === 'original' ? '原版规则' : '自定义（已修改）'}\n${line('left', '红方')}\n${line('right', '蓝方')}`);
      }
    }
    for (const side of ['left', 'right']) {
      const input = content.querySelector(`[data-live-recruitment="${side}"]`);
      if (input && doc.activeElement !== input) input.checked = current.battle?.[side]?.recruitment ?? true;
      const selectedUnit = content.querySelector(`[data-live-selected-unit="${side}"]`);
      if (selectedUnit && doc.activeElement !== selectedUnit) selectedUnit.value = String(current.battle?.[side]?.selectedUnit ?? 0);
    }
    const ai = content.querySelector('[data-live-ai]'); if (ai && doc.activeElement !== ai) ai.checked = current.battle?.enemyAi ?? true;
    refreshPresets();
    setText(storageNotice, (current.warnings ?? []).join('；'));
    storageNotice.hidden = !storageNotice.textContent;
    element.setAttribute('aria-busy', String(busy));
  }
  function open() {
    if (destroyed || opened) return; opened = true; beforeFocus = doc.activeElement;
    element.hidden = false; renderContent(); onOpenChange(true); closeButton.focus({ preventScroll: true });
  }
  function close() {
    if (destroyed || !opened) return; opened = false; cancelConfirmation(); element.hidden = true; onOpenChange(false);
    beforeFocus?.focus?.({ preventScroll: true });
  }
  for (const type of ['pointerdown', 'pointerup', 'click', 'wheel']) on(element, type, event => event.stopPropagation());
  on(element, 'keydown', event => {
    if (event.code === 'F11') return; // host owns fullscreen for the complete game + dock shell.
    if (event.code === 'F2' || event.code === 'Escape') { event.preventDefault(); if (!event.repeat) close(); }
    event.stopPropagation(); // Keep native input editing but never leak WASD, IJKL or Enter to the game.
  });
  on(element, 'keyup', event => event.stopPropagation());
  renderContent(); notice('');
  return Object.freeze({ element, open, close, toggle() { if (opened) close(); else open(); },
    get isOpen() { return opened; }, get isConfirming() { return Boolean(awaitingConfirmation); }, update, destroy() {
      if (destroyed) return; close(); destroyed = true; confirmation.destroy();
      for (const remove of [...currentTabCleanup, ...cleanups]) remove(); element.remove(); style.remove();
    } });
}
