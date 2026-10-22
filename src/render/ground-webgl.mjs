/**
 * Native UVT ground backend for the recovered Flash drawTriangles inputs.
 *
 * Each projected vertex carries (u * t, v * t, t), where the source's t is
 * 600 / (600 + viewZ). All clip-space w values are 1; these three values are
 * therefore interpolated linearly in screen space and divided in the fragment
 * shader. An affine Canvas2D texture transform cannot reproduce this mapping.
 *
 * This module does not project, reorder, clip, or repair source geometry.
 * Caller supplies the original reverse ground order. Unsupported non-finite
 * geometry is counted and skipped, never clamped into a different scene.
 * GPU rasterization / nearest-sample boundary parity with Flash remains an
 * oracle gate, not an assertion of pixel identity.
 */

const FLOATS_PER_VERTEX = 5;
const BYTES_PER_VERTEX = FLOATS_PER_VERTEX * Float32Array.BYTES_PER_ELEMENT;

const VERTEX_SHADER = `
attribute vec2 a_position;
attribute vec3 a_uvt;
uniform vec2 u_resolution;
varying highp vec3 v_uvt;
void main() {
  vec2 clip = a_position / u_resolution * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
  v_uvt = a_uvt;
}
`;

const FRAGMENT_SHADER = `
precision highp float;
varying highp vec3 v_uvt;
uniform sampler2D u_image;
uniform bool u_repeat;
void main() {
  vec2 uv = v_uvt.xy / v_uvt.z;
  // WebGL1 cannot enable hardware REPEAT for the 8000 x 300 NPOT source.
  // Explicit wrapping keeps beginBitmapFill(repeat=true) without resampling.
  if (u_repeat) uv = fract(uv);
  gl_FragColor = texture2D(u_image, uv);
}
`;

function supportedNumber(value) {
  return Number.isFinite(value) && Number.isFinite(Math.fround(value));
}

/**
 * Pack four-vertex, six-index projectGround results without changing order.
 * Indices are offset per accepted tile. Non-drawable and unsupported tiles are
 * omitted; unsupportedTileIndices identifies only drawable but invalid input.
 */
export function buildGroundVertices(projectedGroundTiles = []) {
  const vertices = [];
  const indices = [];
  const unsupportedTileIndices = [];
  let tileCount = 0;
  let skippedTileCount = 0;

  for (const [tileIndex, tile] of Array.from(projectedGroundTiles).entries()) {
    if (!tile?.drawable) {
      skippedTileCount += 1;
      continue;
    }
    const positions = tile.vertices;
    const uvt = tile.uvtData;
    const sourceIndices = tile.indices;
    let valid = positions?.length === 8 && uvt?.length === 12 && sourceIndices?.length === 6;
    const packed = [];
    if (valid) {
      for (let vertex = 0; vertex < 4; vertex += 1) {
        const x = positions[vertex * 2];
        const y = positions[vertex * 2 + 1];
        const u = uvt[vertex * 3];
        const v = uvt[vertex * 3 + 1];
        const t = uvt[vertex * 3 + 2];
        const values = [x, y, u * t, v * t, t];
        if (!(Math.fround(t) > 0) || !supportedNumber(u) || !supportedNumber(v)
            || !values.every(supportedNumber)) {
          valid = false;
          break;
        }
        packed.push(...values);
      }
      valid = valid && Array.from(sourceIndices).every(index => Number.isInteger(index) && index >= 0 && index < 4);
    }
    if (!valid) {
      skippedTileCount += 1;
      unsupportedTileIndices.push(tileIndex);
      continue;
    }
    // WebGL1 core supports unsigned-short indices; never silently wrap them.
    if ((tileCount + 1) * 4 > 65536) {
      throw new RangeError('Ground batch exceeds the WebGL1 unsigned-short index capacity.');
    }
    const offset = tileCount * 4;
    vertices.push(...packed);
    for (const index of sourceIndices) indices.push(index + offset);
    tileCount += 1;
  }

  return {
    vertices: new Float32Array(vertices),
    indices: new Uint16Array(indices),
    tileCount,
    skippedTileCount,
    unsupportedTileIndices,
  };
}

/** Pure reference for the shader's perspective-correct barycentric UV lookup. */
export function uvAtBarycentric(uvtData, weights, vertexIndices = [0, 1, 2]) {
  if (weights?.length !== 3 || vertexIndices?.length !== 3) {
    throw new TypeError('Three barycentric weights and three vertex indices are required.');
  }
  let u = 0;
  let v = 0;
  let t = 0;
  for (let index = 0; index < 3; index += 1) {
    const vertex = vertexIndices[index];
    const weight = weights[index];
    if (!Number.isInteger(vertex) || vertex < 0 || vertex * 3 + 2 >= uvtData.length
        || !Number.isFinite(weight)) {
      throw new TypeError('Invalid UVT vertex index or barycentric weight.');
    }
    const vertexU = uvtData[vertex * 3];
    const vertexV = uvtData[vertex * 3 + 1];
    const vertexT = uvtData[vertex * 3 + 2];
    if (![vertexU, vertexV, vertexT].every(Number.isFinite)) {
      throw new RangeError('Perspective lookup requires finite UVT data.');
    }
    u += weight * vertexU * vertexT;
    v += weight * vertexV * vertexT;
    t += weight * vertexT;
  }
  if (t === 0 || ![u, v, t].every(Number.isFinite)) {
    throw new RangeError('Perspective lookup has no finite nonzero denominator.');
  }
  const result = [u / t, v / t];
  if (!result.every(Number.isFinite)) {
    throw new RangeError('Perspective lookup produced unsupported non-finite UV coordinates.');
  }
  return result;
}

function defaultCanvasFactory(width, height) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height);
  if (typeof document !== 'undefined') return document.createElement('canvas');
  throw new Error('Ground rendering requires an OffscreenCanvas or a browser canvas.');
}

function compileShader(gl, type, source) {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('Unable to allocate the ground WebGL shader.');
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(shader) || 'unknown shader compile error';
    gl.deleteShader(shader);
    throw new Error(`Ground WebGL shader compilation failed: ${message}`);
  }
  return shader;
}

function createProgram(gl) {
  const shaders = [];
  let program;
  try {
    shaders.push(compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER));
    shaders.push(compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER));
    program = gl.createProgram();
    if (!program) throw new Error('Unable to allocate the ground WebGL program.');
    for (const shader of shaders) gl.attachShader(program, shader);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(`Ground WebGL program linking failed: ${gl.getProgramInfoLog(program) || 'unknown link error'}`);
    }
    return program;
  } catch (error) {
    if (program) gl.deleteProgram(program);
    throw error;
  } finally {
    for (const shader of shaders) gl.deleteShader(shader);
  }
}

function imageSize(image) {
  if (!image) throw new TypeError('A loaded ground image is required.');
  if (image.complete === false) throw new Error('The ground image has not finished loading.');
  const width = image.naturalWidth ?? image.videoWidth ?? image.width;
  const height = image.naturalHeight ?? image.videoHeight ?? image.height;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new Error('The ground image must have positive integer dimensions.');
  }
  return { width, height };
}

/**
 * Owns one transparent logical ground canvas. Composite its returned canvas at
 * (0, 0), before the original background strips and display-list children.
 * canvasFactory(width, height) is injectable for browser / unit-test adapters.
 */
export class GroundWebGLRenderer {
  constructor({
    width = 640,
    height = 400,
    canvasFactory = defaultCanvasFactory,
    contextAttributes = {},
    repeat = true,
    smoothing = false,
  } = {}) {
    if (![width, height].every(value => Number.isInteger(value) && value > 0)) {
      throw new RangeError('Ground canvas dimensions must be positive integers.');
    }
    this.width = width;
    this.height = height;
    this.repeat = Boolean(repeat);
    this.smoothing = Boolean(smoothing);
    this.canvas = canvasFactory(width, height);
    this.canvas.width = width;
    this.canvas.height = height;
    this.gl = this.canvas.getContext('webgl', {
      ...contextAttributes,
      alpha: true,
      premultipliedAlpha: true,
      antialias: false,
      depth: false,
      stencil: false,
      preserveDrawingBuffer: true,
    });
    if (!this.gl) throw new Error('WebGL1 is unavailable; the faithful UVT ground renderer cannot start.');
    const gl = this.gl;
    this.maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE);
    this.program = createProgram(gl);
    this.vertexBuffer = gl.createBuffer();
    this.indexBuffer = gl.createBuffer();
    this.texture = gl.createTexture();
    if (!this.vertexBuffer || !this.indexBuffer || !this.texture) {
      this.dispose();
      throw new Error('Unable to allocate ground WebGL buffers or texture.');
    }
    this.locations = {
      position: gl.getAttribLocation(this.program, 'a_position'),
      uvt: gl.getAttribLocation(this.program, 'a_uvt'),
      resolution: gl.getUniformLocation(this.program, 'u_resolution'),
      image: gl.getUniformLocation(this.program, 'u_image'),
      repeat: gl.getUniformLocation(this.program, 'u_repeat'),
    };
    this.lastDrawStats = {
      tileCount: 0, skippedTileCount: 0, unsupportedTileIndices: [], triangleCount: 0,
    };
    this.image = null;
    this.imageWidth = 0;
    this.imageHeight = 0;
    this.disposed = false;
  }

  /** Call after mutating an already-uploaded canvas / video image in place. */
  invalidateTexture() {
    this.image = null;
  }

  uploadImage(image) {
    const { width, height } = imageSize(image);
    if (width > this.maxTextureSize || height > this.maxTextureSize) {
      throw new RangeError(`Original ground texture ${width}×${height} exceeds this GPU's MAX_TEXTURE_SIZE=${this.maxTextureSize}; no resampling was applied.`);
    }
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    const filter = this.smoothing ? gl.LINEAR : gl.NEAREST;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    // CLAMP is complete for NPOT images; source repeat is explicit in shader.
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    // Geometry and UVs both use top-left origin; do not invert the image again.
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
    this.image = image;
    this.imageWidth = width;
    this.imageHeight = height;
  }

  draw(image, projectedGroundTiles) {
    if (this.disposed) throw new Error('The ground renderer has been disposed.');
    const gl = this.gl;
    if (typeof gl.isContextLost === 'function' && gl.isContextLost()) {
      throw new Error('The ground WebGL context was lost; recreate the renderer to restore it.');
    }
    const batch = buildGroundVertices(projectedGroundTiles);
    this.lastDrawStats = {
      tileCount: batch.tileCount,
      skippedTileCount: batch.skippedTileCount,
      unsupportedTileIndices: [...batch.unsupportedTileIndices],
      triangleCount: batch.indices.length / 3,
    };
    gl.viewport(0, 0, this.width, this.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (batch.indices.length === 0) return this.canvas;
    const size = imageSize(image);
    if (this.image !== image || this.imageWidth !== size.width || this.imageHeight !== size.height) {
      this.uploadImage(image);
    }
    gl.useProgram(this.program);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, batch.vertices, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(this.locations.position);
    gl.vertexAttribPointer(this.locations.position, 2, gl.FLOAT, false, BYTES_PER_VERTEX, 0);
    gl.enableVertexAttribArray(this.locations.uvt);
    gl.vertexAttribPointer(this.locations.uvt, 3, gl.FLOAT, false, BYTES_PER_VERTEX, 2 * Float32Array.BYTES_PER_ELEMENT);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, batch.indices, gl.DYNAMIC_DRAW);
    gl.uniform2f(this.locations.resolution, this.width, this.height);
    gl.uniform1i(this.locations.image, 0);
    gl.uniform1i(this.locations.repeat, this.repeat ? 1 : 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.drawElements(gl.TRIANGLES, batch.indices.length, gl.UNSIGNED_SHORT, 0);
    return this.canvas;
  }

  dispose() {
    const gl = this.gl;
    if (gl) {
      if (this.vertexBuffer) gl.deleteBuffer(this.vertexBuffer);
      if (this.indexBuffer) gl.deleteBuffer(this.indexBuffer);
      if (this.texture) gl.deleteTexture(this.texture);
      if (this.program) gl.deleteProgram(this.program);
    }
    this.vertexBuffer = null;
    this.indexBuffer = null;
    this.texture = null;
    this.program = null;
    this.disposed = true;
  }
}
