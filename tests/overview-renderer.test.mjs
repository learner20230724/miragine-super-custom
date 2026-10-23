import test from 'node:test';
import assert from 'node:assert/strict';
import { BattlefieldRenderer } from '../src/render/battlefield.mjs';
import { ViewCamera, projectViewSymbol } from '../src/render/view-camera.mjs';

class Context {
  constructor(canvas) { this.canvas = canvas; this.calls = []; this.depth = 0; }
  save() { this.depth++; } restore() { this.depth--; }
  beginPath() {} rect(...args) { this.calls.push(['rect', ...args]); } clip() {}
  setTransform(...args) { this.calls.push(['setTransform', ...args]); }
  clearRect(...args) { this.calls.push(['clearRect', ...args]); }
  translate(...args) { this.calls.push(['translate', ...args]); }
  scale(...args) { this.calls.push(['scale', ...args]); }
  drawImage(...args) { this.calls.push(['drawImage', ...args]); }
  fillRect(...args) { this.calls.push(['fillRect', ...args]); }
  createPattern() { return {}; }
}
const core = Object.freeze({ x: 2000, y: 150, width: 640, height: 400 });
const unit = (extra = {}) => ({ uid: 1, kind: 'unit', side: 'left', spriteIndex: 0, action: 'idle',
  displayFrame: 1, px: 4200, py: 400, pz: 0, sx: 1, sy: 1, visible: true, ...extra });

async function setup() {
  const sprite = name => ({ bounds: { xMin: -40, yMin: -100, width: 80, height: 105 },
    rasterized: { scale: .9, width: 72, height: 94, offX: -36, offY: -90 },
    frames: [{ index: 1, file: `assets/${name}.png`, width: 80, height: 105,
      bounds: { xMin: -40, yMin: -100, width: 80, height: 105 } }] });
  const manifest = { images: { terrain: { file: 'assets/terrain.png' } }, sprites: {
    A0_idle: sprite('unit'), A_crystal: sprite('base'), fireball: sprite('fireball'),
  } };
  const surfaces = [];
  const canvasFactory = (width, height) => {
    const canvas = { width, height, getContext() { return this.ctx; } }; canvas.ctx = new Context(canvas);
    surfaces.push(canvas); return canvas;
  };
  const context = new Context(null);
  const gpu = { calls: [], canvas: { width: 640, height: 400 },
    draw(image, grounds) { this.calls.push({ image, grounds }); this.lastDrawStats = { revision: this.calls.length }; return this.canvas; },
    dispose() { this.disposed = true; }, invalidateTexture() { this.invalidated = true; } };
  const renderer = new BattlefieldRenderer(context, manifest, { canvasFactory, groundRenderer: gpu,
    imageLoader: async (_url, record) => ({ width: 80, height: 105, file: record.file }) });
  await renderer.load();
  return { renderer, context, gpu, surfaces };
}

test('all-map renders real off-legacy-screen units, bases and elevated effects with the same world projection', async () => {
  const { renderer, context, gpu } = await setup();
  const view = new ViewCamera().fitAll().getView(core);
  const input = [unit(), unit({ uid: 2, kind: 'base', px: 300 }),
    unit({ uid: 3, kind: 'attack', weaponSheet: 'fb', px: 2300, pz: 40 })];
  const before = structuredClone(input);
  const stats = renderer.render(input, core, { displayView: view });
  assert.equal(stats.spritesDrawn, 3); assert.equal(stats.groundCacheHit, false);
  assert.equal(gpu.calls.length, 1);
  assert.equal(context.depth, 0); assert.deepEqual(input, before);
  assert.deepEqual(context.calls.filter(call => call[0] === 'translate').map(call => call.slice(1)),
    input.map(entity => { const p = projectViewSymbol(entity, view); return [p.x, p.y]; }));
  assert.ok(gpu.calls[0].grounds.filter(g => g.drawable).every(g => g.vertices.every(Number.isFinite)));
  assert.deepEqual(context.calls.filter(call => call[0] === 'rect'), [['rect', 0, 0, 640, 400]]);
  assert.deepEqual(core, { x: 2000, y: 150, width: 640, height: 400 });
});

test('240 stationary overview presentations copy ground once while interpolated sprite positions update every time', async () => {
  const { renderer, context, gpu, surfaces } = await setup();
  const observer = new ViewCamera().fitAll(), view = observer.getView(core);
  for (let frame = 0; frame < 240; frame++) {
    const stats = renderer.render([unit({ px: 500 + frame / 8 })], { ...core, x: core.x + frame / 4 }, { displayView: view });
    assert.equal(stats.groundCacheHit, frame !== 0);
    assert.equal(stats.spritesDrawn, 1);
  }
  assert.equal(gpu.calls.length, 1);
  const groundSurface = surfaces[0];
  assert.equal(groundSurface.ctx.calls.filter(call => call[0] === 'drawImage').length, 1);
  const translations = context.calls.filter(call => call[0] === 'translate');
  assert.equal(translations.length, 240); assert.notEqual(translations[0][1], translations[239][1]);
  assert.equal(surfaces.length, 2); // One ground surface plus one reusable unit raster.
});

test('zoomed-out terrain gaps receive an opaque backdrop instead of retaining old follow-view units during source-over presentation', async () => {
  const { renderer, context } = await setup();
  renderer.render([unit({ px: 2100, py: 300 })], core);
  const before = context.calls.length;
  const fills = [];
  context.fillRect = function (...args) {
    fills.push({ args, alpha: this.globalAlpha, composite: this.globalCompositeOperation, color: this.fillStyle });
    this.calls.push(['fillRect', ...args]);
  };
  renderer.render([unit()], core, { displayView: new ViewCamera().fitAll().getView(core) });
  assert.deepEqual(fills, [{ args: [0, 0, 640, 400], alpha: 1, composite: 'source-over', color: '#0e0e0e' }]);
  const calls = context.calls.slice(before);
  const fill = calls.findIndex(call => call[0] === 'fillRect');
  assert.ok(fill > calls.findIndex(call => call[0] === 'clearRect'));
  assert.ok(fill < calls.findIndex(call => call[0] === 'drawImage'));
  const filled = fills.length;
  renderer.render([], core); assert.equal(fills.length, filled); // Legacy path remains unchanged.
  renderer.render([], core, { clear: false, displayView: new ViewCamera().fitAll().getView(core) });
  assert.equal(fills.length, filled); // Respect callers explicitly composing without a clear.
});

test('exact observer changes repaint once, and returning through legacy keeps the custom cached statistics', async () => {
  const { renderer, gpu, surfaces } = await setup();
  const observer = new ViewCamera().fitAll();
  const first = renderer.render([], core, { displayView: observer.getView(core) });
  renderer.render([], core); // Legacy still redraws with original source rules.
  const restored = renderer.render([], core, { displayView: observer.getView(core) });
  assert.equal(gpu.calls.length, 2); assert.equal(restored.groundCacheHit, true);
  assert.deepEqual(restored.ground, first.ground);
  observer.panBy(.000001, 0, core);
  assert.equal(renderer.render([], core, { displayView: observer.getView(core) }).groundCacheHit, false);
  assert.equal(gpu.calls.length, 3); assert.equal(surfaces.length, 1);
  renderer.invalidateDisplayGround(); assert.equal(gpu.invalidated, true);
  assert.equal(renderer.render([], core, { displayView: observer.getView(core) }).groundCacheHit, false);
  assert.equal(gpu.calls.length, 4);
  renderer.dispose(); assert.equal(surfaces[0].width, 0);
});

test('renderer observation validation and GPU failure do not leak state or poison the ground cache', async () => {
  const { renderer, gpu, context } = await setup();
  const view = new ViewCamera().fitAll().getView(core);
  assert.throws(() => renderer.render([], core, { displayView: { ...view, zoom: NaN } }), /displayView/);
  assert.throws(() => renderer.render([], core, { displayView: { ...view, width: 800 } }), /640x400/);
  const paint = gpu.draw.bind(gpu);
  gpu.draw = () => { throw new Error('owned GPU failure'); };
  assert.throws(() => renderer.render([], core, { displayView: view }), /owned GPU failure/);
  assert.equal(context.depth, 0);
  gpu.draw = paint;
  assert.equal(renderer.render([], core, { displayView: view }).groundCacheHit, false);
});
