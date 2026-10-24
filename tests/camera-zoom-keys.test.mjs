import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ViewCamera } from '../src/render/view-camera.mjs';
import { uiOwnsGameKeyboard, wheelZoomFactor, zoomCameraFromKey } from '../src/app/camera-keyboard.mjs';

const core = Object.freeze({ x: 2250, y: 400, width: 640, height: 400 });
const center = { x: 320, y: 250 };
const event = (code, extras = {}) => ({ code, target: { closest: () => null }, ...extras });
const context = (camera, extras = {}) => ({ enabled: true, camera, coreCamera: core, ...extras });
const close = (actual, expected, tolerance = 1e-7) => assert.ok(Math.abs(actual - expected) < tolerance,
  `${actual} differs from ${expected}`);

test('U and O exactly match opposite 100-pixel wheel steps at the visible battlefield center', () => {
  for (const [code, delta] of [['KeyU', -100], ['KeyO', 100]]) {
    const keyed = new ViewCamera(), wheeled = new ViewCamera();
    assert.equal(zoomCameraFromKey(event(code), context(keyed)), true);
    wheeled.zoomAt(wheelZoomFactor(delta), center, core);
    assert.deepEqual(keyed.descriptor(), wheeled.descriptor());
    assert.equal(keyed.mode, 'manual');
    assert.equal(code === 'KeyU' ? keyed.zoom > 1 : keyed.zoom < 1, true);
  }
});

test('keyboard zoom preserves the center ground anchor and original frozen camera', () => {
  const camera = new ViewCamera(), initial = camera.screenToWorld(center, core);
  zoomCameraFromKey(event('KeyU'), context(camera));
  const after = camera.screenToWorld(center, core);
  close(after.x, initial.x); close(after.y, initial.y);
  zoomCameraFromKey(event('KeyO'), context(camera));
  close(camera.zoom, 1); close(camera.centerX, core.x); close(camera.centerY, core.y);
  assert.deepEqual(core, { x: 2250, y: 400, width: 640, height: 400 });
});

test('held U/O accepts keyboard repeat at every simulation speed including paused', () => {
  const results = [];
  for (const speed of [0, 1, 20, 50, 100]) {
    const camera = new ViewCamera();
    const state = context(camera, { speed, paused: speed === 0 });
    zoomCameraFromKey(event('KeyU'), state);
    for (let n = 0; n < 5; n++) assert.equal(zoomCameraFromKey(event('KeyU', { repeat: true }), state), true);
    close(camera.zoom, Math.exp(.15 * 6));
    results.push(camera.descriptor());
  }
  for (const result of results) assert.deepEqual(result, results[0]);
});

test('keyboard zoom shares wheel minimum/maximum clamps and can leave full-map view', () => {
  const keyed = new ViewCamera().fitAll(), wheeled = new ViewCamera().fitAll();
  for (const [code, delta] of [['KeyO', 100], ['KeyU', -100]]) {
    for (let n = 0; n < 100; n++) {
      zoomCameraFromKey(event(code, { repeat: true }), context(keyed));
      wheeled.zoomAt(wheelZoomFactor(delta), center, core);
    }
    assert.deepEqual(keyed.descriptor(), wheeled.descriptor());
    assert.equal(keyed.zoom, code === 'KeyU' ? keyed.maxZoom : keyed.minZoom);
  }
});

test('inactive scenes, unrelated keys, modifiers and composing text do not zoom', () => {
  const camera = new ViewCamera();
  for (const code of ['KeyI', 'KeyJ', 'KeyK', 'KeyL', 'KeyW', 'ArrowRight', 'Enter', 'F2']) {
    assert.equal(zoomCameraFromKey(event(code), context(camera)), false);
  }
  for (const flag of ['ctrlKey', 'altKey', 'metaKey', 'isComposing']) {
    for (const code of ['KeyU', 'KeyO']) assert.equal(zoomCameraFromKey(event(code, { [flag]: true }), context(camera)), false);
  }
  assert.equal(zoomCameraFromKey(event('KeyU'), context(camera, { enabled: false })), false);
  assert.equal(zoomCameraFromKey(event('KeyU'), context(null)), false);
  assert.equal(camera.mode, 'follow'); assert.equal(camera.zoom, 1);
});

test('editing fields, settings, toolbar and confirmation targets own U/O', () => {
  const camera = new ViewCamera();
  for (const selector of ['input', 'textarea', 'select', '[contenteditable]', '[role="dialog"]',
    '[data-custom-controls]', '[data-settings-panel]', '[data-game-text-controls]']) {
    const target = { closest: query => query.includes(selector) ? {} : null };
    assert.equal(uiOwnsGameKeyboard(target), true);
    for (const code of ['KeyU', 'KeyO']) assert.equal(zoomCameraFromKey(event(code, { target }), context(camera)), false);
  }
  assert.equal(zoomCameraFromKey(event('KeyU', { target: { isContentEditable: true } }), context(camera)), false);
  assert.equal(camera.mode, 'follow');
  assert.equal(uiOwnsGameKeyboard(undefined), false);
  assert.equal(uiOwnsGameKeyboard({ closest: () => null }), false, 'Canvas focus is not blocked by an open drawer');
});

test('wheel factor extraction retains pixel, line, page and huge-delta behavior', () => {
  close(wheelZoomFactor(-100), Math.exp(.15));
  close(wheelZoomFactor(2, 1), Math.exp(-32 * .0015));
  close(wheelZoomFactor(1, 2), Math.exp(-400 * .0015));
  close(wheelZoomFactor(9000), Math.exp(-500 * .0015));
  close(wheelZoomFactor(-9000), Math.exp(500 * .0015));
  assert.equal(wheelZoomFactor(0), 1);
});

test('main routes U/O after confirmation and toolbar guards and before paused simulation keys', async () => {
  const main = await readFile(new URL('../src/app/main.mjs', import.meta.url), 'utf8');
  const listener = main.slice(main.indexOf("window.addEventListener('keydown'"), main.indexOf("window.addEventListener('keyup'"));
  const zoom = listener.indexOf('zoomCameraFromKey(event');
  assert.ok(zoom > listener.indexOf("if (settings?.isConfirming && event.code !== 'F11') return;"));
  assert.ok(zoom > listener.indexOf('if (toolbarKeys.has(event.code))'));
  assert.ok(zoom < listener.indexOf('!frameClock.paused'));
  assert.match(listener.slice(zoom), /enabled: ready && controller\.phase === 'game' && !controller\.overlay && !controller\.simulation\?\.winner/);
  assert.match(listener.slice(zoom), /frameClock\.invalidate\(\)/);
  assert.match(main, /observer\.zoomAt\(wheelZoomFactor\(event\.deltaY, event\.deltaMode\)/);
});

test('main wires real-time selection repeat outside simulation ticks and guards editing focus instead of drawer visibility', async () => {
  const main = await readFile(new URL('../src/app/main.mjs', import.meta.url), 'utf8');
  assert.match(main, /new OriginalKeyboard\(controller, \{ repeatSelection: true \}\)/);
  assert.match(main, /keyboard\.keyDown\(event\.code, \{ now: performance\.now\(\), repeat: event\.repeat \}\)/);
  assert.match(main, /observedSimulation = controller\.simulation;\s+keyboard\.clear\(\)/);
  const repeatStart = main.indexOf('if (keyboard.advanceSelection(now');
  const advance = main.indexOf('const { render } = frameClock.advance(now');
  assert.ok(repeatStart >= 0 && repeatStart < advance);
  const repeat = main.slice(repeatStart, advance);
  assert.match(repeat, /document\.hidden \|\| frameClock\.paused \|\| Boolean\(controller\.overlay\)/);
  assert.match(repeat, /settings\?\.isConfirming/);
  assert.match(repeat, /uiOwnsGameKeyboard\(document\.activeElement\)/);
  assert.doesNotMatch(repeat, /settings\?\.isOpen/);
  assert.match(repeat, /frameClock\.invalidate\(\)/);
});
