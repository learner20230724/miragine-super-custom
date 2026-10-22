import assert from 'node:assert/strict';
import test from 'node:test';
import {
  backingStoreSize,
  clientToGame,
  fitViewport,
  gameToClient,
} from '../src/platform/viewport.mjs';

function close(actual, expected, tolerance = 1e-9) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} ≈ ${expected}`);
}

function closePoint(actual, expected) {
  assert.notEqual(actual, null);
  close(actual.x, expected.x);
  close(actual.y, expected.y);
}

test('800 × 600 fills the viewport without bars', () => {
  const fit = fitViewport(800, 600);
  assert.equal(fit.gameWidth, 640);
  assert.equal(fit.gameHeight, 480);
  assert.equal(fit.scale, 1.25);
  assert.equal(fit.width, 800);
  assert.equal(fit.height, 600);
  assert.equal(fit.left, 0);
  assert.equal(fit.top, 0);
  assert.equal(fit.right, 800);
  assert.equal(fit.bottom, 600);
  closePoint(clientToGame(400, 300, fit), { x: 320, y: 240 });
  assert.ok(Object.isFrozen(fit));
});

test('2560 × 1440 uses a centered 1920 × 1440 stage', () => {
  const fit = fitViewport(2560, 1440);
  assert.equal(fit.scale, 3);
  assert.equal(fit.width, 1920);
  assert.equal(fit.height, 1440);
  assert.equal(fit.left, 320);
  assert.equal(fit.top, 0);
  assert.equal(fit.right, 2240);
  assert.equal(fit.bottom, 1440);
  closePoint(clientToGame(1280, 720, fit), { x: 320, y: 240 });
});

test('360 × 640 portrait layout uses a centered 360 × 270 stage', () => {
  const fit = fitViewport(360, 640);
  assert.equal(fit.scale, 0.5625);
  assert.equal(fit.width, 360);
  assert.equal(fit.height, 270);
  assert.equal(fit.left, 0);
  assert.equal(fit.top, 185);
  assert.equal(fit.bottom, 455);
  closePoint(clientToGame(180, 320, fit), { x: 320, y: 240 });
});

test('wide black bars and every external edge reject clicks without clamping', () => {
  const fit = fitViewport(2560, 1440);
  for (const [x, y] of [
    [0, 720], [319.999, 720], [2240, 720], [2559, 720],
    [-1, 720], [2560, 720], [1280, -1], [1280, 1440],
  ]) {
    assert.equal(clientToGame(x, y, fit), null, `${x}, ${y} must miss`);
  }
  closePoint(clientToGame(320, 0, fit), { x: 0, y: 0 });
  assert.notEqual(clientToGame(2239.999, 1439.999, fit), null);
});

test('portrait black bars reject clicks including the lower bar boundary', () => {
  const fit = fitViewport(360, 640);
  for (const [x, y] of [[180, 0], [180, 184.999], [180, 455], [180, 639]]) {
    assert.equal(clientToGame(x, y, fit), null);
  }
  closePoint(clientToGame(0, 185, fit), { x: 0, y: 0 });
  assert.notEqual(clientToGame(359.999, 454.999, fit), null);
});

test('game bounds are half-open and game coordinates are not rounded', () => {
  const fit = fitViewport(800, 600);
  for (const [x, y] of [[-0.001, 0], [0, -0.001], [640, 0], [0, 480], [640, 480]]) {
    assert.equal(gameToClient(x, y, fit), null);
  }
  closePoint(gameToClient(0, 0, fit), { x: 0, y: 0 });
  closePoint(clientToGame(0.3125, 0.625, fit), { x: 0.25, y: 0.5 });
  assert.notEqual(gameToClient(639.999, 479.999, fit), null);
});

test('pointer math includes a containing element client origin', () => {
  const fit = fitViewport(2560, 1440, { clientLeft: 137.25, clientTop: -48.5 });
  closePoint(gameToClient(0, 0, fit), { x: 457.25, y: -48.5 });
  closePoint(clientToGame(1417.25, 671.5, fit), { x: 320, y: 240 });
  assert.equal(clientToGame(457.249, 671.5, fit), null);
  assert.equal(clientToGame(2377.25, 671.5, fit), null);
});

test('fractional element and bar offsets keep the exact top-left edge inside', () => {
  const fit = fitViewport(1620.923076923077, 653.3098591549295, {
    clientLeft: 137.135, clientTop: -38.741,
  });
  const corner = gameToClient(0, 0, fit);
  closePoint(clientToGame(corner.x, corner.y, fit), { x: 0, y: 0 });
  assert.equal(clientToGame(corner.x + fit.width, corner.y, fit), null);
  assert.equal(clientToGame(corner.x, corner.y + fit.height, fit), null);
});

for (const dpr of [1, 1.25, 2]) {
  test(`DPR ${dpr} affects the backing store but never CSS input geometry`, () => {
    const fit = fitViewport(800, 600, { devicePixelRatio: dpr });
    assert.equal(fit.backingWidth, 800 * dpr);
    assert.equal(fit.backingHeight, 600 * dpr);
    assert.equal(fit.pixelScaleX, fit.backingWidth / 640);
    assert.equal(fit.pixelScaleY, fit.backingHeight / 480);
    closePoint(clientToGame(250, 187.5, fit), { x: 200, y: 150 });
    closePoint(gameToClient(200, 150, fit), { x: 250, y: 187.5 });
  });

  test(`DPR ${dpr} round-trips fractional points at every tested viewport size`, () => {
    for (const [width, height] of [[800, 600], [2560, 1440], [360, 640], [997.3, 713.7]]) {
      const fit = fitViewport(width, height, {
        devicePixelRatio: dpr, clientLeft: 13.5, clientTop: 27.25,
      });
      close(fit.width / fit.height, 4 / 3);
      assert.ok(fit.width <= width && fit.height <= height);
      for (const [x, y] of [[0, 0], [1.25, 4.5], [320, 240], [639.99, 479.99]]) {
        const client = gameToClient(x, y, fit);
        closePoint(clientToGame(client.x, client.y, fit), { x, y });
      }
    }
  });
}

test('fractional CSS sizes use actual rounded backing-store drawing scales', () => {
  const fit = fitViewport(361, 640, { devicePixelRatio: 1.25 });
  assert.equal(fit.width, 361);
  assert.equal(fit.height, 270.75);
  assert.equal(fit.backingWidth, 451);
  assert.equal(fit.backingHeight, 338);
  close(fit.pixelScaleX * 640, 451);
  close(fit.pixelScaleY * 480, 338);
  closePoint(gameToClient(320, 240, fit), { x: 180.5, y: 320 });
});

test('backing stores round to nearest integer and remain at least one pixel', () => {
  assert.deepEqual(backingStoreSize(9.5, 5.5, 1.25), {
    width: 12, height: 7, devicePixelRatio: 1.25,
  });
  assert.deepEqual(backingStoreSize(0.2, 0.1), {
    width: 1, height: 1, devicePixelRatio: 1,
  });
  assert.ok(Object.isFrozen(backingStoreSize(1, 1)));
});

test('a custom game aspect ratio can be fitted without changing pointer rules', () => {
  const fit = fitViewport(800, 600, { gameWidth: 100, gameHeight: 100 });
  assert.equal(fit.width, 600);
  assert.equal(fit.height, 600);
  assert.equal(fit.left, 100);
  closePoint(clientToGame(400, 300, fit), { x: 50, y: 50 });
  assert.equal(clientToGame(99, 300, fit), null);
});

test('non-positive and non-finite dimensions are rejected explicitly', () => {
  for (const value of [0, -1, NaN, Infinity, -Infinity]) {
    assert.throws(() => fitViewport(value, 480), RangeError);
    assert.throws(() => fitViewport(640, value), RangeError);
    assert.throws(() => backingStoreSize(value, 480), RangeError);
    assert.throws(() => backingStoreSize(640, value), RangeError);
    for (const key of ['gameWidth', 'gameHeight', 'devicePixelRatio']) {
      assert.throws(() => fitViewport(640, 480, { [key]: value }), RangeError);
    }
    assert.throws(() => backingStoreSize(640, 480, value), RangeError);
  }
});

test('dimension types, options, and client origins are validated', () => {
  for (const value of [undefined, null, '640', true, {}, []]) {
    assert.throws(() => fitViewport(value, 480), TypeError);
    assert.throws(() => fitViewport(640, value), TypeError);
  }
  for (const value of [null, [], 1, 'options']) {
    assert.throws(() => fitViewport(640, 480, value), TypeError);
  }
  assert.throws(() => fitViewport(640, 480, { clientLeft: NaN }), RangeError);
  assert.throws(() => fitViewport(640, 480, { clientTop: Infinity }), RangeError);
  assert.throws(() => fitViewport(640, 480, { clientTop: '0' }), TypeError);
});

test('invalid pointer values and malformed fits are programmer errors, not hits', () => {
  const fit = fitViewport(640, 480);
  for (const transform of [clientToGame, gameToClient]) {
    for (const value of [NaN, Infinity, -Infinity]) {
      assert.throws(() => transform(value, 0, fit), RangeError);
      assert.throws(() => transform(0, value, fit), RangeError);
    }
    assert.throws(() => transform('0', 0, fit), TypeError);
    assert.throws(() => transform(0, 0, null), TypeError);
    assert.throws(() => transform(0, 0, {}), TypeError);
    assert.throws(() => transform(0, 0, { ...fit, width: 0 }), RangeError);
  }
});

test('unrepresentable scales and backing-store dimensions fail explicitly', () => {
  assert.throws(() => fitViewport(Number.MIN_VALUE, Number.MIN_VALUE), RangeError);
  assert.throws(() => fitViewport(640, 480, { gameWidth: Number.MIN_VALUE, gameHeight: Number.MIN_VALUE }), RangeError);
  assert.throws(() => backingStoreSize(Number.MAX_VALUE, 480, 2), RangeError);
  assert.throws(() => backingStoreSize(Number.MAX_SAFE_INTEGER + 1, 480), RangeError);
});
