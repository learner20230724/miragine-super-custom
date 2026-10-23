import assert from 'node:assert/strict';
import test from 'node:test';
import { FOCAL_LENGTH, ROTATION_X_DEGREES } from '../src/render/projection.mjs';
import { ViewCamera, inverseViewPoint } from '../src/render/view-camera.mjs';
import { overviewGroundGeometry } from '../src/render/overview-ground.mjs';

function view(overrides = {}) {
  return { kind: 'observation-view', mode: 'manual', width: 640, height: 400,
    centerX: 2250, centerY: 400, zoom: .12, offsetX: 0, offsetY: 0, nearPlane: 24, ...overrides };
}

function assertCornersCovered(result, descriptor, top = 79) {
  assert.equal(result.vectors.length, 4);
  const [start, , end] = result.vectors;
  for (const [x, y] of [[0, top], [descriptor.width, top], [descriptor.width, descriptor.height], [0, descriptor.height]]) {
    const point = inverseViewPoint(x, y, descriptor);
    assert.ok(point, `invertible corner ${x},${y}`);
    assert.ok(point.x >= start.x && point.x <= end.x, `x=${point.x} in [${start.x},${end.x}]`);
    assert.ok(point.y >= start.y && point.y <= end.y, `y=${point.y} in [${start.y},${end.y}]`);
  }
}

function fraction(value) { return value - Math.floor(value); }

test('overview ground covers the inverse visible-frustum bounding box', () => {
  const descriptor = view();
  const result = overviewGroundGeometry(descriptor);
  assert.equal(result.coverageLimited, false);
  assertCornersCovered(result, descriptor);
  assert.deepEqual(result.vectors, [
    { x: result.grid.startX, y: result.grid.startY },
    { x: result.grid.endX, y: result.grid.startY },
    { x: result.grid.endX, y: result.grid.endY },
    { x: result.grid.startX, y: result.grid.endY },
  ]);
});

test('all minimum/maximum zoom and map-edge views cover the requested 80..400 strip', () => {
  for (const zoom of [.01, .12, 1, 4]) {
    for (const centerX of [0, 2250, 4500]) {
      for (const centerY of [0, 400, 800]) {
        const descriptor = view({ zoom, centerX, centerY });
        const result = overviewGroundGeometry(descriptor);
        assert.equal(result.coverageLimited, false, JSON.stringify(descriptor));
        assertCornersCovered(result, descriptor);
      }
    }
  }
});

test('actual fitAll descriptor covers ground outside the playing map without changing the camera', () => {
  const camera = new ViewCamera();
  camera.fitAll([{ pz: 0 }, { pz: 200 }]);
  const descriptor = camera.getView();
  const before = structuredClone(descriptor);
  const result = overviewGroundGeometry(descriptor);
  assert.equal(result.coverageLimited, false);
  assertCornersCovered(result, descriptor);
  assert.deepEqual(descriptor, before);
  assert.ok(result.grid.startY < 0 || result.grid.endY > 800);
});

test('merged UV periods are exactly anchored to the original -900/-1600 world grid', () => {
  const result = overviewGroundGeometry(view({ zoom: .01 }));
  const { grid, uvScale } = result;
  assert.equal((grid.startX + 900) / 9800, grid.minColumn);
  assert.equal((grid.startY + 1600) / 300, grid.minRow);
  assert.equal((grid.endX - grid.startX) / 9800, uvScale.u);
  assert.equal((grid.endY - grid.startY) / 300, uvScale.v);
  for (const [x, y] of [[-500, -1200], [0, 0], [2250, 400], [4499.125, 799.75]]) {
    const mergedU = (x - grid.startX) / (grid.endX - grid.startX) * uvScale.u;
    const mergedV = (y - grid.startY) / (grid.endY - grid.startY) * uvScale.v;
    assert.ok(Math.abs(fraction(mergedU) - fraction((x + 900) / 9800)) < 1e-10);
    assert.ok(Math.abs(fraction(mergedV) - fraction((y + 1600) / 300)) < 1e-10);
  }
});

test('geometry remains exactly four vertices even when hundreds of thousands of cells repeat', () => {
  const result = overviewGroundGeometry(view({ zoom: .0001 }));
  assert.equal(result.vectors.length, 4);
  assert.ok(result.uvScale.u * result.uvScale.v > 100_000);
  assert.ok(result.coverageLimited);
  assert.equal(Object.keys(result.vectors).length, 4);
});

test('horizon crossing raises the sampled top and explicitly reports limited coverage', () => {
  const descriptor = view({ offsetY: 200, zoom: .01 });
  const result = overviewGroundGeometry(descriptor);
  const sin = Math.fround(Math.sin(ROTATION_X_DEGREES * Math.PI / 180));
  const cos = Math.fround(Math.cos(ROTATION_X_DEGREES * Math.PI / 180));
  const horizonY = descriptor.height / 2 + descriptor.offsetY + FOCAL_LENGTH * cos / sin;
  assert.equal(result.grid.horizonY, horizonY);
  assert.ok(result.grid.top > horizonY);
  assert.ok(result.grid.top > 80);
  assert.equal(result.coverageLimited, true);
  for (const point of result.vectors) {
    assert.ok(Number.isFinite(point.x) && Number.isFinite(point.y));
    assert.ok(Math.abs(point.x) <= 1_000_000 && Math.abs(point.y) <= 1_000_000);
  }
});

test('finite extent bounds never create a partial-period quad or out-of-limit coordinates', () => {
  const descriptor = view({ zoom: .0001 });
  const result = overviewGroundGeometry(descriptor, { maxWorldExtent: 100_000 });
  assert.equal(result.coverageLimited, true);
  assert.equal(result.vectors.length, 4);
  for (const point of result.vectors) {
    assert.ok(Math.abs(point.x) <= 100_000 && Math.abs(point.y) <= 100_000);
    assert.ok(Number.isInteger((point.x + 900) / 9800));
    assert.ok(Number.isInteger((point.y + 1600) / 300));
  }
});

test('uncoverable horizons and near-plane inversions return explicit empty limited geometry', () => {
  for (const descriptor of [view({ offsetY: 1000 }), view({ offsetY: -10000 }), view({ centerX: 1e12 })]) {
    const result = overviewGroundGeometry(descriptor);
    assert.deepEqual(result.vectors, []);
    assert.deepEqual(result.uvScale, { u: 0, v: 0 });
    assert.equal(result.coverageLimited, true);
  }
  assert.deepEqual(overviewGroundGeometry(view(), { maxWorldExtent: 100 }).vectors, []);
});

test('caller-selected top is respected and negative top is visibly marked as clipped', () => {
  const descriptor = view();
  assertCornersCovered(overviewGroundGeometry(descriptor, { top: 86 }), descriptor, 86);
  const result = overviewGroundGeometry(descriptor, { top: -5 });
  assert.equal(result.grid.top, 0);
  assert.equal(result.coverageLimited, true);
  assert.deepEqual(overviewGroundGeometry(descriptor, { top: 400 }).vectors, []);
});

test('invalid display descriptions cannot propagate NaN or Infinity to ground vectors', () => {
  for (const descriptor of [null, view({ zoom: 0 }), view({ zoom: NaN }), view({ centerX: Infinity }),
    view({ height: -1 }), view({ nearPlane: 600 }), view({ offsetY: NaN })]) {
    const result = overviewGroundGeometry(descriptor);
    assert.equal(result.coverageLimited, true);
    assert.deepEqual(result.vectors, []);
  }
});

test('invalid safety options fail before generating any geometry', () => {
  assert.throws(() => overviewGroundGeometry(view(), { top: NaN }), /top must be finite/);
  for (const maxWorldExtent of [0, -1, Infinity, NaN, Number.MAX_VALUE]) {
    assert.throws(() => overviewGroundGeometry(view(), { maxWorldExtent }), /extent must be positive/);
  }
});
