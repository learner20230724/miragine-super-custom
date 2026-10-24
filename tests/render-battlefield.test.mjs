import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BattlefieldRenderer,
  ORIGINAL_GROUND_TILES,
  RENDER_FIDELITY,
  backgroundTileOrigins,
  resolveSpriteFrame,
  spriteKeyFor,
  spriteRasterPlacement,
} from '../src/render/battlefield.mjs';
import { createCamera } from '../src/render/projection.mjs';
import { ViewCamera } from '../src/render/view-camera.mjs';

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
    images: Object.fromEntries([['terrain', 8000, 300], ['bg1', 920, 79], ['bg2', 584, 31]]
      .map(([key, width, height]) => [key, { file: `assets/${key}.png`, width, height }])),
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
  setTransform(...args) { this.calls.push(['setTransform', ...args]); }
  clearRect(...args) { this.calls.push(['clearRect', ...args]); }
  fillRect(...args) { this.calls.push(['fillRect', ...args]); }
  drawImage(...args) { this.calls.push(['drawImage', ...args]); }
  createPattern(image, repeat) { this.calls.push(['createPattern', image, repeat]); return { image, repeat }; }
}

function setup(options = {}) {
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
    calls: [], scaleCalls: [], canvas: { kind: 'webgl-ground', width: 640, height: 400 }, lastDrawStats: { tileCount: 3 },
    setRenderScale(x, y) { this.scaleCalls.push([x, y]); this.canvas.width = Math.ceil(640 * x); this.canvas.height = Math.ceil(400 * y); },
    draw(image, grounds) { this.calls.push({ image, grounds }); return this.canvas; },
    dispose() { this.disposed = true; },
  };
  const renderer = new BattlefieldRenderer(context, manifest, {
    baseUrl: 'https://example.invalid/game/', canvasFactory, groundRenderer,
    imageLoader: async (url, record) => { loaded.push({ url, record }); return { file: record.file }; },
    ...options,
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
  const spriteDraws = context.calls.filter(call => call[0] === 'drawImage' && surfaces.includes(call[1]));
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
  assert.deepEqual(context.calls.filter(call => call[0] === 'drawImage' && call[1].file?.includes('/bg'))
    .map(call => [call[1].file, ...call.slice(2)]), [
    ['assets/bg1.png', 0, 0], ['assets/bg2.png', 0, 0], ['assets/bg2.png', 584, 0],
  ]);
  assert.equal(context.calls.filter(call => call[0] === 'fillRect').length, 0);
  assert.equal(context.calls.filter(call => call[0] === 'createPattern').length, 0);
  renderer.render([], createCamera({ x: 3000 }));
  assert.equal(context.calls.filter(call => call[0] === 'createPattern').length, 0);
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
  const originalDraw = context.drawImage.bind(context);
  context.drawImage = (image, ...args) => {
    if (image.file === 'assets/bg1.png') throw new Error('Bitmap fill failed');
    originalDraw(image, ...args);
  };
  assert.throws(() => renderer.render([], createCamera()), /Bitmap fill failed/);
  assert.equal(context.depth, 0);
  context.drawImage = (image, ...args) => {
    if (image.kind === 'webgl-ground' || image.file?.includes('/bg')) originalDraw(image, ...args);
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

test('native battlefield accepts scale before load and draws original sprites directly at caller scale', async () => {
  const { renderer, context, surfaces, groundRenderer } = setup({ spriteRasterMode: 'source' });
  assert.equal(renderer.setRenderScale(3), true);
  await renderer.load();
  assert.deepEqual(groundRenderer.scaleCalls.at(-1), [3, 3]);
  const camera = createCamera();
  const originalSnapshot = [unit()];
  const before = structuredClone(originalSnapshot);
  const stats = renderer.render(originalSnapshot, camera);
  assert.equal(context.depth, 0);
  assert.deepEqual(originalSnapshot, before);
  assert.deepEqual(stats.renderTarget, { logicalWidth: 640, logicalHeight: 400, backingWidth: 1920, backingHeight: 1200 });
  assert.equal(stats.sourceSpritesDrawn, 1);
  assert.equal(stats.spriteSurfaces, 0);
  assert.equal(surfaces.length, 1); // Exactly one native ground cache, no sprite bitmap.
  assert.equal(surfaces[0].width, 1920);
  assert.equal(surfaces[0].height, 1200);
  const draws = context.calls.filter(call => call[0] === 'drawImage');
  assert.deepEqual(draws[0].slice(2), [0, 0, 640, 400]); // Not double-scaled native dimensions.
  const spriteDraw = draws.find(call => call[1] === renderer.images.get('assets/A0_idle-1.png'));
  assert.equal(spriteDraw.length, 10); // Direct source rectangle to logical sprite rectangle.
  assert.equal(context.calls.some(call => call[0] === 'setTransform'), false);
  assert.deepEqual(context.calls.find(call => call[0] === 'rect'), ['rect', 0, 0, 640, 400]);
});

test('stationary native follow caches ground without changing original thirteen-strip projection', async () => {
  const baseline = setup({ spriteRasterMode: 'source' });
  const native = setup({ spriteRasterMode: 'source' });
  await Promise.all([baseline.renderer.load(), native.renderer.load()]);
  native.renderer.setRenderScale(2);
  const camera = createCamera({ x: 1300, y: 100 });
  baseline.renderer.render([], camera);
  assert.equal(native.renderer.render([unit()], camera).groundCacheHit, false);
  assert.deepEqual(native.groundRenderer.calls[0].grounds, baseline.groundRenderer.calls[0].grounds);
  for (let frame = 0; frame < 240; frame++) {
    assert.equal(native.renderer.render([unit({ px: frame })], camera).groundCacheHit, true);
  }
  assert.equal(native.groundRenderer.calls.length, 1);
  assert.equal(native.surfaces.length, 1);
  assert.equal(native.renderer.render([], { ...camera, x: camera.x + 0.00000001 }).groundCacheHit, false);
  assert.equal(native.groundRenderer.calls.length, 2); // Exact camera key, no position quantization.
  native.renderer.invalidateDisplayGround();
  assert.equal(native.renderer.render([], camera).groundCacheHit, false);
});

test('window and DPR resize replace cache pixels in place and share one follow/overview entry', async () => {
  const { renderer, surfaces, groundRenderer, context } = setup({ spriteRasterMode: 'source' });
  await renderer.load();
  renderer.setRenderScale(2);
  const camera = createCamera();
  renderer.render([], camera);
  const surface = surfaces[0];
  const observer = new ViewCamera();
  observer.fitAll();
  const displayView = observer.getView(camera);
  assert.equal(renderer.render([], camera, { displayView }).groundCacheHit, false);
  assert.equal(renderer.render([], camera, { displayView }).groundCacheHit, true);
  assert.equal(renderer.setRenderScale(3), true);
  assert.equal(renderer.render([], camera, { displayView }).groundCacheHit, false);
  assert.equal(renderer.setRenderScale(3), false);
  assert.equal(renderer.render([], camera, { displayView }).groundCacheHit, true);
  assert.equal(surface.width, 1920);
  assert.equal(surface.height, 1200);
  assert.equal(surfaces.length, 1);
  assert.equal(groundRenderer.calls.length, 3);
  assert.deepEqual(context.calls.filter(call => call[0] === 'drawImage' && call[1] === surface).at(-1).slice(2), [0, 0, 640, 400]);
  assert.equal(renderer.render([], camera).groundCacheHit, false); // Same entry, distinct mode.
  renderer.dispose();
  assert.equal(surface.width, 0);
  assert.equal(surface.height, 0);
});

test('native resolution never silently accepts a fixed-size injected ground backend', async () => {
  const { renderer, groundRenderer } = setup();
  delete groundRenderer.setRenderScale;
  await renderer.load();
  assert.equal(renderer.setRenderScale(1), false);
  assert.throws(() => renderer.setRenderScale(2), /backend must support setRenderScale/);
  assert.equal(renderer.renderWidth, 640);
  for (const scale of [0, -1, Infinity, NaN, Number.MAX_VALUE]) {
    assert.throws(() => renderer.setRenderScale(scale), /scale|dimension/i);
  }
});

test('visible bitmap repeat cells preserve source sampling phase at fractional DPR and either camera direction', () => {
  for (const width of [584, 920]) for (const camera of [-5000.25, -1, 0, .125, 2000, 7000.1]) {
    const layer = { rect: { x: 0, y: 55, width: 640, height: 31 },
      matrix: { tx: -camera / 4, ty: 55 } };
    const tiles = backgroundTileOrigins(layer, width, 31);
    assert.ok(tiles.length >= 1 && tiles.length <= 3);
    for (const scale of [1, 1.25, 2.5, 4.96875]) {
      for (let physicalX = 0; physicalX < Math.floor(640 * scale); physicalX += 3) {
        const localX = (physicalX + .5) / scale - layer.matrix.tx;
        const tile = tiles.find(candidate => localX >= candidate.x && localX < candidate.x + width);
        assert.ok(tile, `every visible pixel has a repeated source at scale ${scale}`);
        const patternSample = Math.floor(((localX % width) + width) % width);
        assert.equal(Math.floor(localX - tile.x), patternSample);
      }
    }
  }
});

test('background tiling retains vertical repeat, transparent-image identity and exact clip', async () => {
  const { renderer, context, surfaces } = setup();
  await renderer.load();
  const layer = { key: 'bg2', matrix: { tx: 12.5, ty: -4.5 }, rect: { x: 10, y: 20, width: 640, height: 100 } };
  const before = structuredClone(layer);
  const tiles = backgroundTileOrigins(layer, 584, 31);
  renderer.drawBackground(layer);
  assert.deepEqual(layer, before);
  assert.equal(context.depth, 0);
  assert.deepEqual(context.calls.find(call => call[0] === 'rect'), ['rect', 10, 20, 640, 100]);
  assert.deepEqual(context.calls.find(call => call[0] === 'translate'), ['translate', 12.5, -4.5]);
  const draws = context.calls.filter(call => call[0] === 'drawImage');
  assert.equal(draws.length, tiles.length);
  assert.ok(draws.every(call => call[1] === renderer.images.get('assets/bg2.png')));
  assert.deepEqual(draws.map(call => call.slice(2)), tiles.map(({ x, y }) => [x, y]));
  assert.equal(surfaces.length, 0); // No low-resolution or expanded background bitmap.
  assert.equal(context.imageSmoothingEnabled, false);
  assert.throws(() => backgroundTileOrigins(layer, 0, 31), /positive integers/);
  assert.throws(() => backgroundTileOrigins({ ...layer, matrix: { tx: Infinity, ty: 0 } }, 584, 31), /finite/);
});
