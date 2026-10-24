import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { fitViewport } from '../src/platform/viewport.mjs';

const source = fs.readFileSync(new URL('../src/app/main.mjs', import.meta.url), 'utf8');

// Exercise the actual main adapter functions without starting a browser/game.
// Full menus, resizing, DPR and pixels are separately checked in real Chromium.
function adapter({ ready = true, dpr = 1.5 } = {}) {
  const calls = [], dimensions = { width: 640, height: 480 };
  const canvas = { style: {} };
  for (const key of ['width', 'height']) Object.defineProperty(canvas, key, {
    get: () => dimensions[key], set: value => { calls.push([key, value]); dimensions[key] = value; },
  });
  const context = {
    canvas, fit: null, ready, loadingMessage: null,
    window: { devicePixelRatio: dpr }, fitViewport,
    stage: { getBoundingClientRect: () => ({ width: 2120, height: 1590, left: 5.5, top: 3.25 }) },
    view: { setRenderSize: (...args) => calls.push(['view', ...args]) },
    renderer: { setRenderScale: (...args) => calls.push(['ground', ...args]) },
    frameClock: { invalidate: () => calls.push(['invalidate']) },
    updateControls: () => calls.push(['controls']), performance: { now: () => 10 },
    display: {
      setTransform: (...args) => calls.push(['transform', ...args]),
      fillRect: (...args) => calls.push(['fill', ...args]),
      fillText: (...args) => calls.push(['text', ...args]),
    },
  };
  vm.createContext(context);
  const functions = source.slice(source.indexOf('function resize()'), source.indexOf('async function json('));
  vm.runInContext(functions, context);
  return { context, calls, canvas };
}

test('native main renders into the visible canvas without a 640x480 stage intermediate', () => {
  assert.match(source, /new OriginalGameView\(canvas,/);
  assert.doesNotMatch(source, /const logical\s*=|drawImage\(logical|new OriginalGameView\(logical,/);
  assert.match(source, /view\.render\(controller, presentationRenderer\)/);
  assert.match(source, /presented\+\+/);
});

test('resize connects exact native dimensions and independently rounded render scales', () => {
  const { context, calls, canvas } = adapter();
  context.resize();
  assert.equal(canvas.width, 3180); assert.equal(canvas.height, 2385);
  assert.deepEqual(calls.find(x => x[0] === 'view'), ['view', 3180, 2385]);
  assert.deepEqual(calls.find(x => x[0] === 'ground'), ['ground', 3180 / 640, 2385 / 480]);
  assert.equal(context.fit.clientLeft, 5.5);
  assert.equal(context.fit.clientTop, 3.25);
  assert.ok(calls.some(x => x[0] === 'invalidate'));
});

test('unchanged resize does not clear the backing store again', () => {
  const { context, calls } = adapter();
  context.resize(); calls.length = 0; context.resize();
  assert.equal(calls.filter(x => ['width', 'height'].includes(x[0])).length, 0);
});

test('hidden stage does not allocate surfaces or invalidate presentation', () => {
  const { context, calls } = adapter();
  context.stage.getBoundingClientRect = () => ({ width: 0, height: 0 });
  context.resize(); assert.deepEqual(calls, []);
});

test('loading and failure messages draw at native density and survive resize', () => {
  const { context, calls } = adapter({ ready: false });
  context.resize(); calls.length = 0; context.message('Loading', 'Original images');
  assert.deepEqual(calls.find(x => x[0] === 'transform'), ['transform', 3180 / 640, 0, 0, 2385 / 480, 0, 0]);
  assert.deepEqual(calls.find(x => x[0] === 'fill'), ['fill', 0, 0, 640, 480]);
  calls.length = 0; context.window.devicePixelRatio = 2; context.resize();
  assert.ok(calls.some(x => x[0] === 'text' && x[1] === 'Loading'));
  assert.equal(context.canvas.width, 4240);
});

test('presentation-only resize works before the game is loaded without advancing time', () => {
  const { context, calls } = adapter();
  context.view = context.renderer = context.frameClock = null;
  context.resize();
  assert.ok(calls.some(x => x[0] === 'width'));
  assert.equal(context.fit.gameWidth, 640); assert.equal(context.fit.gameHeight, 480);
});

test('native main observes DPR changes without changing the original clock or CSS input mapping', () => {
  assert.match(source, /fit\?\.devicePixelRatio !== \(window\.devicePixelRatio \|\| 1\)/);
  assert.match(source, /clientToGame\(event\.clientX, event\.clientY, fit\)/);
  assert.match(source, /new MiraginePlayback\(controller,/);
  assert.match(source, /renderScaleX: canvas\.width \/ 640/);
  assert.match(source, /renderScaleY: canvas\.height \/ 480/);
});
