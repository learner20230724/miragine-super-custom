import { clampInteger } from '../customization/numeric.mjs';

/** Opt-in rules editor. Draft editing, persistence and battle mutations are distinct actions. */
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
[data-settings-panel] .ms-apply-help {position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap;border:0}
[data-settings-panel] .ms-dirty {font-size:11px;color:#e4c97f}
[data-settings-panel] .ms-check {display:flex;align-items:center;gap:7px;font-size:12px}
[data-settings-panel] .ms-sides {display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;container-type:inline-size}
[data-settings-panel] .ms-side {min-width:0;border-top:3px solid #b96160}
[data-settings-panel] .ms-side[data-side=right] {border-top-color:#668ed6}
[data-settings-panel] .ms-side .ms-field {min-width:0;margin-bottom:9px}
[data-settings-panel] .ms-side input:not([type=checkbox]),[data-settings-panel] .ms-side select {width:100%;min-width:0}
[data-settings-panel] .ms-field-help {font-size:10px;color:#abbba5;overflow-wrap:anywhere}
[data-settings-panel] .ms-choice {display:flex;gap:5px;flex-wrap:wrap;margin-bottom:10px}
[data-settings-panel] .ms-choice button[aria-pressed=true] {background:#665d30;border-color:#ccb868}
[data-settings-panel] .ms-candidates {display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:3px 8px}
[data-settings-panel] .ms-candidates .ms-check {font-size:11px;min-width:0;overflow-wrap:anywhere}
[data-settings-panel] .ms-live-note {margin-bottom:9px;color:#d5c28a;font-size:11px}
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
  const confirmAction = confirm ?? (message => typeof win.confirm === 'function' ? win.confirm(message) : false);
  const node = (tag, className = '', text) => {
    const result = doc.createElement(tag); if (className) result.className = className;
    if (text !== undefined) result.textContent = String(text); return result;
  };
  const cleanups = [], invalid = new Map(), selection = new Map(), tabButtons = new Map();
  const state = () => customization.getState();
  let opened = false, destroyed = false, busy = false, activeTab = 'sandbox', selectedPreset = '', lastPresetSignature = '';
  let presentation = { paused: false, speed: 1 }, beforeFocus = null, presetNameDraft = '';
  let currentTabCleanup = [], liveBindings = [], metadataCache = null, sandboxContext = null, startDifficulty = 1, startSinglePlay = true;
  function on(element, type, listener, transient = false) {
    element.addEventListener(type, listener);
    (transient ? currentTabCleanup : cleanups).push(() => element.removeEventListener(type, listener)); return element;
  }
  const style = node('style'); style.setAttribute('data-settings-panel-style', ''); style.textContent = SETTINGS_PANEL_CSS;
  (doc.head ?? doc.documentElement).appendChild(style);
  const element = node('aside'); element.id = 'miragine-settings-panel'; element.setAttribute('data-settings-panel', '');
  element.setAttribute('aria-label', '自定义规则与沙盒'); element.hidden = true;
  const header = node('header', 'ms-header'), titleBlock = node('div');
  const titleRow = node('div', 'ms-title-row'); titleRow.appendChild(node('h2', '', '自定义规则与沙盒'));
  const dirtyLabel = node('span', 'ms-dirty'); dirtyLabel.setAttribute('data-draft-dirty', ''); titleRow.appendChild(dirtyLabel); titleBlock.appendChild(titleRow);
  const pauseStatus = node('p', 'ms-muted'); pauseStatus.setAttribute('data-editor-pause-status', ''); titleBlock.appendChild(pauseStatus); header.appendChild(titleBlock);
  const headerActions = node('div', 'ms-header-actions'); header.appendChild(headerActions); element.appendChild(header);
  function button(parent, text, action, callback, className = '', transient = false) {
    const control = node('button', className, text); control.type = 'button';
    if (action) control.setAttribute('data-settings-action', action);
    on(control, 'click', event => { event.stopPropagation(); if (!destroyed && !control.disabled) callback(event); }, transient);
    parent.appendChild(control); return control;
  }
  const closeButton = button(headerActions, '收起 ×', 'close', () => close()); closeButton.setAttribute('aria-label', '收起设置（F2 或 Escape）');
  const scroll = node('div', 'ms-scroll'); element.appendChild(scroll);
  if (playbackElement) scroll.appendChild(playbackElement);
  const nav = node('nav', 'ms-tabs'); nav.setAttribute('role', 'tablist'); nav.setAttribute('aria-label', '自定义设置分类'); scroll.appendChild(nav);
  const content = node('div', 'ms-content'); content.setAttribute('role', 'tabpanel'); content.id = 'miragine-settings-content'; scroll.appendChild(content);
  const message = node('p', 'ms-message'); message.setAttribute('role', 'status'); message.setAttribute('aria-live', 'polite');
  message.setAttribute('data-settings-message', ''); element.appendChild(message);
  const footer = node('footer', 'ms-footer'), footerTools = node('div', 'ms-footer-actions');
  footerTools.setAttribute('data-settings-footer-actions', '');
  const undo = button(footerTools, '撤销', 'undo', () => action(async () => {
    customization.undoDraft(); invalid.clear(); renderContent(); notice('已撤销草稿修改，不会撤销已经生效的战局变化。');
  }));
  undo.setAttribute('title', '只撤销草稿修改，不撤销已生效的战局变化');
  const reset = button(footerTools, '恢复原版默认', 'reset', () => action(async () => {
    if (!confirmAction('将编辑草稿恢复为原版默认？已保存预设不删除，当前战局不会自动改变。')) return;
    customization.resetDraft(); invalid.clear(); selectedPreset = ''; renderContent(); notice('草稿已恢复为原版默认，尚未保存或应用。');
  }));
  reset.setAttribute('title', '只恢复草稿默认值；点击应用后才改变规则');
  const apply = button(footerTools, '应用设置', 'apply-current', () => action(async () => {
    assertValid();
    if (state().isBattle) {
      const report = await customization.applyCurrent({ health: 'ratio' });
      notice(reportMessage(report, '可即时生效的设置已应用本局，开局项从下局生效。') + ' 保存预设是独立操作。');
    } else {
      await customization.applyNext(); notice('设置已应用到下局；不会自动开始战斗。保存预设是独立操作。');
    }
  }), 'ms-primary');
  const applyHelp = node('p', 'ms-apply-help'); applyHelp.setAttribute('data-settings-apply-help', ''); applyHelp.id = 'miragine-settings-apply-help';
  apply.setAttribute('aria-describedby', applyHelp.id);
  footer.appendChild(footerTools); footer.appendChild(applyHelp); element.appendChild(footer); root.appendChild(element);
  const storageNotice = node('p', 'ms-muted'); storageNotice.setAttribute('data-storage-warning', ''); footer.appendChild(storageNotice);
  function option(select, value, text) { const result = node('option', '', text); result.value = String(value); select.appendChild(result); return result; }
  function label(parent, text, input) {
    const result = node('label', 'ms-field'); result.appendChild(node('span', '', text)); result.appendChild(input); parent.appendChild(result); return input;
  }
  function notice(text, error = false) { setText(message, String(text)); message.setAttribute('data-error', String(error)); }
  function assertValid() { if (invalid.size) throw new Error(`有 ${invalid.size} 项输入无效，请修正红框字段或撤销 / 恢复草稿。`); }
  function reportMessage(report, fallback) {
    if (typeof report === 'string') return report;
    const notes = report?.notes ?? report?.warnings ?? (report?.note ? [report.note] : []);
    const applied = Array.isArray(report?.applied) ? report.applied.length : null;
    const deferred = Array.isArray(report?.deferred) ? report.deferred.length : null;
    return (applied === null ? fallback : `已应用 ${applied} 项。`) + (deferred ? ` ${deferred} 项下局生效。` : '')
      + (notes.length ? ` ${notes.join('；')}` : '');
  }
  async function action(callback) {
    if (busy || destroyed) return; busy = true; update();
    try { await callback(); } catch (error) { notice(error?.message ?? error, true); }
    finally { busy = false; if (!destroyed) update(); }
  }
  async function persist() {
    if (typeof customization.flush !== 'function' || await customization.flush() === false) {
      throw new Error('未能确认写入本机存储；本次内容可能只在内存中，请立即导出 JSON 保存。');
    }
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
  function fieldsInto(parent, fields, { live = false, prefix = '' } = {}) {
    const current = state();
    for (const field of sortedFields(fields)) {
      const sideName = fieldSide(field) === 'left' ? '红方' : fieldSide(field) === 'right' ? '蓝方' : '';
      const input = fieldInput(field, readPath(live ? current.applied : current.draft, field.path), { live, prefix: prefix || sideName });
      const wrap = node('div', 'ms-field'), name = node('label', '', !prefix && sideName ? `${sideName} · ${field.label}` : field.label);
      // A label cannot contain a group of candidate checkboxes; its name is supplied to the fieldset instead.
      if (field.type !== 'unit-list') { const id = `miragine-field-${field.path.replace(/[^a-zA-Z0-9_-]/g, '-')}`; input.id = id; name.setAttribute('for', id); }
      wrap.appendChild(name); wrap.appendChild(input);
      const defaultValue = readPath(current.defaults, field.path);
      const timing = live ? field.apply?.startsWith('下次') ? field.apply : '' : field.apply ?? '应用后生效';
      wrap.appendChild(node('span', 'ms-field-help', `${field.unit ? `${field.unit} · ` : ''}原版默认：${Array.isArray(defaultValue) ? defaultValue.join(', ') : formatted(defaultValue)}${timing ? ` · ${timing}` : ''}`));
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
    content.appendChild(node('p', 'ms-live-note', '红蓝独立编辑，不会自动同时修改双方。这里修改的是草稿；应用本局后影响对应阵营。'));
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
    if (!live && invalid.has(field.path)) { input.value = invalid.get(field.path).raw; input.setAttribute('aria-invalid', 'true'); }
    if (!isText && !isBool) clampOnInput(input, field);
    if (live) {
      input.setAttribute('data-live-field-path', field.path);
      bindLive(input, field, s => readPath(s.applied, field.path), next => customization.applyLiveField(field.path, next, { health: 'ratio' }));
      return input;
    }
    on(input, 'change', () => {
      try {
        const next = parseFieldValue({ ...field, type }, input.value, input.checked);
        if (!isBool) input.value = String(next);
        customization.updateDraft(field.path, next); invalid.delete(field.path); input.setAttribute('aria-invalid', 'false');
        notice('草稿已修改，尚未自动应用或保存。'); update();
      } catch (error) {
        invalid.set(field.path, { raw: input.value, error: error.message }); input.setAttribute('aria-invalid', 'true');
        notice(`${field.label}：${error.message}`, true); update();
      }
    }, true);
    return input;
  }
  function candidateInput(field, value) {
    const box = node('div', 'ms-candidates'); box.setAttribute('data-field-path', field.path); box.setAttribute('role', 'group'); box.setAttribute('aria-label', field.label);
    const selected = new Set(value ?? []), inputs = [];
    for (const unit of group('units')?.entries ?? []) {
      const input = node('input'); input.type = 'checkbox'; input.checked = selected.has(Number(unit.id));
      input.setAttribute('data-candidate-unit', unit.id); input.setAttribute('aria-label', `${field.label}：${unit.label}`); inputs.push([Number(unit.id), input]);
      const line = node('label', 'ms-check'); line.appendChild(input); line.appendChild(node('span', '', unit.label)); box.appendChild(line);
      on(input, 'change', () => {
        const next = inputs.filter(([, item]) => item.checked).map(([id]) => id);
        try { customization.updateDraft(field.path, next); invalid.delete(field.path); box.setAttribute('aria-invalid', 'false'); notice('候选兵种草稿已修改，尚未应用。'); }
        catch (error) { input.checked = !input.checked; notice(`${field.label}：${error.message}`, true); }
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
        binding.pending = true; await commit(next); binding.edited = binding.revision !== revision; input.setAttribute('aria-invalid', 'false'); notice('已立即修改本局对应字段，其他草稿未自动应用。');
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
  function renderSandbox() {
    const summary = node('p', 'ms-summary'); summary.setAttribute('data-battle-summary', ''); content.appendChild(summary);
    content.appendChild(node('p', 'ms-live-note', '本页直接修改当前战局：输入后按 Enter 或离开输入框即生效。打开设置不会暂停游戏。'));
    const columns = node('div', 'ms-sides'); content.appendChild(columns);
    const s = state(), baseFields = groupFields('bases'); sandboxContext = battleContext(s);
    const difficulty = s.battle?.difficulty ?? startDifficulty;
    baseFields.push(...(group('difficulties')?.entries?.find(entry => Number(entry.id) === difficulty)?.fields ?? []).filter(field => /\.blueBase/.test(field.path)));
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
        return action(async () => { await customization.setRecruitment(side, enabled); notice('已更新' + sideLabel + '本局自动招募。'); });
      }, true);
    }
    const basics = card(content, '通用基础规则');
    fieldsInto(basics, groupFields('basic').length ? groupFields('basic') : groupFields('economy').filter(field => field.apply !== '下局'), { live: true });
    const ai = node('input'); ai.type = 'checkbox'; ai.checked = s.battle?.enemyAi ?? true; ai.setAttribute('data-live-ai', ''); ai.setAttribute('data-needs-battle', '');
    const aiLabel = node('label', 'ms-check'); aiLabel.appendChild(ai); aiLabel.appendChild(node('span', '', '蓝方电脑自动选择兵种（单人局）')); basics.appendChild(aiLabel);
    on(ai, 'change', () => {
      const enabled = ai.checked;
      return action(async () => { await customization.setEnemyAi(enabled); notice('已更新本局电脑选兵开关。'); });
    }, true);
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
        await customization.clearTroops(side); notice('已清除' + sideLabel + '士兵。');
      }, 'ms-danger');
    }
    spawnCard.appendChild(node('p', 'ms-muted', '生成数量没有额外的沙盒上限，分批执行、可取消；大量士兵依然可能耗尽内存或拖慢战斗。'));
    const navigation = card(content, '新局与原版');
    button(navigation, '调整开局参数 / 开始新局', 'goto-starting', () => { activeTab = 'starting'; renderContent(); }, '', true);
    if (typeof customization.returnToOriginal === 'function') button(navigation, '回到原版菜单', 'return-original', () => action(async () => {
      if (state().isBattle && !confirmAction('结束当前战局并回到原版菜单？草稿和已保存预设保留。')) return;
      await customization.returnToOriginal(); notice('已回到原版菜单；下局使用原版规则。草稿和预设仍保留。');
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
    content.appendChild(node('p', 'ms-summary', '本页全部是开局设置，只影响新战局，不会改变当前金币、收入、人口或当前倒计时。'));
    const startCard = card(content, '开始新战局');
    const difficulties = group('difficulties')?.entries ?? [];
    startCard.appendChild(node('p', 'ms-muted', '选择新局难度'));
    inlineChoices(startCard, difficulties.map(entry => [Number(entry.id), entry.label]), startDifficulty, 'data-start-difficulty', value => { startDifficulty = value; });
    inlineChoices(startCard, [[true, '单人对战电脑'], [false, '双人对战']], startSinglePlay, 'data-start-mode', value => { startSinglePlay = value; });
    button(startCard, '按草稿开始新战局', 'start-battle', () => action(async () => {
      assertValid();
      if (state().isBattle && !confirmAction('重新开始将结束当前战局。按当前草稿开始新局？')) return;
      const options = { difficulty: startDifficulty, singlePlay: startSinglePlay };
      if (onStartBattle) await onStartBattle(options); else await customization.startBattle(options);
      notice('已开始新战局。');
    }), 'ms-primary', true);
    const entries = group('starting')?.entries ?? group('start')?.entries ?? [];
    for (const entry of entries) {
      const section = card(content, entry.label); fieldsInto(section, entry.fields ?? []);
    }
    const behavior = group('behavior');
    if (behavior) {
      const section = card(content, '开局自动行为');
      fieldsInto(section, (behavior.entries?.flatMap(entry => entry.fields ?? []) ?? []).map(field => ({ ...field, apply: '下局（本页开局自动行为）' })));
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
    const groups = [['general', '概率与水晶战斗参数'], ['thresholds', '选兵阈值与强制选兵'], ['candidates', '随机候选与反制表']];
    const category = selection.get('ai-category') ?? 'general';
    const menu = selectInput(groups, 'AI 参数分类'); menu.value = category; menu.setAttribute('data-ai-category', '');
    on(menu, 'change', () => { selection.set('ai-category', menu.value); renderContent(); }, true);
    label(content, '参数分类', menu);
    content.appendChild(node('p', 'ms-live-note', '选择这里只切换编辑内容，不改变本局难度；修改后点击底部应用。'));
    const section = card(content, entry?.label ?? 'AI'); section.setAttribute('data-ai-difficulty', entry?.id ?? '');
    const fields = (entry?.fields ?? []).filter(field => field.apply !== '下局');
    if (category === 'candidates') {
      const candidates = fields.filter(field => field.type === 'unit-list');
      const chosen = candidates.find(field => field.path.split('.ai.')[1] === selection.get('ai-candidate')) ?? candidates[0];
      const choices = selectInput(candidates.map(field => {
        const key = field.path.split('.ai.')[1], id = /^counterChoices\.(\d+)$/.exec(key)?.[1];
        const unit = group('units')?.entries?.find(item => String(item.id) === id);
        return [key, unit ? `对 ${unit.label} 的反制候选` : field.label];
      }), '选择候选兵种表');
      choices.setAttribute('data-ai-candidate-select', ''); choices.value = chosen?.path.split('.ai.')[1] ?? '';
      on(choices, 'change', () => { selection.set('ai-candidate', choices.value); renderContent(); }, true);
      label(section, '候选表', choices); fieldsInto(section, chosen ? [chosen] : []);
    } else fieldsInto(section, fields.filter(field => category === 'general' ? !field.path.includes('.ai.')
      : field.path.includes('.ai.') && field.type !== 'unit-list'));
  }
  let presetSelect = null, presetName = null;
  function renderPresets() {
    content.appendChild(node('p', 'ms-summary', '编辑 → 应用 → 保存是三个独立动作。载入 / 导入只替换草稿；不自动修改正在进行的战局，也不覆盖 config/custom.json。'));
    const card = node('section', 'ms-card'), row = node('div', 'ms-row'); card.appendChild(node('h3', '', '本机预设'));
    presetSelect = selectInput([['', '选择已保存预设']], '已保存预设'); presetSelect.setAttribute('data-preset-select', '');
    presetName = node('input'); presetName.type = 'text'; presetName.maxLength = 80; presetName.placeholder = '例如：近战大混战'; presetName.value = presetNameDraft; presetName.setAttribute('aria-label', '预设名称'); presetName.setAttribute('data-preset-name', '');
    label(row, '已保存预设', presetSelect); label(row, '名称', presetName); card.appendChild(row);
    const buttons = node('div', 'ms-row');
    button(buttons, '载入草稿', 'load-preset', () => action(async () => {
      if (!presetSelect.value) throw new Error('请先选择一个已保存的预设。');
      if (!discardDraft('载入预设')) return;
      await customization.loadPreset(presetSelect.value); selectedPreset = presetSelect.value; invalid.clear();
      presetName.value = state().presets.find(item => item.id === selectedPreset)?.name ?? '';
      notice('预设已载入草稿，尚未应用到本局。');
    }), '', true);
    button(buttons, '另存为新预设', 'save-preset', () => savePreset(false), 'ms-primary', true);
    button(buttons, '覆盖所选预设', 'overwrite-preset', () => savePreset(true), '', true);
    button(buttons, '删除所选', 'delete-preset', () => action(async () => {
      if (!presetSelect.value) throw new Error('请先选择预设。');
      if (!confirmAction('删除所选的本机预设？当前草稿与战局不改变。')) return;
      await customization.deletePreset(presetSelect.value); await persist(); selectedPreset = ''; refreshPresets(true); notice('已删除所选预设，当前草稿与战局保留。');
    }), 'ms-danger', true);
    card.appendChild(buttons); content.appendChild(card); refreshPresets(true);
    const transfer = node('section', 'ms-card'); transfer.appendChild(node('h3', '', '导入 / 导出规则文件'));
    const file = node('input'); file.type = 'file'; file.accept = '.json,application/json'; file.hidden = true; file.setAttribute('data-preset-file', ''); transfer.appendChild(file);
    on(file, 'change', () => action(async () => {
      try {
        const chosen = file.files?.[0]; if (!chosen) return;
        if (chosen.size > 256 * 1024) throw new Error('单个预设 JSON 不得超过 256 KB。');
        if (!discardDraft('导入文件')) return;
        await customization.importJSON(await chosen.text()); invalid.clear(); selectedPreset = ''; refreshPresets(true);
        notice('文件校验通过，已导入草稿；尚未应用或保存为本机预设。');
      } finally { file.value = ''; }
    }), true);
    const fileActions = node('div', 'ms-row');
    button(fileActions, '导入 JSON', 'import', () => file.click(), '', true);
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
      notice('已导出草稿 JSON；不会自动应用到本局。');
    }), '', true);
    transfer.appendChild(fileActions); transfer.appendChild(node('p', 'ms-muted', '预设只包含白名单规则，不包含脚本。倍速、视角与显示上限是本次运行设置，不随预设保存。恢复原版默认不会删除已保存预设。')); content.appendChild(transfer);
  }
  function discardDraft(actionName) { return !(state().dirty || invalid.size) || confirmAction(`${actionName}将替换当前未保存草稿，继续？`); }
  async function savePreset(overwrite) {
    await action(async () => {
      assertValid(); const name = presetName.value.trim(); if (!name) throw new Error('请填写预设名称。');
      const id = overwrite ? presetSelect.value : undefined;
      if (overwrite && !id) throw new Error('请先选择要覆盖的预设。');
      if (overwrite && !confirmAction('覆盖所选预设？其他预设和当前战局不改变。')) return;
      const saved = await customization.savePreset(name, id); await persist();
      selectedPreset = saved?.id ?? id ?? ''; refreshPresets(true); notice('预设已保存到本机；保存不会自动应用到本局。');
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
  function update(patch = {}) {
    if (destroyed) return;
    presentation = { ...presentation, ...patch };
    // The collapsed editor performs no profile cloning / DOM traversal in the game loop.
    if (!opened) return;
    const current = state();
    if (activeTab === 'sandbox' && sandboxContext !== battleContext(current)) {
      // Native menu navigation can replace a match without closing this dock.
      // clearContent removes listeners before detaching focused fields, so a
      // resulting blur cannot accidentally apply old text to the new match.
      renderContent(); notice('战局已切换，当前状态已刷新；旧战局未确认的输入未应用。'); return;
    }
    const stopped = Boolean(presentation.paused);
    const zeroSpeed = presentation.speed === 0;
    setText(pauseStatus, !current.isBattle ? '打开设置不自动开始对局' : zeroSpeed ? '0 倍暂停中 · 使用时间控制继续' : stopped ? '战斗已暂停 · 可编辑与观察' : '战斗进行中 · 打开设置不暂停');
    setText(dirtyLabel, invalid.size ? `${invalid.size} 项输入无效` : current.dirty ? '草稿尚未保存' : '草稿就绪');
    undo.disabled = busy || !current.canUndo;
    apply.disabled = busy || invalid.size > 0;
    setText(apply, current.isBattle ? '应用设置' : '应用下局设置');
    setText(applyHelp, !current.isBattle ? '尚未开始战局：应用后从下局使用。撤销／恢复默认只改草稿。'
      : activeTab === 'sandbox' ? '本页已即时生效；按钮应用其他草稿，开局项下局生效。'
        : activeTab === 'starting' ? '开局项下局生效；其他页面可即时生效的草稿同时应用本局。'
          : '可即时生效的设置应用本局；开局项从下局生效。撤销／恢复默认只改草稿。');
    apply.setAttribute('title', applyHelp.textContent);
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
      if (!current.isBattle || !current.battle) setText(summary, '尚无进行中的战局。可以从原游戏菜单开始，或按草稿新建自定义战局。');
      else {
        const battle = current.battle;
        const line = (side, name) => `${name}：金币 ${formatted(battle[side]?.money)} · 收入 ${formatted(battle[side]?.income)} · 人口 ${formatted(battle[side]?.population)} · 士兵 ${formatted(battle[side]?.units)} · 水晶 HP ${formatted(battle[side]?.baseHp)}`;
        const difficulty = group('difficulties')?.entries?.find(entry => Number(entry.id) === Number(battle.difficulty));
        setText(summary, `本局难度：${difficulty?.label ?? battle.difficulty}\n规则：${current.mode === 'original' ? '原版规则' : '自定义（已修改）'}\n${line('left', '红方')}\n${line('right', '蓝方')}`);
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
    notice('打开设置不自动暂停。首页状态可直接修改；其他草稿请明确选择应用或保存。');
  }
  function close() {
    if (destroyed || !opened) return; opened = false; element.hidden = true; onOpenChange(false);
    beforeFocus?.focus?.({ preventScroll: true });
  }
  for (const type of ['pointerdown', 'pointerup', 'click', 'wheel']) on(element, type, event => event.stopPropagation());
  on(element, 'keydown', event => {
    if (event.code === 'F11') return; // host owns fullscreen for the complete game + dock shell.
    if (event.code === 'F2' || event.code === 'Escape') { event.preventDefault(); if (!event.repeat) close(); }
    event.stopPropagation(); // Keep native input editing but never leak WASD, IJKL or Enter to the game.
  });
  on(element, 'keyup', event => event.stopPropagation());
  renderContent(); notice('修改草稿不会自动改变战局。');
  return Object.freeze({ element, open, close, toggle() { if (opened) close(); else open(); },
    get isOpen() { return opened; }, update, destroy() {
      if (destroyed) return; close(); destroyed = true;
      for (const remove of [...currentTabCleanup, ...cleanups]) remove(); element.remove(); style.remove();
    } });
}
