import assert from 'node:assert/strict';
import test from 'node:test';
import {
  GroundWebGLRenderer,
  buildGroundVertices,
  uvAtBarycentric,
} from '../src/render/ground-webgl.mjs';

function ground(x = 0) {
  return {
    drawable: true,
    vertices: [x, 0, x + 100, 0, x + 150, 80, x - 50, 80],
    indices: [0, 1, 3, 1, 2, 3],
    uvtData: [0, 0, 1, 1, 0, 1, 1, 1, 2, 0, 1, 2],
  };
}

function close(actual, expected, tolerance = 1e-12) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} ≈ ${expected}`);
}

function contextStub({ maxTextureSize = 16384, compile = true, link = true } = {}) {
  const calls = [];
  const gl = {};
  const constants = [
    'VERTEX_SHADER', 'FRAGMENT_SHADER', 'COMPILE_STATUS', 'LINK_STATUS', 'MAX_TEXTURE_SIZE',
    'TEXTURE0', 'TEXTURE_2D', 'TEXTURE_MIN_FILTER', 'TEXTURE_MAG_FILTER', 'NEAREST', 'LINEAR',
    'TEXTURE_WRAP_S', 'TEXTURE_WRAP_T', 'CLAMP_TO_EDGE', 'UNPACK_FLIP_Y_WEBGL',
    'UNPACK_PREMULTIPLY_ALPHA_WEBGL', 'RGBA', 'UNSIGNED_BYTE', 'COLOR_BUFFER_BIT',
    'DEPTH_TEST', 'CULL_FACE', 'BLEND', 'ONE', 'ONE_MINUS_SRC_ALPHA', 'ARRAY_BUFFER',
    'DYNAMIC_DRAW', 'FLOAT', 'ELEMENT_ARRAY_BUFFER', 'TRIANGLES', 'UNSIGNED_SHORT',
  ];
  for (const [index, name] of constants.entries()) gl[name] = index + 1;
  let id = 0;
  for (const name of ['createShader', 'createProgram', 'createBuffer', 'createTexture']) {
    gl[name] = (...args) => {
      const value = { type: name, id: ++id };
      calls.push([name, ...args, value]);
      return value;
    };
  }
  for (const name of [
    'shaderSource', 'compileShader', 'deleteShader', 'attachShader', 'linkProgram',
    'deleteProgram', 'activeTexture', 'bindTexture', 'texParameteri', 'pixelStorei',
    'texImage2D', 'viewport', 'clearColor', 'clear', 'useProgram', 'disable', 'enable',
    'blendFunc', 'bindBuffer', 'bufferData', 'enableVertexAttribArray',
    'vertexAttribPointer', 'uniform2f', 'uniform1i', 'drawElements', 'deleteBuffer',
    'deleteTexture',
  ]) gl[name] = (...args) => calls.push([name, ...args]);
  gl.getShaderParameter = () => compile;
  gl.getShaderInfoLog = () => 'test shader failure';
  gl.getProgramParameter = () => link;
  gl.getProgramInfoLog = () => 'test program failure';
  gl.getParameter = parameter => parameter === gl.MAX_TEXTURE_SIZE ? maxTextureSize : undefined;
  gl.getAttribLocation = (_program, name) => name === 'a_position' ? 0 : 1;
  gl.getUniformLocation = (_program, name) => name;
  gl.isContextLost = () => false;
  const canvas = {
    width: 0,
    height: 0,
    getContext: (...args) => {
      calls.push(['getContext', ...args]);
      return gl;
    },
  };
  return { gl, canvas, calls, canvasFactory: () => canvas };
}

test('ground buffer packs UV times perspective, not affine UV, with original winding', () => {
  const tile = ground();
  const before = structuredClone(tile);
  const result = buildGroundVertices([tile]);
  assert.ok(result.vertices instanceof Float32Array);
  assert.ok(result.indices instanceof Uint16Array);
  assert.deepEqual([...result.vertices], [
    0, 0, 0, 0, 1,
    100, 0, 1, 0, 1,
    150, 80, 2, 2, 2,
    -50, 80, 0, 2, 2,
  ]);
  assert.deepEqual([...result.indices], [0, 1, 3, 1, 2, 3]);
  assert.equal(result.tileCount, 1);
  assert.equal(result.skippedTileCount, 0);
  assert.deepEqual(tile, before);
});

test('ground batches preserve caller order and offset accepted tile indices', () => {
  const result = buildGroundVertices([ground(1000), { ...ground(), drawable: false }, ground(0)]);
  assert.equal(result.vertices[0], 1000);
  assert.equal(result.vertices[20], 0);
  assert.deepEqual([...result.indices], [0, 1, 3, 1, 2, 3, 4, 5, 7, 5, 6, 7]);
  assert.equal(result.tileCount, 2);
  assert.equal(result.skippedTileCount, 1);
  assert.deepEqual(result.unsupportedTileIndices, []);
});

test('backend explicitly counts source focal-plane Infinity without repairing geometry', () => {
  const focalTile = ground();
  focalTile.vertices[2] = Infinity;
  focalTile.uvtData[5] = Infinity;
  const result = buildGroundVertices([ground(), focalTile]);
  assert.equal(result.tileCount, 1);
  assert.equal(result.skippedTileCount, 1);
  assert.deepEqual(result.unsupportedTileIndices, [1]);
  assert.equal(focalTile.vertices[2], Infinity);
  assert.equal(focalTile.uvtData[5], Infinity);
});

test('malformed, non-finite, zero-t, and GPU float-overflow tiles are not submitted', () => {
  const zero = ground();
  zero.uvtData[2] = 0;
  const nan = ground();
  nan.uvtData[0] = NaN;
  const overflow = ground();
  overflow.vertices[0] = 1e100;
  const underflow = ground();
  underflow.uvtData[2] = 1e-100;
  const badIndex = { ...ground(), indices: [0, 1, 4, 1, 2, 3] };
  const short = { ...ground(), vertices: [1, 2] };
  const result = buildGroundVertices([zero, nan, overflow, badIndex, short, underflow]);
  assert.equal(result.vertices.length, 0);
  assert.equal(result.indices.length, 0);
  assert.equal(result.skippedTileCount, 6);
  assert.deepEqual(result.unsupportedTileIndices, [0, 1, 2, 3, 4, 5]);
});

test('UVT reference divides interpolated weighted UV by interpolated t', () => {
  const uvt = [0, 0, 1, 1, 0, 2, 0, 1, 4];
  const uv = uvAtBarycentric(uvt, [0.25, 0.25, 0.5]);
  close(uv[0], 2 / 11);
  close(uv[1], 8 / 11);
  assert.notDeepEqual(uv, [0.25, 0.5]);
});

test('UVT reference agrees with affine interpolation only when t is constant', () => {
  const uvt = [0, 0, 2, 1, 0, 2, 1, 1, 2, 0, 1, 2];
  assert.deepEqual(uvAtBarycentric(uvt, [0.25, 0.25, 0.5], [0, 1, 3]), [0.25, 0.5]);
});

test('UVT reference rejects invalid inputs and a zero denominator', () => {
  assert.throws(() => uvAtBarycentric([0, 0, 1], [1, 0]), /Three barycentric/);
  assert.throws(() => uvAtBarycentric([0, 0, 1], [1, 0, 0]), /Invalid UVT vertex/);
  assert.throws(() => uvAtBarycentric([0, 0, 0, 1, 0, 0, 0, 1, 0], [1, 0, 0]), /nonzero denominator/);
  assert.throws(() => uvAtBarycentric([0, 0, Infinity, 1, 0, 1, 0, 1, 1], [1, 0, 0]), /finite UVT/);
});

test('renderer compiles genuine UVT division shaders and requests transparent WebGL1', () => {
  const fixture = contextStub();
  const renderer = new GroundWebGLRenderer({ canvasFactory: fixture.canvasFactory });
  const context = fixture.calls.find(call => call[0] === 'getContext');
  assert.equal(context[1], 'webgl');
  assert.equal(context[2].alpha, true);
  assert.equal(context[2].premultipliedAlpha, true);
  assert.equal(context[2].antialias, false);
  assert.equal(fixture.canvas.width, 640);
  assert.equal(fixture.canvas.height, 400);
  const sources = fixture.calls.filter(call => call[0] === 'shaderSource').map(call => call[2]);
  assert.match(sources[0], /gl_Position = vec4\(clip\.x, -clip\.y, 0\.0, 1\.0\)/);
  assert.match(sources[1], /v_uvt\.xy \/ v_uvt\.z/);
  assert.match(sources[1], /fract\(uv\)/);
  renderer.dispose();
});

test('one indexed draw preserves painter order, top-left sampling, and premultiplied alpha', () => {
  const fixture = contextStub();
  const renderer = new GroundWebGLRenderer({ canvasFactory: fixture.canvasFactory });
  const { gl, calls } = fixture;
  const image = { width: 8000, height: 300 };
  assert.equal(renderer.draw(image, [ground(1000), ground(0)]), fixture.canvas);
  assert.deepEqual(calls.find(call => call[0] === 'clearColor'), ['clearColor', 0, 0, 0, 0]);
  assert.deepEqual(calls.find(call => call[0] === 'drawElements'), ['drawElements', gl.TRIANGLES, 12, gl.UNSIGNED_SHORT, 0]);
  assert.deepEqual(calls.find(call => call[0] === 'blendFunc'), ['blendFunc', gl.ONE, gl.ONE_MINUS_SRC_ALPHA]);
  assert.ok(calls.some(call => call[0] === 'disable' && call[1] === gl.DEPTH_TEST));
  assert.ok(calls.some(call => call[0] === 'disable' && call[1] === gl.CULL_FACE));
  assert.ok(calls.some(call => call[0] === 'pixelStorei' && call[1] === gl.UNPACK_FLIP_Y_WEBGL && call[2] === false));
  assert.ok(calls.some(call => call[0] === 'pixelStorei' && call[1] === gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL && call[2] === true));
  assert.equal(renderer.lastDrawStats.tileCount, 2);
  assert.equal(renderer.lastDrawStats.triangleCount, 4);
});

test('original 8000×300 NPOT texture uses NEAREST and CLAMP with explicit repeat uniform', () => {
  const fixture = contextStub();
  const renderer = new GroundWebGLRenderer({ canvasFactory: fixture.canvasFactory });
  renderer.draw({ width: 8000, height: 300 }, [ground()]);
  const { gl, calls } = fixture;
  const parameters = calls.filter(call => call[0] === 'texParameteri');
  assert.deepEqual(parameters, [
    ['texParameteri', gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST],
    ['texParameteri', gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST],
    ['texParameteri', gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE],
    ['texParameteri', gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE],
  ]);
  assert.ok(calls.some(call => call[0] === 'uniform1i' && call[1] === 'u_repeat' && call[2] === 1));
});

test('repeat and smoothing enhancements must be explicitly requested', () => {
  const fixture = contextStub();
  const renderer = new GroundWebGLRenderer({ canvasFactory: fixture.canvasFactory, repeat: false, smoothing: true });
  renderer.draw({ width: 10, height: 10 }, [ground()]);
  assert.ok(fixture.calls.some(call => call[0] === 'uniform1i' && call[1] === 'u_repeat' && call[2] === 0));
  assert.ok(fixture.calls.some(call => call[0] === 'texParameteri' && call[2] === fixture.gl.TEXTURE_MIN_FILTER && call[3] === fixture.gl.LINEAR));
});

test('texture upload is cached by identity and dimensions, with explicit invalidation', () => {
  const fixture = contextStub();
  const renderer = new GroundWebGLRenderer({ canvasFactory: fixture.canvasFactory });
  const image = { width: 8000, height: 300 };
  renderer.draw(image, [ground()]);
  renderer.draw(image, [ground()]);
  assert.equal(fixture.calls.filter(call => call[0] === 'texImage2D').length, 1);
  renderer.invalidateTexture();
  renderer.draw(image, [ground()]);
  image.height = 301;
  renderer.draw(image, [ground()]);
  assert.equal(fixture.calls.filter(call => call[0] === 'texImage2D').length, 3);
});

test('small GPU fails informatively rather than shrinking the original ground', () => {
  const fixture = contextStub({ maxTextureSize: 4096 });
  const renderer = new GroundWebGLRenderer({ canvasFactory: fixture.canvasFactory });
  assert.throws(() => renderer.draw({ width: 8000, height: 300 }, [ground()]), /8000×300.*MAX_TEXTURE_SIZE=4096.*no resampling/);
  assert.equal(fixture.calls.filter(call => call[0] === 'texImage2D').length, 0);
});

test('empty and non-finite-only frames clear stale ground without uploading an image', () => {
  const fixture = contextStub();
  const renderer = new GroundWebGLRenderer({ canvasFactory: fixture.canvasFactory });
  const invalid = ground();
  invalid.vertices[0] = NaN;
  assert.equal(renderer.draw(null, [invalid]), fixture.canvas);
  assert.equal(renderer.lastDrawStats.skippedTileCount, 1);
  assert.deepEqual(renderer.lastDrawStats.unsupportedTileIndices, [0]);
  assert.equal(fixture.calls.filter(call => call[0] === 'drawElements').length, 0);
  assert.equal(fixture.calls.filter(call => call[0] === 'texImage2D').length, 0);
  assert.equal(fixture.calls.filter(call => call[0] === 'clear').length, 1);
});

test('unavailable WebGL, shader failures, and link failures are explicit', () => {
  assert.throws(() => new GroundWebGLRenderer({ canvasFactory: () => ({ getContext: () => null }) }), /WebGL1 is unavailable/);
  const badShader = contextStub({ compile: false });
  assert.throws(() => new GroundWebGLRenderer({ canvasFactory: badShader.canvasFactory }), /shader compilation failed: test shader failure/);
  assert.equal(badShader.calls.filter(call => call[0] === 'deleteShader').length, 1);
  const badLink = contextStub({ link: false });
  assert.throws(() => new GroundWebGLRenderer({ canvasFactory: badLink.canvasFactory }), /program linking failed: test program failure/);
  assert.equal(badLink.calls.filter(call => call[0] === 'deleteProgram').length, 1);
  assert.equal(badLink.calls.filter(call => call[0] === 'deleteShader').length, 2);
});

test('context loss and disposal never silently return a stale terrain frame', () => {
  const fixture = contextStub();
  const renderer = new GroundWebGLRenderer({ canvasFactory: fixture.canvasFactory });
  fixture.gl.isContextLost = () => true;
  assert.throws(() => renderer.draw({ width: 1, height: 1 }, [ground()]), /context was lost/);
  renderer.dispose();
  assert.throws(() => renderer.draw(null, []), /disposed/);
  assert.equal(fixture.calls.filter(call => call[0] === 'deleteBuffer').length, 2);
  assert.equal(fixture.calls.filter(call => call[0] === 'deleteTexture').length, 1);
});
