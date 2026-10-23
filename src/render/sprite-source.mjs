/**
 * A preserved PNG already has its exported frame bounds translated to (0,0).
 * Restore the original sheet's fixed 0.9-scale BitmapData rectangle. Width,
 * height and offsets retain the manifest's AS3-int truncation; this is still
 * an FFDec extent proxy, not a claim of Flash getRect/pixel parity.
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
 * Draw the unchanged PNG straight into the final logical destination instead
 * of shrinking it into another Canvas first. Clip in source coordinates so
 * the old BitmapData's integer extents and the sheet's foot anchor survive.
 * Fractional source coordinates are deliberate: rounding here shifts frames.
 * The caller owns projection/mirroring and may choose its sampling filter.
 */
export function spriteSourcePlacement(sprite, frame) {
  const placement = spriteRasterPlacement(sprite, frame);
  const scale = sprite.rasterized.scale;
  const left = Math.max(0, -placement.x);
  const top = Math.max(0, -placement.y);
  const right = Math.min(placement.imageWidth, placement.width - placement.x);
  const bottom = Math.min(placement.imageHeight, placement.height - placement.y);
  if (right <= left || bottom <= top) return null;
  return {
    sourceX: left / scale,
    sourceY: top / scale,
    sourceWidth: (right - left) / scale,
    sourceHeight: (bottom - top) / scale,
    x: placement.offX + placement.x + left,
    y: placement.offY + placement.y + top,
    width: right - left,
    height: bottom - top,
  };
}
