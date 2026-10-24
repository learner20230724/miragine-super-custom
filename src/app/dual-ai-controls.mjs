/** Native-resolution controls for the optional mirrored-AI match mode. */
export const DUAL_AI_DIFFICULTIES = Object.freeze(['简单', '普通', '困难', '不可战胜']);

export const DUAL_AI_CONTROLS_CSS = `
[data-dual-ai-controls]{position:absolute;z-index:3;display:block;pointer-events:none;user-select:none;color:#fff;font-family:'Microsoft YaHei',Arial,sans-serif}
[data-dual-ai-controls] [hidden]{display:none!important}
[data-dual-ai-controls] *{box-sizing:border-box}
[data-dual-ai-controls] button,[data-dual-ai-controls] select{pointer-events:auto;font:inherit;color:inherit;border:1px solid #b9ae7b;border-radius:.25em;background:#20251eef;cursor:pointer;text-shadow:0 1px 2px #0008;line-height:1.5;text-align:center;padding:.3em .6em;white-space:nowrap}
[data-dual-ai-controls] button:hover{color:#ffe8a0;background:#3b432ded;text-decoration:none}
[data-dual-ai-controls] :is(button,select,input):focus-visible{outline:2px solid #ffe8a0;outline-offset:2px}
[data-dual-ai-controls] button:disabled{opacity:.5;cursor:default}
[data-dual-ai-controls] [data-dual-ai-action=dual-ai]{position:absolute;box-shadow:0 2px 5px #0008;font-weight:600;color:#fff0b7}
[data-dual-ai-controls] [data-dual-ai-panel]{position:absolute;pointer-events:auto;padding:1em 1.2em;background:#172018f2;border:1px solid #b9ae7b;border-radius:.5em;box-shadow:0 3px 14px #0008}
[data-dual-ai-controls] h2{font-size:1.45em;text-align:center;margin:0 0 .7em;color:#fff0b7}
[data-dual-ai-controls] .dual-ai-sides{display:grid;grid-template-columns:1fr 1fr;gap:1.2em;margin-bottom:.85em}
[data-dual-ai-controls] .dual-ai-choice{display:flex;flex-direction:column;gap:.45em;text-align:center;font-weight:600}
[data-dual-ai-controls] .dual-ai-choice:first-child{color:#ffb2a8}
[data-dual-ai-controls] .dual-ai-choice:last-child{color:#b0ceff}
[data-dual-ai-controls] select{width:100%;background:#29332a;color:#fff}
[data-dual-ai-controls] .dual-ai-stats{display:flex;align-items:center;justify-content:center;gap:.4em;font-size:.9em;line-height:1.5}
[data-dual-ai-controls] input{width:1.1em;height:1.1em;accent-color:#d4b366;pointer-events:auto}
[data-dual-ai-controls] .dual-ai-note{font-size:.85em;text-align:center;line-height:1.5;margin:.65em 0;color:#d4dcca}
[data-dual-ai-controls] .dual-ai-actions{display:flex;justify-content:center;gap:1em;margin-top:.85em}
[data-dual-ai-controls] [data-dual-ai-action=dual-ai-start]{background:#6b602f;color:#fff5d5}
[data-dual-ai-controls] [data-dual-ai-side]{position:absolute;display:flex;align-items:center;gap:.55em;white-space:nowrap;line-height:1.5;text-shadow:0 1px 2px #000c}
[data-dual-ai-controls] [data-dual-ai-side=left]{color:#ffded9}
[data-dual-ai-controls] [data-dual-ai-side=right]{color:#e0ecff;justify-content:flex-end}
[data-dual-ai-controls] [data-dual-ai-side] button{font-size:.9em;padding:.2em .45em;background:#172018c9}
[data-dual-ai-controls] [data-dual-ai-side] button[aria-pressed=true]{border-color:#f0c078;color:#ffe3a8}
`;

export function dualAILayout(fit) {
  if (!fit || ![fit.left, fit.top, fit.width, fit.height].every(Number.isFinite) || fit.width <= 0 || fit.height <= 0) return null;
  const scale = fit.width / 640;
  const rect = (left, top, width, height) => ({ left: left * scale, top: top * scale, width: width * scale, height: height * scale });
  return { left: fit.left, top: fit.top, width: fit.width, height: fit.height, scale,
    entry: rect(212, 384, 227, 46), panel: rect(126, 214, 388, 238),
    leftSide: rect(9, 96, 270, 24), rightSide: rect(361, 96, 270, 24) };
}

export function createDualAIControls({ root, onAction = () => {} } = {}) {
  const doc = root?.ownerDocument;
  if (!doc?.createElement || typeof onAction !== 'function') throw new TypeError('A game-stage DOM root and action callback are required');
  const listeners = [], interactive = [], style = doc.createElement('style');
  style.setAttribute('data-dual-ai-style', ''); style.textContent = DUAL_AI_CONTROLS_CSS;
  (doc.head ?? doc.documentElement).appendChild(style);
  const node = (tag, text) => { const result = doc.createElement(tag); if (text !== undefined) result.textContent = text; return result; };
  const element = node('div'); element.setAttribute('data-dual-ai-controls', '');
  // Reuse the existing native-UI keyboard ownership guard. These controls have
  // their own action namespace and do not dispatch lower-left game actions.
  element.setAttribute('data-game-text-controls', ''); element.setAttribute('aria-label', '双 AI 对战'); element.hidden = true;
  let destroyed = false, state = {}, available = false;
  const listen = (target, type, callback) => { target.addEventListener(type, callback); listeners.push(() => target.removeEventListener(type, callback)); };
  const dispatch = (action, value, refocus = true) => {
    if (destroyed || !available) return;
    const recruiting = action.startsWith('dual-ai-recruit-');
    if (recruiting ? state.phase !== 'game' || state.matchMode !== 'ai-vs-ai' || state.winner
      : state.phase !== 'title' || state.panel !== (action === 'dual-ai' ? 'home' : 'dual-ai')) return;
    onAction(action, value);
    if (refocus) root.querySelector?.('#game')?.focus?.({ preventScroll: true });
  };
  const button = (parent, text, action, value) => {
    const control = node('button', text); control.type = 'button'; control.setAttribute('data-dual-ai-action', action);
    listen(control, 'click', event => { event.stopPropagation(); if (!control.disabled) dispatch(action, typeof value === 'function' ? value() : value); });
    parent.appendChild(control); interactive.push(control); return control;
  };
  const entry = button(element, '双 AI 对战', 'dual-ai');
  const panel = node('section'); panel.setAttribute('data-dual-ai-panel', ''); panel.setAttribute('aria-label', '双 AI 对战难度');
  panel.appendChild(node('h2', '双 AI 对战'));
  const columns = node('div'); columns.className = 'dual-ai-sides'; panel.appendChild(columns);
  const selects = {};
  for (const [side, name] of [['left', '红方 AI'], ['right', '蓝方 AI']]) {
    const label = node('label'); label.className = 'dual-ai-choice'; label.appendChild(node('span', name));
    const select = node('select'); select.setAttribute('data-dual-ai-difficulty', side); select.setAttribute('aria-label', `${name} 难度`);
    for (const [value, text] of DUAL_AI_DIFFICULTIES.entries()) { const option = node('option', text); option.value = String(value); select.appendChild(option); }
    listen(select, 'change', event => { event.stopPropagation(); if (!select.disabled) dispatch(`dual-ai-${side}`, Number(select.value), false); });
    label.appendChild(select); columns.appendChild(label); selects[side] = select; interactive.push(select);
  }
  const statsLine = node('label'); statsLine.className = 'dual-ai-stats';
  const stats = node('input'); stats.type = 'checkbox'; stats.setAttribute('data-dual-ai-stats', '');
  statsLine.appendChild(stats); statsLine.appendChild(node('span', '同时使用所选难度的数值加成')); panel.appendChild(statsLine); interactive.push(stats);
  listen(stats, 'change', event => { event.stopPropagation(); if (!stats.disabled) dispatch('dual-ai-stats', stats.checked, false); });
  const note = node('p', '关闭加成：双方数值用当前普通档，仅比较 AI 选兵。'); note.className = 'dual-ai-note'; panel.appendChild(note);
  const actions = node('div'); actions.className = 'dual-ai-actions'; panel.appendChild(actions);
  const back = button(actions, '返回', 'dual-ai-back'), start = button(actions, '开始对战', 'dual-ai-start'); element.appendChild(panel);
  const sides = {};
  for (const [side, name] of [['left', '红方'], ['right', '蓝方']]) {
    const sideElement = node('div'); sideElement.setAttribute('data-dual-ai-side', side);
    const label = node('span'); label.setAttribute('data-dual-ai-status', side); sideElement.appendChild(label);
    const control = button(sideElement, '暂停出兵', `dual-ai-recruit-${side}`, () => !(state.recruitment?.[side] ?? true));
    control.setAttribute('title', `只暂停${name}出兵，不暂停现有士兵、对方或游戏时间；点击兵种可临时选兵到下一轮。`);
    sides[side] = { element: sideElement, label, button: control, name }; element.appendChild(sideElement);
  }
  for (const type of ['pointerdown', 'pointerup', 'wheel', 'click']) listen(element, type, event => event.stopPropagation());
  root.appendChild(element);
  const place = (target, rect) => { for (const key of ['left', 'top', 'width', 'height']) target.style[key] = `${rect[key]}px`; };
  return Object.freeze({ element, update(next = {}) {
    if (destroyed) return;
    state = next; const layout = dualAILayout(next.fit);
    available = Boolean(next.ready && !next.overlay && !next.confirming && layout);
    const home = available && next.phase === 'title' && next.panel === 'home';
    const setup = available && next.phase === 'title' && next.panel === 'dual-ai';
    const battle = available && next.phase === 'game' && next.matchMode === 'ai-vs-ai' && !next.winner;
    element.hidden = !(home || setup || battle); entry.hidden = !home; entry.disabled = !home; panel.hidden = !setup;
    for (const control of interactive) if (control !== entry) control.disabled = !setup && !battle;
    for (const select of Object.values(selects)) select.disabled = !setup;
    stats.disabled = !setup; back.disabled = !setup; start.disabled = !setup;
    if (layout) {
      place(element, layout); place(entry, layout.entry); place(panel, layout.panel);
      element.style.fontSize = `${12 * layout.scale}px`; entry.style.fontSize = `${21 * layout.scale}px`;
    }
    const options = next.options ?? {};
    for (const side of ['left', 'right']) {
      // Do not disturb a live native selection while the user navigates it.
      if (doc.activeElement !== selects[side]) selects[side].value = String(options[`${side}Difficulty`] ?? 1);
      const item = sides[side]; item.element.hidden = !battle; item.button.disabled = !battle;
      const difficulty = DUAL_AI_DIFFICULTIES[options[`${side}Difficulty`] ?? 1] ?? '普通';
      const running = next.recruitment?.[side] ?? true;
      item.label.textContent = `${item.name} AI · ${difficulty}`;
      item.button.textContent = running ? '暂停出兵' : '开始出兵';
      item.button.setAttribute('aria-label', `${running ? '暂停' : '开始'}${item.name}出兵`);
      item.button.setAttribute('aria-pressed', String(!running));
      if (layout) place(item.element, layout[`${side}Side`]);
    }
    if (doc.activeElement !== stats) stats.checked = options.applyDifficultyStats ?? true;
  }, destroy() {
    if (destroyed) return; destroyed = true;
    for (const remove of listeners) remove(); element.remove(); style.remove();
  } });
}
