/**
 * One-entry presentation cache for a stationary, already-projected ground.
 *
 * The renderer owns the exact revision key, including source-image identity.
 * This helper never inspects, quantizes, or changes camera / world geometry.
 * A cache miss paints WebGL once and copies that completed result into one
 * owned Canvas2D surface; hits reuse that surface without GPU repaint/readback.
 * The returned surface is read-only to callers: composite it, do not modify it.
 */

function browserCanvas(width, height) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height);
  if (typeof document !== 'undefined') return document.createElement('canvas');
  throw new Error('GroundLayerCache requires a browser canvas or canvasFactory.');
}

export class GroundLayerCache {
  #surface;
  #context;
  #key;
  #valid = false;
  #painting = false;
  #disposed = false;

  constructor({ width = 640, height = 400, canvasFactory = browserCanvas } = {}) {
    if (![width, height].every(value => Number.isInteger(value) && value > 0)) {
      throw new RangeError('Ground cache dimensions must be positive integers.');
    }
    if (typeof canvasFactory !== 'function') throw new TypeError('canvasFactory must be a function.');
    Object.defineProperties(this, {
      width: { value: width, enumerable: true },
      height: { value: height, enumerable: true },
    });
    this.#surface = canvasFactory(width, height);
    if (!this.#surface || typeof this.#surface.getContext !== 'function') {
      throw new TypeError('canvasFactory must return a Canvas2D-capable surface.');
    }
    this.#surface.width = width;
    this.#surface.height = height;
    this.#context = this.#surface.getContext('2d');
    if (!this.#context) throw new Error('Could not create the ground cache Canvas2D context.');
  }

  /**
   * Exact key equality only. paint() must synchronously return a different
   * canvas with these exact dimensions. The key commits only after its copy
   * succeeds; paint/copy failures invalidate the previous entry.
   */
  get(key, paint) {
    if (this.#disposed) throw new Error('GroundLayerCache has been disposed.');
    if (typeof key !== 'string') throw new TypeError('Ground cache key must be an exact revision string.');
    if (typeof paint !== 'function') throw new TypeError('Ground cache paint must be a function.');
    if (this.#painting) throw new Error('Reentrant ground cache painting is unsupported.');
    if (this.#valid && this.#key === key) return { surface: this.#surface, hit: true };

    this.#valid = false;
    this.#key = undefined;
    this.#painting = true;
    try {
      const source = paint();
      if (!source || typeof source !== 'object' || typeof source.then === 'function') {
        throw new TypeError('Ground cache paint must synchronously return a canvas.');
      }
      if (source === this.#surface) throw new TypeError('Ground cache paint cannot return the cache surface itself.');
      if (source.width !== this.width || source.height !== this.height) {
        throw new RangeError(`Ground cache source must be exactly ${this.width}×${this.height}; no resampling is applied.`);
      }
      const context = this.#context;
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.globalAlpha = 1;
      context.globalCompositeOperation = 'source-over';
      context.imageSmoothingEnabled = false;
      context.clearRect(0, 0, this.width, this.height);
      context.drawImage(source, 0, 0);
      this.#key = key;
      this.#valid = true;
      return { surface: this.#surface, hit: false };
    } finally {
      this.#painting = false;
    }
  }

  /** Mark the one entry dirty without painting, copying, or allocating. */
  invalidate() {
    this.#valid = false;
    this.#key = undefined;
  }

  /** The returned surfaces must no longer be used after disposal. */
  dispose() {
    if (this.#disposed) return;
    this.invalidate();
    this.#surface.width = 0;
    this.#surface.height = 0;
    this.#surface = null;
    this.#context = null;
    this.#disposed = true;
  }
}
