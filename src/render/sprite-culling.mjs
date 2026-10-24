import { sourceEffectLayout } from './source-effects.mjs';

/**
 * Bound the pixels submitted by drawSourceEffect, not the sprite's logical
 * foot point. Intersect both original clips with the transformed source image.
 * This metadata-only result is cached per asset frame by the renderer.
 */
export function sourceEffectDrawBounds(sprite, record, image) {
  const layout = sourceEffectLayout(sprite, record);
  if (layout.empty) return null;
  const raster = layout.rasterClip, shape = layout.shapeClip;
  let left = Math.max(raster.x, shape.x), top = Math.max(raster.y, shape.y);
  let right = Math.min(raster.x + raster.width, shape.x + shape.width);
  let bottom = Math.min(raster.y + raster.height, shape.y + shape.height);
  const [a, b, c, d, tx, ty] = layout.matrix;
  const width = image?.naturalWidth ?? image?.width ?? record.width;
  const height = image?.naturalHeight ?? image?.height ?? record.height;
  const x = [tx, tx + a * width, tx + c * height, tx + a * width + c * height];
  const y = [ty, ty + b * width, ty + d * height, ty + b * width + d * height];
  // Finite metadata can still overflow when multiplied. In that case retain
  // the original clip bounds instead of risking a false-negative cull.
  if (x.every(Number.isFinite) && y.every(Number.isFinite)) {
    left = Math.max(left, Math.min(...x)); right = Math.min(right, Math.max(...x));
    top = Math.max(top, Math.min(...y)); bottom = Math.min(bottom, Math.max(...y));
  }
  return { x: left, y: top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
}

/**
 * Conservative post-projection rejection against the same logical clip that
 * the Canvas renderer uses. Signed scales preserve mirroring. Keep one backing
 * pixel outside every edge for sampling/antialiasing; never round coordinates.
 * Overflow/unknown geometry is deliberately drawn, not guessed to be invisible.
 */
export function projectedRectangleOutside(projected, rect, width, height, marginX = 1, marginY = marginX) {
  const dx0 = projected.scaleX * rect.x, dx1 = projected.scaleX * (rect.x + rect.width);
  const dy0 = projected.scaleY * rect.y, dy1 = projected.scaleY * (rect.y + rect.height);
  const x0 = projected.x + dx0, x1 = projected.x + dx1;
  const y0 = projected.y + dy0, y1 = projected.y + dy1;
  if (!Number.isFinite(x0) || !Number.isFinite(x1) || !Number.isFinite(y0) || !Number.isFinite(y1)) return false;
  // Canvas transform composition/backends can round to float32. A gigantic
  // translation canceled by a gigantic signed scale needs a relative reserve,
  // not just one pixel calculated using JS doubles. Keep uncertain edge cases.
  const reserveX = marginX + (Math.abs(projected.x) + Math.max(Math.abs(dx0), Math.abs(dx1))) * 2 ** -20;
  const reserveY = marginY + (Math.abs(projected.y) + Math.max(Math.abs(dy0), Math.abs(dy1))) * 2 ** -20;
  return Math.max(x0, x1) < -reserveX || Math.min(x0, x1) > width + reserveX
    || Math.max(y0, y1) < -reserveY || Math.min(y0, y1) > height + reserveY;
}
