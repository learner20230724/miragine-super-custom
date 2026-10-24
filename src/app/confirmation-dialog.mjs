/** An in-page confirmation: never opens Electron's focus-stealing native dialog. */
export const CONFIRMATION_DIALOG_CSS = `
[data-settings-confirm-backdrop] {position:fixed;inset:0;z-index:2147483647;display:grid;place-items:center;padding:12px;background:#0009;overflow:auto;overscroll-behavior:contain;color:#edf1e8;font:14px/1.6 OriginalYahei,'Microsoft YaHei',Arial,sans-serif;box-sizing:border-box}
[data-settings-confirm-backdrop] * {box-sizing:border-box}
[data-settings-confirm] {width:min(480px,100%);min-width:0;min-height:0;max-height:calc(100vh - 24px);max-height:calc(100dvh - 24px);display:flex;flex-direction:column;padding:16px;gap:12px;border:1px solid #9baf87;border-radius:9px;background:#1b281f;box-shadow:0 8px 40px #0008;overflow:auto}
[data-settings-confirm] h2 {margin:0;font-size:17px;color:#fff0c8;flex-shrink:0}
[data-settings-confirm-message] {margin:0;min-height:0;overflow:auto;overflow-wrap:anywhere;white-space:pre-line;overscroll-behavior:contain}
[data-settings-confirm-actions] {display:flex;justify-content:flex-end;flex-wrap:wrap;gap:8px;flex-shrink:0}
[data-settings-confirm] button {font:inherit;color:inherit;min-height:36px;max-width:100%;padding:6px 16px;border:1px solid #718366;border-radius:5px;background:#2c3a2f;cursor:pointer}
[data-settings-confirm] button:focus-visible {outline:2px solid #ebc66c;outline-offset:2px}
[data-settings-confirm-accept] {background:#695e2f!important;border-color:#c0b16a!important}
`;

let nextDialogId = 0;
export function createConfirmationDialog({ document: doc, focusRoot = null, host: suppliedHost = null, fallbackFocus = () => null } = {}) {
  if (!doc?.createElement) throw new TypeError('A DOM document is required');
  let pending = null, destroyed = false, restoration = null;
  const connected = element => {
    if (!element) return false;
    if (typeof element.isConnected === 'boolean') return element.isConnected;
    for (let current = element; current; current = current.parentNode) if (current === doc.documentElement) return true;
    return false;
  };
  const contains = (parent, child) => {
    for (let current = child; current; current = current.parentNode) if (current === parent) return true;
    return false;
  };
  function restoreFocus({ forget = false, focus = true } = {}) {
    if (destroyed || pending || !restoration) return;
    const { origin, identity } = restoration; if (forget) restoration = null;
    if (!focus) return;
    let target = origin;
    if (!connected(target) && identity && focusRoot) {
      target = [...focusRoot.querySelectorAll(`[${identity.attribute}]`)]
        .find(element => element.getAttribute(identity.attribute) === identity.value);
    }
    if (!connected(target) || target.disabled || target.hidden || target.inert) target = fallbackFocus();
    if (connected(target) && !target.disabled && !target.hidden && !target.inert) target.focus?.({ preventScroll: true });
  }
  function ask(message, { returnFocus = doc.activeElement } = {}) {
    if (destroyed || pending) return Promise.resolve(false);
    const identity = ['data-field-path', 'data-settings-action', 'data-entry-select'].map(attribute => ({
      attribute, value: returnFocus?.getAttribute?.(attribute)
    })).find(item => item.value !== undefined && item.value !== null);
    restoration = { origin: returnFocus, identity };
    const make = (tag, attribute, text) => {
      const element = doc.createElement(tag); if (attribute) element.setAttribute(attribute, '');
      if (text !== undefined) element.textContent = String(text); return element;
    };
    const style = make('style', 'data-settings-confirm-style'); style.textContent = CONFIRMATION_DIALOG_CSS;
    const backdrop = make('div', 'data-settings-confirm-backdrop');
    const dialog = make('section', 'data-settings-confirm'); dialog.setAttribute('role', 'dialog'); dialog.setAttribute('aria-modal', 'true'); dialog.tabIndex = -1;
    const id = `miragine-confirm-${++nextDialogId}`;
    const title = make('h2', null, '请确认操作'); title.id = `${id}-title`;
    const description = make('p', 'data-settings-confirm-message', message); description.id = `${id}-message`;
    dialog.setAttribute('aria-labelledby', title.id); dialog.setAttribute('aria-describedby', description.id);
    const actions = make('div', 'data-settings-confirm-actions');
    const cancel = make('button', 'data-settings-confirm-cancel', '取消'); cancel.type = 'button';
    const accept = make('button', 'data-settings-confirm-accept', '确认'); accept.type = 'button';
    actions.appendChild(cancel); actions.appendChild(accept); dialog.appendChild(title); dialog.appendChild(description); dialog.appendChild(actions); backdrop.appendChild(dialog);
    const host = suppliedHost ?? doc.fullscreenElement ?? doc.body ?? doc.documentElement, removals = [], inert = [];
    let settle;
    const result = new Promise(resolve => { settle = resolve; });
    function listen(element, type, listener, options) {
      element.addEventListener(type, listener, options); removals.push(() => element.removeEventListener(type, listener, options));
    }
    function finish(value) {
      if (pending?.backdrop !== backdrop) return;
      pending = null;
      for (const remove of removals) remove();
      backdrop.remove(); style.remove();
      for (const [element, previous] of inert) element.inert = previous;
      restoreFocus(); settle(Boolean(value));
    }
    pending = { backdrop, finish };
    const stop = event => event.stopPropagation();
    for (const type of ['pointerdown', 'pointerup', 'click', 'dblclick', 'wheel', 'keyup', 'contextmenu']) listen(backdrop, type, stop);
    for (const [control, value] of [[cancel, false], [accept, true]]) listen(control, 'click', event => {
      event.preventDefault(); event.stopPropagation(); finish(value);
    });
    // Inert stops mouse/keyboard editing throughout the game, not just this dock.
    // A capture guard additionally prevents shortcuts and synthetic click-through.
    const background = [...host.children];
    // A fullscreen-capable shell owns the portal. Also disable its outside
    // siblings without making the portal's ancestors themselves inert.
    for (let branch = host; branch !== doc.body && branch.parentNode; branch = branch.parentNode) {
      background.push(...[...branch.parentNode.children].filter(element => element !== branch));
    }
    for (const element of new Set(background)) { inert.push([element, element.inert]); element.inert = true; }
    host.appendChild(backdrop); (doc.head ?? doc.documentElement).appendChild(style);
    const events = doc.addEventListener ? doc : doc.documentElement;
    const blockOutside = event => {
      if (contains(backdrop, event.target)) return;
      event.preventDefault(); event.stopPropagation(); event.stopImmediatePropagation?.();
    };
    for (const type of ['pointerdown', 'pointerup', 'click', 'dblclick', 'wheel', 'contextmenu', 'input', 'change']) listen(events, type, blockOutside, { capture: true, passive: false });
    listen(events, 'keydown', event => {
      const key = event.key || event.code;
      if (key === 'Escape') { event.preventDefault(); event.stopPropagation(); event.stopImmediatePropagation?.(); finish(false); return; }
      if (key === 'Tab') {
        event.preventDefault(); event.stopPropagation(); event.stopImmediatePropagation?.();
        const controls = [cancel, accept], current = controls.indexOf(doc.activeElement);
        const index = current < 0 ? (event.shiftKey ? 1 : 0) : (current + (event.shiftKey ? -1 : 1) + 2) % 2;
        controls[index].focus({ preventScroll: true }); return;
      }
      if (!contains(backdrop, event.target)) { blockOutside(event); cancel.focus({ preventScroll: true }); }
      // Button Enter/Space defaults still work, but game shortcuts cannot hear them.
      event.stopPropagation();
    }, true);
    listen(events, 'keyup', event => { event.stopPropagation(); if (!contains(backdrop, event.target)) event.preventDefault(); }, true);
    listen(events, 'focusin', event => {
      if (!contains(backdrop, event.target)) { event.stopPropagation(); cancel.focus({ preventScroll: true }); }
    }, true);
    cancel.focus({ preventScroll: true });
    return result;
  }
  return Object.freeze({ ask, restoreFocus, get isOpen() { return Boolean(pending); },
    cancel() { pending?.finish(false); },
    destroy() { if (destroyed) return; pending?.finish(false); destroyed = true; restoration = null; }
  });
}
