import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { BattlefieldRenderer } from '../src/render/battlefield.mjs';
import { createCamera } from '../src/render/projection.mjs';
import { projectViewSymbol } from '../src/render/view-camera.mjs';
import { projectedRectangleOutside, sourceEffectDrawBounds } from '../src/render/sprite-culling.mjs';
import { sourceEffectLayout } from '../src/render/source-effects.mjs';
import { parseOptions } from '../tools/verify-offscreen-culling.mjs';

const project = (x, y = 200, scaleX = 1, scaleY = 1) => ({ x, y, scaleX, scaleY });
const rect = { x: -10, y: -30, width: 20, height: 40 };
const outside = (p, r = rect, margin = 1) => projectedRectangleOutside(p, r, 640, 400, margin);

test('pixel verifier report paths are restricted to fresh ignored JSON reports', () => {
  assert.equal(parseOptions([]).report, '.local/offscreen-culling-verification.json');
  assert.equal(parseOptions(['--report', '.local/nested/culling.json']).report, '.local/nested/culling.json');
  for (const report of ['../report.json', '.local/../public.json', 'public.json', '.local/x.txt', '.local//x.json', 'C:/private/x.json']) {
    assert.throws(() => parseOptions(['--report', report]), /inside/);
  }
  assert.throws(() => parseOptions(['--report']), /Missing/);
  assert.throws(() => parseOptions(['--channel', 'msedge', '--channel', 'chrome']), /repeated/);
});

test('culling retains partly visible rectangles, signed scales and a one-backing-pixel edge reserve', () => {
  for (const x of [-10, -5, 0, 640, 645, 650]) assert.equal(outside(project(x)), false);
  assert.equal(outside(project(-12)), true);
  assert.equal(outside(project(652)), true);
  for (const scale of [-4, -1, .125, 1, 4]) {
    assert.equal(outside(project(0, 200, scale, -scale)), false);
    assert.equal(outside(project(640, 200, scale, -scale)), false);
    assert.equal(outside(project(-100, 200, scale, -scale)), true);
  }
  assert.equal(outside(project(320, -11)), false); // Lower part crosses the upper clip edge.
  assert.equal(outside(project(320, -12)), true);
  assert.equal(outside(project(320, 431)), false);
  assert.equal(outside(project(320, 432)), true);
  assert.equal(outside(project(-10.75), rect, 1), false);
  assert.equal(outside(project(-10.75), rect, .5), true);
  assert.equal(outside(project(1300, 200, -2), { x: 300, y: -20, width: 500, height: 40 }), false);
});

test('very large finite rectangles use endpoints without overflow-based false negatives', () => {
  assert.equal(outside(project(Number.MAX_SAFE_INTEGER)), true);
  assert.equal(outside(project(-Number.MAX_SAFE_INTEGER)), true);
  assert.equal(outside(project(320), { x: -1e300, y: -30, width: 2e300, height: 40 }), false);
  assert.equal(outside(project(320, 200, 1e300)), false); // Finite visible giant.
  assert.equal(outside(project(320, 200, Number.MAX_VALUE)), false); // Overflow falls back to draw.
  assert.equal(outside(project(1e9 - 10), { x: -1e9, y: -30, width: 1, height: 40 }), false); // Float32 cancellation is uncertain.
  assert.equal(outside(project(Infinity)), false);
  assert.equal(outside(project(NaN)), false);
});

test('source-effect bounds include the actual rotated image intersected with both original clips', () => {
  const manifest = JSON.parse(readFileSync(new URL('../generated/asset-manifest.json', import.meta.url)));
  const effects = JSON.parse(readFileSync(new URL('../generated/source-effects.json', import.meta.url)));
  for (const [key, frames] of Object.entries(effects.sprites)) for (const record of Object.values(frames)) {
    const result = sourceEffectDrawBounds(manifest.sprites[key], record);
    if (record.empty) { assert.equal(result, null); continue; }
    const layout = sourceEffectLayout(manifest.sprites[key], record);
    assert.ok(result.width > 0 && result.height > 0);
    for (const clip of [layout.rasterClip, layout.shapeClip]) {
      assert.ok(result.x >= clip.x && result.y >= clip.y);
      assert.ok(result.x + result.width <= clip.x + clip.width + 1e-10);
      assert.ok(result.y + result.height <= clip.y + clip.height + 1e-10);
    }
  }
  const record = { width: 200, height: 100, matrix: [0, -1, 1, 0, 0, 200],
    clip: { xMin: 0, yMin: 0, xMax: 100, yMax: 200 } };
  const sprite = { bounds: { xMin: 0, yMin: 0 }, rasterized: { scale: 1, offX: 0, offY: 0, width: 100, height: 200 } };
  assert.deepEqual(sourceEffectDrawBounds(sprite, record), { x: 0, y: 0, width: 100, height: 200 });
  assert.deepEqual(sourceEffectDrawBounds(sprite, record, { naturalWidth: 50, naturalHeight: 60 }),
    { x: 0, y: 150, width: 60, height: 50 });
});

class Context {
  constructor() { this.calls = []; this.depth = 0; }
  save() { this.depth++; this.calls.push(['save']); }
  restore() { this.depth--; this.calls.push(['restore']); }
  beginPath() { this.calls.push(['beginPath']); }
  rect(...args) { this.calls.push(['rect', ...args]); }
  clip() { this.calls.push(['clip']); }
  translate(...args) { this.calls.push(['translate', ...args]); }
  scale(...args) { this.calls.push(['scale', ...args]); }
  transform(...args) { this.calls.push(['transform', ...args]); }
  setTransform(...args) { this.calls.push(['setTransform', ...args]); }
  clearRect(...args) { this.calls.push(['clearRect', ...args]); }
  fillRect(...args) { this.calls.push(['fillRect', ...args]); }
  drawImage(...args) { this.calls.push(['drawImage', ...args]); }
}

function sprite(key, bounds = rect) {
  return { bounds: { xMin: bounds.x, yMin: bounds.y, width: bounds.width, height: bounds.height },
    rasterized: { scale: 1, offX: bounds.x, offY: bounds.y, width: bounds.width, height: bounds.height },
    frames: [1, 2].map(index => ({ index, file: `${key}-${index}.png`, width: bounds.width, height: bounds.height,
      bounds: { xMin: bounds.x, yMin: bounds.y, width: bounds.width, height: bounds.height } })) };
}
const unit = (px, extra = {}) => ({ uid: px, kind: 'unit', side: 'left', spriteIndex: 0, action: 'idle',
  displayFrame: 1, px, py: 0, pz: 0, sx: 1, sy: 1, ...extra });
async function rendererFor(mode = 'source') {
  const manifest = { images: { terrain: { file: 'terrain.png', width: 2, height: 2 } },
    sprites: { A0_idle: sprite('unit'), storm: sprite('effect', { x: -500, y: -300, width: 1000, height: 600 }) } };
  const effect = { file: 'original-effect.png', width: 1000, height: 600, matrix: [1, 0, 0, 1, -500, -300],
    clip: { xMin: -500, yMin: -300, xMax: 500, yMax: 300 } };
  const context = new Context(), surfaces = [];
  const factory = (width, height) => {
    const ctx = new Context(), surface = { width, height, getContext: () => ctx };
    ctx.canvas = surface; surfaces.push(surface); return surface;
  };
  const ground = { ground: true, width: 640, height: 400 };
  const renderer = new BattlefieldRenderer(context, manifest, { canvasFactory: factory, spriteRasterMode: mode,
    sourceFrames: { storm: { 1: effect, 2: { empty: true } } },
    imageLoader: async (_url, record) => ({ file: record.file, width: record.width, height: record.height }),
    groundRenderer: { setRenderScale(x, y) { ground.width = Math.ceil(640 * x); ground.height = Math.ceil(400 * y); },
      draw: () => ground } });
  await renderer.load();
  return { renderer, context, surfaces };
}

test('source and legacy skip only wholly offscreen sprites, preserve painter order, and never mutate snapshots', async () => {
  for (const mode of ['source', 'legacy']) {
    const { renderer, context } = await rendererFor(mode);
    const snapshot = [unit(-2000), unit(50), unit(2000), unit(-50, { sx: -1 }),
      unit(-329), unit(329), unit(0, { pz: 1000 }), unit(0, { visible: false })];
    const before = structuredClone(snapshot), camera = createCamera();
    const stats = renderer.render(snapshot, camera);
    assert.equal(stats.culledSprites, 3);
    assert.equal(stats.spritesDrawn, 4);
    assert.equal(stats.hidden, 1);
    assert.deepEqual(context.calls.filter(call => call[0] === 'translate').map(call => call[1]), [370, 270, -9, 649]);
    assert.deepEqual(snapshot, before);
    assert.equal(context.depth, 0);
    const optimizedCalls = context.calls.filter(call => ['translate', 'scale', 'drawImage'].includes(call[0]));
    context.calls.length = 0;
    const onlyVisible = snapshot.filter((_, index) => [1, 3, 4, 5].includes(index));
    renderer.render(onlyVisible, camera, { cullOffscreen: false });
    assert.deepEqual(context.calls.filter(call => ['translate', 'scale', 'drawImage'].includes(call[0])), optimizedCalls);
    context.calls.length = 0;
    assert.equal(renderer.render(snapshot, camera, { cullOffscreen: false }).spritesDrawn, 7);
    assert.equal(renderer.lastRenderStats.culledSprites, 0);
  }
});

test('legacy culling happens before raster allocation and bounds caches remain per asset, not per unit', async () => {
  const { renderer, surfaces } = await rendererFor('legacy');
  const snapshot = Array.from({ length: 1600 }, (_, i) => unit(2000 + i));
  const stats = renderer.render(snapshot, createCamera());
  assert.equal(stats.culledSprites, 1600);
  assert.equal(stats.spritesDrawn, 0);
  assert.equal(stats.spriteSurfaces, 0);
  assert.equal(surfaces.length, 0);
  assert.equal(renderer.spriteDrawBounds.size, 1);
  renderer.dispose();
  assert.equal(renderer.spriteDrawBounds.size, 0);
});

test('caller filters, displaced shadows and destination-wide composites conservatively retain all draws', async () => {
  for (const settings of [{ filter: 'blur(20px)' }, { shadowBlur: 20 }, { shadowOffsetX: -2000 },
    { shadowOffsetY: 1000 }, { globalCompositeOperation: 'copy' }]) {
    const { renderer, context } = await rendererFor();
    Object.assign(context, settings);
    const stats = renderer.render([unit(2000)], createCamera());
    assert.equal(stats.offscreenCulling, false);
    assert.equal(stats.culledSprites, 0);
    assert.equal(stats.spritesDrawn, 1);
  }
});

test('giant source effects intersecting the screen are drawn even with far-away feet, and blank frames stay blank', async () => {
  const { renderer, context } = await rendererFor();
  const effect = (x, extra = {}) => unit(x - 320, { kind: 'attack', weaponSheet: 'storm', ...extra });
  const stats = renderer.render([effect(800), effect(1300, { sx: -2 }), effect(2000), effect(320, { displayFrame: 2 })], createCamera());
  assert.equal(stats.sourceEffectsDrawn, 2);
  assert.equal(stats.culledSprites, 1);
  assert.equal(stats.emptySourceEffects, 1);
  assert.equal(stats.spritesDrawn, 3); // Historical count includes a selected blank source frame.
  assert.equal(context.calls.filter(call => call[0] === 'drawImage' && call[1].file === 'original-effect.png').length, 2);
  assert.equal(context.depth, 0);
});

test('observation zoom and native fractional DPR use final projection rather than world or foot-point culling', async () => {
  const { renderer, context } = await rendererFor();
  renderer.setRenderScale(2.5, 1.25);
  for (const zoom of [.05, .4, 1, 4]) {
    const view = { kind: 'observation-view', mode: 'manual', width: 640, height: 400,
      centerX: 1000, centerY: 0, zoom, offsetX: 0, offsetY: 0, nearPlane: 24 };
    const snapshot = [-10000, 0, 1000, 2000, 10000].map((x, i) => unit(x, { sx: i % 2 ? -1 : 1 }));
    const expected = snapshot.map(entity => projectViewSymbol(entity, view)).filter(point => !projectedRectangleOutside(point, rect, 640, 400, .4, .8));
    context.calls.length = 0;
    const stats = renderer.render(snapshot, createCamera(), { displayView: view });
    assert.equal(stats.spritesDrawn, expected.length);
    assert.equal(stats.culledSprites, snapshot.length - expected.length);
    assert.deepEqual(context.calls.filter(call => call[0] === 'translate').map(call => call.slice(1)), expected.map(point => [point.x, point.y]));
    assert.deepEqual(stats.renderTarget, { logicalWidth: 640, logicalHeight: 400, backingWidth: 1600, backingHeight: 500 });
  }
});
