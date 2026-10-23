import { FOCAL_LENGTH, MAX_SYMBOL_SCALE, ROTATION_X_DEGREES, projectPoint } from './projection.mjs';

// Observation-only controls. These are display limits/margins, not game rules.
const SIN = Math.fround(Math.sin(ROTATION_X_DEGREES * Math.PI / 180));
const COS = Math.fround(Math.cos(ROTATION_X_DEGREES * Math.PI / 180));
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const finite = (value, name) => {
  if (!Number.isFinite(value)) throw new TypeError(`${name} must be finite`);
  return value;
};
const positive = (value, name) => {
  finite(value, name);
  if (value <= 0) throw new RangeError(`${name} must be positive`);
  return value;
};

/**
 * Custom zoom scales world distances BEFORE the original -70-degree Matrix3D
 * projection, equivalent to changing observation distance, not shrinking an
 * already-clipped 640x400 image. Original focal length and oblique angle remain.
 * Default follow returns null so the production legacy path is not changed.
 */
export function projectViewPoint(x, y, view, z = 0) {
  const relativeY = (y - view.centerY) * view.zoom;
  const denominator = FOCAL_LENGTH + Math.fround(SIN * Math.fround(relativeY));
  if (!Number.isFinite(denominator) || denominator < view.nearPlane) {
    return { x: NaN, y: NaN, perspective: 0, drawable: false };
  }
  const point = projectPoint((x - view.centerX) * view.zoom, relativeY,
    { x: 0, y: 0, width: view.width, height: view.height });
  return { ...point, x: point.x + view.offsetX,
    y: point.y + view.offsetY - z * view.zoom * point.perspective,
    drawable: Number.isFinite(point.x) && Number.isFinite(point.y) && point.perspective > 0 };
}

export function projectViewSymbol(symbol, view) {
  const point = projectViewPoint(symbol.px ?? 0, symbol.py ?? 0, view, symbol.pz ?? 0);
  const scale = view.zoom * Math.max(0, Math.min(point.perspective, MAX_SYMBOL_SCALE));
  return { ...point, scale, scaleX: (symbol.sx ?? 1) * scale, scaleY: (symbol.sy ?? 1) * scale };
}

/** Ground-plane inverse; elevated sprites intentionally do not select units. */
export function inverseViewPoint(x, y, view) {
  const dx = x - view.width / 2 - view.offsetX;
  const dy = y - view.height / 2 - view.offsetY;
  const perspective = 1 - SIN * dy / (FOCAL_LENGTH * COS);
  if (!Number.isFinite(perspective) || perspective <= 0) return null;
  const worldY = view.centerY + dy / (view.zoom * COS * perspective);
  const worldX = view.centerX + dx / (view.zoom * perspective);
  const denominator = FOCAL_LENGTH / perspective;
  if (![worldX, worldY].every(Number.isFinite) || denominator < view.nearPlane) return null;
  return { x: worldX, y: worldY };
}

/**
 * The source ground consists of axis-aligned four-corner strips. Clip those
 * strips BEFORE projection at a positive display near-plane and retain their
 * original UV fraction: no stretching, infinity, or behind-camera triangles.
 * This is a custom observation safeguard, not a change to legacy projection.
 */
export function projectViewGround(vectors, view, uvScale = { u: 1, v: 1 }) {
  const top = vectors[0].y, bottom = vectors[2].y;
  const nearY = view.centerY + (FOCAL_LENGTH - view.nearPlane * 1.001) / (-SIN * view.zoom);
  const clippedBottom = Math.min(bottom, nearY);
  const empty = { drawable: false, vertices: Array(8).fill(0), indices: [0, 1, 3, 1, 2, 3],
    uvtData: Array(12).fill(0), processedVertices: 0, perspective: 0 };
  if (!(bottom > top) || clippedBottom <= top) return empty;
  const vertices = [], uvtData = [];
  for (let index = 0; index < 4; index++) {
    const vertex = vectors[index];
    const y = Math.min(vertex.y, clippedBottom);
    const point = projectViewPoint(vertex.x, y, view);
    if (!point.drawable) return empty;
    vertices.push(point.x, point.y);
    uvtData.push(index === 1 || index === 2 ? uvScale.u : 0,
      (y - top) / (bottom - top) * uvScale.v, point.perspective);
  }
  return { drawable: true, vertices, uvtData, indices: [0, 1, 3, 1, 2, 3], processedVertices: 4,
    perspective: uvtData[11], clipped: clippedBottom < bottom };
}

export class ViewCamera {
  constructor({ mapWidth = 4500, mapHeight = 800, width = 640, height = 400,
    minZoom = .01, maxZoom = 4, nearPlane = 24, padding = 16,
    heightPadding = 240, sidePadding = 96 } = {}) {
    for (const [key, value] of Object.entries({ mapWidth, mapHeight, width, height, minZoom, maxZoom, nearPlane })) positive(value, key);
    for (const [key, value] of Object.entries({ padding, heightPadding, sidePadding })) {
      finite(value, key); if (value < 0) throw new RangeError(`${key} must not be negative`);
    }
    if (minZoom > 1 || maxZoom < 1 || minZoom > maxZoom) throw new RangeError('Zoom range must include 1');
    if (nearPlane >= FOCAL_LENGTH || padding * 2 >= Math.min(width, height)) throw new RangeError('Invalid display near-plane or padding');
    Object.assign(this, { mapWidth, mapHeight, width, height, minZoom, maxZoom, nearPlane, padding, heightPadding, sidePadding });
    this.follow();
  }

  follow() {
    this.mode = 'follow'; this.zoom = 1; this.centerX = this.centerY = null;
    this.offsetX = this.offsetY = 0;
    return this;
  }

  activate(coreCamera) {
    if (this.mode === 'follow') {
      if (!coreCamera) throw new TypeError('A render-time core camera is required to leave follow mode');
      this.centerX = clamp(finite(coreCamera.x, 'camera.x'), 0, this.mapWidth);
      this.centerY = clamp(finite(coreCamera.y, 'camera.y'), 0, this.mapHeight);
      this.mode = 'manual';
    }
  }

  descriptor() {
    return Object.freeze({ kind: 'observation-view', mode: this.mode, zoom: this.zoom,
      centerX: this.centerX, centerY: this.centerY, width: this.width, height: this.height,
      offsetX: this.offsetX, offsetY: this.offsetY, nearPlane: this.nearPlane });
  }

  getView(_coreCamera) { return this.mode === 'follow' ? null : this.descriptor(); }

  effectiveView(coreCamera) {
    if (this.mode !== 'follow') return this.descriptor();
    if (!coreCamera) throw new TypeError('A render-time core camera is required in follow mode');
    return { zoom: 1, centerX: coreCamera.x, centerY: coreCamera.y,
      width: coreCamera.width, height: coreCamera.height, offsetX: 0, offsetY: 0, nearPlane: this.nearPlane };
  }

  worldToScreen(point, coreCamera) {
    const view = this.effectiveView(coreCamera);
    if (this.mode === 'follow') {
      const projected = projectPoint(point.x, point.y, coreCamera);
      return { ...projected, y: projected.y - (point.z ?? 0) * projected.perspective,
        drawable: projected.perspective > 0 && Number.isFinite(projected.x) && Number.isFinite(projected.y) };
    }
    return projectViewPoint(point.x, point.y, view, point.z ?? 0);
  }

  screenToWorld(point, coreCamera) { return inverseViewPoint(point.x, point.y, this.effectiveView(coreCamera)); }

  positionAnchor(world, screen) {
    const view = { ...this.descriptor(), centerX: 0, centerY: 0 };
    const delta = inverseViewPoint(screen.x, screen.y, view);
    if (!delta) return false;
    this.centerX = clamp(world.x - delta.x, 0, this.mapWidth);
    this.centerY = clamp(world.y - delta.y, 0, this.mapHeight);
    return true;
  }

  zoomAt(factor, point = { x: this.width / 2, y: this.height / 2 }, coreCamera) {
    positive(factor, 'zoom factor');
    const anchorPoint = { x: finite(point.x, 'anchor.x'), y: finite(point.y, 'anchor.y') };
    this.activate(coreCamera);
    const world = this.screenToWorld(anchorPoint) ?? this.screenToWorld({ x: this.width / 2, y: this.height / 2 });
    this.zoom = clamp(this.zoom * factor, this.minZoom, this.maxZoom);
    this.mode = 'manual';
    if (world) this.positionAnchor(world, anchorPoint);
    return this;
  }

  panBy(dx, dy, coreCamera, point = { x: this.width / 2, y: this.height / 2 }) {
    finite(dx, 'pan dx'); finite(dy, 'pan dy');
    this.activate(coreCamera);
    const world = this.screenToWorld(point);
    const end = { x: point.x + dx, y: clamp(point.y + dy, 0, this.height) };
    if (world) this.positionAnchor(world, end);
    this.mode = 'manual';
    return this;
  }

  /** Minimap navigation addresses world coordinates, never the core camera. */
  centerOn(x, y, coreCamera) {
    finite(x, 'center x'); finite(y, 'center y');
    this.activate(coreCamera);
    this.centerX = clamp(x, 0, this.mapWidth);
    this.centerY = clamp(y, 0, this.mapHeight);
    this.offsetX = this.offsetY = 0;
    this.mode = 'manual';
    return this;
  }

  fitAll(snapshot = []) {
    this.mode = 'overview'; this.centerX = this.mapWidth / 2; this.centerY = this.mapHeight / 2;
    this.offsetX = this.offsetY = 0;
    // Reserve all baseline bitmap height plus airborne/projectile motion. A
    // caller may supply the current immutable snapshot to reserve extra height.
    const extraHeight = snapshot.reduce((max, item) => Math.max(max, Number.isFinite(item.pz) ? item.pz : 0), 0);
    const height = this.heightPadding + extraHeight;
    const boundsAt = zoom => {
      const view = { ...this.descriptor(), zoom };
      const points = [];
      for (const x of [-this.sidePadding, this.mapWidth + this.sidePadding]) {
        for (const y of [0, this.mapHeight]) {
          for (const z of [-16, height]) points.push(projectViewPoint(x, y, view, z));
        }
      }
      if (points.some(point => !point.drawable)) return null;
      return { left: Math.min(...points.map(p => p.x)), right: Math.max(...points.map(p => p.x)),
        top: Math.min(...points.map(p => p.y)), bottom: Math.max(...points.map(p => p.y)) };
    };
    let low = this.minZoom, high = this.maxZoom;
    const fits = bounds => bounds && bounds.right - bounds.left <= this.width - 2 * this.padding
      && bounds.bottom - bounds.top <= this.height - 2 * this.padding;
    if (!fits(boundsAt(low))) throw new RangeError('Map does not fit inside the configured minimum display zoom');
    for (let iteration = 0; iteration < 52; iteration++) {
      const middle = (low + high) / 2;
      if (fits(boundsAt(middle))) low = middle; else high = middle;
    }
    this.zoom = low;
    const bounds = boundsAt(low);
    this.offsetX = this.width / 2 - (bounds.left + bounds.right) / 2;
    this.offsetY = this.height / 2 - (bounds.top + bounds.bottom) / 2;
    return this;
  }

  snapshot(coreCamera) {
    const view = this.effectiveView(coreCamera);
    const mapCorners = [[0, 0], [this.mapWidth, 0], [this.mapWidth, this.mapHeight], [0, this.mapHeight]]
      .map(([x, y]) => this.worldToScreen({ x, y }, coreCamera))
      .map(point => Object.freeze({ x: Number.isFinite(point.x) ? point.x : null,
        y: Number.isFinite(point.y) ? point.y : null, drawable: point.drawable,
        visible: point.drawable && point.x >= 0 && point.x <= this.width && point.y >= 0 && point.y <= this.height }));
    const polygon = [[0, 0], [this.width, 0], [this.width, this.height], [0, this.height]]
      .map(([x, y]) => inverseViewPoint(x, y, view));
    return Object.freeze({ mode: this.mode, zoom: this.zoom, centerX: view.centerX, centerY: view.centerY,
      mapCorners: Object.freeze(mapCorners), visibleWorldPolygon: polygon.every(Boolean)
        ? Object.freeze(polygon.map(point => Object.freeze(point))) : null });
  }
}
