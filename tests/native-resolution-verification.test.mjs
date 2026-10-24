import test from 'node:test';
import assert from 'node:assert/strict';
import { parseNativeOptions, nativeSurfaceMatches, summarizeNativeSample, visibleHotspotPoint, sameRenderViewport } from '../tools/verify-native-resolution.mjs';

test('native verifier requires a unique isolated local target and ignored proof path', () => {
  const options = parseNativeOptions(['--dir', 'dist/fresh', '--mode', 'baseline', '--seconds', '8']);
  assert.equal(options.mode, 'baseline'); assert.equal(options.seconds, 8);
  assert.equal(parseNativeOptions(['--url', 'http://127.0.0.1:1234/']).mode, 'native');
  assert.equal(parseNativeOptions(['--source-electron', 'dist/fresh', '--matrix', 'high']).matrix, 'high');
  assert.equal(parseNativeOptions(['--help']).help, true);
  for (const args of [[], ['--dir', 'a', '--url', 'http://localhost'], ['--url', 'https://example.com'],
    ['--url', 'http://user:pass@localhost'], ['--dir', 'a', '--mode', 'other'], ['--dir', 'a', '--seconds', 'NaN'],
    ['--dir', 'a', '--seconds', '0'], ['--dir', 'a', '--seconds', '31'], ['--dir', 'a', '--prefix', '../escape'],
    ['--dir', 'a', '--out', '../escape.json'], ['--dir', 'a', '--out', 'README.md'], ['--dir', 'a', '--dir', 'b'],
    ['--dir', 'a', '--source-electron', 'b'], ['--dir', 'a', '--matrix', 'bad'], ['--unknown', 'x']]) {
    assert.throws(() => parseNativeOptions(args));
  }
});

test('native verifier clicks only the visible clipped title music hotspot', () => {
  const viewport = { clientLeft: 0, clientTop: 0, left: 17, top: 0, scale: 1.925 };
  const hotspot = { left: 616, right: 679, top: .7, bottom: 27.3 };
  const point = visibleHotspotPoint(hotspot, viewport);
  assert.equal(point.x, 1225.9); assert.equal(point.y, 26.95);
  assert.ok(point.x < 17 + 640 * 1.925);
  assert.equal(visibleHotspotPoint({ ...hotspot, left: 650 }, viewport), null);
  assert.equal(visibleHotspotPoint(hotspot, { ...viewport, scale: 0 }), null);
  assert.equal(visibleHotspotPoint(null, viewport), null);
});

test('viewport guard catches screenshot DPR resets and any mid-sample render size change', () => {
  const viewport = { viewportWidth: 1920, viewportHeight: 1200, gameWidth: 640, gameHeight: 480, scale: 2.5,
    left: 160, top: 0, width: 1600, height: 1200, right: 1760, bottom: 1200, clientLeft: 0, clientTop: 0,
    devicePixelRatio: 2, backingWidth: 3200, backingHeight: 2400, pixelScaleX: 5, pixelScaleY: 5 };
  assert.equal(sameRenderViewport(viewport, { ...viewport }), true);
  for (const [key, value] of Object.entries(viewport)) {
    assert.equal(sameRenderViewport(viewport, { ...viewport, [key]: value + 1 }), false);
    assert.equal(sameRenderViewport({ ...viewport, [key]: NaN }, viewport), false);
  }
  assert.equal(sameRenderViewport(viewport, { ...viewport, devicePixelRatio: 1.5 }), false);
  assert.equal(sameRenderViewport({}, {}), false); assert.equal(sameRenderViewport(null, viewport), false);
});

test('native surface proof checks logical coordinates, backing dimensions and both render scales', () => {
  const canvas = { width: 3180, height: 2385 };
  const state = { viewport: { backingWidth: 3180, backingHeight: 2385 }, presentationStats: {
    mode: 'native-resolution', logicalWidth: 640, logicalHeight: 480, backingWidth: 3180, backingHeight: 2385,
    renderScaleX: 4.96875, renderScaleY: 4.96875 } };
  assert.equal(nativeSurfaceMatches(state, canvas), true);
  for (const key of ['backingWidth', 'backingHeight', 'logicalWidth', 'logicalHeight', 'renderScaleX', 'renderScaleY']) {
    assert.equal(nativeSurfaceMatches({ ...state, presentationStats: { ...state.presentationStats, [key]: 0 } }, canvas), false);
  }
  assert.equal(nativeSurfaceMatches({ ...state, presentationStats: { ...state.presentationStats, mode: 'legacy' } }, canvas), false);
  assert.equal(nativeSurfaceMatches(state, { width: 640, height: 480 }), false);
  assert.equal(nativeSurfaceMatches(null, canvas), false);
  assert.equal(nativeSurfaceMatches(state, null), false);
});

test('render profile uses actual counters without confusing presentation and 30 Hz simulation', () => {
  const before = { atMs: 1000, game: { frame: 30, presentationStats: { framesPresented: 20, renderCpuTotalMs: 100 } } };
  const after = { atMs: 3000, game: { frame: 90, presentationStats: { framesPresented: 140, renderCpuTotalMs: 340, renderCpuMaxMs: 10 } } };
  const observation = { presentations: 118, cpuMs: [1, 2, 3], intervals: [16, 17] };
  const native = summarizeNativeSample(before, after, observation, 'native');
  assert.equal(native.presentationFps, 60); assert.equal(native.simulationHz, 30);
  assert.equal(native.animateCpu.averageMs, 2); assert.equal(native.nativeRenderCpu.averageMs, 2);
  const baseline = summarizeNativeSample(before, after, observation, 'baseline');
  assert.equal(baseline.presentationFps, 59); assert.equal(baseline.nativeRenderCpu, null);
  assert.throws(() => summarizeNativeSample(before, before, observation, 'native'));
  assert.throws(() => summarizeNativeSample(before, after, { ...observation, presentations: -1 }, 'baseline'));
  assert.equal(before.game.frame, 30); assert.equal(observation.cpuMs.length, 3);
});
