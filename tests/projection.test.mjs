import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_CAMERA_HEIGHT,
  DEFAULT_CAMERA_WIDTH,
  FOCAL_LENGTH,
  MAX_SYMBOL_SCALE,
  PROJECTION_SOURCE,
  ROTATION_X_DEGREES,
  backgroundLayers,
  createCamera,
  groundCorners,
  groundPainterOrder,
  limitCameraInMap,
  painterOrder,
  projectGround,
  projectPoint,
  projectSymbol,
  withCameraPosition,
  withCameraX,
  withCameraY,
} from '../src/render/projection.mjs';

function close(actual, expected, tolerance = 1e-10) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} ≈ ${expected}`);
}

test('the geometry constants cite the recovered super renderer', () => {
  assert.equal(ROTATION_X_DEGREES, -70);
  assert.equal(FOCAL_LENGTH, 600);
  assert.equal(MAX_SYMBOL_SCALE, 10);
  assert.equal(DEFAULT_CAMERA_WIDTH, 640);
  assert.equal(DEFAULT_CAMERA_HEIGHT, 400);
  assert.match(PROJECTION_SOURCE.renderer, /DragonForceRenderEngine\.as$/);
});

test('camera constructor keeps supplied coordinates with unset NaN limits', () => {
  const camera = createCamera({ x: -2000, y: 8000 });
  assert.equal(camera.x, -2000);
  assert.equal(camera.y, 8000);
  assert.equal(camera.width, 640);
  assert.equal(camera.height, 400);
  for (const key of ['minX', 'minY', 'maxX', 'maxY']) {
    assert.ok(Number.isNaN(camera[key]), key);
  }
  const moved = withCameraPosition(camera, -10000, 10000);
  assert.equal(moved.x, -10000);
  assert.equal(moved.y, 10000);
  assert.equal(camera.x, -2000);
  assert.equal(camera.y, 8000);
});

test('limitInMap sets bounds but does not immediately clamp the camera', () => {
  const original = createCamera({ x: 2000, y: -300 });
  const camera = limitCameraInMap(original, 1000, 800);
  assert.equal(camera.x, 2000);
  assert.equal(camera.y, -300);
  assert.equal(camera.minX, 0);
  assert.equal(camera.minY, 0);
  assert.equal(camera.maxX, 360);
  assert.equal(camera.maxY, 400);
  assert.ok(Number.isNaN(original.maxX));
  const moved = withCameraPosition(camera, camera.x, camera.y);
  assert.equal(moved.x, 360);
  assert.equal(moved.y, 0);
});

test('camera setters clamp at each exact source boundary', () => {
  const camera = limitCameraInMap(createCamera(), 2000, 1000);
  for (const [input, expected] of [[-1, 0], [0, 0], [400, 400], [1360, 1360], [1361, 1360]]) {
    assert.equal(withCameraX(camera, input).x, expected);
  }
  for (const [input, expected] of [[-1, 0], [0, 0], [400, 400], [600, 600], [601, 600]]) {
    assert.equal(withCameraY(camera, input).y, expected);
  }
});

test('a map smaller than the camera preserves the original sequential-clamp quirk', () => {
  const camera = limitCameraInMap(createCamera(), 200, 100);
  assert.equal(camera.maxX, -440);
  assert.equal(camera.maxY, -300);
  // Both if statements execute: lower clamp sets 0, upper clamp then sets max.
  for (const input of [-1000, -50, 0, 1000]) {
    assert.equal(withCameraX(camera, input).x, -440);
    assert.equal(withCameraY(camera, input).y, -300);
  }
});

test('limitInMap retains AS3 int truncation and 32-bit parameter coercion', () => {
  const camera = limitCameraInMap(createCamera(), 1000.9, 800.9);
  assert.equal(camera.maxX, 360);
  assert.equal(camera.maxY, 400);
  assert.equal(limitCameraInMap(createCamera(), 2 ** 32 + 1000, Infinity).maxX, 360);
  assert.equal(limitCameraInMap(createCamera(), 2 ** 32 + 1000, Infinity).maxY, -400);
});

test('NaN camera setter values are not silently normalized', () => {
  const camera = limitCameraInMap(createCamera(), 2000, 1000);
  assert.ok(Number.isNaN(withCameraX(camera, NaN).x));
  assert.ok(Number.isNaN(withCameraY(camera, NaN).y));
});

test('camera center projects to the center with unit perspective and scale', () => {
  const camera = createCamera({ x: 2000, y: 150 });
  const symbol = projectSymbol({ px: 2000, py: 150 }, camera);
  assert.equal(symbol.x, 320);
  assert.equal(symbol.y, 200);
  assert.equal(symbol.perspective, 1);
  assert.equal(symbol.scaleX, 1);
  assert.equal(symbol.scaleY, 1);
});

test('camera translation is removed before the -70 degree X rotation', () => {
  const translated = projectPoint(2100, 250, createCamera({ x: 2000, y: 150 }));
  const origin = projectPoint(100, 100, createCamera());
  assert.deepEqual(translated, origin);
  // Independent numeric landmarks of the recovered rotation/projection.
  close(origin.viewY, 34.2020149230957);
  close(origin.viewZ, -93.9692611694336);
  close(origin.perspective, 1.1856987213594887);
  close(origin.x, 438.56987213594886);
  close(origin.y, 240.5532853622327);
});

test('Matrix3D casts vectors and coefficients to float32 before Number projection', () => {
  const point = projectPoint(1.00000001, 1.00000001, createCamera());
  assert.equal(point.viewX, 1);
  assert.equal(point.viewY, Math.fround(Math.cos(-70 * Math.PI / 180)));
  assert.equal(point.viewZ, Math.fround(Math.sin(-70 * Math.PI / 180)));
  assert.equal(point.perspective, 600 / (600 + point.viewZ));
  const nonFinite = projectPoint(Infinity, 1, createCamera());
  assert.ok(Number.isNaN(nonFinite.viewY));
  assert.ok(Number.isNaN(nonFinite.viewZ));
  assert.ok(Number.isNaN(nonFinite.perspective));
});

test('near ground grows and farther ground shrinks instead of using JKS 2-D geometry', () => {
  const camera = createCamera();
  const near = projectSymbol({ px: 100, py: 300 }, camera);
  const far = projectSymbol({ px: 100, py: -300 }, camera);
  assert.ok(near.perspective > 1);
  assert.ok(near.x > 420);
  assert.ok(near.y > 200);
  assert.ok(far.perspective > 0 && far.perspective < 1);
  assert.ok(far.x > 320 && far.x < 420);
  assert.ok(far.y < 200);
});

test('height is a post-projection screen offset, not perspective depth', () => {
  const camera = createCamera({ x: 2000, y: 150 });
  const low = projectSymbol({ px: 2100, py: 250, pz: 0 }, camera);
  const high = projectSymbol({ px: 2100, py: 250, pz: 40 }, camera);
  assert.equal(low.x, high.x);
  assert.equal(low.perspective, high.perspective);
  assert.equal(low.scale, high.scale);
  close(low.y - high.y, 40 * low.perspective);
});

test('sprite scale clamps to 10 but position keeps the larger perspective', () => {
  const symbol = projectSymbol({ px: 100, py: 620, pz: 15, sx: -2, sy: 0.5 }, createCamera());
  assert.ok(symbol.perspective > 10);
  assert.equal(symbol.scale, 10);
  assert.equal(symbol.scaleX, -20);
  assert.equal(symbol.scaleY, 5);
  close(symbol.x, 320 + 100 * symbol.perspective);
  close(symbol.y, 200 + (symbol.viewY - 15) * symbol.perspective);
  assert.ok(symbol.x > 1320);
});

test('behind-camera symbols retain negative projected positions and zero size', () => {
  const symbol = projectSymbol({ px: 100, py: 700, pz: 20, sx: -1 }, createCamera());
  assert.ok(symbol.perspective < 0);
  assert.equal(symbol.scale, 0);
  assert.ok(Object.is(symbol.scaleX, -0));
  assert.equal(symbol.scaleY, 0);
  assert.ok(symbol.x < 320);
  close(symbol.y, 200 + (symbol.viewY - 20) * symbol.perspective);
  assert.equal('drawable' in symbol, false);
});

test('the focal-plane singularity is not replaced by a made-up near clip', () => {
  const y = -600 / Math.fround(Math.sin(-70 * Math.PI / 180));
  const symbol = projectSymbol({ px: 1, py: y, pz: 1 }, createCamera());
  assert.equal(symbol.perspective, Infinity);
  assert.equal(symbol.scale, 10);
  assert.equal(symbol.x, Infinity);
  // Original y = finite * Infinity - pz * Infinity is NaN, not a safe coordinate.
  assert.ok(Number.isNaN(symbol.y));
});

test('ground corners retain v0-v3 winding and integer constructor arguments', () => {
  assert.deepEqual(groundCorners(-900, -1600, 9800, 300), [
    { x: -900, y: -1600 }, { x: 8900, y: -1600 },
    { x: 8900, y: -1300 }, { x: -900, y: -1300 },
  ]);
  assert.deepEqual(groundCorners(10.9, -10.9, 20.9, 30.9), [
    { x: 10, y: -10 }, { x: 30, y: -10 },
    { x: 30, y: 20 }, { x: 10, y: 20 },
  ]);
});

test('all four ground corners use the source triangles and perspective UVT values', () => {
  const camera = createCamera({ x: 2000, y: 150 });
  const corners = groundCorners(1900, 50, 200, 200);
  const ground = projectGround(corners, camera);
  assert.equal(ground.drawable, true);
  assert.equal(ground.processedVertices, 4);
  assert.deepEqual(ground.indices, [0, 1, 3, 1, 2, 3]);
  assert.deepEqual(ground.uvtData.filter((_, index) => index % 3 === 0), [0, 1, 1, 0]);
  assert.deepEqual(ground.uvtData.filter((_, index) => index % 3 === 1), [0, 0, 1, 1]);
  for (let index = 0; index < 4; index += 1) {
    const expected = projectPoint(corners[index].x, corners[index].y, camera);
    close(ground.vertices[index * 2], expected.x);
    close(ground.vertices[index * 2 + 1], expected.y);
    close(ground.uvtData[index * 3 + 2], expected.perspective);
  }
  assert.ok(ground.vertices[0] > ground.vertices[6]);
  assert.ok(ground.vertices[2] < ground.vertices[4]);
});

test('ground triangles do not inherit the symbol 0..10 perspective clamp', () => {
  const ground = projectGround(groundCorners(0, 610, 10, 10), createCamera());
  assert.equal(ground.drawable, true);
  assert.ok(ground.uvtData[2] > 10);
  assert.ok(ground.uvtData[8] > ground.uvtData[2]);
});

test('ground rejects a fully behind-camera tile at its first corner', () => {
  const ground = projectGround(groundCorners(0, 700, 100, 100), createCamera());
  assert.equal(ground.drawable, false);
  assert.equal(ground.processedVertices, 1);
  assert.ok(ground.uvtData[2] < 0);
});

test('ground rejects the entire crossing tile, not just its behind-camera triangles', () => {
  const ground = projectGround(groundCorners(0, 600, 100, 100), createCamera());
  assert.equal(ground.drawable, false);
  assert.equal(ground.processedVertices, 3);
  assert.ok(ground.uvtData[2] > 0);
  assert.ok(ground.uvtData[5] > 0);
  assert.ok(ground.uvtData[8] < 0);
});

test('ground keeps original >0 final-value handling rather than inventing finite checks', () => {
  const camera = createCamera();
  const y = -600 / Math.fround(Math.sin(-70 * Math.PI / 180));
  const infinite = projectGround([{ x: 1, y }, { x: 2, y }, { x: 3, y }, { x: 4, y }], camera);
  assert.equal(infinite.drawable, true);
  assert.equal(infinite.processedVertices, 4);
  assert.equal(infinite.perspective, Infinity);
  const invalid = projectGround([{ x: 1, y: NaN }, { x: 2, y: NaN }, { x: 3, y: NaN }, { x: 4, y: NaN }], camera);
  assert.equal(invalid.drawable, false);
  assert.equal(invalid.processedVertices, 4);
  assert.ok(Number.isNaN(invalid.perspective));
});

test('painter helpers return copies in the original back-to-front display-list sequence', () => {
  const symbols = [{ id: 'near', py: 300 }, { id: 'far', py: -200 }, { id: 'middle', py: 0 }];
  const original = [...symbols];
  const order = painterOrder(symbols);
  assert.deepEqual(order.map(symbol => symbol.id), ['far', 'middle', 'near']);
  assert.deepEqual(symbols, original);
  assert.equal(order[0], symbols[1]);
  const grounds = ['first-added', 'second-added', 'third-added'];
  assert.deepEqual(groundPainterOrder(grounds), ['third-added', 'second-added', 'first-added']);
  assert.deepEqual(grounds, ['first-added', 'second-added', 'third-added']);
});

test('background strips retain exact source rectangles and separate parallax factors', () => {
  const camera = createCamera({ x: 2000, y: 900, width: 1280 });
  const layers = backgroundLayers(camera);
  assert.deepEqual(layers, [
    {
      key: 'bg1',
      matrix: { a: 1, b: 0, c: 0, d: 1, tx: -225, ty: 0 },
      rect: { x: 0, y: 0, width: 640, height: 79 },
    },
    {
      key: 'bg2',
      matrix: { a: 1, b: 0, c: 0, d: 1, tx: -500, ty: 55 },
      rect: { x: 0, y: 55, width: 640, height: 31 },
    },
  ]);
  assert.deepEqual(backgroundLayers(camera, { bg1: false }).map(layer => layer.key), ['bg2']);
  assert.deepEqual(backgroundLayers(camera, { bg1: false, bg2: false }), []);
});
