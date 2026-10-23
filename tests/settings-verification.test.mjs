import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import { parseSettingsOptions, summarizeSettingsTiming, reportPath, compactCrystalBounds,
  foregroundOwnedWindow, registerNativeExport, completedNativeExport } from '../tools/verify-settings.mjs';
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

test('native foreground callback is serializable and uses only its owned window', () => {
  const calls = [], bounds = { x: 10, y: 20, width: 900, height: 700 };
  const win = { isVisible: () => false, isMinimized: () => true, isFocused: () => false,
    getBounds: () => bounds, show: () => calls.push('show'), focus: () => calls.push('window-focus'),
    webContents: { focus: () => calls.push('web-contents-focus') } };
  const callback = Function(`return (${foregroundOwnedWindow.toString()})`)();
  assert.deepEqual(callback({ BrowserWindow: { getAllWindows: () => [win] } }),
    { visible: false, minimized: true, focused: false, bounds });
  assert.deepEqual(calls, ['show', 'window-focus', 'web-contents-focus']);
  assert.throws(() => callback({ BrowserWindow: { getAllWindows: () => [] } }), /unavailable/);
});

test('native export only sets a destination after a real download event, then records completion', async () => {
  const session = new EventEmitter(), item = new EventEmitter(), calls = [];
  const previous = globalThis.__SETTINGS_VERIFY_DOWNLOAD__;
  try {
    Object.assign(item, { setSavePath: target => calls.push(['save-as', target]),
      getFilename: () => 'preset.json', getTotalBytes: () => 123, getReceivedBytes: () => 123,
      getMimeType: () => 'application/json' });
    const callback = Function(`return (${registerNativeExport.toString()})`)();
    callback({ BrowserWindow: { getAllWindows: () => [{ webContents: { session } }] } }, 'isolated-export.json');
    assert.deepEqual(calls, [], 'registration must not write or fabricate a downloaded file');
    assert.equal(session.listenerCount('will-download'), 1);
    let completed = false;
    globalThis.__SETTINGS_VERIFY_DOWNLOAD__.then(() => { completed = true; });
    session.emit('will-download', {}, item);
    assert.deepEqual(calls, [['save-as', 'isolated-export.json']]);
    assert.equal(session.listenerCount('will-download'), 0, 'listener is scoped to one actual export');
    await Promise.resolve(); assert.equal(completed, false, 'destination selection is not download completion');
    item.emit('done', {}, 'completed');
    assert.deepEqual(await globalThis.__SETTINGS_VERIFY_DOWNLOAD__, { status: 'completed', filename: 'preset.json',
      totalBytes: 123, receivedBytes: 123, mimeType: 'application/json' });
    assert.equal(item.listenerCount('done'), 0);
    assert.throws(() => callback({ BrowserWindow: { getAllWindows: () => [] } }, 'unused.json'), /unavailable/);
  } finally {
    if (previous === undefined) delete globalThis.__SETTINGS_VERIFY_DOWNLOAD__;
    else globalThis.__SETTINGS_VERIFY_DOWNLOAD__ = previous;
  }
});

test('native download proof requires completed status and exact positive on-disk byte count', () => {
  const info = { status: 'completed', totalBytes: 8511, receivedBytes: 8511 };
  assert.equal(completedNativeExport(info, 8511), true);
  for (const bytes of [undefined, null, '8511', 0, -1, 1.5, 8510, Infinity, NaN]) {
    assert.equal(completedNativeExport(info, bytes), false);
  }
  for (const invalid of [null, {}, { ...info, status: 'cancelled' }, { ...info, status: 'interrupted' },
    { ...info, totalBytes: -1 }, { ...info, receivedBytes: 8510 }, { ...info, receivedBytes: '8511' }]) {
    assert.equal(completedNativeExport(invalid, 8511), false);
  }
  assert.deepEqual(info, { status: 'completed', totalBytes: 8511, receivedBytes: 8511 });
});
