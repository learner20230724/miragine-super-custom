import assert from 'node:assert/strict';
import test from 'node:test';
import {
  parseProfileOptions,
  sanitizeScriptUrl,
  summarizeCpuProfile,
  summarizeIntervals,
  summarizePresentations,
} from '../tools/profile-desktop.mjs';

const baseUrl = 'http://127.0.0.1:49152';

test('performance profiling requires an explicit portable directory but help needs none', () => {
  assert.throws(() => parseProfileOptions([]), /--dir/);
  assert.equal(parseProfileOptions(['--help']).help, true);
  assert.equal(parseProfileOptions(['-h']).help, true);
  const options = parseProfileOptions(['--dir', 'portable-fixture']);
  assert.equal(options.dir, 'portable-fixture');
  assert.equal(options.seconds, 10);
  assert.equal(options.out, '.local/performance-profile.json');
});

test('profiling parses explicit report destinations and fractional bounded durations', () => {
  const options = parseProfileOptions([
    '--dir', 'portable fixture', '--out', '.local/profile-fixture.json', '--seconds', '0.25',
  ]);
  assert.equal(options.dir, 'portable fixture');
  assert.equal(options.out, '.local/profile-fixture.json');
  assert.equal(options.seconds, 0.25);
  assert.equal(parseProfileOptions(['--dir', 'fixture', '--seconds', '120']).seconds, 120);
});

test('profiling rejects missing arguments, unexpected options, and invalid durations', () => {
  for (const args of [
    ['--dir'], ['--dir', '--seconds', '1'],
    ['--dir', 'fixture', '--out'], ['--dir', 'fixture', '--seconds'],
    ['--dir', 'fixture', '--unknown'],
  ]) assert.throws(() => parseProfileOptions(args), Error);
  for (const seconds of ['0', '-1', '120.01', 'NaN', 'Infinity', '-Infinity', 'abc', '']) {
    assert.throws(() => parseProfileOptions(['--dir', 'fixture', '--seconds', seconds]), Error, seconds);
  }
});

test('empty frame interval statistics are explicitly unavailable rather than zero', () => {
  assert.deepEqual(summarizeIntervals([]), {
    count: 0,
    medianMs: null,
    p95Ms: null,
    maxMs: null,
    over50Ms: 0,
    over100Ms: 0,
    averageMs: null,
  });
});

test('frame interval statistics use a normal median and nearest-rank p95', () => {
  const intervals = Array.from({ length: 20 }, (_, index) => 20 - index);
  const before = [...intervals];
  assert.deepEqual(summarizeIntervals(intervals), {
    count: 20,
    medianMs: 10.5,
    p95Ms: 19,
    maxMs: 20,
    over50Ms: 0,
    over100Ms: 0,
    averageMs: 10.5,
  });
  assert.deepEqual(intervals, before, 'statistics must not reorder captured samples');
  assert.equal(summarizeIntervals([2]).p95Ms, 2);
  assert.equal(summarizeIntervals([4, 2]).medianMs, 3);
  assert.equal(summarizeIntervals([4, 2]).p95Ms, 4);
  assert.equal(summarizeIntervals([3, 1, 2]).medianMs, 2);
});

test('frame interval thresholds are strictly greater than 50 and 100 milliseconds', () => {
  const stats = summarizeIntervals([0, 50, 50.5, 100, 100.5]);
  assert.equal(stats.count, 5);
  assert.equal(stats.medianMs, 50.5);
  assert.equal(stats.p95Ms, 100.5);
  assert.equal(stats.averageMs, 60.2);
  assert.equal(stats.over50Ms, 3);
  assert.equal(stats.over100Ms, 1);
});

test('invalid interval values are filtered without coercion or dropping zero', () => {
  const stats = summarizeIntervals([NaN, Infinity, -Infinity, -1, null, undefined, '16', 0, 16]);
  assert.deepEqual(stats, {
    count: 2,
    medianMs: 8,
    p95Ms: 16,
    maxMs: 16,
    over50Ms: 0,
    over100Ms: 0,
    averageMs: 8,
  });
});

test('no observed presentations report zero throughput and no frame intervals', () => {
  const report = summarizePresentations([], 1000);
  assert.equal(report.count, 0);
  assert.equal(report.framesPerSecond, 0);
  assert.deepEqual(report.intervals, summarizeIntervals([]));
});

test('a single presentation has throughput but cannot establish a frame interval', () => {
  const report = summarizePresentations([125], 2000);
  assert.equal(report.count, 1);
  assert.equal(report.framesPerSecond, 0.5);
  assert.equal(report.intervals.count, 0);
  assert.equal(report.intervals.medianMs, null);
});

test('presentation throughput uses the elapsed capture window, with count minus one intervals', () => {
  const report = summarizePresentations([0, 30, 70, 120], 200);
  assert.equal(report.count, 4);
  assert.equal(report.framesPerSecond, 20);
  assert.equal(report.intervals.count, report.count - 1);
  assert.deepEqual(report.intervals, summarizeIntervals([30, 40, 50]));
});

test('rAF callbacks are not counted as final game-canvas submissions', () => {
  const rafTimestamps = Array.from({ length: 60 }, (_, index) => index * 1000 / 60);
  const presentationTimestamps = Array.from({ length: 30 }, (_, index) => index * 1000 / 30);
  const rafObserver = summarizePresentations(rafTimestamps, 1000);
  const presentationObserver = summarizePresentations(presentationTimestamps, 1000);
  assert.equal(rafObserver.framesPerSecond, 60);
  assert.equal(presentationObserver.framesPerSecond, 30);
  assert.equal(presentationObserver.count, 30);
  assert.equal(presentationObserver.intervals.count, 29);
  assert.ok(presentationObserver.intervals.medianMs > rafObserver.intervals.medianMs);
});

test('presentation timestamps reject invalid values without coercion or input mutation', () => {
  const timestamps = [NaN, Infinity, -Infinity, -1, null, undefined, '16', 0, 33, 66];
  const before = [...timestamps];
  const report = summarizePresentations(timestamps, 1000);
  assert.equal(report.count, 3);
  assert.equal(report.framesPerSecond, 3);
  assert.deepEqual(report.intervals, summarizeIntervals([33, 33]));
  assert.deepEqual(timestamps, before);
});

test('presentation rates remain unavailable for invalid measurement durations', () => {
  for (const elapsedMs of [0, -1, NaN, Infinity, -Infinity, null, undefined, '1000']) {
    const report = summarizePresentations([0, 16], elapsedMs);
    assert.equal(report.count, 2);
    assert.equal(report.framesPerSecond, null);
    assert.equal(report.intervals.count, 1);
    assert.equal(report.intervals.medianMs, 16);
  }
  assert.equal(summarizePresentations([0, 0.1], 0.25).framesPerSecond, 8000);
});

test('presentation timestamps retain capture order rather than being sorted', () => {
  const timestamps = [30, 10, 50];
  const before = [...timestamps];
  const report = summarizePresentations(timestamps, 1000);
  assert.equal(report.count, 3);
  assert.deepEqual(report.intervals, summarizeIntervals([-20, 40]));
  assert.equal(report.intervals.count, 1, 'a backwards timestamp must not become a positive sorted interval');
  assert.deepEqual(timestamps, before);
});

test('script URL summaries strip local origins, ports, query strings, and fragments', () => {
  assert.equal(sanitizeScriptUrl(`${baseUrl}/src/app/main.mjs?private=fixture#section`, baseUrl), '/src/app/main.mjs');
  assert.equal(sanitizeScriptUrl('http://localhost:12345/src/render/game.mjs?token=fixture', baseUrl), '/src/render/game.mjs');
  assert.equal(sanitizeScriptUrl('https://fixture.example/src/core/battle.mjs?key=fixture#private', baseUrl), '/src/core/battle.mjs');
  assert.equal(sanitizeScriptUrl('/src/core/battle.mjs?cache=fixture#private', baseUrl), '/src/core/battle.mjs');
  assert.equal(sanitizeScriptUrl('', baseUrl), '');
});

test('script URL summaries never expose filesystem locations', () => {
  const windowsPath = ['C:', 'Users', 'synthetic-profile-person', 'private', 'game.mjs'].join(String.fromCharCode(92));
  const fileUrl = ['file:', '', '', 'C:', 'Users', 'synthetic-profile-person', 'private', 'game.mjs'].join('/');
  const unixPath = ['', 'home', 'synthetic-profile-person', 'private', 'game.mjs'].join('/');
  for (const location of [windowsPath, fileUrl, unixPath]) {
    assert.equal(sanitizeScriptUrl(location, baseUrl), '[local]');
  }
});

function profileNode(id, functionName, children = [], url = `${baseUrl}/src/core/battle.mjs`) {
  return {
    id,
    callFrame: { functionName, scriptId: String(id), url, lineNumber: id, columnNumber: 2 },
    children,
  };
}

function findFrame(rows, functionName) {
  const frame = rows.find((row) => row.functionName === functionName);
  assert.ok(frame, `missing CPU profile frame: ${functionName}`);
  assert.equal(typeof frame.lineNumber, 'number');
  assert.equal(typeof frame.columnNumber, 'number');
  return frame;
}

test('empty CPU profiles have no samples or ranked entries', () => {
  assert.deepEqual(summarizeCpuProfile({ nodes: [], samples: [] }, baseUrl), {
    sampleCount: 0,
    topSelf: [],
    topInclusive: [],
  });
});

test('CPU summaries count self samples separately from descendant-inclusive samples', () => {
  const profile = {
    nodes: [
      profileNode(10, '(root)', [20, 40], ''),
      profileNode(20, 'outer', [30]),
      profileNode(30, 'inner'),
      profileNode(40, 'other'),
    ],
    samples: [20, 30, 30, 40],
    timeDeltas: [500, 1000, 800, 2000],
  };
  const before = JSON.stringify(profile);
  const report = summarizeCpuProfile(profile, baseUrl);
  assert.equal(report.sampleCount, 4);
  for (const [functionName, selfSamples, inclusiveSamples, selfPercent, inclusivePercent] of [
    ['outer', 1, 3, 25, 75],
    ['inner', 2, 2, 50, 50],
    ['other', 1, 1, 25, 25],
  ]) {
    for (const rows of [report.topSelf, report.topInclusive]) {
      const frame = findFrame(rows, functionName);
      assert.equal(frame.selfSamples, selfSamples, functionName);
      assert.equal(frame.inclusiveSamples, inclusiveSamples, functionName);
      assert.equal(frame.selfPercent, selfPercent, functionName);
      assert.equal(frame.inclusivePercent, inclusivePercent, functionName);
      assert.equal(frame.url, '/src/core/battle.mjs');
    }
  }
  assert.equal(JSON.stringify(profile), before, 'summarizing must not mutate the captured profile');
  for (const [rows, countKey] of [[report.topSelf, 'selfSamples'], [report.topInclusive, 'inclusiveSamples']]) {
    for (let index = 1; index < rows.length; index++) {
      assert.ok(rows[index - 1][countKey] >= rows[index][countKey], countKey);
    }
  }
});

test('ranked CPU lists are limited to ten entries and redact local script locations', () => {
  const privateFile = ['file:', '', '', 'C:', 'Users', 'synthetic-profile-person', 'game.mjs'].join('/');
  const leaves = Array.from({ length: 12 }, (_, index) => profileNode(index + 2, `worker${index}`, [], privateFile));
  const profile = {
    nodes: [profileNode(1, '(root)', leaves.map((node) => node.id), ''), ...leaves],
    samples: leaves.flatMap((node, index) => Array(index + 1).fill(node.id)),
  };
  const report = summarizeCpuProfile(profile, baseUrl);
  assert.equal(report.sampleCount, 78);
  assert.equal(report.topSelf.length, 10);
  assert.equal(report.topInclusive.length, 10);
  for (const rows of [report.topSelf, report.topInclusive]) {
    for (const row of rows.filter((entry) => entry.functionName !== '(root)')) assert.equal(row.url, '[local]');
  }
  assert.ok(!JSON.stringify(report).includes('synthetic-profile-person'));
});
