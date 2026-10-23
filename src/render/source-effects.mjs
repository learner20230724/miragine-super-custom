/**
 * Display the retained high-density source bitmaps at the original logical size.
 * This is not super-resolution. No canvases, image copies, frame resampling,
 * simulation changes or inferred animation frames are created here.
 */

function finite(value, name) {
  if (!Number.isFinite(value)) throw new TypeError(`${name} must be finite`);
  return value;
}

/** Convert source bitmap → sprite coordinates into the original BitmapData box. */
export function sourceEffectLayout(sprite, record) {
  if (!record || typeof record !== 'object') throw new TypeError('A source-effect frame is required');
  if (record.empty === true) return { empty: true };
  if (!sprite?.bounds || !sprite?.rasterized) throw new TypeError('Original sprite raster metadata is required');
  const raster = sprite.rasterized, bounds = sprite.bounds;
  const scale = finite(raster.scale, 'raster scale');
  if (scale <= 0) throw new RangeError('Raster scale must be positive');
  for (const key of ['width', 'height']) {
    if (!Number.isInteger(raster[key]) || raster[key] <= 0) throw new RangeError(`Raster ${key} must be a positive integer`);
    if (!Number.isInteger(record[key]) || record[key] <= 0) throw new RangeError(`Source ${key} must be a positive integer`);
  }
  const offsetX = finite(raster.offX, 'raster offX') - finite(bounds.xMin, 'bounds xMin') * scale;
  const offsetY = finite(raster.offY, 'raster offY') - finite(bounds.yMin, 'bounds yMin') * scale;
  if (!Array.isArray(record.matrix) || record.matrix.length !== 6) throw new TypeError('A six-value bitmap matrix is required');
  const [a, b, c, d, tx, ty] = record.matrix.map(value => finite(value, 'bitmap matrix'));
  if (!record.clip) throw new TypeError('An original shape clip is required');
  const { xMin, yMin, xMax, yMax } = record.clip;
  for (const value of [xMin, yMin, xMax, yMax]) finite(value, 'shape clip');
  if (xMax <= xMin || yMax <= yMin) throw new RangeError('Original shape clip must be non-empty');
  return {
    empty: false,
    matrix: [a * scale, b * scale, c * scale, d * scale,
      tx * scale + offsetX, ty * scale + offsetY],
    rasterClip: { x: raster.offX, y: raster.offY, width: raster.width, height: raster.height },
    shapeClip: { x: xMin * scale + offsetX, y: yMin * scale + offsetY,
      width: (xMax - xMin) * scale, height: (yMax - yMin) * scale },
    smoothing: record.smoothing === true,
  };
}

/** Caller already applied the projected entity translation and signed scale. */
export function drawSourceEffect(context, image, sprite, record) {
  const layout = sourceEffectLayout(sprite, record);
  if (layout.empty) return false; // Source storm frame 10 is intentionally blank.
  if (!image) throw new TypeError('A loaded source-effect image is required');
  context.save();
  try {
    for (const clip of [layout.rasterClip, layout.shapeClip]) {
      context.beginPath();
      context.rect(clip.x, clip.y, clip.width, clip.height);
      context.clip();
    }
    context.transform(...layout.matrix);
    context.imageSmoothingEnabled = layout.smoothing;
    context.drawImage(image, 0, 0);
  } finally {
    context.restore();
  }
  return true;
}
