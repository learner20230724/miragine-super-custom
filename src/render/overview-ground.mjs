import { FOCAL_LENGTH, ROTATION_X_DEGREES } from './projection.mjs';
import { inverseViewPoint } from './view-camera.mjs';

// Original ground bitmap placement / period, not a simulation map boundary.
const ORIGIN_X = -900;
const ORIGIN_Y = -1600;
const CELL_WIDTH = 9800;
const CELL_HEIGHT = 300;
const SIN = Math.fround(Math.sin(ROTATION_X_DEGREES * Math.PI / 180));
const COS = Math.fround(Math.cos(ROTATION_X_DEGREES * Math.PI / 180));
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

function emptyGeometry(top = null, bottom = null, horizonY = null) {
  return {
    vectors: [],
    uvScale: { u: 0, v: 0 },
    grid: {
      originX: ORIGIN_X, originY: ORIGIN_Y, cellWidth: CELL_WIDTH, cellHeight: CELL_HEIGHT,
      minColumn: 0, maxColumnExclusive: 0, minRow: 0, maxRowExclusive: 0,
      columnCount: 0, rowCount: 0, startX: null, endX: null, startY: null, endY: null,
      top, bottom, horizonY,
    },
    coverageLimited: true,
  };
}

/**
 * Extend only the observation mode's decorative ground to its visible frustum.
 *
 * One grid-aligned quad replaces any number of original-period bitmap cells.
 * UV scale counts whole cells, so repeat sampling has the original world-space
 * phase even when the quad starts before the original thirteen ground strips.
 * No allocation is proportional to the number of repeated cells.
 *
 * coverageLimited is explicit if the requested region crosses the horizon,
 * cannot be inverted, or exceeds the finite safety extent. Extent limiting
 * rounds IN to complete original cells rather than silently breaking UV phase.
 */
export function overviewGroundGeometry(view, { top = 79, maxWorldExtent = 1_000_000 } = {}) {
  if (!Number.isFinite(top)) throw new TypeError('Overview ground top must be finite.');
  if (!Number.isFinite(maxWorldExtent) || maxWorldExtent <= 0
      || maxWorldExtent > Number.MAX_SAFE_INTEGER / 4) {
    throw new RangeError('Overview ground extent must be positive, finite, and allow exact grid indices.');
  }
  if (!view || !['width', 'height', 'centerX', 'centerY', 'zoom', 'offsetX', 'offsetY', 'nearPlane']
    .every(key => Number.isFinite(view[key])) || view.width <= 0 || view.height <= 0
    || view.zoom <= 0 || view.nearPlane <= 0 || view.nearPlane >= FOCAL_LENGTH) {
    return emptyGeometry();
  }

  // Inverse perspective is 1 - SIN * dy / (f * COS). Below this screen
  // horizon it is positive. Never invert the horizon itself (infinite world).
  const horizonY = view.height / 2 + view.offsetY + FOCAL_LENGTH * COS / SIN;
  const horizonEpsilon = Math.max(1e-6, Math.abs(horizonY) * Number.EPSILON * 64);
  const safeTop = Math.max(0, top, horizonY + horizonEpsilon);
  const bottom = view.height;
  let coverageLimited = safeTop !== top;
  if (!Number.isFinite(safeTop) || safeTop >= bottom) return emptyGeometry(safeTop, bottom, horizonY);

  const corners = [[0, safeTop], [view.width, safeTop], [view.width, bottom], [0, bottom]]
    .map(([x, y]) => inverseViewPoint(x, y, view));
  if (corners.some(point => !point || !Number.isFinite(point.x) || !Number.isFinite(point.y))) {
    return emptyGeometry(safeTop, bottom, horizonY);
  }
  const minX = Math.min(...corners.map(point => point.x));
  const maxX = Math.max(...corners.map(point => point.x));
  const minY = Math.min(...corners.map(point => point.y));
  const maxY = Math.max(...corners.map(point => point.y));
  if (minX > maxWorldExtent || maxX < -maxWorldExtent
      || minY > maxWorldExtent || maxY < -maxWorldExtent) {
    return emptyGeometry(safeTop, bottom, horizonY);
  }

  // Bound the inverse before computing indices, including near-horizon world
  // coordinates that may be finite but much larger than safe integer indices.
  const boundedMinX = clamp(minX, -maxWorldExtent, maxWorldExtent);
  const boundedMaxX = clamp(maxX, -maxWorldExtent, maxWorldExtent);
  const boundedMinY = clamp(minY, -maxWorldExtent, maxWorldExtent);
  const boundedMaxY = clamp(maxY, -maxWorldExtent, maxWorldExtent);
  const desiredMinColumn = Math.floor((boundedMinX - ORIGIN_X) / CELL_WIDTH);
  const desiredMaxColumn = Math.ceil((boundedMaxX - ORIGIN_X) / CELL_WIDTH);
  const desiredMinRow = Math.floor((boundedMinY - ORIGIN_Y) / CELL_HEIGHT);
  const desiredMaxRow = Math.ceil((boundedMaxY - ORIGIN_Y) / CELL_HEIGHT);
  const minColumn = Math.max(desiredMinColumn, Math.ceil((-maxWorldExtent - ORIGIN_X) / CELL_WIDTH));
  const maxColumnExclusive = Math.min(desiredMaxColumn, Math.floor((maxWorldExtent - ORIGIN_X) / CELL_WIDTH));
  const minRow = Math.max(desiredMinRow, Math.ceil((-maxWorldExtent - ORIGIN_Y) / CELL_HEIGHT));
  const maxRowExclusive = Math.min(desiredMaxRow, Math.floor((maxWorldExtent - ORIGIN_Y) / CELL_HEIGHT));
  const columnCount = maxColumnExclusive - minColumn;
  const rowCount = maxRowExclusive - minRow;
  if (columnCount <= 0 || rowCount <= 0) return emptyGeometry(safeTop, bottom, horizonY);
  const startX = ORIGIN_X + minColumn * CELL_WIDTH;
  const endX = ORIGIN_X + maxColumnExclusive * CELL_WIDTH;
  const startY = ORIGIN_Y + minRow * CELL_HEIGHT;
  const endY = ORIGIN_Y + maxRowExclusive * CELL_HEIGHT;
  coverageLimited ||= startX > minX || endX < maxX || startY > minY || endY < maxY;
  return {
    vectors: [{ x: startX, y: startY }, { x: endX, y: startY },
      { x: endX, y: endY }, { x: startX, y: endY }],
    uvScale: { u: columnCount, v: rowCount },
    grid: {
      originX: ORIGIN_X, originY: ORIGIN_Y, cellWidth: CELL_WIDTH, cellHeight: CELL_HEIGHT,
      minColumn, maxColumnExclusive, minRow, maxRowExclusive, columnCount, rowCount,
      startX, endX, startY, endY, top: safeTop, bottom, horizonY,
    },
    coverageLimited,
  };
}
