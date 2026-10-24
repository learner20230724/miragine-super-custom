import { uiOwnsGameKeyboard } from './camera-keyboard.mjs';

/** Single-press observation commands; never consume editing or OS shortcuts. */
export function applyCameraShortcut(event, { enabled, camera, snapshot = [] } = {}) {
  if (!enabled || !camera || event.repeat || event.ctrlKey || event.altKey || event.metaKey
    || event.isComposing || uiOwnsGameKeyboard(event.target)) return false;
  if (event.code === 'KeyP') camera.fitAll(snapshot);
  // Physical Semicolon works in either layout; punctuation fallback covers
  // platforms that provide the character but no useful physical key code.
  else if (event.code === 'Semicolon' || event.key === ';' || event.key === '；') camera.follow();
  else return false;
  return true;
}
