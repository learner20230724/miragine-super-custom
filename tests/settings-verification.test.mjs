import assert from 'node:assert/strict';
import test from 'node:test';
import { parseSettingsOptions, summarizeSettingsTiming, reportPath, compactCrystalBounds } from '../tools/verify-settings.mjs';
import { ViewCamera } from '../src/render/view-camera.mjs';

test('settings verifier has independent report names and defaults', () => {
  const options = parseSettingsOptions(['--url', 'http://127.0.0.1:43210/']);
  assert.equal(options.out, '.local/settings-verification.json');
  assert.equal(options.screenshotPrefix, 'settings');
  assert.equal(options.sampleSeconds, 1);
  assert.equal(options.headless, false);
  const explicit = parseSettingsOptions(['--dir', 'isolated-portable', '--out', '.local/proof.json',
    '--screenshot-prefix', 'new-proof', '--sample-seconds', '.5', '--headless']);
  assert.equal(explicit.out, '.local/proof.json');
  assert.equal(explicit.screenshotPrefix, 'new-proof');
  assert.equal(explicit.sampleSeconds, .5);
  assert.equal(explicit.headless, true);
});

test('settings verifier retains strict one-target, URL and argument validation', () => {
  for (const args of [[], ['--url', 'https://example.com'], ['--url', 'http://username:password@localhost'],
    ['--dir', 'a', '--url', 'http://localhost'], ['--dir', 'a', '--dir', 'b'], ['--unknown'],
    ['--dir', 'a', '--sample-seconds', 'NaN'], ['--dir', 'a', '--sample-seconds', '.1'],
    ['--dir', 'a', '--screenshot-prefix', '../private'], ['--dir', 'a', '--out']]) {
    assert.throws(() => parseSettingsOptions(args));
  }
  assert.equal(parseSettingsOptions(['--help']).help, true);
});

test('reports can only be JSON beneath ignored verification output directories', () => {
  for (const value of ['.local/proof.json', 'output/proof.json', 'artifacts/new/proof.json', '.tmp/proof.json']) {
    assert.ok(reportPath(value).endsWith('proof.json'));
  }
  for (const value of ['proof.json', 'docs/proof.json', '../proof.json', '.local/../../proof.json', '.local/proof.txt']) {
    assert.throws(() => reportPath(value));
  }
});

test('paused timing needs an actual nonzero observation interval with zero steps', () => {
  const result = summarizeSettingsTiming([{ atMs: 100, frame: 20 }, { atMs: 1100, frame: 20 }], 0);
  assert.equal(result.frozen, true);
  assert.equal(result.advancing, false);
  assert.equal(result.simulationHz, 0);
  assert.equal(result.actualSpeed, 0);
  assert.equal(summarizeSettingsTiming([{ atMs: 0, frame: 1 }, { atMs: 1000, frame: 2 }], 0).frozen, false);
  assert.equal(summarizeSettingsTiming([{ atMs: 0, frame: 1 }, { atMs: 0, frame: 1 }], 0).frozen, false);
});

test('fractional speed evidence differentiates requested and measured throughput', () => {
  const fractional = summarizeSettingsTiming([{ atMs: 200, frame: 10 }, { atMs: 2200, frame: 100 }], 1.5);
  assert.equal(fractional.frameDelta, 90);
  assert.equal(fractional.simulationHz, 45);
  assert.equal(fractional.actualSpeed, 1.5);
  assert.equal(fractional.requestedSimulationHz, 45);
  assert.equal(fractional.advancing, true);
  assert.equal(fractional.frozen, false);
  const limited = summarizeSettingsTiming([{ atMs: 0, frame: 0 }, { atMs: 1000, frame: 300 }], 20);
  assert.equal(limited.requestedSimulationHz, 600);
  assert.equal(limited.simulationHz, 300);
  assert.equal(limited.actualSpeed, 10);
  assert.equal(limited.advancing, true, 'UI functionality must not claim hardware reaches 20x');
  assert.equal('passed' in limited, false, 'no disguised full-performance assertion');
});

test('timing filters malformed samples without rewriting order or mutating input', () => {
  const samples = [null, {}, { atMs: 0, frame: 2 }, { atMs: '10', frame: 3 }, { atMs: 10, frame: .5 },
    { atMs: Infinity, frame: 4 }, { atMs: 1000, frame: 32 }];
  const before = structuredClone(samples);
  assert.equal(summarizeSettingsTiming(samples, 1).sampleCount, 2);
  assert.equal(summarizeSettingsTiming(samples, 1).actualSpeed, 1);
  assert.deepEqual(samples, before);
  for (const invalid of [undefined, null, '1', -1, 20.1, NaN, Infinity]) {
    const result = summarizeSettingsTiming(samples, invalid);
    assert.equal(result.simulationHz, null);
    assert.equal(result.frozen, false);
    assert.equal(result.advancing, false);
  }
});

test('reversed, absent, and nonadvancing windows cannot claim live acceleration', () => {
  for (const samples of [[], [{ atMs: 0, frame: 0 }], [{ atMs: 0, frame: 20 }, { atMs: 1000, frame: 10 }],
    [{ atMs: 1000, frame: 1 }, { atMs: 0, frame: 2 }], [{ atMs: 0, frame: 1 }, { atMs: 1000, frame: 1 }]]) {
    assert.equal(summarizeSettingsTiming(samples, 20).advancing, false);
  }
});

test('read-only crystal projection reconstructs offsets and complete image margins', () => {
  const bitmap = { width: 86, height: 134, offX: -43, offY: -129 };
  const sprites = { A_crystal: { rasterized: bitmap }, B_crystal: { rasterized: bitmap } };
  const rules = { mapWidth: 4500, mapHeight: 800, baseSpawnInset: 300 };
  const camera = new ViewCamera(); camera.fitAll();
  const view = camera.snapshot({ x: 2250, y: 400, width: 640, height: 400 });
  const before = structuredClone(view);
  const bounds = compactCrystalBounds(view, rules, sprites);
  assert.ok(Math.abs(bounds[0].left - 16) < .01);
  assert.ok(Math.abs(bounds[1].right - 624) < .01);
  assert.ok(bounds.every(b => b.drawable && b.top > 0 && b.bottom < 400));
  assert.deepEqual(view, before);
});
