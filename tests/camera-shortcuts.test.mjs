import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { applyCameraShortcut } from '../src/app/camera-shortcuts.mjs';
import { CameraZoomKeyboard, uiOwnsGameKeyboard, wheelZoomFactor } from '../src/app/camera-keyboard.mjs';
import { ViewCamera } from '../src/render/view-camera.mjs';
import { beginPointerDrag, advancePointerDrag } from '../src/app/pointer-drag.mjs';
import { menuButtonState } from '../src/app/dual-ai-controls.mjs';

const main = await readFile(new URL('../src/app/main.mjs', import.meta.url), 'utf8');
const core = Object.freeze({ x: 2250, y: 400, width: 640, height: 400 });
const event = (code, extra = {}) => ({ code, repeat: false, target: { closest: () => null },
  preventDefault() { this.prevented = true; }, stopPropagation() {}, ...extra });

test('P calls the existing compact battle panorama with the current immutable snapshot', () => {
  const camera = new ViewCamera(), expected = new ViewCamera();
  const snapshot = Object.freeze([Object.freeze({ kind: 'base', side: 'left', px: 600, py: 400 }),
    Object.freeze({ kind: 'base', side: 'right', px: 3900, py: 400 })]);
  expected.fitAll(snapshot);
  assert.equal(applyCameraShortcut(event('KeyP'), { enabled: true, camera, snapshot }), true);
  assert.deepEqual(camera.descriptor(), expected.descriptor());
  assert.equal(camera.mode, 'overview');
});

test('physical Semicolon and English/Chinese punctuation fallback restore follow', () => {
  for (const input of [event('Semicolon', { key: ';' }), event('Semicolon', { key: '；' }),
    event('Semicolon', { key: ':', shiftKey: true }), event('Unidentified', { key: ';' }), event('', { key: '；' })]) {
    const camera = new ViewCamera().fitAll();
    assert.equal(applyCameraShortcut(input, { enabled: true, camera }), true);
    assert.equal(camera.mode, 'follow'); assert.equal(camera.zoom, 1); assert.equal(camera.getView(core), null);
  }
});

test('repeated presses, modifiers, composition, editing targets and disabled context do not change the camera', () => {
  for (const code of ['KeyP', 'Semicolon']) for (const extra of [{ repeat: true }, { ctrlKey: true }, { altKey: true },
    { metaKey: true }, { isComposing: true }, { target: { closest: () => ({}) } }]) {
    const camera = new ViewCamera(); camera.panBy(5, 0, core); const before = camera.descriptor();
    assert.equal(applyCameraShortcut(event(code, extra), { enabled: true, camera }), false);
    assert.deepEqual(camera.descriptor(), before);
  }
  assert.equal(applyCameraShortcut(event('KeyP'), { enabled: false, camera: new ViewCamera() }), false);
  assert.equal(applyCameraShortcut(event('KeyP'), { enabled: true, camera: null }), false);
  for (const code of ['KeyU', 'KeyO', 'KeyI', 'Space', 'Enter']) {
    assert.equal(applyCameraShortcut(event(code), { enabled: true, camera: new ViewCamera() }), false);
  }
});

function fixture() {
  const windowEvents = new Map(), documentEvents = new Map(), canvasEvents = new Map();
  const counters = { invalidations: 0, updates: 0, actions: [], unlocks: 0 };
  const simulation = { renderCamera: core, renderSnapshot: [], winner: null };
  const controller = { phase: 'game', overlay: null, simulation, singlePlay: false,
    config: { rules: { mapWidth: 4500, mapHeight: 800, baseSpawnInset: 300 } },
    action: (...args) => counters.actions.push(args), select: (...args) => counters.actions.push(args),
    key() {}, drainEvents: () => [] };
  const camera = new ViewCamera(), captures = new Set();
  const canvas = { style: {}, closest: () => null, addEventListener: (name, cb) => canvasEvents.set(name, cb),
    setPointerCapture: id => captures.add(id), hasPointerCapture: id => captures.has(id),
    releasePointerCapture: id => captures.delete(id) };
  const document = { hidden: false, activeElement: canvas, addEventListener: (name, cb) => documentEvents.set(name, cb) };
  canvas.focus = () => { document.activeElement = canvas; };
  const view = { pointer: null, pressed: null, hotspots: [], releaseRasterCaches() {}, tooltipLayouts: new Map() };
  view.hit = p => p && view.hotspots.find(h => p.x >= h.left && p.x < h.right && p.y >= h.top && p.y < h.bottom);
  const context = vm.createContext({ controller, ready: true, document, canvas, view, observer: camera, ViewCamera,
    window: { addEventListener: (name, cb) => windowEvents.set(name, cb) }, settingsRoot: { addEventListener() {} },
    settings: { isOpen: false, isConfirming: false, toggle() {}, close() {} },
    frameClock: { paused: true, invalidate: () => counters.invalidations++, advance() {} },
    cameraZoom: new CameraZoomKeyboard(), cameraKeys: new Set(), toolbarKeys: new Set(),
    keyboard: { clear() {}, keyDown() {}, keyUp() {} }, dualAIRecruitment: null,
    performance: { now: () => 1 }, observedSimulation: simulation, presentation: null,
    audio: { unlock: () => counters.unlocks++, consume() {}, setMuted() {} },
    resetMeasurements() {}, updateControls: () => counters.updates++, toggleFullscreen() {},
    point: e => ({ x: e.clientX, y: e.clientY }),
    sameHotspot: (a, b) => a && b && a.action === b.action && a.value === b.value && a.side === b.side && a.id === b.id,
    mapDrag: false, pressed: null, cameraDrag: null, previousWallNow: null, now: 16, wallDelta: 16,
    applyCameraShortcut, uiOwnsGameKeyboard, wheelZoomFactor, beginPointerDrag, advancePointerDrag });
  vm.runInContext(main.slice(main.indexOf('function clearGameInput('), main.indexOf('function timingChange(')), context);
  vm.runInContext(main.slice(main.indexOf('function moveMap('), main.indexOf('new ResizeObserver')), context);
  return { context, camera, controller, counters, view, canvas,
    key(code, extra = {}) { const e = event(code, { target: canvas, ...extra }); windowEvents.get('keydown')(e); return e; },
    up(code) { windowEvents.get('keyup')(event(code, { target: canvas })); },
    pointer(name, x, y, extra = {}) { const e = event('', { clientX: x, clientY: y, pointerId: 1, button: 0, target: canvas, ...extra }); canvasEvents.get(name)(e); return e; },
    panFrame() { vm.runInContext(main.slice(main.indexOf('// Cross the crystal-to-crystal span'), main.indexOf('    if (render)')), context); },
    focus(target) { document.activeElement = target; documentEvents.get('focusin')({ target }); },
    blur() { windowEvents.get('blur')(); },
    hidden() { document.hidden = true; documentEvents.get('visibilitychange')(); } };
}

test('actual main P and Semicolon work while globally paused, update UI, and ignore OS repeats', () => {
  const f = fixture();
  assert.equal(f.key('KeyP').prevented, true); assert.equal(f.camera.mode, 'overview');
  assert.equal(f.key('Semicolon', { key: ';' }).prevented, true); assert.equal(f.camera.mode, 'follow');
  f.key('KeyP', { repeat: true }); assert.equal(f.camera.mode, 'follow');
  f.key('KeyP'); f.key('Semicolon', { repeat: true }); assert.equal(f.camera.mode, 'overview');
  f.key('Unidentified', { key: '；' }); assert.equal(f.camera.mode, 'follow');
  assert.ok(f.counters.invalidations >= 4 && f.counters.updates >= 4);
});

test('actual main protects ready/menu/overlay/winner/hidden/confirmation and editing focus before shortcuts', () => {
  for (const mode of ['loading', 'menu', 'overlay', 'winner', 'hidden', 'confirmation', 'target', 'focus']) {
    for (const code of ['KeyP', 'Semicolon']) {
      const f = fixture(); f.camera.panBy(1, 0, core); const before = f.camera.descriptor();
      const extra = {};
      if (mode === 'loading') f.context.ready = false;
      if (mode === 'menu') f.controller.phase = 'menu';
      if (mode === 'overlay') f.controller.overlay = 'help';
      if (mode === 'winner') f.controller.simulation.winner = 'left';
      if (mode === 'hidden') f.context.document.hidden = true;
      if (mode === 'confirmation') f.context.settings.isConfirming = true;
      if (mode === 'target') extra.target = { closest: () => ({}) };
      if (mode === 'focus') f.context.document.activeElement = { closest: () => ({}) };
      assert.equal(f.key(code, extra).prevented, undefined, mode);
      assert.deepEqual(f.camera.descriptor(), before, mode);
    }
  }
});

test('actual main IJKL exits follow into free observation, even paused, and cannot revive after focus cleanup', () => {
  for (const code of ['KeyI', 'KeyJ', 'KeyK', 'KeyL']) {
    const f = fixture(); f.key('Semicolon'); f.key(code); f.panFrame();
    assert.equal(f.camera.mode, 'manual'); assert.ok(f.counters.updates >= 2);
    f.up(code); f.key('Semicolon');
    f.focus({ closest: () => ({}) }); f.focus(f.canvas);
    f.key(code, { repeat: true }); f.panFrame(); assert.equal(f.camera.mode, 'follow');
  }
});

test('actual main zero movement does not disable follow and overlay or hidden state clears held IJKL', () => {
  const f = fixture(); f.key('KeyJ'); f.key('KeyL'); f.panFrame(); assert.equal(f.camera.mode, 'follow');
  f.up('KeyJ'); f.controller.overlay = 'help'; f.panFrame(); assert.equal(f.camera.mode, 'follow');
  f.controller.overlay = null; f.panFrame(); assert.equal(f.camera.mode, 'follow');
  f.key('KeyI'); f.context.document.hidden = true; f.panFrame(); assert.equal(f.camera.mode, 'follow');
});

test('actual main drag and minimap positioning cancel follow through existing camera methods', () => {
  for (const button of [0, 1, 2]) {
    const f = fixture(); f.key('Semicolon');
    f.pointer('pointerdown', 320, 250, { button });
    f.pointer('pointermove', 330, 250, { button });
    assert.equal(f.camera.mode, 'manual'); f.pointer('pointerup', 330, 250, { button });
  }
  const f = fixture(); f.view.hotspots = [{ action: 'minimap', left: 180, top: 350, right: 460, bottom: 398, scale: .1 }];
  f.key('Semicolon'); f.pointer('pointerdown', 300, 370);
  assert.equal(f.camera.mode, 'manual'); assert.equal(f.camera.centerX, 1200);
  f.pointer('pointerup', 300, 370); assert.equal(f.counters.actions.length, 0);
});

test('actual main synchronizes a fresh scene before P so its first RAF cannot erase panorama', () => {
  const f = fixture(); f.controller.simulation = { renderSnapshot: [], renderCamera: core, winner: null };
  f.key('KeyP'); assert.equal(f.camera.mode, 'overview');
  f.context.syncObservationScene(16); assert.equal(f.camera.mode, 'overview');
});

test('actual main propagates button press to the renderer and clears on release, cancellation, lost capture or focus loss', () => {
  const item = { action: 'dual-ai', left: 200, top: 405, right: 300, bottom: 450 };
  for (const end of ['pointerup', 'pointercancel', 'lostpointercapture', 'clear', 'blur', 'hidden']) {
    const f = fixture(); f.controller.phase = 'menu'; f.view.hotspots = [item];
    f.pointer('pointerdown', 250, 420);
    assert.equal(f.view.pressed, item);
    assert.equal(menuButtonState(item, f.view.pointer, f.view.pressed), 'pressed');
    const invalidations = f.counters.invalidations;
    if (end === 'clear') f.context.clearGameInput();
    else if (end === 'blur') f.blur();
    else if (end === 'hidden') f.hidden();
    else f.pointer(end, 250, 420);
    assert.equal(f.view.pressed, null, end); assert.equal(f.context.pressed, null, end);
    assert.ok(f.counters.invalidations > invalidations, end);
    assert.equal(f.counters.actions.length, end === 'pointerup' ? 1 : 0, end);
  }
});

test('actual main dragging or cancelling a button press never triggers its action', () => {
  const f = fixture(); f.controller.phase = 'menu';
  f.view.hotspots = [{ action: 'dual-ai', left: 200, top: 405, right: 300, bottom: 450 }];
  f.pointer('pointerdown', 250, 420); f.pointer('pointermove', 350, 420);
  assert.equal(menuButtonState(f.view.hotspots[0], f.view.pointer, f.view.pressed), 'normal');
  f.pointer('pointerup', 350, 420); assert.equal(f.counters.actions.length, 0); assert.equal(f.view.pressed, null);
});
