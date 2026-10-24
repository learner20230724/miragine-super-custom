import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { GameController } from '../src/app/controller.mjs';
import { DualAIRecruitmentKeyboard, OriginalKeyboard } from '../src/app/input.mjs';
import { MiraginePlayback } from '../src/app/playback-session.mjs';
import { uiOwnsGameKeyboard } from '../src/app/camera-keyboard.mjs';
import { applyCameraShortcut } from '../src/app/camera-shortcuts.mjs';
import { ViewCamera } from '../src/render/view-camera.mjs';
import { createCustomization } from '../src/customization/index.mjs';

const defaults = JSON.parse(await readFile(new URL('../config/defaults.generated.json', import.meta.url), 'utf8'));
const main = await readFile(new URL('../src/app/main.mjs', import.meta.url), 'utf8');
const event = (code, extras = {}) => ({ code, repeat: false, preventDefault() {}, stopPropagation() {},
  target: { closest: () => null }, ...extras });
const flags = controller => [controller.simulation.p1[2], controller.simulation.p2[2]];

function fixture({ mode = 'ai-vs-ai', custom = false } = {}) {
  const records = new Map();
  const controller = new GameController(defaults, { storage: { getItem: () => 'true' } });
  const customization = custom ? createCustomization({ controller, defaults, initialConfig: defaults,
    storage: { getItem: key => records.get(key) ?? null, setItem: (key, value) => records.set(key, value) } }) : null;
  if (mode === 'ai-vs-ai') controller.startAIMatch();
  else controller.startMatch(mode === 'single');
  controller.drainEvents();
  return { controller, keys: new DualAIRecruitmentKeyboard(controller),
    keyboard: new OriginalKeyboard(controller, { repeatSelection: true }), customization, records };
}

function mainFixture(options = {}) {
  const f = fixture(options), windowEvents = new Map(), documentEvents = new Map();
  const canvas = { closest: () => null };
  let now = 0;
  const clock = new MiraginePlayback(f.controller, { now, inputStep: () => f.keyboard.step() });
  const counts = { update: 0, invalidate: 0, audio: [] };
  const invalidate = clock.invalidate.bind(clock);
  clock.invalidate = () => { counts.invalidate++; return invalidate(); };
  const context = vm.createContext({ controller: f.controller, keyboard: f.keyboard, dualAIRecruitment: f.keys,
    frameClock: clock, ready: true, document: { hidden: false, activeElement: canvas,
      addEventListener: (name, handler) => documentEvents.set(name, handler) },
    window: { addEventListener: (name, handler) => windowEvents.set(name, handler) },
    settingsRoot: { addEventListener() {} }, settings: { isConfirming: false, isOpen: false, close() {}, toggle() {} },
    toolbarKeys: new Set(), cameraKeys: new Set(),
    cameraZoom: { keyDown: () => false, keyUp: () => false, clear() {} },
    performance: { now: () => now }, uiOwnsGameKeyboard, applyCameraShortcut,
    observedSimulation: f.controller.simulation, presentation: null,
    view: { releaseRasterCaches() {}, tooltipLayouts: new Map() }, observer: new ViewCamera(), ViewCamera,
    audio: { unlock() {}, consume: events => counts.audio.push(...events) },
    updateControls: () => counts.update++, resetMeasurements() {}, toggleFullscreen() {},
    previousWallNow: now, mapDrag: false, pressed: null, cameraDrag: null });
  const scene = main.slice(main.indexOf('function clearGameInput('), main.indexOf('function timingChange('));
  const listeners = main.slice(main.indexOf('const inputCodes ='), main.indexOf('new ResizeObserver'));
  vm.runInContext(scene, context);
  vm.runInContext(listeners, context);
  return { ...f, clock, counts, context, canvas,
    setNow: value => { now = value; },
    down: (code, extras = {}) => windowEvents.get('keydown')(event(code, { target: canvas, ...extras })),
    up: code => windowEvents.get('keyup')(event(code, { target: canvas })),
    blur: () => windowEvents.get('blur')(),
    focus: target => { context.document.activeElement = target; documentEvents.get('focusin')({ target }); },
    visibility: hidden => { context.document.hidden = hidden; documentEvents.get('visibilitychange')(); },
  };
}

test('dual AI Space and Enter toggle independently and immediately, without a simulation tick', () => {
  const { controller, keys } = fixture();
  const before = flags(controller), frame = controller.simulation.frame;
  assert.equal(keys.keyDown(event('Space')), true);
  assert.deepEqual(flags(controller), [1 - before[0], before[1]]);
  assert.equal(keys.keyDown(event('Enter')), true);
  assert.deepEqual(flags(controller), before.map(value => 1 - value));
  assert.equal(controller.simulation.frame, frame);
  assert.equal(controller.drainEvents().filter(item => item.type === 'sound').length, 2);
});

test('immediate toggles ignore OS repeat and duplicate down until the corresponding key is released', () => {
  const { controller, keys } = fixture();
  keys.keyDown(event('Space')); keys.keyDown(event('Enter'));
  const after = flags(controller);
  for (let i = 0; i < 100; i++) {
    assert.equal(keys.keyDown(event('Space', { repeat: true })), false);
    assert.equal(keys.keyDown(event('Enter')), false);
    keys.sync();
  }
  assert.deepEqual(flags(controller), after);
  keys.keyUp(event('Space')); keys.keyDown(event('Space'));
  assert.deepEqual(flags(controller), [1 - after[0], after[1]]);
});

test('paused selection-frame clears cannot clear the independent immediate toggle latch', () => {
  const { controller, keys, keyboard } = fixture();
  keys.keyDown(event('Space')); keys.keyDown(event('Enter'));
  const after = flags(controller), frame = controller.simulation.frame;
  for (let now = 0; now <= 2000; now += 16) {
    keys.sync(); keyboard.advanceSelection(now, { blocked: true });
    keys.keyDown(event('Space')); keys.keyDown(event('Enter', { repeat: true }));
  }
  assert.deepEqual(flags(controller), after);
  assert.equal(controller.simulation.frame, frame);
});

test('clear, UI block, overlay, scene transition and OS repeat cannot leave stale toggle holds', () => {
  for (const mode of ['clear', 'blocked', 'overlay', 'scene']) {
    const { controller, keys } = fixture();
    keys.keyDown(event('Space'));
    if (mode === 'clear') keys.clear();
    if (mode === 'blocked') keys.sync({ blocked: true });
    if (mode === 'overlay') { controller.action('quit'); keys.sync(); controller.action('quit-cancel'); }
    if (mode === 'scene') { controller.startAIMatch(); keys.sync(); }
    const before = flags(controller);
    assert.equal(keys.keyDown(event('Space', { repeat: true })), false, mode);
    assert.deepEqual(flags(controller), before, mode);
    assert.equal(keys.keyDown(event('Space')), true, mode);
    assert.deepEqual(flags(controller), [1 - before[0], before[1]], mode);
  }
});

test('immediate adapter rejects ordinary modes, menus, stopped worlds and winners', () => {
  for (const mode of ['single', 'dual', 'menu', 'winner', 'stopped']) {
    const f = fixture({ mode: ['single', 'dual'].includes(mode) ? mode : 'ai-vs-ai' });
    if (mode === 'menu') f.controller.home();
    if (mode === 'winner') f.controller.simulation.winner = 'left';
    if (mode === 'stopped') f.controller.simulation.stop();
    const before = flags(f.controller);
    assert.equal(f.keys.keyDown(event('Space')), false, mode);
    assert.equal(f.keys.keyDown(event('Enter')), false, mode);
    assert.deepEqual(flags(f.controller), before, mode);
  }
});

test('dual AI keyboard recruitment is match-local and does not save or change next-match profiles', () => {
  const { controller, keys, customization, records } = fixture({ custom: true });
  const before = customization.getState(), saved = [...records];
  keys.keyDown(event('Space')); keys.keyDown(event('Enter'));
  const after = customization.getState();
  assert.deepEqual(after.next, before.next);
  assert.deepEqual(after.draft, before.draft);
  assert.deepEqual([...records], saved);
  assert.equal(after.battle.left.recruitment, false);
  assert.equal(after.battle.right.recruitment, false);
});

test('actual main listener toggles paused dual AI immediately and never enqueues sampled toggles', () => {
  const f = mainFixture();
  f.clock.setPaused(true, 0);
  const before = flags(f.controller), frame = f.controller.simulation.frame;
  f.down('Space'); f.down('Enter');
  assert.deepEqual(flags(f.controller), before.map(value => 1 - value));
  assert.equal(f.keyboard.down.size, 0);
  assert.equal(f.counts.invalidate, 3, 'pause invalidation plus two toggle repaints');
  assert.equal(f.counts.update, 2);
  assert.equal(f.counts.audio.filter(item => item.type === 'sound').length, 2);
  for (let now = 16; now <= 1000; now += 16) {
    f.keyboard.advanceSelection(now, { blocked: f.clock.paused });
    f.keys.sync(); f.clock.advance(now);
    f.down('Space', { repeat: true }); f.down('Enter');
  }
  assert.deepEqual(flags(f.controller), before.map(value => 1 - value));
  assert.equal(f.controller.simulation.frame, frame);
});

test('actual main short tap before first RAF survives fresh scene synchronization', () => {
  const f = mainFixture();
  f.controller.startAIMatch();
  const before = flags(f.controller), frame = f.controller.simulation.frame;
  f.setNow(5); f.down('Space'); f.down('Enter');
  f.setNow(6); f.up('Space'); f.up('Enter');
  f.context.syncObservationScene(16); f.keys.sync();
  assert.deepEqual(flags(f.controller), before.map(value => 1 - value));
  assert.equal(f.controller.simulation.frame, frame);
  assert.equal(f.context.observedSimulation, f.controller.simulation);
  assert.equal(f.keyboard.down.size, 0);
});

test('actual main avoids double toggle through many accelerated ticks at 1x and 100x', () => {
  for (const speed of [1, 100]) {
    const f = mainFixture(); f.clock.setSpeed(speed, 0);
    const before = flags(f.controller);
    f.down('Space'); f.down('Enter');
    for (let now = 1; now <= 100; now++) {
      f.keys.sync(); f.keyboard.advanceSelection(now); f.clock.advance(now);
      f.down('Space', { repeat: true }); f.down('Enter', { repeat: true });
    }
    assert.deepEqual(flags(f.controller), before.map(value => 1 - value));
    assert.equal(f.keyboard.down.size, 0);
  }
});

test('actual main preserves text/tool focus, confirms Enter normally and prevents held-key focus escape', () => {
  const f = mainFixture(), field = { closest: () => ({}) };
  const before = flags(f.controller);
  f.focus(field);
  f.down('Space', { target: field }); f.down('Enter', { target: field });
  f.focus(f.canvas);
  f.down('Space', { repeat: true }); f.down('Enter', { repeat: true });
  assert.deepEqual(flags(f.controller), before);
  f.up('Space'); f.up('Enter');
  f.context.settings.isConfirming = true;
  f.down('Space'); f.down('Enter');
  assert.deepEqual(flags(f.controller), before);
  f.context.settings.isConfirming = false;
  f.down('Space'); f.down('Enter');
  assert.deepEqual(flags(f.controller), before.map(value => 1 - value));
});

test('actual main clears toggle holds across blur, editing focus, visibility and scene changes', () => {
  for (const boundary of ['blur', 'focus', 'visibility', 'scene']) {
    const f = mainFixture(); f.down('Space');
    if (boundary === 'blur') f.blur();
    if (boundary === 'focus') { f.focus({ closest: () => ({}) }); f.focus(f.canvas); }
    if (boundary === 'visibility') { f.visibility(true); f.visibility(false); }
    if (boundary === 'scene') { f.controller.startAIMatch(); f.context.syncObservationScene(1); }
    const before = flags(f.controller);
    f.down('Space', { repeat: true });
    assert.deepEqual(flags(f.controller), before, boundary);
    f.down('Space');
    assert.deepEqual(flags(f.controller), [1 - before[0], before[1]], boundary);
  }
});

test('actual main retains ordinary single/dual frame sampling and global pause guard', () => {
  for (const mode of ['single', 'dual']) {
    const f = mainFixture({ mode });
    const before = flags(f.controller);
    f.down('Space'); f.down('Enter');
    assert.deepEqual(flags(f.controller), before, 'ordinary modes are not made immediate');
    f.keyboard.step();
    assert.deepEqual(flags(f.controller), [1 - before[0], mode === 'dual' ? 1 - before[1] : before[1]]);
    f.up('Space'); f.up('Enter'); f.keyboard.step();
    f.clock.setPaused(true, 0);
    const paused = flags(f.controller);
    f.down('Space'); f.down('Enter'); f.keyboard.step();
    assert.deepEqual(flags(f.controller), paused);
  }
});

test('main synchronizes immediate latches outside accelerated input steps and without the paused condition', () => {
  const start = main.indexOf('dualAIRecruitment.sync({ blocked:');
  const end = main.indexOf('if (keyboard.advanceSelection(now', start);
  assert.ok(start >= 0 && end > start);
  const sync = main.slice(start, end);
  assert.match(sync, /document\.hidden/); assert.match(sync, /settings\?\.isConfirming/);
  assert.match(sync, /uiOwnsGameKeyboard\(document\.activeElement\)/);
  assert.doesNotMatch(sync, /frameClock\.paused|frameClock\.advance/);
  assert.match(main, /function clearGameInput\(\)\s*\{[^}]*dualAIRecruitment\?\.clear\(\)/);
});
