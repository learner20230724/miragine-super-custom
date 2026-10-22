import { GroundWebGLRenderer } from './ground-webgl.mjs';
import {
  backgroundLayers,
  groundCorners,
  groundPainterOrder,
  projectGround,
  projectSymbol,
} from './projection.mjs';

export const BATTLEFIELD_WIDTH = 640;
export const BATTLEFIELD_HEIGHT = 400;

/** DragonForce constructor: thirteen identical terrain bitmaps, not terrain2. */
export const ORIGINAL_GROUND_TILES = Object.freeze(Array.from({ length: 13 }, (_, index) =>
  Object.freeze(groundCorners(-900, -1600 + index * 300, 9800, 300)
    .map(vertex => Object.freeze(vertex)))));

export const RENDER_FIDELITY = Object.freeze({
  source: 'recovered/as3/scripts/dragonforce/renderEngine/DragonForceRenderEngine.as',
  spriteRasterSource: 'recovered/as3/scripts/dragonforce/core/SpriteSheet.as',
  originalAssets: true,
  nativeRuntime: true,
  groundPerspective: 'UVT-weighted WebGL shader, not affine triangles',
  flashPixelParityValidated: false,
  remainingGates: Object.freeze([
    'FFDec-exported extents versus original MovieClip.getRect',
    'Canvas PNG resampling versus original BitmapData.draw at scale 0.9',
    'Flash bitmap pixel-snapping, filtering, and triangle-edge rasterization',
    'Flash equal-py sortOn tie order, supplied by the simulation snapshot',
    'Non-finite focal-plane coordinates cannot be submitted to native backends',
  ]),
});

function browserCanvas(width, height) {
  let canvas;
  if (typeof OffscreenCanvas !== 'undefined') canvas = new OffscreenCanvas(width, height);
  else if (typeof document !== 'undefined') canvas = document.createElement('canvas');
  else throw new Error('A browser Canvas implementation or canvasFactory is required');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function browserImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Could not load game image: ${url}`));
    image.src = url;
  });
}

/** Use source sheet identifiers only; melee hit-test objects have no bitmap. */
export function spriteKeyFor(entity) {
  const prefix = entity.side === 'left' ? 'A' : entity.side === 'right' ? 'B' : null;
  if (entity.kind === 'base') return prefix ? `${prefix}_crystal` : null;
  if (entity.kind === 'unit') {
    if (!prefix || entity.spriteIndex == null || !entity.action) return null;
    return `${prefix}${entity.spriteIndex}_${entity.action}`;
  }
  if (entity.kind === 'attack') {
    return { fb: 'fireball', tb: 'thunderball', storm: 'storm' }[entity.weaponSheet] ?? null;
  }
  return null;
}

/**
 * The core captures BitmapData's displayed frame separately from the advanced
 * timeline counter. Never infer it from currentFrame or wrap an invalid index.
 */
export function resolveSpriteFrame(entity, manifest) {
  const key = spriteKeyFor(entity);
  if (!key || entity.displayFrame == null) return null;
  const sprite = manifest.sprites[key];
  if (!sprite) return null;
  const index = Math.trunc(entity.displayFrame);
  const frame = sprite.frames.find(candidate => candidate.index === index);
  return frame ? { key, sprite, frame, index } : null;
}

/**
 * A preserved PNG already has its exported frame bounds translated to (0,0).
 * Put it back into the original sheet's fixed 0.9-scale BitmapData rectangle.
 * Width, height, offX and offY are the source's AS3-int truncations. Extents
 * come from the manifest and remain an explicitly unvalidated getRect proxy.
 */
export function spriteRasterPlacement(sprite, frame) {
  const scale = sprite.rasterized.scale;
  return {
    width: sprite.rasterized.width,
    height: sprite.rasterized.height,
    offX: sprite.rasterized.offX,
    offY: sprite.rasterized.offY,
    x: (frame.bounds.xMin - sprite.bounds.xMin) * scale,
    y: (frame.bounds.yMin - sprite.bounds.yMin) * scale,
    imageWidth: frame.width * scale,
    imageHeight: frame.height * scale,
  };
}

/**
 * Native battlefield renderer. The caller owns the HUD, menus and viewport.
 * Draw in a logical 640x400 area inside the original 640x480 stage; preserve
 * the caller's Canvas2D transform. No SWF player or replacement art is used.
 *
 * Usage: await renderer.load(); renderer.render(sim.renderSnapshot,
 * sim.renderCamera). The supplied snapshot is already in source render order,
 * captured before separation/recruitment/camera-follow. Do NOT sort it again.
 */
export class BattlefieldRenderer {
  constructor(canvasOrContext, manifest, {
    baseUrl = new URL('../../', import.meta.url),
    imageLoader = browserImage,
    canvasFactory = browserCanvas,
    groundRenderer = null,
    groundTiles = ORIGINAL_GROUND_TILES,
  } = {}) {
    this.context = typeof canvasOrContext?.getContext === 'function'
      ? canvasOrContext.getContext('2d') : canvasOrContext;
    if (!this.context || typeof this.context.drawImage !== 'function') {
      throw new TypeError('BattlefieldRenderer requires a Canvas2D canvas or context');
    }
    if (!manifest?.sprites || !manifest?.images?.terrain) {
      throw new TypeError('BattlefieldRenderer requires the generated asset manifest');
    }
    this.manifest = manifest;
    this.baseUrl = baseUrl;
    this.imageLoader = imageLoader;
    this.canvasFactory = canvasFactory;
    this.groundRenderer = groundRenderer;
    this.groundTiles = groundTiles;
    this.images = new Map();
    this.surfaces = new Map();
    this.patterns = new Map();
    this.loaded = false;
    this.lastRenderStats = null;
    this.fidelity = RENDER_FIDELITY;
  }

  async load() {
    if (this.loadPromise) return this.loadPromise;
    this.loadPromise = this.loadAssets();
    return this.loadPromise;
  }

  async loadAssets() {
    const records = new Map();
    for (const key of ['terrain', 'bg1', 'bg2']) {
      const record = this.manifest.images[key];
      if (record) records.set(record.file, record);
    }
    for (const sprite of Object.values(this.manifest.sprites)) {
      for (const frame of sprite.frames) records.set(frame.file, frame);
    }
    const queue = [...records.values()];
    let cursor = 0;
    // Bound browser image fetch/decode concurrency without serializing 594 PNGs.
    const worker = async () => {
      while (cursor < queue.length) {
        const record = queue[cursor++];
        const url = new URL(record.file, this.baseUrl).href;
        const image = await this.imageLoader(url, record);
        this.images.set(record.file, image);
      }
    };
    await Promise.all(Array.from({ length: Math.min(16, queue.length) }, worker));
    if (!this.groundRenderer) {
      this.groundRenderer = new GroundWebGLRenderer({
        width: BATTLEFIELD_WIDTH,
        height: BATTLEFIELD_HEIGHT,
        canvasFactory: this.canvasFactory,
      });
    }
    this.loaded = true;
    return this;
  }

  spriteSurface(selection) {
    const { key, sprite, frame } = selection;
    const cacheKey = `${key}:${frame.index}`;
    if (this.surfaces.has(cacheKey)) return this.surfaces.get(cacheKey);
    const placement = spriteRasterPlacement(sprite, frame);
    const surface = this.canvasFactory(placement.width, placement.height);
    surface.width = placement.width;
    surface.height = placement.height;
    const context = surface.getContext('2d');
    if (!context) throw new Error('Could not create a sprite rasterization canvas');
    context.imageSmoothingEnabled = true; // Original BitmapData.draw(..., true).
    context.clearRect(0, 0, placement.width, placement.height);
    context.drawImage(this.images.get(frame.file), placement.x, placement.y,
      placement.imageWidth, placement.imageHeight);
    const result = { surface, offX: placement.offX, offY: placement.offY };
    this.surfaces.set(cacheKey, result);
    return result;
  }

  drawBackground(layer) {
    const record = this.manifest.images[layer.key];
    if (!record) return;
    const context = this.context;
    if (!this.patterns.has(layer.key)) {
      const pattern = context.createPattern(this.images.get(record.file), 'repeat');
      if (!pattern) throw new Error(`Could not create original ${layer.key} bitmap fill`);
      this.patterns.set(layer.key, pattern);
    }
    const { rect, matrix } = layer;
    context.save();
    try {
      context.beginPath();
      context.rect(rect.x, rect.y, rect.width, rect.height);
      context.clip();
      context.translate(matrix.tx, matrix.ty);
      context.imageSmoothingEnabled = false; // beginBitmapFill smooth defaults false.
      context.fillStyle = this.patterns.get(layer.key);
      context.fillRect(rect.x - matrix.tx, rect.y - matrix.ty, rect.width, rect.height);
    } finally {
      context.restore();
    }
  }

  render(snapshot, camera, { clear = true } = {}) {
    if (!this.loaded) throw new Error('Call and await BattlefieldRenderer.load() before rendering');
    if (!Array.isArray(snapshot)) throw new TypeError('renderSnapshot must be an array');
    const context = this.context;
    const stats = { spritesDrawn: 0, hidden: 0, emptySymbols: 0,
      missingSprites: [], zeroScale: 0, unsupportedCoordinates: 0 };
    context.save();
    try {
      context.beginPath();
      context.rect(0, 0, BATTLEFIELD_WIDTH, BATTLEFIELD_HEIGHT);
      context.clip();
      if (clear) context.clearRect(0, 0, BATTLEFIELD_WIDTH, BATTLEFIELD_HEIGHT);
      const grounds = groundPainterOrder(this.groundTiles).map(vectors => projectGround(vectors, camera));
      const terrain = this.images.get(this.manifest.images.terrain.file);
      context.drawImage(this.groundRenderer.draw(terrain, grounds), 0, 0);
      stats.ground = this.groundRenderer.lastDrawStats ?? null;
      for (const layer of backgroundLayers(camera, {
        bg1: Boolean(this.manifest.images.bg1), bg2: Boolean(this.manifest.images.bg2),
      })) this.drawBackground(layer);
      for (const entity of snapshot) {
        if (entity.visible === false) { stats.hidden += 1; continue; }
        const key = spriteKeyFor(entity);
        if (!key || entity.displayFrame == null) { stats.emptySymbols += 1; continue; }
        const selection = resolveSpriteFrame(entity, this.manifest);
        if (!selection) { stats.missingSprites.push({ uid: entity.uid, key, frame: entity.displayFrame }); continue; }
        const projected = projectSymbol(entity, camera);
        if (![projected.x, projected.y, projected.scaleX, projected.scaleY].every(Number.isFinite)) {
          stats.unsupportedCoordinates += 1;
          continue;
        }
        if (projected.scaleX === 0 || projected.scaleY === 0) { stats.zeroScale += 1; continue; }
        const bitmap = this.spriteSurface(selection);
        context.save();
        try {
          context.translate(projected.x, projected.y);
          context.scale(projected.scaleX, projected.scaleY);
          context.imageSmoothingEnabled = false; // Symbol.canvas is a default Bitmap.
          context.drawImage(bitmap.surface, bitmap.offX, bitmap.offY);
        } finally {
          context.restore();
        }
        stats.spritesDrawn += 1;
      }
    } finally {
      context.restore();
    }
    this.lastRenderStats = stats;
    return stats;
  }

  dispose() {
    this.groundRenderer?.dispose?.();
    this.images.clear();
    this.surfaces.clear();
    this.patterns.clear();
    this.loaded = false;
    this.loadPromise = null;
  }
}
