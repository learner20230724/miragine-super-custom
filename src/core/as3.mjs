/** AVM2 int conversion: truncate toward zero and wrap to signed 32 bits. */
export const as3int = value => Number(value) >> 0;

/** Tiny source-compatible vector; normalize intentionally does not guard zero. */
export class Vec2 {
  constructor(x = 0, y = 0) { this.x = x; this.y = y; }
  get length() { return Math.sqrt(this.x * this.x + this.y * this.y); }
  divided(value) { this.x /= value; this.y /= value; }
  normalize() { this.divided(this.length); }
  getDivided(value) { return value === 0 ? new Vec2() : new Vec2(this.x / value, this.y / value); }
  getUnit() { return this.getDivided(this.length); }
}

/** Reproducible optional test RNG; the faithful runtime defaults to Math.random. */
export function seededRandom(seed = 1) {
  let state = Number(seed) >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}
