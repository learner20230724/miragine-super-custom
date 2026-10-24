import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { ViewCamera } from '../src/render/view-camera.mjs';
import { CameraZoomKeyboard, KEYBOARD_ZOOM_PER_SECOND, MAX_KEYBOARD_ZOOM_DELTA_MS,
  uiOwnsGameKeyboard, wheelZoomFactor } from '../src/app/camera-keyboard.mjs';

const core = Object.freeze({ x: 2250, y: 400, width: 640, height: 400 });
const center = { x: 320, y: 250 };
const event = (code, extras = {}) => ({ code, target: { closest: () => null }, ...extras });
const close = (actual, expected, tolerance = 1e-7) => assert.ok(Math.abs(actual - expected) < tolerance,
  `${actual} differs from ${expected}`);
const fixture = (extras = {}) => {
  const camera = new ViewCamera();
  return { camera, keys: new CameraZoomKeyboard(), state: { enabled: true, camera, coreCamera: core, scene: core, ...extras } };
};
function hold(f, code, start, duration, hz = 60) {
  f.keys.keyDown(event(code), start, f.state);
  const count = Math.ceil(duration / (1000 / hz));
  for (let n = 1; n <= count; n++) f.keys.advance(start + n * duration / count, f.state);
  f.keys.keyUp(event(code), start + duration, f.state);
}

test('held U doubles and O halves zoom per real second at 30, 60, 120 and 240 display Hz', () => {
  assert.equal(KEYBOARD_ZOOM_PER_SECOND, 2);
  for (const hz of [30, 60, 120, 240]) for (const [code, expected] of [['KeyU', 2], ['KeyO', .5]]) {
    const f = fixture(); hold(f, code, 0, 1000, hz);
    close(f.camera.zoom, expected); assert.equal(f.camera.mode, 'manual');
  }
});

test('first keydown has no 16% jump or repeat delay; the first elapsed millisecond already zooms', () => {
  const f = fixture();
  assert.equal(f.keys.keyDown(event('KeyU'), 0, f.state), true);
  assert.equal(f.camera.zoom, 1); assert.equal(f.camera.mode, 'follow');
  assert.equal(f.keys.advance(1, f.state), true); close(f.camera.zoom, 2 ** .001);
  assert.equal(f.keys.advance(2, f.state), true); close(f.camera.zoom, 2 ** .002);
});

test('keyboard zoom preserves the battlefield center anchor and original frozen camera', () => {
  const f = fixture(), initial = f.camera.screenToWorld(center, core);
  hold(f, 'KeyU', 0, 1000);
  const after = f.camera.screenToWorld(center, core);
  close(after.x, initial.x); close(after.y, initial.y);
  hold(f, 'KeyO', 1000, 1000);
  close(f.camera.zoom, 1); close(f.camera.centerX, core.x); close(f.camera.centerY, core.y);
  assert.deepEqual(core, { x: 2250, y: 400, width: 640, height: 400 });
});

test('paused and 1/20/50/100 game speed produce the same wall-time zoom', () => {
  const results = [];
  for (const speed of [0, 1, 20, 50, 100]) {
    const f = fixture({ speed, paused: speed === 0 }); hold(f, 'KeyU', 0, 600);
    results.push(f.camera.descriptor());
  }
  for (const result of results) assert.deepEqual(result, results[0]);
  close(results[0].zoom, 2 ** .6);
});

test('OS-repeat frequency and duplicate keydown do not affect zoom rate or move the camera at event delivery', () => {
  for (const repeatCount of [0, 1, 40]) {
    const f = fixture(); f.keys.keyDown(event('KeyU'), 0, f.state);
    for (let frame = 1; frame <= 50; frame++) {
      const before = f.camera.zoom;
      for (let repeat = 0; repeat < repeatCount; repeat++) {
        assert.equal(f.keys.keyDown(event('KeyU', { repeat: true }), (frame - 1) * 20 + repeat / 100, f.state), true);
      }
      f.keys.keyDown(event('KeyU'), (frame - 1) * 20, f.state);
      assert.equal(f.camera.zoom, before);
      f.keys.advance(frame * 20, f.state);
    }
    close(f.camera.zoom, 2);
  }
});

test('U and O held together cancel; releasing either resumes only the remaining direction', () => {
  const f = fixture(); f.keys.keyDown(event('KeyU'), 0, f.state);
  f.keys.advance(20, f.state); f.keys.keyDown(event('KeyO'), 30, f.state);
  close(f.camera.zoom, 2 ** .03);
  assert.equal(f.keys.advance(50, f.state), false);
  assert.equal(f.keys.keyUp(event('KeyU'), 60, f.state), false);
  close(f.camera.zoom, 2 ** .03);
  f.keys.advance(80, f.state); close(f.camera.zoom, 2 ** .01);
  f.keys.keyUp(event('KeyO'), 90, f.state); close(f.camera.zoom, 1);
});

test('a complete eight-millisecond tap between RAFs is settled on release and has no trailing animation', () => {
  const f = fixture(); f.keys.advance(0, f.state);
  f.keys.keyDown(event('KeyU'), 5, f.state); assert.equal(f.camera.zoom, 1);
  assert.equal(f.keys.keyUp(event('KeyU'), 13, f.state), true);
  close(f.camera.zoom, 2 ** .008);
  const released = f.camera.descriptor();
  for (const now of [16, 33, 100, 5000]) assert.equal(f.keys.advance(now, f.state), false);
  assert.deepEqual(f.camera.descriptor(), released);
});

test('release between frames settles only the remaining interval, not a second full frame', () => {
  const f = fixture(); f.keys.keyDown(event('KeyO'), 3, f.state);
  f.keys.advance(19, f.state); f.keys.advance(35, f.state);
  f.keys.keyUp(event('KeyO'), 40, f.state); close(f.camera.zoom, 2 ** -.037);
  const zoom = f.camera.zoom; f.keys.advance(51, f.state); assert.equal(f.camera.zoom, zoom);
});

test('long stalls integrate at most 50 ms and discard all remaining debt', () => {
  assert.equal(MAX_KEYBOARD_ZOOM_DELTA_MS, 50);
  const f = fixture(); f.keys.keyDown(event('KeyU'), 0, f.state);
  f.keys.advance(5000, f.state); close(f.camera.zoom, 2 ** .05);
  f.keys.advance(5016, f.state); close(f.camera.zoom, 2 ** .066);
  f.keys.keyUp(event('KeyU'), 5020, f.state); close(f.camera.zoom, 2 ** .07);
  f.keys.advance(10000, f.state); close(f.camera.zoom, 2 ** .07);
});

test('event edges share one frame budget, including repeated taps and direction changes', () => {
  const f = fixture(); f.keys.advance(0, f.state);
  for (const [start, end] of [[0, 20], [25, 45], [50, 70]]) {
    f.keys.keyDown(event('KeyU'), start, f.state); f.keys.keyUp(event('KeyU'), end, f.state);
  }
  close(f.camera.zoom, 2 ** .05);
  f.keys.advance(80, f.state);
  f.keys.keyDown(event('KeyU'), 90, f.state); f.keys.keyUp(event('KeyU'), 100, f.state);
  close(f.camera.zoom, 2 ** .06);
});

test('a stalled release is capped and never leaves a queued zoom animation', () => {
  const f = fixture(); f.keys.keyDown(event('KeyU'), 0, f.state);
  f.keys.keyUp(event('KeyU'), 10000, f.state); close(f.camera.zoom, 2 ** .05);
  const released = f.camera.descriptor();
  f.keys.advance(10001, f.state); f.keys.advance(20000, f.state);
  assert.deepEqual(f.camera.descriptor(), released);
});

test('cleanup loses all debt and OS repeats cannot revive cleared holds', () => {
  const f = fixture(); f.keys.keyDown(event('KeyU'), 0, f.state);
  f.keys.advance(16, f.state); const zoom = f.camera.zoom; f.keys.clear();
  for (const now of [30, 300, 1000]) {
    assert.equal(f.keys.keyDown(event('KeyU', { repeat: true }), now, f.state), false);
    assert.equal(f.keys.advance(now, f.state), false);
  }
  assert.equal(f.camera.zoom, zoom);
  f.keys.keyUp(event('KeyU'), 1001, f.state);
  f.keys.keyDown(event('KeyU'), 1002, f.state); f.keys.advance(1012, f.state);
  close(f.camera.zoom, zoom * 2 ** .01);
});

test('disabled scenes discard held time on either RAF or key release and do not resume automatically', () => {
  for (const stop of ['advance', 'keyUp']) {
    const f = fixture(); f.keys.keyDown(event('KeyU'), 0, f.state);
    if (stop === 'advance') f.keys.advance(100, { ...f.state, enabled: false });
    else f.keys.keyUp(event('KeyU'), 100, { ...f.state, enabled: false });
    f.keys.advance(200, f.state); assert.equal(f.camera.zoom, 1);
    assert.equal(f.keys.keyDown(event('KeyU', { repeat: true }), 201, f.state), false);
  }
});

test('new match identity clears old keys even when simulation changes between RAFs or before keyup', () => {
  for (const transition of ['advance', 'keyUp']) {
    const f = fixture(); f.keys.keyDown(event('KeyU'), 0, f.state);
    const fresh = { ...f.state, scene: {} };
    if (transition === 'advance') f.keys.advance(20, fresh);
    else f.keys.keyUp(event('KeyU'), 20, fresh);
    assert.equal(f.camera.zoom, 1);
    assert.equal(f.keys.keyDown(event('KeyU', { repeat: true }), 21, fresh), false);
    f.keys.keyUp(event('KeyU'), 22, fresh); assert.equal(f.camera.zoom, 1);
    f.keys.keyDown(event('KeyU'), 23, fresh); f.keys.advance(33, fresh);
    close(f.camera.zoom, 2 ** .01);
  }
});

test('editing fields, settings, toolbar and confirmation targets own U/O and cancel held time', () => {
  for (const selector of ['input', 'textarea', 'select', '[contenteditable]', '[role="dialog"]',
    '[data-custom-controls]', '[data-settings-panel]', '[data-game-text-controls]']) {
    const f = fixture(), target = { closest: query => query.includes(selector) ? {} : null };
    assert.equal(uiOwnsGameKeyboard(target), true);
    f.keys.keyDown(event('KeyU'), 0, f.state);
    assert.equal(f.keys.keyDown(event('KeyO', { target }), 15, f.state), false);
    f.keys.advance(30, f.state); assert.equal(f.camera.zoom, 1);
  }
  assert.equal(uiOwnsGameKeyboard({ isContentEditable: true }), true);
  assert.equal(uiOwnsGameKeyboard(undefined), false);
  assert.equal(uiOwnsGameKeyboard({ closest: () => null }), false, 'An open drawer does not own canvas focus');
});

test('release into an editing control cannot apply leftover camera movement', () => {
  const f = fixture(); f.keys.keyDown(event('KeyU'), 0, f.state);
  f.keys.keyUp(event('KeyU', { target: { isContentEditable: true } }), 15, f.state);
  f.keys.advance(30, f.state); assert.equal(f.camera.zoom, 1);
});

test('unrelated keys, modifiers, composition, missing camera and inactive contexts cannot start zoom', () => {
  const f = fixture();
  for (const code of ['KeyI', 'KeyJ', 'KeyK', 'KeyL', 'KeyW', 'ArrowRight', 'Enter', 'F2']) {
    assert.equal(f.keys.keyDown(event(code), 0, f.state), false);
    assert.equal(f.keys.keyUp(event(code), 0, f.state), false);
  }
  for (const flag of ['ctrlKey', 'altKey', 'metaKey', 'isComposing']) {
    assert.equal(f.keys.keyDown(event('KeyU', { [flag]: true }), 0, f.state), false);
  }
  assert.equal(f.keys.keyDown(event('KeyU'), 0, { ...f.state, enabled: false }), false);
  assert.equal(f.keys.keyDown(event('KeyU'), 0, { ...f.state, camera: null }), false);
  f.keys.advance(30, f.state); assert.equal(f.camera.zoom, 1);
});

test('backward RAF timestamps do not double-count time and invalid time fails before mutation', () => {
  const f = fixture(); f.keys.keyDown(event('KeyU'), 10, f.state);
  assert.equal(f.keys.advance(8, f.state), false);
  f.keys.advance(20, f.state); close(f.camera.zoom, 2 ** .01);
  const zoom = f.camera.zoom;
  for (const invalid of [NaN, Infinity, -1]) {
    assert.throws(() => f.keys.advance(invalid, f.state), TypeError);
    assert.throws(() => f.keys.keyDown(event('KeyO'), invalid, f.state), TypeError);
    assert.throws(() => f.keys.keyUp(event('KeyU'), invalid, f.state), TypeError);
  }
  assert.equal(f.camera.zoom, zoom);
  f.keys.keyUp(event('KeyU'), 25, f.state); close(f.camera.zoom, 2 ** .015);
});

test('keyboard shares wheel min/max clamps, may leave overview and stops making changes at a limit', () => {
  const f = fixture(); f.camera.fitAll();
  const initial = f.camera.zoom; hold(f, 'KeyU', 0, 1000);
  close(f.camera.zoom, initial * 2); assert.equal(f.camera.mode, 'manual');
  hold(f, 'KeyU', 1000, 10000); assert.equal(f.camera.zoom, f.camera.maxZoom);
  f.keys.keyDown(event('KeyU'), 11000, f.state); assert.equal(f.keys.advance(11020, f.state), false);
  f.keys.keyUp(event('KeyU'), 11020, f.state);
  hold(f, 'KeyO', 11020, 10000); assert.equal(f.camera.zoom, f.camera.minZoom);
  f.keys.keyDown(event('KeyO'), 21020, f.state); assert.equal(f.keys.advance(21040, f.state), false);
});

test('wheel factor is unchanged for pixel, line, page and huge-delta scrolling', () => {
  close(wheelZoomFactor(-100), Math.exp(.15));
  close(wheelZoomFactor(2, 1), Math.exp(-32 * .0015));
  close(wheelZoomFactor(1, 2), Math.exp(-400 * .0015));
  close(wheelZoomFactor(9000), Math.exp(-500 * .0015));
  close(wheelZoomFactor(-9000), Math.exp(500 * .0015));
  assert.equal(wheelZoomFactor(0), 1);
});

test('main routes U/O after confirmation/toolbars, advances before rendering, and permits paused observation', async () => {
  const main = await readFile(new URL('../src/app/main.mjs', import.meta.url), 'utf8');
  const listener = main.slice(main.indexOf("window.addEventListener('keydown'"), main.indexOf("window.addEventListener('keyup'"));
  const zoom = listener.indexOf('cameraZoom.keyDown(event');
  assert.ok(zoom > listener.indexOf("if (settings?.isConfirming && event.code !== 'F11') return;"));
  assert.ok(zoom > listener.indexOf('if (toolbarKeys.has(event.code))'));
  assert.ok(zoom < listener.indexOf('!frameClock.paused'));
  const source = main.slice(main.indexOf('function cameraZoomContext()'), main.indexOf('function timingChange('));
  assert.match(source, /controller\.phase === 'game' && !controller\.overlay && !controller\.simulation\?\.winner/);
  assert.match(source, /!document\.hidden && !settings\?\.isConfirming && !uiOwnsGameKeyboard\(document\.activeElement\)/);
  assert.match(source, /scene: controller\?\.simulation/); assert.doesNotMatch(source, /frameClock\.paused/);
  const combat = main.indexOf('const { render } = frameClock.advance(now');
  const advance = main.indexOf('if (cameraZoom.advance(performance.now(), cameraZoomContext())) frameClock.invalidate();');
  assert.ok(advance > combat && advance < main.indexOf('if (render)', combat));
  assert.match(main, /cameraZoom\.keyUp\(event, performance\.now\(\), cameraZoomContext\(\)\)/);
  assert.match(main, /observer\.zoomAt\(wheelZoomFactor\(event\.deltaY, event\.deltaMode\)/);
});

test('main clears held zoom on focus/visibility boundaries and fresh simulations', async () => {
  const main = await readFile(new URL('../src/app/main.mjs', import.meta.url), 'utf8');
  assert.match(main, /function clearGameInput\(\)\s*\{[^}]*cameraZoom\.clear\(\)/);
  assert.match(main, /document\.addEventListener\('focusin', event => \{\s*if \(uiOwnsGameKeyboard\(event\.target\)\) cameraZoom\.clear\(\)/);
  assert.match(main, /window\.addEventListener\('blur', \(\) => \{[^}]*cameraZoom\.clear\(\)/);
  const hidden = main.slice(main.indexOf("document.addEventListener('visibilitychange'"), main.indexOf('new ResizeObserver'));
  assert.match(hidden, /cameraZoom\.clear\(\)/);
  assert.match(main, /observedSimulation = controller\.simulation;\s+keyboard\.clear\(\);\s+cameraZoom\.clear\(\)/);
});

test('main new-match synchronization preserves a fresh held U and a complete short tap before the first RAF', async () => {
  const main = await readFile(new URL('../src/app/main.mjs', import.meta.url), 'utf8');
  const source = main.slice(main.indexOf('function syncObservationScene('), main.indexOf('function timingChange('));
  for (const shortTap of [false, true]) {
    const f = fixture(), previous = { renderCamera: { ...core, x: 500 } }, next = { renderCamera: core };
    let clears = 0;
    const sandbox = vm.createContext({ ready: true, observedSimulation: previous,
      controller: { phase: 'game', simulation: next, config: { rules: { mapWidth: 4500, mapHeight: 800, baseSpawnInset: 300 } } },
      keyboard: { clear() { clears++; } }, cameraZoom: f.keys, observer: f.camera, ViewCamera,
      presentation: { camera: previous.renderCamera }, view: { releaseRasterCaches() {}, tooltipLayouts: new Map() },
      resetMeasurements() {}, performance: { now: () => 5 }, document: { hidden: false, activeElement: null },
      settings: { isConfirming: false }, uiOwnsGameKeyboard });
    vm.runInContext(source, sandbox);
    f.keys.keyDown(event('KeyO'), 0, { ...f.state, scene: previous });
    assert.equal(f.keys.keyDown(event('KeyU'), 5, sandbox.cameraZoomContext()), true);
    assert.equal(clears, 1); assert.equal(sandbox.presentation, null);
    assert.equal(sandbox.cameraZoomContext().coreCamera, core, 'Old presentation camera must not anchor the new scene');
    if (shortTap) f.keys.keyUp(event('KeyU'), 13, sandbox.cameraZoomContext());
    sandbox.syncObservationScene(16);
    f.keys.advance(16, sandbox.cameraZoomContext());
    assert.equal(clears, 1, 'First RAF must not clear a second time');
    close(f.camera.zoom, 2 ** ((shortTap ? 8 : 11) / 1000));
  }
});

test('main leaves selection repeat outside simulation ticks and preserves existing focus guards', async () => {
  const main = await readFile(new URL('../src/app/main.mjs', import.meta.url), 'utf8');
  assert.match(main, /new OriginalKeyboard\(controller, \{ repeatSelection: true \}\)/);
  assert.match(main, /keyboard\.keyDown\(event\.code, \{ now: performance\.now\(\), repeat: event\.repeat \}\)/);
  const start = main.indexOf('if (keyboard.advanceSelection(now');
  const advance = main.indexOf('const { render } = frameClock.advance(now');
  assert.ok(start >= 0 && start < advance);
  const repeat = main.slice(start, advance);
  assert.match(repeat, /document\.hidden \|\| frameClock\.paused \|\| Boolean\(controller\.overlay\)/);
  assert.match(repeat, /settings\?\.isConfirming/);
  assert.match(repeat, /uiOwnsGameKeyboard\(document\.activeElement\)/);
  assert.doesNotMatch(repeat, /settings\?\.isOpen/); assert.match(repeat, /frameClock\.invalidate\(\)/);
});
