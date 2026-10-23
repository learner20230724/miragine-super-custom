import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { BattlefieldRenderer } from '../src/render/battlefield.mjs';
import { spriteRasterPlacement, spriteSourcePlacement } from '../src/render/sprite-source.mjs';
import { createCamera, projectSymbol } from '../src/render/projection.mjs';
import { ViewCamera, projectViewSymbol } from '../src/render/view-camera.mjs';

const close = (actual, expected, label = '') => assert.ok(Math.abs(actual - expected) < 1e-9,
  `${label}: ${actual} != ${expected}`);
const manifest = () => ({
  images: { terrain: { file: 'assets/terrain.png' } },
  sprites: { A0_idle: {
    bounds: { xMin: -10.5, yMin: -20.5, width: 30.5, height: 40.5 },
    rasterized: { scale: .9, width: 27, height: 36, offX: -9, offY: -18 },
    frames: [1, 2].map((index) => ({ index, file: `assets/unit-${index}.png`, width: 31, height: 41,
      bounds: { xMin: -10.5 + index - 1, yMin: -20.5 - index + 1, width: 30.5, height: 40.5 } })),
  } },
});

class Context {
  constructor() { this.calls = []; this.depth = 0; this.smoothingStack = []; }
  save() { this.depth++; this.smoothingStack.push(this.imageSmoothingEnabled); }
  restore() { this.depth--; this.imageSmoothingEnabled = this.smoothingStack.pop(); }
  beginPath() {}
  rect(...args) { this.calls.push(['rect', ...args]); }
  clip() {}
  clearRect() {}
  fillRect() {}
  translate(...args) { this.calls.push(['translate', ...args]); }
  scale(...args) { this.calls.push(['scale', ...args]); }
  setTransform(...args) { this.calls.push(['setTransform', ...args]); }
  transform(...args) { this.calls.push(['transform', ...args]); }
  drawImage(image, ...args) { this.calls.push(['drawImage', image, ...args, { smoothing: this.imageSmoothingEnabled }]); }
}

async function setup(options = {}) {
  const context = new Context(), surfaces = [], loaded = [];
  const canvasFactory = (width, height) => {
    const surface = { width, height, context: new Context(), getContext() { return this.context; } };
    surfaces.push(surface); return surface;
  };
  const ground = { canvas: { kind: 'ground', width: 640, height: 400 }, draw() { return this.canvas; }, dispose() {} };
  const renderer = new BattlefieldRenderer(context, manifest(), {
    canvasFactory, groundRenderer: ground, spriteRasterMode: 'source',
    imageLoader: async (_url, record) => { const image = { file: record.file }; loaded.push(image); return image; },
    ...options,
  });
  await renderer.load();
  return { renderer, context, surfaces, loaded };
}

const unit = (overrides = {}) => ({ uid: 1, kind: 'unit', side: 'left', spriteIndex: 0,
  action: 'idle', displayFrame: 1, currentFrame: 2, px: 0, py: 0, pz: 0,
  sx: 1, sy: 1, visible: true, ...overrides });
const spriteDraws = context => context.calls.filter(call => call[0] === 'drawImage' && call[1].kind !== 'ground');

test('source placement keeps integer bitmap extents and fractional frame anchors', () => {
  const sprite = manifest().sprites.A0_idle;
  assert.deepEqual(spriteSourcePlacement(sprite, sprite.frames[0]), {
    sourceX: 0, sourceY: 0, sourceWidth: 30, sourceHeight: 40,
    x: -9, y: -18, width: 27, height: 36,
  });
  const placement = spriteSourcePlacement(sprite, sprite.frames[1]);
  for (const [key, expected] of Object.entries({ sourceX: 0, sourceY: 1, sourceWidth: 29,
    sourceHeight: 40, x: -8.1, y: -18, width: 26.1, height: 36 })) close(placement[key], expected, key);
});

test('all four bitmap edges are clipped without rounding or expanding the original rectangle', () => {
  const sprite = manifest().sprites.A0_idle;
  const frame = { width: 40, height: 50, bounds: { xMin: -12.5, yMin: -22.5 } };
  const placement = spriteSourcePlacement(sprite, frame);
  for (const [key, expected] of Object.entries({ sourceX: 2, sourceY: 2, sourceWidth: 30,
    sourceHeight: 40, x: -9, y: -18, width: 27, height: 36 })) close(placement[key], expected, key);
  assert.equal(spriteSourcePlacement(sprite, { ...frame, bounds: { xMin: 100, yMin: 100 } }), null);
});

test('every preserved production frame retains the old clipping and source-to-logical mapping', () => {
  const data = JSON.parse(fs.readFileSync(new URL('../generated/asset-manifest.json', import.meta.url), 'utf8'));
  let frames = 0;
  for (const sprite of Object.values(data.sprites)) for (const frame of sprite.frames) {
    const result = spriteSourcePlacement(sprite, frame), raster = spriteRasterPlacement(sprite, frame);
    const scale = sprite.rasterized.scale;
    frames++;
    assert.ok(result && result.sourceWidth > 0 && result.sourceHeight > 0);
    assert.ok(result.sourceX >= 0 && result.sourceY >= 0);
    assert.ok(result.sourceX + result.sourceWidth <= frame.width + 1e-9);
    assert.ok(result.sourceY + result.sourceHeight <= frame.height + 1e-9);
    assert.ok(result.x >= raster.offX - 1e-9 && result.y >= raster.offY - 1e-9);
    assert.ok(result.x + result.width <= raster.offX + raster.width + 1e-9);
    assert.ok(result.y + result.height <= raster.offY + raster.height + 1e-9);
    close(raster.offX + raster.x + result.sourceX * scale, result.x);
    close(raster.offY + raster.y + result.sourceY * scale, result.y);
    close(result.sourceWidth * scale, result.width);
    close(result.sourceHeight * scale, result.height);
  }
  assert.equal(frames, 594);
});

test('source rendering uses one nine-argument PNG draw with unchanged projection and mirroring', async () => {
  const { renderer, context, surfaces } = await setup();
  const camera = createCamera(), input = [unit({ sx: -1, px: 125, py: -50 })];
  const before = structuredClone(input), cameraBefore = structuredClone(camera);
  const projected = projectSymbol(input[0], camera);
  const stats = renderer.render(input, camera);
  assert.equal(stats.spritesDrawn, 1); assert.equal(context.depth, 0);
  assert.equal(stats.spriteRasterMode, 'source'); assert.equal(stats.sourceSpritesDrawn, 1);
  assert.equal(stats.sourceEffectsDrawn, 0); assert.equal(stats.emptySourceEffects, 0);
  assert.equal(stats.spriteSurfaces, 0); assert.equal(stats.sourcePlacements, 1);
  assert.deepEqual(input, before); assert.deepEqual(camera, cameraBefore);
  assert.deepEqual(context.calls.filter(call => call[0] === 'translate'), [['translate', projected.x, projected.y]]);
  assert.deepEqual(context.calls.filter(call => call[0] === 'scale'), [['scale', projected.scaleX, projected.scaleY]]);
  assert.deepEqual(spriteDraws(context), [[
    'drawImage', { file: 'assets/unit-1.png' }, 0, 0, 30, 40, -9, -18, 27, 36, { smoothing: true },
  ]]);
  assert.equal(surfaces.length, 0); assert.equal(renderer.surfaces.size, 0);
});

test('240 source presentations reuse small coordinate records and allocate no sprite surfaces', async () => {
  const { renderer, context, surfaces } = await setup();
  for (let index = 0; index < 240; index++) renderer.render([unit({ px: index / 8 })], createCamera());
  assert.equal(spriteDraws(context).length, 240);
  assert.equal(renderer.sourcePlacements.size, 1);
  assert.equal(renderer.surfaces.size, 0); assert.equal(surfaces.length, 0);
  renderer.dispose(); assert.equal(renderer.sourcePlacements.size, 0);
});

test('overview uses the same source PNG and independent existing view projection', async () => {
  const { renderer, context, surfaces } = await setup();
  const camera = createCamera(), observer = new ViewCamera().fitAll(), view = observer.getView(camera);
  const input = unit({ px: 4000, py: 400 }), projected = projectViewSymbol(input, view);
  const before = structuredClone(input);
  renderer.render([input], camera, { displayView: view });
  assert.deepEqual(context.calls.filter(call => call[0] === 'translate'), [['translate', projected.x, projected.y]]);
  assert.deepEqual(context.calls.filter(call => call[0] === 'scale'), [['scale', projected.scaleX, projected.scaleY]]);
  assert.deepEqual(input, before); assert.equal(spriteDraws(context).length, 2); // Ground cache copy plus unit.
  assert.equal(surfaces.length, 1); // Only the existing ground cache; no role surface.
  assert.equal(renderer.surfaces.size, 0);
});

test('source mode preserves displayFrame, hidden, absent and invalid frame semantics', async () => {
  const { renderer, context } = await setup();
  const stats = renderer.render([unit({ visible: false }), unit({ displayFrame: null }),
    unit({ displayFrame: 999 }), unit({ displayFrame: 2, currentFrame: 1 })], createCamera());
  assert.equal(stats.hidden, 1); assert.equal(stats.emptySymbols, 1); assert.equal(stats.spritesDrawn, 1);
  assert.deepEqual(stats.missingSprites, [{ uid: 1, key: 'A0_idle', frame: 999 }]);
  assert.equal(spriteDraws(context)[0][1].file, 'assets/unit-2.png');
  assert.equal(renderer.sourcePlacements.size, 1);
});

test('legacy remains the constructor default and original cache path is unchanged', async () => {
  const { renderer, context, surfaces, loaded } = await setup({ spriteRasterMode: undefined,
    sourceFrames: { thunderball: { 1: { file: 'assets/raw-effect.png' } } } });
  renderer.render([unit()], createCamera());
  assert.equal(renderer.spriteRasterMode, 'legacy');
  assert.equal(loaded.some(image => image.file === 'assets/raw-effect.png'), false);
  assert.equal(surfaces.length, 1); assert.equal(surfaces[0].width, 27); assert.equal(surfaces[0].height, 36);
  assert.deepEqual(spriteDraws(context)[0].slice(2), [-9, -18, { smoothing: false }]);
  assert.equal(renderer.sourcePlacements.size, 0);
});

test('original-density records load once and draw without raster canvases, while removed frames stay empty', async () => {
  const record = { index: 1, file: 'assets/raw-effect.png', width: 128, height: 128,
    matrix: [.25, 0, 0, .25, -10.5, -20.5],
    clip: { xMin: -10.5, yMin: -20.5, xMax: 21.5, yMax: 11.5 } };
  const sourceFrames = { A0_idle: { 1: record, 2: { index: 2, empty: true } },
    thunderball: { 1: record } };
  const { renderer, context, surfaces, loaded } = await setup({ sourceFrames });
  assert.equal(loaded.filter(image => image.file === record.file).length, 1);
  const visible = renderer.render([unit()], createCamera());
  assert.equal(visible.spritesDrawn, 1); assert.equal(visible.sourceEffectsDrawn, 1);
  assert.equal(visible.sourceSpritesDrawn, 0); assert.equal(visible.emptySourceEffects, 0);
  assert.equal(spriteDraws(context).length, 1);
  assert.equal(spriteDraws(context)[0][1].file, record.file);
  assert.equal(context.calls.filter(call => call[0] === 'transform').length, 1);
  assert.equal(renderer.surfaces.size, 0); assert.equal(renderer.sourcePlacements.size, 0);
  assert.equal(surfaces.length, 0); assert.equal(context.depth, 0);
  const drawn = spriteDraws(context).length;
  const empty = renderer.render([unit({ displayFrame: 2 })], createCamera());
  assert.equal(empty.spritesDrawn, 1); assert.equal(empty.sourceEffectsDrawn, 0);
  assert.equal(empty.emptySourceEffects, 1);
  assert.equal(spriteDraws(context).length, drawn); // Do not fall back to the visible previous frame.
  assert.equal(context.depth, 0);
});

test('source draw failures restore nested contexts and bad rendering modes are rejected', async () => {
  const { renderer, context } = await setup();
  context.drawImage = image => { if (image.kind !== 'ground') throw new Error('source draw failed'); };
  assert.throws(() => renderer.render([unit()], createCamera()), /source draw failed/);
  assert.equal(context.depth, 0);
  assert.throws(() => new BattlefieldRenderer(new Context(), manifest(), { spriteRasterMode: 'ai' }), /spriteRasterMode/);
});
