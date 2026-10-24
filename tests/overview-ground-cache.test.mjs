import assert from 'node:assert/strict';
import test from 'node:test';
import { GroundLayerCache } from '../src/render/ground-layer-cache.mjs';

function fixture(options = {}) {
  const calls = [];
  const context = {
    setTransform: (...args) => calls.push(['setTransform', ...args]),
    clearRect: (...args) => calls.push(['clearRect', ...args]),
    drawImage: (...args) => {
      calls.push(['drawImage', ...args]);
      if (options.failCopy) throw new Error('synthetic copy failure');
    },
  };
  const surfaces = [];
  const canvasFactory = (width, height) => {
    const surface = { width, height, getContext: type => type === '2d' ? context : null };
    surfaces.push(surface);
    return surface;
  };
  return { calls, context, surfaces, canvasFactory, options };
}

function source(width = 640, height = 400) {
  return { width, height, originalWebGLCanvas: true };
}

test('stationary overview paints and copies WebGL ground once across 240 presentations', () => {
  const state = fixture();
  const cache = new GroundLayerCache({ canvasFactory: state.canvasFactory });
  const originalGround = source();
  let paints = 0;
  const paint = () => { paints++; return originalGround; };
  const first = cache.get('image:1|camera-exact:0,1,640,400', paint);
  assert.equal(first.hit, false);
  for (let presentation = 1; presentation < 240; presentation++) {
    const result = cache.get('image:1|camera-exact:0,1,640,400', paint);
    assert.equal(result.hit, true);
    assert.equal(result.surface, first.surface);
  }
  assert.equal(paints, 1);
  assert.equal(state.calls.filter(call => call[0] === 'drawImage').length, 1);
  assert.equal(state.calls.filter(call => call[0] === 'clearRect').length, 1);
  assert.equal(state.surfaces.length, 1);
  assert.deepEqual(state.calls.find(call => call[0] === 'drawImage'), ['drawImage', originalGround, 0, 0]);
});

test('exact revision differences repaint, without quantization or source mutation', () => {
  const state = fixture();
  const cache = new GroundLayerCache({ canvasFactory: state.canvasFactory });
  const originalGround = Object.freeze(source());
  let paints = 0;
  const paint = () => { paints++; return originalGround; };
  assert.equal(cache.get('camera:1', paint).hit, false);
  assert.equal(cache.get('camera:1.0000000000000002', paint).hit, false);
  assert.equal(cache.get('image:2|camera:1.0000000000000002', paint).hit, false);
  assert.equal(paints, 3);
  assert.equal(state.surfaces.length, 1);
  assert.deepEqual(originalGround, source());
});

test('cache retains only the last revision, not an unbounded key map', () => {
  const state = fixture();
  const cache = new GroundLayerCache({ canvasFactory: state.canvasFactory });
  let paints = 0;
  const paint = () => { paints++; return source(); };
  const first = cache.get('a', paint);
  for (let index = 0; index < 100; index++) {
    const result = cache.get(`revision:${index}`, paint);
    assert.equal(result.hit, false);
    assert.equal(result.surface, first.surface);
  }
  assert.equal(cache.get('a', paint).hit, false);
  assert.equal(paints, 102);
  assert.equal(state.surfaces.length, 1);
});

test('invalidate schedules a repaint on the same key without eager work or allocation', () => {
  const state = fixture();
  const cache = new GroundLayerCache({ canvasFactory: state.canvasFactory });
  let paints = 0;
  const paint = () => { paints++; return source(); };
  cache.get('', paint);
  cache.invalidate();
  assert.equal(paints, 1);
  assert.equal(state.calls.filter(call => call[0] === 'drawImage').length, 1);
  assert.equal(cache.get('', paint).hit, false);
  assert.equal(paints, 2);
  assert.equal(state.surfaces.length, 1);
});

test('paint failure never commits the failed key or returns a stale hit', () => {
  const state = fixture();
  const cache = new GroundLayerCache({ canvasFactory: state.canvasFactory });
  cache.get('old', () => source());
  assert.throws(() => cache.get('new', () => { throw new Error('synthetic paint failure'); }), /paint failure/);
  assert.equal(cache.get('new', () => source()).hit, false);
  assert.equal(cache.get('new', () => source()).hit, true);
  assert.equal(state.calls.filter(call => call[0] === 'drawImage').length, 2);
});

test('paint failure also invalidates the previous revision', () => {
  const state = fixture();
  const cache = new GroundLayerCache({ canvasFactory: state.canvasFactory });
  cache.get('old', () => source());
  assert.throws(() => cache.get('new', () => { throw new Error('no completed ground'); }), /no completed ground/);
  assert.equal(cache.get('old', () => source()).hit, false);
});

test('copy failure never poisons a key, including a partially cleared surface', () => {
  const state = fixture();
  const cache = new GroundLayerCache({ canvasFactory: state.canvasFactory });
  cache.get('old', () => source());
  state.options.failCopy = true;
  assert.throws(() => cache.get('new', () => source()), /synthetic copy failure/);
  state.options.failCopy = false;
  assert.equal(cache.get('old', () => source()).hit, false);
  assert.equal(cache.get('new', () => source()).hit, false);
  assert.equal(cache.get('new', () => source()).hit, true);
});

test('fixed cache dimensions reject implicit resize, clipping, or resampling', () => {
  const state = fixture();
  const cache = new GroundLayerCache({ width: 450, height: 80, canvasFactory: state.canvasFactory });
  assert.throws(() => { cache.width = 640; }, TypeError);
  assert.throws(() => { cache.height = 400; }, TypeError);
  assert.throws(() => cache.get('wrong-size', () => source()), /exactly 450×80.*no resampling/);
  assert.equal(state.calls.length, 0);
  const result = cache.get('right-size', () => source(450, 80));
  assert.equal(result.surface.width, 450);
  assert.equal(result.surface.height, 80);
  assert.deepEqual(state.calls.find(call => call[0] === 'clearRect'), ['clearRect', 0, 0, 450, 80]);
});

test('each copy uses identity transform, neutral alpha, and no filtering', () => {
  const state = fixture();
  const cache = new GroundLayerCache({ canvasFactory: state.canvasFactory });
  cache.get('revision', () => source());
  assert.deepEqual(state.calls[0], ['setTransform', 1, 0, 0, 1, 0, 0]);
  assert.equal(state.context.globalAlpha, 1);
  assert.equal(state.context.globalCompositeOperation, 'source-over');
  assert.equal(state.context.imageSmoothingEnabled, false);
});

test('cache rejects malformed keys, asynchronous paint, and self-copy', () => {
  const state = fixture();
  const cache = new GroundLayerCache({ canvasFactory: state.canvasFactory });
  assert.throws(() => cache.get(1, () => source()), /exact revision string/);
  assert.throws(() => cache.get('x', null), /paint must be a function/);
  assert.throws(() => cache.get('x', () => null), /synchronously return a canvas/);
  assert.throws(() => cache.get('x', () => Promise.resolve(source())), /synchronously return a canvas/);
  assert.throws(() => cache.get('x', () => state.surfaces[0]), /cache surface itself/);
  assert.equal(cache.get('x', () => source()).hit, false);
});

test('reentrant paint fails explicitly and does not commit a cache entry', () => {
  const state = fixture();
  const cache = new GroundLayerCache({ canvasFactory: state.canvasFactory });
  assert.throws(() => cache.get('x', () => cache.get('nested', () => source())), /Reentrant/);
  assert.equal(cache.get('x', () => source()).hit, false);
});

test('disposal releases the single surface and is idempotent', () => {
  const state = fixture();
  const cache = new GroundLayerCache({ canvasFactory: state.canvasFactory });
  const result = cache.get('x', () => source());
  cache.dispose();
  cache.dispose();
  assert.equal(result.surface.width, 0);
  assert.equal(result.surface.height, 0);
  assert.throws(() => cache.get('x', () => source()), /disposed/);
  assert.equal(state.surfaces.length, 1);
});

test('constructor validates dimensions and canvas support before use', () => {
  for (const dimensions of [{ width: 0 }, { height: -1 }, { width: 1.5 }, { height: Infinity }]) {
    assert.throws(() => new GroundLayerCache({ ...dimensions, canvasFactory: fixture().canvasFactory }), /positive integers/);
  }
  assert.throws(() => new GroundLayerCache({ canvasFactory: null }), /must be a function/);
  assert.throws(() => new GroundLayerCache({ canvasFactory: () => null }), /Canvas2D-capable/);
  assert.throws(() => new GroundLayerCache({ canvasFactory: () => ({ getContext: () => null }) }), /Canvas2D context/);
});

test('native-resolution cache resizes one surface and invalidates even the same camera key', () => {
  const state = fixture();
  const cache = new GroundLayerCache({ canvasFactory: state.canvasFactory });
  const first = cache.get('stationary', () => source());
  assert.equal(cache.resize(3180, 1988), true);
  assert.equal(cache.width, 3180);
  assert.equal(cache.height, 1988);
  assert.equal(state.surfaces.length, 1);
  assert.throws(() => cache.get('stationary', () => source()), /exactly 3180×1988/);
  let paints = 0;
  const paint = () => { paints++; return source(3180, 1988); };
  const native = cache.get('stationary', paint);
  assert.equal(native.surface, first.surface);
  assert.equal(native.hit, false);
  for (let frame = 0; frame < 240; frame++) {
    assert.equal(cache.resize(3180, 1988), false);
    assert.equal(cache.get('stationary', paint).hit, true);
  }
  assert.equal(paints, 1);
  assert.equal(state.calls.filter(call => call[0] === 'drawImage').length, 2);
  assert.equal(state.surfaces.length, 1);
  assert.equal(cache.resize(640, 400), true);
  assert.equal(cache.get('stationary', () => source()).hit, false);
});

test('native cache resizing rejects reentrancy, invalid sizes and disposed state', () => {
  const state = fixture();
  const cache = new GroundLayerCache({ canvasFactory: state.canvasFactory });
  for (const size of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER]) {
    assert.throws(() => cache.resize(size, 400), /positive integers/);
  }
  assert.throws(() => cache.get('x', () => { cache.resize(1280, 800); return source(); }), /during painting/);
  assert.equal(cache.width, 640);
  assert.equal(cache.get('x', () => source()).hit, false);
  cache.dispose();
  assert.throws(() => cache.resize(640, 400), /disposed/);
});
