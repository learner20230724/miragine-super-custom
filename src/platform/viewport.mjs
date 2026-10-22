/**
 * Pure viewport geometry for the original 640 × 480 game stage.
 *
 * All pointer and layout values are CSS pixels, never backing-store pixels.
 * Canvas backing-store dimensions are rounded separately for high-DPI displays.
 * Rendering must use pixelScaleX / pixelScaleY when drawing game coordinates
 * into that backing store; do not multiply pointer coordinates by the DPR.
 */

function finiteNumber(value, name) {
  if (typeof value !== 'number') {
    throw new TypeError(`${name} must be a number`);
  }
  if (!Number.isFinite(value)) {
    throw new RangeError(`${name} must be finite`);
  }
  return value;
}

function positiveNumber(value, name) {
  finiteNumber(value, name);
  if (value <= 0) {
    throw new RangeError(`${name} must be greater than zero`);
  }
  return value;
}

function backingDimension(cssSize, devicePixelRatio) {
  const pixels = Math.max(1, Math.round(cssSize * devicePixelRatio));
  if (!Number.isSafeInteger(pixels)) {
    throw new RangeError('backing-store dimension exceeds safe integer precision');
  }
  return pixels;
}

/**
 * Calculate integer canvas width/height attributes from positive CSS dimensions.
 * Rounding is nearest-integer (Math.round), with at least one physical pixel.
 * No browser-specific canvas size limit is imposed by this geometry module.
 */
export function backingStoreSize(width, height, devicePixelRatio = 1) {
  positiveNumber(width, 'width');
  positiveNumber(height, 'height');
  positiveNumber(devicePixelRatio, 'devicePixelRatio');
  return Object.freeze({
    width: backingDimension(width, devicePixelRatio),
    height: backingDimension(height, devicePixelRatio),
    devicePixelRatio,
  });
}

/**
 * Fit and center a game stage inside the available CSS viewport, without crop.
 *
 * left/top/right/bottom are relative to that viewport. clientLeft/clientTop are
 * its optional browser-client origin (for example a containing element's
 * getBoundingClientRect().left/top). Pass a fresh fit after resize or scrolling.
 *
 * Set the canvas CSS dimensions to width/height and its integer attributes to
 * backingWidth/backingHeight. Use the actual rounded pixelScaleX/pixelScaleY
 * rather than scale * devicePixelRatio for a precise drawing transform.
 *
 * Zero-sized/hidden viewports and unrepresentable dimensions throw RangeError;
 * a platform adapter should skip rendering and input until layout is positive.
 */
export function fitViewport(viewportWidth, viewportHeight, options = {}) {
  positiveNumber(viewportWidth, 'viewportWidth');
  positiveNumber(viewportHeight, 'viewportHeight');
  if (options === null || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError('options must be an object');
  }
  const {
    gameWidth = 640,
    gameHeight = 480,
    devicePixelRatio = 1,
    clientLeft = 0,
    clientTop = 0,
  } = options;
  positiveNumber(gameWidth, 'gameWidth');
  positiveNumber(gameHeight, 'gameHeight');
  positiveNumber(devicePixelRatio, 'devicePixelRatio');
  finiteNumber(clientLeft, 'clientLeft');
  finiteNumber(clientTop, 'clientTop');

  const widthScale = viewportWidth / gameWidth;
  const heightScale = viewportHeight / gameHeight;
  const scale = Math.min(widthScale, heightScale);
  positiveNumber(scale, 'computed scale');

  // Use the exact limiting dimension to avoid creating a fractional gap there.
  const width = widthScale <= heightScale ? viewportWidth : gameWidth * scale;
  const height = widthScale <= heightScale ? gameHeight * scale : viewportHeight;
  positiveNumber(width, 'computed width');
  positiveNumber(height, 'computed height');
  const left = (viewportWidth - width) / 2;
  const top = (viewportHeight - height) / 2;
  const backing = backingStoreSize(width, height, devicePixelRatio);

  return Object.freeze({
    viewportWidth,
    viewportHeight,
    gameWidth,
    gameHeight,
    scale,
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    clientLeft,
    clientTop,
    devicePixelRatio,
    backingWidth: backing.width,
    backingHeight: backing.height,
    pixelScaleX: backing.width / gameWidth,
    pixelScaleY: backing.height / gameHeight,
  });
}

function validateFit(viewport) {
  if (viewport === null || typeof viewport !== 'object') {
    throw new TypeError('viewport must be a fitViewport result');
  }
  for (const key of ['width', 'height', 'gameWidth', 'gameHeight']) {
    positiveNumber(viewport[key], `viewport.${key}`);
  }
  for (const key of ['left', 'top', 'clientLeft', 'clientTop']) {
    finiteNumber(viewport[key], `viewport.${key}`);
  }
}

/**
 * Convert PointerEvent.clientX/clientY to continuous game-stage coordinates.
 * Returns null for black bars or any other point outside the stage. No clamping
 * occurs: an outside click must never turn into a click on an edge button.
 *
 * Hit bounds are half-open: left/top inclusive, right/bottom exclusive. This
 * also matches game coordinates [0, gameWidth) × [0, gameHeight). Returned
 * coordinates retain fractional precision; the game owns any pixel rounding.
 */
export function clientToGame(clientX, clientY, viewport) {
  finiteNumber(clientX, 'clientX');
  finiteNumber(clientY, 'clientY');
  validateFit(viewport);
  // Combine the origin in the same order as gameToClient. Subtracting its two
  // terms separately can turn the exact top-left point into a tiny negative
  // number when the containing element or fitted bars have fractional offsets.
  const originX = viewport.clientLeft + viewport.left;
  const originY = viewport.clientTop + viewport.top;
  if (clientX < originX || clientY < originY
      || clientX >= originX + viewport.width || clientY >= originY + viewport.height) {
    return null;
  }
  const x = clientX - originX;
  const y = clientY - originY;
  return {
    x: (x / viewport.width) * viewport.gameWidth,
    y: (y / viewport.height) * viewport.gameHeight,
  };
}

/**
 * Convert a game-stage point to browser-client CSS pixels. Returns null outside
 * the same half-open game bounds as clientToGame. For rectangle geometry at an
 * excluded right/bottom boundary, use the viewport.right/bottom fields instead.
 */
export function gameToClient(gameX, gameY, viewport) {
  finiteNumber(gameX, 'gameX');
  finiteNumber(gameY, 'gameY');
  validateFit(viewport);
  if (gameX < 0 || gameY < 0 || gameX >= viewport.gameWidth || gameY >= viewport.gameHeight) {
    return null;
  }
  return {
    x: viewport.clientLeft + viewport.left + (gameX / viewport.gameWidth) * viewport.width,
    y: viewport.clientTop + viewport.top + (gameY / viewport.gameHeight) * viewport.height,
  };
}
