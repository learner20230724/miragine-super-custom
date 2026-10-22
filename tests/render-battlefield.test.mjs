import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BattlefieldRenderer,
  ORIGINAL_GROUND_TILES,
  RENDER_FIDELITY,
  resolveSpriteFrame,
  spriteKeyFor,
  spriteRasterPlacement,
} from '../src/render/battlefield.mjs';
import { createCamera } from '../src/render/projection.mjs';

function fixtureSprite(key, count = 1) {
  return {
    bounds: { xMin: -10.5, yMin: -20.5, width: 30.5, height: 40.5 },
    rasterized: { scale: 0.9, width: 27, height: 36, offX: -9, offY: -18 },
    frames: Array.from({ length: count }, (_, index) => ({
      index: index + 1, file: `assets/${key}-${index + 1}.png`,
      width: 31, height: 41,
      bounds: { xMin: -10.5 + index, yMin: -20.5 - index, width: 30.5, height: 40.5 },
    })),
  };
}

function fixtureManifest() {
  return {
    images: Object.fromEntries(['terrain', 'bg1', 'bg2'].map(key => [key, { file: `assets/${key}.png` }])),
    sprites: {
      A0_idle: fixtureSprite('A0_idle', 2),
      B0_idle: fixtureSprite('B0_idle'),
      A_crystal: fixtureSprite('A_crystal'),
      B_crystal: fixtureSprite('B_crystal'),
      fireball: fixtureSprite('fireball'),
      thunderball: fixtureSprite('thunderball'),
      storm: fixtureSprite('storm'),
    },
  };
}

class FakeContext {
  constructor(canvas = null) { this.canvas = canvas; this.calls = []; this.depth = 0; }
  save() { this.depth += 1; this.calls.push(['save']); }
  restore() { this.depth -= 1; this.calls.push(['restore']); }
  beginPath() { this.calls.push(['beginPath']); }
  rect(...args) { this.calls.push(['rect', ...args]); }
  clip() { this.calls.push(['clip']); }
  translate(...args) { this.calls.push(['translate', ...args]); }
  scale(...args) { this.calls.push(['scale', ...args]); }
  clearRect(...args) { this.calls.push(['clearRect', ...args]); }
  fillRect(...args) { this.calls.push(['fillRect', ...args]); }
  drawImage(...args) { this.calls.push(['drawImage', ...args]); }
  createPattern(image, repeat) { this.calls.push(['createPattern', image, repeat]); return { image, repeat }; }
}

function setup() {
  const manifest = fixtureManifest();
  const context = new FakeContext();
  const loaded = [];
  const surfaces = [];
  const canvasFactory = (width, height) => {
    const canvas = { width, height, getContext: () => canvas.context };
    canvas.context = new FakeContext(canvas);
    surfaces.push(canvas);
    return canvas;
  };
  const groundRenderer = {
    calls: [], canvas: { kind: 'webgl-ground' }, lastDrawStats: { tileCount: 3 },
    draw(image, grounds) { this.calls.push({ image, grounds }); return this.canvas; },
    dispose() { this.disposed = true; },
  };
  const renderer = new BattlefieldRenderer(context, manifest, {
    baseUrl: 'https://example.invalid/game/', canvasFactory, groundRenderer,
    imageLoader: async (url, record) => { loaded.push({ url, record }); return { file: record.file }; },
  });
  return { renderer, context, manifest, loaded, surfaces, groundRenderer };
}

function unit(overrides = {}) {
  return { uid: 1, kind: 'unit', side: 'left', spriteIndex: 0, action: 'idle',
    displayFrame: 1, currentFrame: 2, px: 0, py: 0, pz: 0, sx: 1, sy: 1, visible: true,
    ...overrides };
}

test('the battlefield uses exactly the thirteen original ground tiles', () => {
  assert.equal(ORIGINAL_GROUND_TILES.length, 13);
  assert.deepEqual(ORIGINAL_GROUND_TILES[0], [
    { x: -900, y: -1600 }, { x: 8900, y: -1600 },
    { x: 8900, y: -1300 }, { x: -900, y: -1300 },
  ]);
  assert.equal(ORIGINAL_GROUND_TILES[12][0].y, 2000);
  assert.ok(Object.isFrozen(ORIGINAL_GROUND_TILES[0][0]));
  assert.equal(RENDER_FIDELITY.flashPixelParityValidated, false);
});

test('sprite identifiers preserve source team, raw sprite index, and effect sheets', () => {
  assert.equal(spriteKeyFor(unit()), 'A0_idle');
  assert.equal(spriteKeyFor(unit({ side: 'right', spriteIndex: 14, action: 'dead' })), 'B14_dead');
  assert.equal(spriteKeyFor({ kind: 'base', side: 'left' }), 'A_crystal');
  assert.equal(spriteKeyFor({ kind: 'base', side: 'right' }), 'B_crystal');
  for (const [weaponSheet, key] of [['fb', 'fireball'], ['tb', 'thunderball'], ['storm', 'storm']]) {
    assert.equal(spriteKeyFor({ kind: 'attack', weaponSheet }), key);
  }
  assert.equal(spriteKeyFor({ kind: 'attack' }), null); // Melee has no sprite.
  assert.equal(spriteKeyFor(unit({ spriteIndex: undefined })), null); // No invented id fallback.
});

test('frame selection uses displayFrame, never the already-advanced currentFrame', () => {
  const manifest = fixtureManifest();
  assert.equal(resolveSpriteFrame(unit(), manifest).frame.index, 1);
  assert.equal(resolveSpriteFrame(unit({ displayFrame: 2 }), manifest).frame.index, 2);
  assert.equal(resolveSpriteFrame(unit({ displayFrame: 3 }), manifest), null);
  assert.equal(resolveSpriteFrame(unit({ displayFrame: 0 }), manifest), null);
  assert.equal(resolveSpriteFrame(unit({ displayFrame: null }), manifest), null);
});

test('raster placement uses fixed sheet bounds, .9 scale, and truncated bitmap offsets', () => {
  const sprite = fixtureSprite('A0_idle', 2);
  const placement = spriteRasterPlacement(sprite, sprite.frames[1]);
  assert.deepEqual(placement, {
    width: 27, height: 36, offX: -9, offY: -18,
    x: 0.9, y: -0.9, imageWidth: 27.900000000000002, imageHeight: 36.9,
  });
});

test('load fetches actual manifest files once and can be awaited repeatedly', async () => {
  const { renderer, loaded } = setup();
  await Promise.all([renderer.load(), renderer.load()]);
  assert.equal(loaded.length, 11);
  assert.equal(new Set(loaded.map(item => item.url)).size, 11);
  assert.ok(loaded.every(item => item.url.startsWith('https://example.invalid/game/assets/')));
  assert.equal(renderer.loaded, true);
});

test('render preserves snapshot order, applies original bitmap offsets, and leaves HUD untouched', async () => {
  const { renderer, context, surfaces, groundRenderer } = setup();
  await renderer.load();
  const snapshot = [unit({ uid: 7, side: 'right', px: 100, py: 100 }), unit({ uid: 8, px: -100, py: -100 })];
  const before = structuredClone(snapshot);
  const stats = renderer.render(snapshot, createCamera());
  assert.equal(stats.spritesDrawn, 2);
  assert.equal(context.depth, 0);
  assert.deepEqual(snapshot, before);
  assert.deepEqual(context.calls.filter(call => call[0] === 'clearRect'), [['clearRect', 0, 0, 640, 400]]);
  const spriteDraws = context.calls.filter(call => call[0] === 'drawImage').slice(1);
  assert.equal(spriteDraws.length, 2);
  assert.deepEqual(spriteDraws.map(call => call.slice(2)), [[-9, -18], [-9, -18]]);
  const firstFile = surfaces[0].context.calls.find(call => call[0] === 'drawImage')[1].file;
  assert.equal(firstFile, 'assets/B0_idle-1.png'); // No resort of current positions.
  assert.equal(groundRenderer.calls[0].grounds.length, 13);
  assert.equal(groundRenderer.calls[0].grounds[0].drawable, false); // Last-added tile is behind camera.
  assert.equal(stats.ground.tileCount, 3);
  assert.equal(context.calls.some(call => call[0] === 'setTransform'), false);
});

test('backgrounds repeat with the two original parallax transforms', async () => {
  const { renderer, context } = setup();
  await renderer.load();
  renderer.render([], createCamera({ x: 2000, y: 150 }));
  assert.deepEqual(context.calls.filter(call => call[0] === 'translate'), [
    ['translate', -225, 0], ['translate', -500, 55],
  ]);
  assert.deepEqual(context.calls.filter(call => call[0] === 'fillRect'), [
    ['fillRect', 225, 0, 640, 79], ['fillRect', 500, 0, 640, 31],
  ]);
  assert.equal(context.calls.filter(call => call[0] === 'createPattern').length, 2);
  renderer.render([], createCamera({ x: 3000 }));
  assert.equal(context.calls.filter(call => call[0] === 'createPattern').length, 2);
});

test('hidden, empty melee, missing frames, behind-camera scale, and focal singularities stay distinct', async () => {
  const { renderer } = setup();
  await renderer.load();
  const focalY = -600 / Math.fround(Math.sin(-70 * Math.PI / 180));
  const stats = renderer.render([
    unit({ visible: false }),
    { kind: 'attack', visible: true },
    unit({ displayFrame: 999 }),
    unit({ py: 700 }),
    unit({ py: focalY, pz: 1 }),
    unit(),
  ], createCamera());
  assert.equal(stats.hidden, 1);
  assert.equal(stats.emptySymbols, 1);
  assert.deepEqual(stats.missingSprites, [{ uid: 1, key: 'A0_idle', frame: 999 }]);
  assert.equal(stats.zeroScale, 1);
  assert.equal(stats.unsupportedCoordinates, 1);
  assert.equal(stats.spritesDrawn, 1);
});

test('sprite surface cache does not rerasterize a displayed frame each render', async () => {
  const { renderer, surfaces } = setup();
  await renderer.load();
  renderer.render([unit()], createCamera(), { clear: false });
  renderer.render([unit()], createCamera(), { clear: false });
  assert.equal(surfaces.length, 1);
  assert.equal(surfaces[0].context.imageSmoothingEnabled, true);
  assert.equal(surfaces[0].width, 27);
  assert.equal(surfaces[0].height, 36);
});

test('context restore is guaranteed if the GPU backend fails, with no affine fallback', async () => {
  const { renderer, context, groundRenderer } = setup();
  await renderer.load();
  groundRenderer.draw = () => { throw new Error('GPU unsupported'); };
  assert.throws(() => renderer.render([], createCamera()), /GPU unsupported/);
  assert.equal(context.depth, 0);
});

test('context restore is guaranteed for nested background and sprite drawing errors', async () => {
  const { renderer, context } = setup();
  await renderer.load();
  context.fillRect = () => { throw new Error('Bitmap fill failed'); };
  assert.throws(() => renderer.render([], createCamera()), /Bitmap fill failed/);
  assert.equal(context.depth, 0);
  context.fillRect = () => {};
  const originalDraw = context.drawImage.bind(context);
  context.drawImage = (image, ...args) => {
    if (image.kind === 'webgl-ground') originalDraw(image, ...args);
    else throw new Error('Sprite draw failed');
  };
  assert.throws(() => renderer.render([unit()], createCamera()), /Sprite draw failed/);
  assert.equal(context.depth, 0);
});

test('load/render fail explicitly instead of substituting art or a fake battlefield', async () => {
  const { renderer } = setup();
  assert.throws(() => renderer.render([], createCamera()), /await/);
  renderer.imageLoader = async () => { throw new Error('Missing original asset'); };
  await assert.rejects(renderer.load(), /Missing original asset/);
  assert.equal(renderer.loaded, false);
});

test('dispose releases owned surfaces and GPU resources', async () => {
  const { renderer, groundRenderer } = setup();
  await renderer.load();
  renderer.render([unit()], createCamera());
  renderer.dispose();
  assert.equal(renderer.loaded, false);
  assert.equal(renderer.images.size, 0);
  assert.equal(renderer.surfaces.size, 0);
  assert.equal(groundRenderer.disposed, true);
});
