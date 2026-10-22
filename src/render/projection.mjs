/**
 * Pure geometry port of the recovered Super Miragine War renderer.
 *
 * Evidence: recovered/as3/scripts/dragonforce/renderEngine/DragonForceRenderEngine.as,
 * recovered/as3/scripts/dragonforce/core/{Camera,GroundTile,Symbol}.as.
 * This is not the ordinary game's 2-D renderer or the JKS replacement.
 *
 * The source deliberately has no symbol near-plane clipping: it clamps only
 * displayed scale, not projected positions. Non-finite results at the focal
 * plane are retained here. A drawing backend must skip unsupported coordinates
 * without changing this geometry or the simulation.
 */

export const ROTATION_X_DEGREES = -70;
export const FOCAL_LENGTH = 600;
export const DEFAULT_CAMERA_WIDTH = 640;
export const DEFAULT_CAMERA_HEIGHT = 400;
export const MAX_SYMBOL_SCALE = 10;

const radians = ROTATION_X_DEGREES * Math.PI / 180;
// Flash Matrix3D stores coefficients and transforms Vector3D using float32.
// Number math after transformVector returns remains float64. Do not silently
// replace this with a more precise all-double rotation.
const rotationCos = Math.fround(Math.cos(radians));
const rotationSin = Math.fround(Math.sin(radians));

export const PROJECTION_SOURCE = Object.freeze({
  renderer: 'recovered/as3/scripts/dragonforce/renderEngine/DragonForceRenderEngine.as',
  camera: 'recovered/as3/scripts/dragonforce/core/Camera.as',
  ground: 'recovered/as3/scripts/dragonforce/core/GroundTile.as',
  symbol: 'recovered/as3/scripts/dragonforce/core/Symbol.as',
  numericReference: 'https://github.com/ruffle-rs/ruffle/tree/master/tests/tests/swfs/avm2/matrix3d_precision',
});

/**
 * The original Camera constructor writes its coordinates directly, bypassing
 * the setters. Its uninitialized Number limit fields are NaN, NOT zero.
 * Returned cameras are ordinary records; the helpers below return copies.
 */
export function createCamera({
  x = 0,
  y = 0,
  width = DEFAULT_CAMERA_WIDTH,
  height = DEFAULT_CAMERA_HEIGHT,
} = {}) {
  return {
    x: Number(x),
    y: Number(y),
    width: Number(width),
    height: Number(height),
    minX: NaN,
    minY: NaN,
    maxX: NaN,
    maxY: NaN,
  };
}

/** AS3 int parameter coercion, including truncation and signed 32-bit wrap. */
function asInt(value) {
  return Number(value) | 0;
}

/**
 * Camera.limitInMap(int, int) only sets limits; it does not clamp the existing
 * position. Bounds are not expanded when the map is smaller than the camera.
 */
export function limitCameraInMap(camera, mapWidth, mapHeight) {
  return {
    ...camera,
    minX: 0,
    minY: 0,
    maxX: asInt(mapWidth) - camera.width,
    maxY: asInt(mapHeight) - camera.height,
  };
}

/** Keep the source's TWO sequential if statements, not a reordered clamp. */
function constrainedCoordinate(value, min, max) {
  let result = Number(value);
  if (result < min) result = min;
  if (result > max) result = max;
  return result;
}

export function withCameraX(camera, x) {
  return { ...camera, x: constrainedCoordinate(x, camera.minX, camera.maxX) };
}

export function withCameraY(camera, y) {
  return { ...camera, y: constrainedCoordinate(y, camera.minY, camera.maxY) };
}

export function withCameraPosition(camera, x, y) {
  return withCameraY(withCameraX(camera, x), y);
}

function transformXYRow(a, b, x, y) {
  const productX = Math.fround(a * x);
  const productY = Math.fround(b * y);
  const sum = Math.fround(productX + productY);
  return Math.fround(Math.fround(sum + 0) + 0);
}

/**
 * Matrix3D.appendRotation(-70, X_AXIS), then transformVector(x, y, 0).
 * Symbol height pz is NOT put into this matrix or the perspective denominator.
 */
export function projectPoint(x, y, camera) {
  const relativeX = Math.fround(x - camera.x);
  const relativeY = Math.fround(y - camera.y);
  // Retain even the zero products: 0 * Infinity/NaN propagates in the original
  // matrix multiplication instead of being optimized out algebraically.
  const viewX = transformXYRow(1, 0, relativeX, relativeY);
  const viewY = transformXYRow(0, rotationCos, relativeX, relativeY);
  const viewZ = transformXYRow(0, rotationSin, relativeX, relativeY);
  const perspective = FOCAL_LENGTH / (FOCAL_LENGTH + viewZ);
  return {
    x: viewX * perspective + camera.width * 0.5,
    y: viewY * perspective + camera.height * 0.5,
    perspective,
    viewX,
    viewY,
    viewZ,
  };
}

/**
 * Sprite.scaleX/Y use the clamped perspective. Sprite.x/y use the UNCLAMPED
 * perspective, including negative and non-finite values. There is no cull flag
 * because the original does not reject a symbol behind the camera.
 */
export function projectSymbol(symbol, camera) {
  const { px = 0, py = 0, pz = 0, sx = 1, sy = 1 } = symbol;
  const point = projectPoint(px, py, camera);
  const scale = Math.max(0, Math.min(point.perspective, MAX_SYMBOL_SCALE));
  return {
    ...point,
    y: point.y - pz * point.perspective,
    scale,
    scaleX: sx * scale,
    scaleY: sy * scale,
  };
}

/** GroundTile constructor's clockwise v0/v1/v2/v3 order and int arguments. */
export function groundCorners(x = 0, y = 0, width = 0, height = 0) {
  x = asInt(x);
  y = asInt(y);
  width = asInt(width);
  height = asInt(height);
  return [
    { x, y },
    { x: x + width, y },
    { x: x + width, y: y + height },
    { x, y: y + height },
  ];
}

/**
 * Produce the exact drawTriangles inputs for one four-corner ground tile.
 * Ground rendering differs from symbol rendering: the first negative
 * perspective aborts the tile, and it draws only if the final value is > 0.
 * There is NO 0..10 clamp and no extra near-plane or winding rejection.
 *
 * An aborted tile's unused buffer entries are zero here. The AS3 renderer
 * reuses its old entries, but never draws that aborted tile; those stale values
 * are therefore deliberately not exposed as meaningful geometry.
 */
export function projectGround(vectors, camera) {
  const vertices = Array(8).fill(0);
  const indices = [0, 1, 3, 1, 2, 3];
  const uvtData = [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0];
  let perspective = NaN;
  let processedVertices = 0;
  for (let index = 0; index < 4; index += 1) {
    const vertex = vectors[index];
    const point = projectPoint(vertex.x, vertex.y, camera);
    perspective = point.perspective;
    vertices[index * 2] = point.x;
    vertices[index * 2 + 1] = point.y;
    uvtData[index * 3 + 2] = perspective;
    processedVertices += 1;
    if (perspective < 0) break;
  }
  return {
    drawable: perspective > 0,
    vertices,
    indices,
    uvtData,
    processedVertices,
    perspective,
  };
}

/**
 * Source: sortOn('py', NUMERIC | DESCENDING), then addChild in reverse order.
 * This helper never changes the input or its elements. Equal-py tie order in
 * Flash's sortOn is an unresolved oracle gate; JS's stable sort is used for
 * those ties, followed by the same reverse iteration. Do not claim tie parity.
 *
 * The game core captures the render-time list BEFORE separation/camera follow.
 * A backend should draw that snapshot in its existing order rather than
 * sorting a later simulation state with this helper.
 */
export function painterOrder(symbols) {
  return [...symbols].sort((left, right) => right.py - left.py).reverse();
}

/** Source renders scene.grounds from last to first, underneath all children. */
export function groundPainterOrder(grounds) {
  return [...grounds].reverse();
}

/**
 * These strips are always 640 pixels wide, not camera.width. The original
 * draws them after the ground triangles but before display-list children.
 * Presence flags correspond to the original bg1BitmapData/bg2BitmapData checks.
 */
export function backgroundLayers(camera, { bg1 = true, bg2 = true } = {}) {
  const layers = [];
  if (bg1) {
    layers.push({
      key: 'bg1',
      matrix: { a: 1, b: 0, c: 0, d: 1, tx: camera.x / 80 - 250, ty: 0 },
      rect: { x: 0, y: 0, width: 640, height: 79 },
    });
  }
  if (bg2) {
    layers.push({
      key: 'bg2',
      matrix: { a: 1, b: 0, c: 0, d: 1, tx: -camera.x / 4, ty: 55 },
      rect: { x: 0, y: 55, width: 640, height: 31 },
    });
  }
  return layers;
}
