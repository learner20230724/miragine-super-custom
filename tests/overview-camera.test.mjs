import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ViewCamera, projectViewPoint, projectViewSymbol, projectViewGround, inverseViewPoint } from '../src/render/view-camera.mjs';
import { projectPoint, projectSymbol, groundCorners } from '../src/render/projection.mjs';

const core = Object.freeze({ x: 2000, y: 150, width: 640, height: 400 });
const close = (actual, expected, tolerance = .003) => assert.ok(Math.abs(actual - expected) <= tolerance,
  `${actual} differs from ${expected} by more than ${tolerance}`);
const manifest = JSON.parse(await readFile(new URL('../generated/asset-manifest.json', import.meta.url), 'utf8'));
const crystalSprites = { left: manifest.sprites.A_crystal.rasterized, right: manifest.sprites.B_crystal.rasterized };
const crystalEdges = (camera, crystal, bitmap) => {
  const point = projectViewSymbol(crystal, camera.getView(core));
  const x = [bitmap.offX, bitmap.offX + bitmap.width].map(value => point.x + value * point.scaleX);
  const y = [bitmap.offY, bitmap.offY + bitmap.height].map(value => point.y + value * point.scaleY);
  return { left: Math.min(...x), right: Math.max(...x), top: Math.min(...y), bottom: Math.max(...y) };
};

test('default follow has no display override and does not write a frozen core camera', () => {
  const camera = new ViewCamera();
  assert.equal(camera.getView(core), null);
  assert.equal(camera.snapshot(core).mode, 'follow');
  assert.deepEqual(camera.worldToScreen({ x: 2100, y: 300 }, core),
    { ...projectPoint(2100, 300, core), drawable: true });
  camera.zoomAt(.5, { x: 320, y: 200 }, core).panBy(10, 10, core).fitAll().follow();
  assert.equal(camera.getView(core), null);
  assert.deepEqual(core, { x: 2000, y: 150, width: 640, height: 400 });
});

test('custom zoom 1 retains the original -70 degree projection and sprite height', () => {
  const camera = new ViewCamera(); camera.panBy(0, 0, core);
  const view = camera.getView(core);
  for (const [px, py, pz] of [[2000, 150, 0], [2100, 300, 40], [100, 0, 50]]) {
    const symbol = { px, py, pz, sx: -1, sy: 1 };
    const source = projectSymbol(symbol, core), observed = projectViewSymbol(symbol, view);
    for (const key of ['x', 'y', 'perspective', 'scaleX', 'scaleY']) close(observed[key], source[key], .00001);
  }
});

test('explicit full map fit includes every ground corner, unit-height reserve, side margin and immutable JSON snapshot', () => {
  const camera = new ViewCamera().fitMap([{ pz: 80 }]);
  const view = camera.getView(core), state = camera.snapshot(core);
  assert.equal(state.mode, 'overview');
  assert.ok(state.zoom < 1);
  assert.ok(Object.isFrozen(state) && Object.isFrozen(state.mapCorners) && Object.isFrozen(view));
  assert.doesNotThrow(() => JSON.parse(JSON.stringify(state)));
  for (const x of [-96, 0, 4500, 4596]) for (const y of [0, 800]) for (const z of [-16, 0, 320]) {
    const point = camera.worldToScreen({ x, y, z }, core);
    assert.equal(point.drawable, true);
    assert.ok(point.x >= 16 - .001 && point.x <= 624 + .001, JSON.stringify(point));
    assert.ok(point.y >= 16 - .001 && point.y <= 384 + .001, JSON.stringify(point));
  }
});

test('battle panorama fits complete manifest crystal bitmaps near both edges rather than empty map corners', () => {
  const camera = new ViewCamera({ crystalSprites }).fitAll();
  const red = crystalEdges(camera, { px: 300, py: 400 }, crystalSprites.left);
  const blue = crystalEdges(camera, { px: 4200, py: 400 }, crystalSprites.right);
  close(red.left, 16); close(blue.right, 624);
  assert.ok(red.top > 16 && red.bottom < 384 && blue.top > 16 && blue.bottom < 384);
  close(camera.zoom, .15253387, .000001);
  assert.ok(camera.zoom / new ViewCamera().fitMap().zoom > 1.27);
  assert.ok(camera.snapshot(core).mapCorners.some(point => !point.visible), 'Compact battle fit must not claim all ground corners visible');
  const initialZoom = camera.zoom;
  camera.zoomAt(.7, { x: 320, y: 200 }, core);
  assert.ok(camera.zoom < initialZoom);
  assert.ok(camera.snapshot(core).mapCorners.every(point => point.visible), 'Wheel zoom-out still exposes all map corners');
});

test('battle fit uses actual snapshot base positions and signed bitmap transforms without mutating evidence', () => {
  const sprites = { left: { width: 160, height: 180, offX: -120, offY: -170 },
    right: { width: 100, height: 150, offX: -35, offY: -140 } };
  const snapshot = Object.freeze([
    Object.freeze({ kind: 'base', side: 'left', px: 600, py: 400, pz: 0, sx: -1, sy: 1 }),
    Object.freeze({ kind: 'base', side: 'right', px: 3700, py: 400, pz: 0, sx: 1, sy: 1 }),
    Object.freeze({ kind: 'unit', px: 2250, py: 300, pz: 100 }),
  ]);
  const before = JSON.stringify(snapshot);
  const camera = new ViewCamera({ crystalSprites: sprites }).fitAll(snapshot);
  const red = crystalEdges(camera, snapshot[0], sprites.left), blue = crystalEdges(camera, snapshot[1], sprites.right);
  close(red.left, 16); close(blue.right, 624);
  assert.equal(camera.centerX, 2150);
  assert.equal(JSON.stringify(snapshot), before);
  assert.ok(Object.isFrozen(camera.crystalSprites.left));
  for (const y of [0, 800]) for (const z of [-16, 340]) {
    const point = camera.worldToScreen({ x: camera.centerX, y, z }, core);
    assert.ok(point.drawable && point.y >= 16 - .001 && point.y <= 384 + .001);
  }
});

test('airborne vertical reserve wins over edge-tight crystals when both constraints cannot fit', () => {
  const camera = new ViewCamera().fitAll([{ pz: 6000 }]);
  const red = crystalEdges(camera, { px: 300, py: 400 }, crystalSprites.left);
  assert.ok(red.left > 16);
  for (const y of [0, 800]) for (const z of [-16, 6240]) {
    const point = camera.worldToScreen({ x: 2250, y, z }, core);
    assert.ok(point.drawable && point.y >= 16 - .001 && point.y <= 384 + .001);
  }
});

test('overview retains perspective depth and the original tilt rather than flattening into a 2-D map', () => {
  const camera = new ViewCamera().fitAll(), view = camera.getView(core);
  const top = projectViewPoint(2300, 0, view), middle = projectViewPoint(2300, 400, view), bottom = projectViewPoint(2300, 800, view);
  assert.ok(top.perspective < middle.perspective && middle.perspective < bottom.perspective);
  const radians = -70 * Math.PI / 180;
  close((bottom.y - view.offsetY - 200) / (view.zoom * 400 * bottom.perspective), Math.cos(radians), .000001);
  assert.ok(bottom.y - top.y < 800 * view.zoom); // Oblique, not top-down.
});

test('ground inverse round-trips finite world points at multiple observation zooms', () => {
  const camera = new ViewCamera().fitAll();
  for (const factor of [1, 2, .25, 4]) {
    camera.zoomAt(factor, { x: 320, y: 200 }, core);
    const view = camera.getView(core);
    for (const point of [{ x: 100, y: 100 }, { x: 2250, y: 400 }, { x: 4300, y: 500 }]) {
      const screen = projectViewPoint(point.x, point.y, view);
      if (!screen.drawable) continue;
      const inverse = inverseViewPoint(screen.x, screen.y, view);
      assert.ok(inverse);
      close(inverse.x, point.x); close(inverse.y, point.y);
    }
  }
});

test('wheel zoom keeps the ground point under the mouse until an explicit map boundary is reached', () => {
  const camera = new ViewCamera().fitAll();
  const cursor = { x: 280, y: 210 }, before = camera.screenToWorld(cursor, core);
  camera.zoomAt(1.5, cursor, core);
  const after = camera.worldToScreen(before, core);
  close(after.x, cursor.x); close(after.y, cursor.y);
  camera.zoomAt(1 / 1.5, cursor, core);
  const restored = camera.worldToScreen(before, core);
  close(restored.x, cursor.x); close(restored.y, cursor.y);
});

test('drag moves the anchored ground point with the pointer and clamps the display center only', () => {
  const camera = new ViewCamera(); camera.panBy(0, 0, core);
  const start = { x: 330, y: 210 }, world = camera.screenToWorld(start, core);
  camera.panBy(20, 12, core, start);
  const projected = camera.worldToScreen(world, core);
  close(projected.x, 350); close(projected.y, 222);
  for (let index = 0; index < 5; index++) camera.panBy(1e9, 1e9, core);
  assert.ok(camera.centerX >= 0 && camera.centerX <= 4500);
  assert.ok(camera.centerY >= 0 && camera.centerY <= 800);
  camera.zoomAt(1e9, start, core); assert.equal(camera.zoom, camera.maxZoom);
  camera.zoomAt(1e-20, start, core); assert.equal(camera.zoom, camera.minZoom);
  assert.deepEqual(core, { x: 2000, y: 150, width: 640, height: 400 });
});

test('keyboard crosses from red to blue in four real seconds at every zoom and frame subdivision', () => {
  for (const zoom of [.03, .1525, .5, 1, 4]) for (const slices of [1, 40, 240, 960]) {
    const camera = new ViewCamera();
    camera.centerOn(300, 400, core).zoomAt(zoom, { x: 320, y: 200 }, core);
    for (let index = 0; index < slices; index++) camera.keyboardPan(1, 0, 4000 / slices, core);
    close(camera.centerX, 4200, .000001); close(camera.centerY, 400, .000001);
    assert.equal(camera.zoom, zoom);
    camera.keyboardPan(-1, 0, 4000, core);
    close(camera.centerX, 300, .000001);
  }
  assert.deepEqual(core, { x: 2000, y: 150, width: 640, height: 400 });
});

test('keyboard navigation normalizes diagonals, respects world boundaries and ignores zero-time/zero-direction input', () => {
  const camera = new ViewCamera();
  camera.keyboardPan(0, 0, 100, core).keyboardPan(1, 0, 0, core);
  assert.equal(camera.mode, 'follow');
  camera.centerOn(2250, 400, core).keyboardPan(1, -1, 100, core);
  close(Math.hypot(camera.centerX - 2250, camera.centerY - 400), 97.5, .000001);
  camera.keyboardPan(-1, -1, 1e9, core);
  assert.equal(camera.centerX, 0); assert.equal(camera.centerY, 0);
  camera.keyboardPan(1, 1, 1e9, core);
  assert.equal(camera.centerX, 4500); assert.equal(camera.centerY, 800);
  assert.throws(() => camera.keyboardPan(1, 0, -1, core), /not be negative/);
  assert.throws(() => camera.keyboardPan(NaN, 0, 1, core), /finite/);
  assert.throws(() => camera.keyboardPan(1, 0, Infinity, core), /finite/);
});

test('keyboard crossing duration and configured crystal separation are display settings, not core mutation', () => {
  const camera = new ViewCamera({ mapWidth: 6000, baseSpawnInset: 500, keyboardCrossingMs: 2000 });
  camera.centerOn(500, 400, core).keyboardPan(1, 0, 2000, core);
  close(camera.centerX, 5500);
  assert.throws(() => new ViewCamera({ keyboardCrossingMs: 0 }), /positive/);
  assert.throws(() => new ViewCamera({ baseSpawnInset: 2250 }), /positive horizontal separation/);
  assert.throws(() => new ViewCamera({ crystalSprites: { left: { width: 0 } } }), /positive/);
});

test('minimap centerOn reaches a distant world point directly, keeps zoom and never changes the logical camera', () => {
  const camera = new ViewCamera();
  assert.equal(camera.centerOn(4300, 700, core), camera);
  assert.equal(camera.mode, 'manual'); assert.equal(camera.zoom, 1);
  close(camera.worldToScreen({ x: 4300, y: 700 }, core).x, 320);
  close(camera.worldToScreen({ x: 4300, y: 700 }, core).y, 200);
  camera.fitAll(); const zoom = camera.zoom;
  camera.centerOn(100, 100, core);
  assert.equal(camera.zoom, zoom); assert.equal(camera.offsetX, 0); assert.equal(camera.offsetY, 0);
  close(camera.worldToScreen({ x: 100, y: 100 }, core).x, 320);
  close(camera.worldToScreen({ x: 100, y: 100 }, core).y, 200);
  camera.centerOn(-1e9, 1e9, core);
  assert.equal(camera.centerX, 0); assert.equal(camera.centerY, 800);
  assert.throws(() => camera.centerOn(NaN, 1, core), /finite/);
  assert.deepEqual(core, { x: 2000, y: 150, width: 640, height: 400 });
});

test('custom ground clips a near-plane crossing strip before projection without stretching its UV', () => {
  const camera = new ViewCamera(); camera.panBy(0, 0, core);
  const view = camera.getView(core);
  const result = projectViewGround(groundCorners(-900, 500, 9800, 300), view);
  assert.equal(result.drawable, true); assert.equal(result.clipped, true);
  assert.ok(result.vertices.every(Number.isFinite));
  assert.ok(result.uvtData[7] > 0 && result.uvtData[7] < 1);
  assert.equal(result.uvtData[10], result.uvtData[7]);
  assert.ok(result.uvtData.filter((_value, i) => i % 3 === 2).every(t => t > 0));
  assert.equal(projectViewGround(groundCorners(-900, 1000, 9800, 300), view).drawable, false);
});

test('merged decorative ground retains the original per-cell UV period even when near-clipped', () => {
  const camera = new ViewCamera(); camera.panBy(0, 0, core);
  const vectors = groundCorners(-900, 200, 19600, 600);
  const one = projectViewGround(vectors, camera.getView(core));
  const repeated = projectViewGround(vectors, camera.getView(core), { u: 2, v: 2 });
  assert.equal(repeated.drawable, true); assert.equal(repeated.clipped, true);
  assert.deepEqual(repeated.vertices, one.vertices);
  for (let i = 0; i < 4; i++) {
    assert.equal(repeated.uvtData[i * 3], one.uvtData[i * 3] * 2);
    assert.equal(repeated.uvtData[i * 3 + 1], one.uvtData[i * 3 + 1] * 2);
    assert.equal(repeated.uvtData[i * 3 + 2], one.uvtData[i * 3 + 2]);
  }
});

test('custom focal-plane and invalid inputs fail safely without repairing original geometry', () => {
  const camera = new ViewCamera(); camera.panBy(0, 0, core);
  const view = camera.getView(core);
  assert.equal(projectViewPoint(100, 1000, view).drawable, false);
  assert.equal(inverseViewPoint(320, -1000, view), null);
  assert.throws(() => camera.zoomAt(0, { x: 0, y: 0 }, core), /positive/);
  assert.throws(() => camera.panBy(NaN, 0, core), /finite/);
  assert.throws(() => new ViewCamera({ nearPlane: 600 }), /Invalid display/);
  assert.throws(() => new ViewCamera({ maxZoom: .5 }), /include 1/);
});
