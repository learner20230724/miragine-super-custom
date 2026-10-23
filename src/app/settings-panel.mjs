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
[data-settings-panel] .ms-footer .ms-row {margin-bottom:7px}
[data-settings-panel] .ms-footer .ms-row:last-child {margin-bottom:0}
[data-settings-panel] .ms-dirty {font-size:11px;color:#e4c97f;margin-left:auto}
[data-settings-panel] .ms-check {display:flex;align-items:center;gap:7px;font-size:12px}
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
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error('请输入有限数值');
  if (field.integer && !Number.isInteger(number)) throw new Error('请输入整数');
  if (field.min !== undefined && number < field.min) throw new Error(`不能小于 ${field.min}`);
  if (field.max !== undefined && number > field.max) throw new Error(`不能大于 ${field.max}`);
  return number;
}
function formatted(value) { return value === undefined ? '—' : typeof value === 'boolean' ? value ? '开启' : '关闭' : String(value); }
function setText(node, text) { if (node.textContent !== text) node.textContent = text; }

/**
 * root is a caller-owned dock whose layout reserves canvas space. It is not an overlay.
 * onOpenChange owns the editor pause token; onPauseChange requests pause / continue.
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
  let currentTabCleanup = [];
  function on(element, type, listener, transient = false) {
    element.addEventListener(type, listener);
    (transient ? currentTabCleanup : cleanups).push(() => element.removeEventListener(type, listener)); return element;
  }
  const style = node('style'); style.setAttribute('data-settings-panel-style', ''); style.textContent = SETTINGS_PANEL_CSS;
  (doc.head ?? doc.documentElement).appendChild(style);
  const element = node('aside'); element.id = 'miragine-settings-panel'; element.setAttribute('data-settings-panel', '');
  element.setAttribute('aria-label', '自定义规则与沙盒'); element.hidden = true;
  const header = node('header', 'ms-header'), titleBlock = node('div');
  titleBlock.appendChild(node('h2', '', '自定义规则与沙盒'));
  const pauseStatus = node('p', 'ms-muted'); pauseStatus.setAttribute('data-editor-pause-status', ''); titleBlock.appendChild(pauseStatus); header.appendChild(titleBlock);
  const headerActions = node('div', 'ms-header-actions'); header.appendChild(headerActions); element.appendChild(header);
  function button(parent, text, action, callback, className = '', transient = false) {
    const control = node('button', className, text); control.type = 'button';
    if (action) control.setAttribute('data-settings-action', action);
    on(control, 'click', event => { event.stopPropagation(); if (!destroyed && !control.disabled) callback(event); }, transient);
    parent.appendChild(control); return control;
  }
  const pauseButton = button(headerActions, '继续战斗', 'pause', () => { onPauseChange(!presentation.paused); });
  const closeButton = button(headerActions, '收起 ×', 'close', () => close()); closeButton.setAttribute('aria-label', '收起设置（F2 或 Escape）');
  const scroll = node('div', 'ms-scroll'); element.appendChild(scroll);
  if (playbackElement) scroll.appendChild(playbackElement);
  const nav = node('nav', 'ms-tabs'); nav.setAttribute('role', 'tablist'); nav.setAttribute('aria-label', '自定义设置分类'); scroll.appendChild(nav);
  const content = node('div', 'ms-content'); content.setAttribute('role', 'tabpanel'); content.id = 'miragine-settings-content'; scroll.appendChild(content);
  const message = node('p', 'ms-message'); message.setAttribute('role', 'status'); message.setAttribute('aria-live', 'polite');
  message.setAttribute('data-settings-message', ''); element.appendChild(message);
  const footer = node('footer', 'ms-footer'), footerTools = node('div', 'ms-row'), footerApply = node('div', 'ms-row');
  const dirtyLabel = node('span', 'ms-dirty'); dirtyLabel.setAttribute('data-draft-dirty', '');
  const undo = button(footerTools, '撤销', 'undo', () => action(async () => {
    customization.undoDraft(); invalid.clear(); renderContent(); notice('已撤销草稿修改，未自动应用到战局。');
  }));
  button(footerTools, '恢复原版默认', 'reset', () => action(async () => {
    if (!confirmAction('将编辑草稿恢复为原版默认？已保存预设不删除，当前战局不会自动改变。')) return;
    customization.resetDraft(); invalid.clear(); selectedPreset = ''; renderContent(); notice('草稿已恢复为原版默认，尚未保存或应用。');
  }));
  footerTools.appendChild(dirtyLabel); footer.appendChild(footerTools);
  const hpPolicy = node('select'); hpPolicy.setAttribute('aria-label', '已有单位生命值应用策略'); hpPolicy.setAttribute('data-health-policy', '');
  option(hpPolicy, 'ratio', '存量单位保持生命比例'); option(hpPolicy, 'absolute', '保留当前生命（不截断超额生命）'); hpPolicy.value = 'ratio';
  footerApply.appendChild(hpPolicy);
  const apply = button(footerApply, '应用本局', 'apply-current', () => action(async () => {
    assertValid(); const report = await customization.applyCurrent({ health: hpPolicy.value });
    notice(reportMessage(report, '已应用本局。') + ' 保存预设是独立操作。');
  }), 'ms-primary');
  button(footerApply, '设为下局规则', 'apply-next', () => action(async () => {
    assertValid(); await customization.applyNext(); notice('已设为本次运行的下局规则；当前战局未重新开始。请单独保存预设以便以后载入。');
  }));
  footer.appendChild(footerApply); element.appendChild(footer); root.appendChild(element);
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
  function metadata() { const result = customization.getMetadata(); return Array.isArray(result) ? result : result?.groups ?? []; }
  function tabs() { return [{ id: 'sandbox', label: '沙盒 / 刷兵' }, ...metadata(), { id: 'presets', label: '预设 / 文件' }]; }
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
    for (const cleanup of currentTabCleanup) cleanup(); currentTabCleanup = [];
    while (content.firstChild) content.removeChild(content.firstChild);
  }
  function renderContent() {
    clearContent();
    for (const [id, button] of tabButtons) { button.setAttribute('aria-selected', String(id === activeTab)); button.tabIndex = id === activeTab ? 0 : -1; }
    content.setAttribute('aria-labelledby', `miragine-tab-${activeTab}`);
    if (activeTab === 'sandbox') renderSandbox();
    else if (activeTab === 'presets') renderPresets();
    else renderFields(metadata().find(group => group.id === activeTab));
    update();
  }
  function renderFields(group) {
    if (!group) return;
    const entries = group.entries ?? [];
    let selected = selection.get(group.id) ?? String(entries[0]?.id ?? '');
    if (!entries.some(entry => String(entry.id) === selected)) selected = String(entries[0]?.id ?? '');
    selection.set(group.id, selected);
    if (entries.length > 1) {
      const selector = node('select'); selector.setAttribute('data-entry-select', group.id); selector.setAttribute('aria-label', `选择${group.label}`);
      for (const entry of entries) option(selector, entry.id, entry.label);
      selector.value = selected;
      on(selector, 'change', () => { selection.set(group.id, selector.value); renderContent(); }, true);
      const row = node('div', 'ms-row'); label(row, `选择${group.label}`, selector); content.appendChild(row);
    } else content.appendChild(node('h3', '', entries[0]?.label ?? group.label));
    if (group.description) content.appendChild(node('p', 'ms-summary', group.description));
    const entry = entries.find(item => String(item.id) === selected);
    if (entry?.description) content.appendChild(node('p', 'ms-summary', entry.description));
    const tableWrap = node('div', 'ms-table-wrap'), table = node('table'), thead = node('thead'), heading = node('tr'), tbody = node('tbody');
    for (const text of ['参数 / 单位', '原版默认', '草稿值', '生效时机']) heading.appendChild(node('th', '', text));
    thead.appendChild(heading); table.appendChild(thead); table.appendChild(tbody); tableWrap.appendChild(table); content.appendChild(tableWrap);
    const current = state();
    // Keep balance numbers visible before the long optional description row.
    const fields = [...(entry?.fields ?? group.fields ?? [])].sort((a, b) =>
      Number(a.path.endsWith('.description')) - Number(b.path.endsWith('.description')));
    for (const field of fields) {
      const row = node('tr'), name = node('th', '', field.label); name.scope = 'row';
      if (field.unit) name.appendChild(node('span', 'ms-unit', field.unit)); row.appendChild(name);
      row.appendChild(node('td', 'ms-default', formatted(readPath(current.defaults, field.path))));
      const editCell = node('td'), input = fieldInput(field, readPath(current.draft, field.path)); editCell.appendChild(input); row.appendChild(editCell);
      row.appendChild(node('td', 'ms-timing', field.apply ?? '按规则生效')); tbody.appendChild(row);
    }
  }
  function fieldInput(field, value) {
    const type = field.type ?? typeof value;
    const isText = type === 'string' || type === 'text', isBool = type === 'boolean';
    const multiline = isText && field.path.endsWith('description');
    const input = node(multiline ? 'textarea' : 'input');
    // HTMLTextAreaElement.type is a read-only getter in real browsers.
    if (!multiline) input.type = isBool ? 'checkbox' : isText ? 'text' : 'number';
    if (isBool) input.checked = Boolean(value); else input.value = String(value ?? '');
    input.setAttribute('data-field-path', field.path); input.setAttribute('aria-label', field.label);
    if (!isText && !isBool) {
      input.step = field.integer ? '1' : 'any'; input.inputMode = field.integer ? 'numeric' : 'decimal';
      if (field.min !== undefined) input.min = String(field.min); if (field.max !== undefined) input.max = String(field.max);
    } else if (isText) input.maxLength = field.maxLength ?? (field.path.endsWith('description') ? 2000 : 120);
    if (invalid.has(field.path)) { input.value = invalid.get(field.path).raw; input.setAttribute('aria-invalid', 'true'); }
    on(input, 'change', () => {
      try {
        const next = parseFieldValue({ ...field, type }, input.value, input.checked);
        customization.updateDraft(field.path, next); invalid.delete(field.path); input.setAttribute('aria-invalid', 'false');
        notice('草稿已修改，尚未自动应用或保存。'); update();
      } catch (error) {
        invalid.set(field.path, { raw: input.value, error: error.message }); input.setAttribute('aria-invalid', 'true');
        notice(`${field.label}：${error.message}`, true); update();
      }
    }, true);
    return input;
  }
  function selectInput(values, aria) {
    const input = node('select'); input.setAttribute('aria-label', aria);
    for (const [value, text] of values) option(input, value, text); input.value = String(values[0]?.[0] ?? ''); return input;
  }
  function numberInput(value, aria, min = 0, max = 1000000) {
    const input = node('input'); input.type = 'number'; input.value = String(value); input.min = String(min); input.max = String(max); input.step = '1';
    input.setAttribute('aria-label', aria); return input;
  }
  function number(input) { return parseFieldValue({ type: 'number', integer: true, min: Number(input.min), max: Number(input.max) }, input.value); }
  function battleButton(parent, text, actionName, callback, className = '') {
    const result = button(parent, text, actionName, () => action(callback), className, true); result.setAttribute('data-needs-battle', ''); return result;
  }
  function renderSandbox() {
    const summary = node('p', 'ms-summary'); summary.setAttribute('data-battle-summary', ''); content.appendChild(summary);
    const startCard = node('section', 'ms-card'); startCard.appendChild(node('h3', '', '新建自定义战局'));
    const startRow = node('div', 'ms-row');
    const difficulties = metadata().find(item => item.id === 'difficulties')?.entries ?? [];
    const difficulty = selectInput(difficulties.length ? difficulties.map(entry => [entry.id, entry.label]) : [[0, '普通']], '新战局难度');
    const mode = selectInput([['single', '单人对战电脑'], ['two', '双人对战']], '新战局模式');
    label(startRow, '难度', difficulty); label(startRow, '模式', mode); startCard.appendChild(startRow);
    button(startCard, '按草稿开始新战局', 'start-battle', () => action(async () => {
      assertValid();
      if (state().isBattle && !confirmAction('重新开始将结束当前战局。按当前草稿开始新局？')) return;
      const options = { difficulty: Number(difficulty.value), singlePlay: mode.value === 'single' };
      if (onStartBattle) await onStartBattle(options); else await customization.startBattle(options);
      notice('已按草稿开始自定义战局；如设置仍持有暂停，请点击“继续战斗”。');
    }), 'ms-primary', true);
    if (typeof customization.returnToOriginal === 'function') {
      button(startCard, '回到原版菜单', 'return-original', () => action(async () => {
        if (state().isBattle && !confirmAction('结束当前战局并回到原版菜单？草稿和已保存预设保留。')) return;
        await customization.returnToOriginal(); notice('已回到原版菜单；下局使用原版规则。草稿和预设仍保留。');
      }), '', true);
    }
    content.appendChild(startCard);
    const spawnCard = node('section', 'ms-card'); spawnCard.appendChild(node('h3', '', '刷兵 / 清场'));
    const row = node('div', 'ms-row');
    const side = selectInput([['left', '红方（左）'], ['right', '蓝方（右）']], '刷兵阵营'); side.setAttribute('data-sandbox-side', '');
    const units = metadata().find(group => group.id === 'units')?.entries ?? [];
    const unit = selectInput(units.map(entry => [entry.id, entry.label]), '刷兵兵种'); unit.setAttribute('data-sandbox-unit', '');
    const count = numberInput(1, '刷兵数量', 1, 100); count.setAttribute('data-sandbox-count', '');
    label(row, '阵营', side); label(row, '兵种', unit); label(row, '数量（单次 1–100）', count); spawnCard.appendChild(row);
    const actions = node('div', 'ms-row');
    battleButton(actions, '生成士兵', 'spawn', async () => {
      await customization.spawn({ side: side.value, unitId: Number(unit.value), count: number(count) }); notice('已生成士兵。使用当前已应用规则，不会自动应用草稿。');
    }, 'ms-primary');
    battleButton(actions, '选为招募兵种', 'select-unit', async () => {
      await customization.selectUnit({ side: side.value, unitId: Number(unit.value) }); notice('已切换该阵营当前招募兵种。');
    });
    battleButton(actions, '清除所选阵营', 'clear-side', async () => {
      if (!confirmAction('清除所选阵营的士兵与其相关投射物？基地保留，不能撤销。')) return;
      await customization.clearTroops(side.value); notice('已清除所选阵营士兵。');
    }, 'ms-danger');
    battleButton(actions, '清除双方士兵', 'clear-all', async () => {
      if (!confirmAction('清除双方士兵与投射物？基地保留，不能撤销。')) return;
      await customization.clearTroops('both'); notice('已清除双方士兵。');
    }, 'ms-danger');
    spawnCard.appendChild(actions); content.appendChild(spawnCard);
    const resourceCard = node('section', 'ms-card'); resourceCard.appendChild(node('h3', '', '本局资源（直接生效）'));
    const resourceRow = node('div', 'ms-row');
    const resourceSide = selectInput([['left', '红方（左）'], ['right', '蓝方（右）']], '资源阵营'); resourceSide.setAttribute('data-resource-side', '');
    label(resourceRow, '阵营', resourceSide);
    const money = numberInput(1000, '设定金币', 0, 100000000), income = numberInput(100, '设定每轮收入', 0, 100000000), population = numberInput(50, '设定本轮剩余人口', 0, 10000);
    for (const [key, control] of [['money', money], ['income', income], ['population', population]]) control.setAttribute('data-resource-value', key);
    label(resourceRow, '金币', money); label(resourceRow, '每轮收入', income); label(resourceRow, '本轮剩余人口', population); resourceCard.appendChild(resourceRow);
    battleButton(resourceCard, '设置这些资源', 'set-resources', async () => {
      await customization.setResources({ side: resourceSide.value, money: number(money), income: number(income), population: number(population) }); notice('已设置所选阵营本局资源。');
    });
    content.appendChild(resourceCard);
    const behaviorCard = node('section', 'ms-card'); behaviorCard.appendChild(node('h3', '', '本局招募与电脑控制'));
    const s = state();
    for (const [sideName, text] of [['left', '红方自动招募'], ['right', '蓝方自动招募']]) {
      const check = node('input'); check.type = 'checkbox'; check.checked = s.battle?.[sideName]?.recruitment ?? true;
      check.setAttribute('data-live-recruitment', sideName); check.setAttribute('data-needs-battle', '');
      const line = node('label', 'ms-check'); line.appendChild(check); line.appendChild(node('span', '', text)); behaviorCard.appendChild(line);
      on(check, 'change', () => action(async () => { await customization.setRecruitment(sideName, check.checked); notice('已更新本局自动招募。'); }), true);
    }
    const ai = node('input'); ai.type = 'checkbox'; ai.checked = s.battle?.enemyAi ?? true; ai.setAttribute('data-live-ai', ''); ai.setAttribute('data-needs-battle', '');
    const aiLabel = node('label', 'ms-check'); aiLabel.appendChild(ai); aiLabel.appendChild(node('span', '', '电脑自动选择兵种（单人局）')); behaviorCard.appendChild(aiLabel);
    on(ai, 'change', () => action(async () => { await customization.setEnemyAi(ai.checked); notice('已更新本局电脑选兵开关。'); }), true);
    behaviorCard.appendChild(node('p', 'ms-muted', '这些操作直接作用于本局；需要长期使用时，请在“行为”页编辑草稿并保存预设。'));
    content.appendChild(behaviorCard);
    content.appendChild(node('p', 'ms-muted', '本作没有建筑建造、可释放技能、固定关卡波次或条件增援编辑项，不会虚构这些系统。'));
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
    const stopped = Boolean(presentation.paused);
    const zeroSpeed = presentation.speed === 0;
    setText(pauseButton, zeroSpeed ? '0 倍已暂停' : stopped ? '继续战斗' : '暂停战斗'); pauseButton.setAttribute('aria-pressed', String(stopped || zeroSpeed));
    pauseButton.disabled = !current.isBattle || zeroSpeed;
    setText(pauseStatus, !current.isBattle ? '打开设置不自动开始对局' : zeroSpeed ? '0 倍暂停中 · 恢复战斗需先选择正倍速' : stopped ? '战斗已暂停 · 可编辑与观察' : '战斗进行中 · 可边玩边调');
    setText(dirtyLabel, invalid.size ? `${invalid.size} 项输入无效` : current.dirty ? '草稿尚未保存' : '草稿就绪');
    undo.disabled = busy || !current.canUndo;
    apply.disabled = busy || !current.isBattle || invalid.size > 0;
    for (const control of content.querySelectorAll('[data-needs-battle]')) control.disabled = busy || !current.isBattle;
    const summary = content.querySelector('[data-battle-summary]');
    if (summary) {
      if (!current.isBattle || !current.battle) setText(summary, '尚无进行中的战局。可以从原游戏菜单开始，或按草稿新建自定义战局。');
      else {
        const battle = current.battle;
        const line = (side, name) => `${name}：金币 ${formatted(battle[side]?.money)} · 收入 ${formatted(battle[side]?.income)} · 人口 ${formatted(battle[side]?.population)} · 士兵 ${formatted(battle[side]?.units)} · 水晶 HP ${formatted(battle[side]?.baseHp)}`;
        setText(summary, `本局：${current.mode === 'original' ? '原版规则' : '自定义战局'}\n${line('left', '红方')}\n${line('right', '蓝方')}`);
      }
    }
    for (const side of ['left', 'right']) {
      const input = content.querySelector(`[data-live-recruitment="${side}"]`);
      if (input && doc.activeElement !== input) input.checked = current.battle?.[side]?.recruitment ?? true;
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
    notice('打开设置默认暂停战斗。修改草稿后，请明确选择应用或保存。');
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
