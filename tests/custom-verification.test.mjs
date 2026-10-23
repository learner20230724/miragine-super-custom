import assert from 'node:assert/strict';
import test from 'node:test';
import {
  correctFit,
  parseCustomOptions,
  rectanglesOverlap,
  summarizeSubmissions,
  summarizeTiming,
} from '../tools/verify-custom.mjs';

test('custom verification needs exactly one target while help can omit it', () => {
  assert.throws(() => parseCustomOptions([]), Error);
  assert.equal(parseCustomOptions(['--help']).help, true);
  assert.equal(parseCustomOptions(['-h']).help, true);
  const options = parseCustomOptions(['--dir', 'portable fixture']);
  assert.equal(options.dir, 'portable fixture');
  assert.equal(options.out, '.local/custom-verification.json');
  assert.equal(options.sampleSeconds, 2);
  assert.equal(options.headless, false);
  for (const args of [
    ['--dir', 'fixture', '--url', 'http://localhost:41234'],
    ['--help', '--dir', 'fixture', '--url', 'http://localhost:41234'],
  ]) assert.throws(() => parseCustomOptions(args), Error);
});

test('custom verification permits only credential-free loopback HTTP URLs', () => {
  for (const url of [
    'http://127.0.0.1:41234',
    'http://localhost:41234/',
    'http://[::1]:41234/index.html',
  ]) assert.equal(new URL(parseCustomOptions(['--url', url]).url).href, new URL(url).href);
  for (const url of [
    'http://example.test', 'http://localhost.example.test', 'http://127.0.0.2',
    'https://localhost:41234', 'ftp://127.0.0.1', 'file:fixture',
    'http://fixture:credential@localhost:41234', 'http://localhost:99999', 'not-a-url',
  ]) assert.throws(() => parseCustomOptions(['--url', url]), Error, url);
});

test('custom verification accepts explicit report paths, headless mode, and duration bounds', () => {
  const options = parseCustomOptions([
    '--url', 'http://127.0.0.1:41234', '--out', '.local/custom-fixture.json',
    '--sample-seconds', '0.5', '--headless',
  ]);
  assert.equal(options.out, '.local/custom-fixture.json');
  assert.equal(options.sampleSeconds, 0.5);
  assert.equal(options.headless, true);
  assert.equal(parseCustomOptions(['--dir', 'fixture', '--sample-seconds', '10']).sampleSeconds, 10);
});

test('custom verification rejects invalid durations even when help was requested', () => {
  for (const duration of ['0', '-1', '0.49', '10.01', 'NaN', 'Infinity', '-Infinity', 'text', '']) {
    assert.throws(() => parseCustomOptions(['--dir', 'fixture', '--sample-seconds', duration]), Error, duration);
    assert.throws(() => parseCustomOptions(['--help', '--sample-seconds', duration]), Error, duration);
  }
});

test('custom verification rejects duplicate flags, unknown flags, and missing values', () => {
  for (const args of [
    ['--dir'], ['--url'], ['--dir', 'fixture', '--out'],
    ['--dir', 'fixture', '--sample-seconds'], ['--dir', '--headless'],
    ['--dir', 'fixture', '--unknown'], ['--help', '--unknown'],
    ['--dir', 'one', '--dir', 'two'],
    ['--url', 'http://localhost:41234', '--url', 'http://127.0.0.1:41234'],
    ['--dir', 'fixture', '--out', '.local/one.json', '--out', '.local/two.json'],
    ['--dir', 'fixture', '--sample-seconds', '1', '--sample-seconds', '2'],
    ['--dir', 'fixture', '--headless', '--headless'],
  ]) assert.throws(() => parseCustomOptions(args), Error);
});

test('custom verification permits explicit Chrome or Edge channels without changing the default', () => {
  assert.equal(Object.hasOwn(parseCustomOptions(['--dir', 'fixture']), 'browserChannel'), false);
  for (const browserChannel of ['chrome', 'msedge']) {
    const options = parseCustomOptions(['--url', 'http://localhost:41234', '--browser-channel', browserChannel]);
    assert.equal(options.browserChannel, browserChannel);
    assert.equal(parseCustomOptions(['--dir', 'fixture', '--browser-channel', browserChannel]).browserChannel, browserChannel);
  }
});

test('custom verification rejects missing, duplicate, and unsupported browser channels', () => {
  for (const args of [
    ['--dir', 'fixture', '--browser-channel'],
    ['--dir', 'fixture', '--browser-channel', '--headless'],
    ['--dir', 'fixture', '--browser-channel', 'chrome', '--browser-channel', 'msedge'],
    ['--help', '--browser-channel', 'firefox'],
  ]) assert.throws(() => parseCustomOptions(args), Error);
  for (const browserChannel of ['', 'firefox', 'chromium', 'Chrome', 'edge', 'unknown']) {
    assert.throws(() => parseCustomOptions(['--dir', 'fixture', '--browser-channel', browserChannel]), Error);
  }
});

test('screenshot prefixes default safely and accept bounded labels without changing report paths', () => {
  const defaults = parseCustomOptions(['--dir', 'fixture']);
  assert.equal(defaults.screenshotPrefix, 'custom');
  assert.equal(defaults.out, '.local/custom-verification.json');
  for (const screenshotPrefix of ['custom-final', 'custom-portable-final', 'Custom-2', 'x', 'a'.repeat(48)]) {
    const options = parseCustomOptions(['--dir', 'fixture', '--screenshot-prefix', screenshotPrefix]);
    assert.equal(options.screenshotPrefix, screenshotPrefix);
    assert.equal(options.out, defaults.out);
  }
  assert.equal(parseCustomOptions([
    '--dir', 'fixture', '--out', '.local/report-fixture.json', '--screenshot-prefix', 'custom-final',
  ]).out, '.local/report-fixture.json');
});

test('screenshot prefixes reject path syntax, punctuation, spaces, and oversized labels', () => {
  for (const screenshotPrefix of [
    '', '.', '..', '../escape', 'folder/file', 'folder\\file', 'fixture.png',
    'two words', ' leading', 'trailing ', '-leading', '_label', 'a'.repeat(49),
  ]) {
    assert.throws(() => parseCustomOptions(['--dir', 'fixture', '--screenshot-prefix', screenshotPrefix]), Error);
    assert.throws(() => parseCustomOptions(['--help', '--screenshot-prefix', screenshotPrefix]), Error);
  }
});

test('screenshot prefixes reject missing and duplicate CLI values', () => {
  for (const args of [
    ['--dir', 'fixture', '--screenshot-prefix'],
    ['--dir', 'fixture', '--screenshot-prefix', '--headless'],
    ['--dir', 'fixture', '--screenshot-prefix', 'one', '--screenshot-prefix', 'two'],
  ]) assert.throws(() => parseCustomOptions(args), Error);
});

test('submission summaries handle zero or one event and unavailable capture durations', () => {
  const noIntervals = { count: 0, medianMs: null, p95Ms: null, maxMs: null };
  assert.deepEqual(summarizeSubmissions([], 1000), { count: 0, framesPerSecond: 0, intervals: noIntervals });
  assert.deepEqual(summarizeSubmissions([42], 2000), { count: 1, framesPerSecond: 0.5, intervals: noIntervals });
  for (const elapsedMs of [0, -1, NaN, Infinity, -Infinity, null, undefined, '1000']) {
    const report = summarizeSubmissions([0, 16], elapsedMs);
    assert.equal(report.count, 2);
    assert.equal(report.framesPerSecond, null);
    assert.deepEqual(report.intervals, { count: 1, medianMs: 16, p95Ms: 16, maxMs: 16 });
  }
});

test('submission statistics use count-based rates, a normal median, and nearest-rank p95', () => {
  const timestamps = [0, 10, 30, 60, 100];
  const before = [...timestamps];
  assert.deepEqual(summarizeSubmissions(timestamps, 200), {
    count: 5,
    framesPerSecond: 25,
    intervals: { count: 4, medianMs: 25, p95Ms: 40, maxMs: 40 },
  });
  assert.deepEqual(timestamps, before);
});

test('submission timestamps filter malformed entries but retain capture order and input values', () => {
  const timestamps = [NaN, Infinity, -Infinity, -1, null, undefined, '16', 30, 10, 50];
  const before = [...timestamps];
  assert.deepEqual(summarizeSubmissions(timestamps, 1000), {
    count: 3,
    framesPerSecond: 3,
    intervals: { count: 1, medianMs: 40, p95Ms: 40, maxMs: 40 },
  });
  assert.deepEqual(timestamps, before);
});

function close(actual, expected, tolerance = 1e-10) {
  assert.equal(typeof actual, 'number');
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} approximately equals ${expected}`);
}

test('timing summaries distinguish real-time simulation speed from game-second frame rate', () => {
  for (const speed of [0.5, 1, 2, 3]) {
    const report = summarizeTiming([
      { atMs: 125, frame: 100 },
      { atMs: 1125, frame: 100 + 30 * speed },
      { atMs: 2125, frame: 100 + 60 * speed },
    ], { speed });
    assert.equal(report.sampleCount, 3);
    assert.equal(report.elapsedMs, 2000);
    assert.equal(report.frameDelta, 60 * speed);
    close(report.simulationHz, 30 * speed);
    close(report.framesPerGameSecond, 30);
    close(report.expectedSimulationHz, 30 * speed);
    close(report.relativeError, 0);
    assert.equal(report.passed, true);
  }
});

test('timing calculations honor a custom logical frequency instead of assuming 30 Hz', () => {
  const report = summarizeTiming([{ atMs: 0, frame: 0 }, { atMs: 1000, frame: 96 }], {
    speed: 2,
    logicalHz: 48,
  });
  assert.equal(report.simulationHz, 96);
  assert.equal(report.expectedSimulationHz, 96);
  assert.equal(report.framesPerGameSecond, 48);
  assert.equal(report.relativeError, 0);
  assert.equal(report.passed, true);
});

test('timing acceptance includes the exact tolerance boundary and rejects worse rates', () => {
  const samples = (frame) => [{ atMs: 0, frame: 0 }, { atMs: 1000, frame }];
  const boundary = summarizeTiming(samples(24), { speed: 1, logicalHz: 32 });
  assert.equal(boundary.relativeError, 0.25);
  assert.equal(boundary.passed, true);
  assert.equal(summarizeTiming(samples(23), { speed: 1, logicalHz: 32 }).passed, false);
  const customBoundary = summarizeTiming(samples(90), { speed: 1, logicalHz: 100, tolerance: 0.1 });
  assert.equal(customBoundary.relativeError, 0.1);
  assert.equal(customBoundary.passed, true);
  assert.equal(summarizeTiming(samples(89), { speed: 1, logicalHz: 100, tolerance: 0.1 }).passed, false);
  assert.equal(summarizeTiming(samples(30), { speed: 2 }).passed, false);
});

test('timing summaries filter malformed samples without coercion or mutating input', () => {
  const samples = [
    null, undefined, {}, { atMs: 0, frame: 0 },
    { atMs: NaN, frame: 1 }, { atMs: 20, frame: Infinity },
    { atMs: -1, frame: 1 }, { atMs: 20, frame: -1 },
    { atMs: '20', frame: 1 }, { atMs: 20, frame: '1' },
    { atMs: 1000, frame: 30 },
  ];
  const before = structuredClone(samples);
  const report = summarizeTiming(samples, { speed: 1 });
  assert.equal(report.sampleCount, 2);
  assert.equal(report.elapsedMs, 1000);
  assert.equal(report.frameDelta, 30);
  assert.equal(report.simulationHz, 30);
  assert.equal(report.passed, true);
  assert.deepEqual(samples, before);
});

test('timing summaries cannot pass with absent, zero-length, or reversed measurement windows', () => {
  for (const samples of [
    [], [{ atMs: 0, frame: 0 }],
    [{ atMs: 1, frame: 0 }, { atMs: 1, frame: 30 }],
    [{ atMs: 1000, frame: 30 }, { atMs: 0, frame: 0 }],
    [{ atMs: 0, frame: 30 }, { atMs: 1000, frame: 0 }],
  ]) {
    const before = structuredClone(samples);
    const report = summarizeTiming(samples, { speed: 1 });
    assert.equal(report.sampleCount, samples.length);
    assert.equal(report.simulationHz, null);
    assert.equal(report.framesPerGameSecond, null);
    assert.equal(report.relativeError, null);
    assert.equal(report.passed, false);
    assert.deepEqual(samples, before, 'measurement order must not be sorted or rewritten');
  }
});

test('a valid non-advancing simulation measures zero and fails the expected-rate gate', () => {
  const report = summarizeTiming([{ atMs: 0, frame: 9 }, { atMs: 1000, frame: 9 }], { speed: 1 });
  assert.equal(report.frameDelta, 0);
  assert.equal(report.simulationHz, 0);
  assert.equal(report.framesPerGameSecond, 0);
  assert.equal(report.relativeError, 1);
  assert.equal(report.passed, false);
});

test('invalid speed or logical frequency cannot produce a passing timing assertion', () => {
  const samples = [{ atMs: 0, frame: 0 }, { atMs: 1000, frame: 30 }];
  for (const speed of [undefined, null, 0, -1, NaN, Infinity, '1']) {
    const report = summarizeTiming(samples, { speed });
    assert.equal(report.simulationHz, null);
    assert.equal(report.framesPerGameSecond, null);
    assert.equal(report.relativeError, null);
    assert.equal(report.passed, false);
  }
  for (const logicalHz of [null, 0, -1, NaN, Infinity, '30']) {
    const report = summarizeTiming(samples, { speed: 1, logicalHz });
    assert.equal(report.simulationHz, null);
    assert.equal(report.framesPerGameSecond, null);
    assert.equal(report.relativeError, null);
    assert.equal(report.passed, false);
  }
});

const rectangle = (left, top, right, bottom) => ({ left, top, right, bottom });

test('overlap detection is symmetric and requires positive intersection on both axes', () => {
  const outer = rectangle(0, 0, 20, 20);
  const inner = rectangle(2, 3, 12, 13);
  const before = [structuredClone(outer), structuredClone(inner)];
  assert.equal(rectanglesOverlap(outer, inner), true);
  assert.equal(rectanglesOverlap(inner, outer), true);
  assert.equal(rectanglesOverlap(outer, rectangle(20, 0, 30, 20)), false);
  assert.equal(rectanglesOverlap(outer, rectangle(0, 20, 20, 30)), false);
  assert.equal(rectanglesOverlap(outer, rectangle(21, 21, 30, 30)), false);
  assert.deepEqual([outer, inner], before);
});

test('overlap detection excludes intersections exactly equal to the epsilon threshold', () => {
  const base = rectangle(0, 0, 10, 10);
  assert.equal(rectanglesOverlap(base, rectangle(9.5, 0, 20, 10)), false);
  assert.equal(rectanglesOverlap(base, rectangle(0, 9.5, 10, 20)), false);
  assert.equal(rectanglesOverlap(base, rectangle(9.49, 0, 20, 10)), true);
  assert.equal(rectanglesOverlap(base, rectangle(9.9, 0, 20, 10), 0), true);
  assert.equal(rectanglesOverlap(base, rectangle(8, 0, 20, 10), 2), false);
});

test('overlap detection rejects malformed, non-finite, or non-positive rectangles', () => {
  const valid = rectangle(0, 0, 10, 10);
  for (const invalid of [
    null, undefined, {}, rectangle(0, 0, 0, 10), rectangle(0, 0, 10, 0),
    rectangle(10, 0, 0, 10), rectangle(0, 10, 10, 0),
    rectangle(NaN, 0, 10, 10), rectangle(0, Infinity, 10, 10),
    rectangle(0, 0, '10', 10), rectangle(0, 0, 10, undefined),
  ]) {
    assert.equal(rectanglesOverlap(invalid, valid), false);
    assert.equal(rectanglesOverlap(valid, invalid), false);
  }
});

const viewport = (overrides = {}) => ({
  width: 800, height: 600, left: 0, top: 0, viewportWidth: 800, viewportHeight: 600,
  ...overrides,
});

test('viewport fit accepts full-stage, wide letterbox, and portrait pillarbox layouts', () => {
  assert.equal(correctFit(viewport()), true);
  assert.equal(correctFit(viewport({ width: 1440, height: 1080, left: 240, viewportWidth: 1920, viewportHeight: 1080 })), true);
  assert.equal(correctFit(viewport({ width: 360, height: 270, top: 185, viewportWidth: 360, viewportHeight: 640 })), true);
});

test('viewport fit rejects aspect distortion, cropping, and avoidable all-around borders', () => {
  for (const value of [
    viewport({ width: 800, height: 500 }),
    viewport({ width: 1200, height: 900 }),
    viewport({ width: 400, height: 300, left: 200, top: 150 }),
    viewport({ left: -1 }), viewport({ top: -1 }),
    viewport({ left: 1 }), viewport({ top: 1 }),
  ]) assert.equal(correctFit(value), false);
});

test('viewport fit rejects missing, non-numeric, non-finite, and non-positive dimensions', () => {
  assert.equal(correctFit(null), false);
  assert.equal(correctFit(undefined), false);
  assert.equal(correctFit({}), false);
  for (const key of ['width', 'height', 'viewportWidth', 'viewportHeight']) {
    for (const value of [undefined, null, '800', NaN, Infinity, 0, -1]) {
      assert.equal(correctFit(viewport({ [key]: value })), false, key);
    }
  }
  for (const key of ['left', 'top']) {
    for (const value of [undefined, null, '0', NaN, Infinity]) {
      assert.equal(correctFit(viewport({ [key]: value })), false, key);
    }
  }
});
