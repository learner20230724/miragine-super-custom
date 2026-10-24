import test from 'node:test';
import assert from 'node:assert/strict';
import { parseLargeBattleOptions, summarizeLargeBattleSamples, summarizeProcessMemory } from '../tools/verify-large-battle.mjs';

test('large-army verifier requires one isolated target and finite bounded test fixture', () => {
  const defaults = parseLargeBattleOptions(['--source-electron', 'dist/fresh']);
  assert.equal(defaults.perSide, 500); assert.equal(defaults.seconds, 3); assert.equal(defaults.dpr, 1.5); assert.equal(defaults.renderHz, 120);
  const custom = parseLargeBattleOptions(['--dir', 'dist/fresh', '--per-side', '800', '--seconds', '1', '--render-hz', '240', '--cpu-profile']);
  assert.equal(custom.perSide, 800); assert.equal(custom.cpuProfile, true); assert.equal(parseLargeBattleOptions(['--help']).help, true);
  for (const extra of [['--per-side', '801'], ['--per-side', '0'], ['--per-side', '1.1'], ['--seconds', 'NaN'], ['--seconds', '0'],
    ['--seconds', '11'], ['--unit', '16'], ['--width', '320'], ['--height', 'NaN'], ['--dpr', '3'], ['--render-hz', '30'],
    ['--out', 'README.md'], ['--out', '../escape.json'], ['--prefix', '../escape'], ['--unknown', '1'], ['--seconds']]) {
    assert.throws(() => parseLargeBattleOptions(['--dir', 'dist/fresh', ...extra]));
  }
  assert.throws(() => parseLargeBattleOptions([]));
  assert.throws(() => parseLargeBattleOptions(['--dir', 'a', '--source-electron', 'b']));
  assert.throws(() => parseLargeBattleOptions(['--dir', 'a', '--dir', 'b']));
});

test('large-army stats distinguish actual counters, sampled draw values and absent baseline culling', () => {
  const before = { atMs: 1000, frame: 30, presentations: 100, renderCpuTotalMs: 300,
    spritesDrawn: 1002, culledSprites: null, jsHeapUsedBytes: 1e7, alive: { left: 501, right: 501 } };
  const after = { ...before, atMs: 4000, frame: 90, presentations: 250, renderCpuTotalMs: 900, spritesDrawn: 980, jsHeapUsedBytes: 2e7 };
  const summary = summarizeLargeBattleSamples([before, after], 8);
  assert.equal(summary.targetSimulationHz, 240); assert.equal(summary.simulationHz, 20); assert.equal(summary.presentationFps, 50);
  assert.equal(summary.averageRenderCpuMs, 4); assert.equal(summary.actualSpeed, 2 / 3);
  assert.equal(summary.sampledCulledSprites, null); assert.equal(summary.sampledSpritesDrawn.average, 991);
  assert.equal(summary.sampledJsHeapBytes.max, 2e7);
  const culled = summarizeLargeBattleSamples([{ ...before, culledSprites: 1002 }, { ...after, culledSprites: 999 }], 8);
  assert.equal(culled.sampledCulledSprites.min, 999);
  const paused = summarizeLargeBattleSamples([before, { ...after, frame: before.frame }], 0);
  assert.equal(paused.simulationHz, 0); assert.equal(paused.presentationFps, 50);
  assert.throws(() => summarizeLargeBattleSamples([before], 1));
  assert.throws(() => summarizeLargeBattleSamples([before, before], 1));
  assert.throws(() => summarizeLargeBattleSamples([before, { ...after, frame: -1 }], 1));
});

test('Electron KB memory is converted without confusing missing private memory with zero', () => {
  const report = summarizeProcessMemory([{ type: 'Browser', memory: { workingSetSize: 10, peakWorkingSetSize: 12, privateBytes: 5 }, cpu: { percentCPUUsage: 8 } },
    { type: 'GPU', memory: { workingSetSize: 20, peakWorkingSetSize: 22 }, cpu: { percentCPUUsage: 2 } }]);
  assert.equal(report.summedWorkingSetBytes, 30 * 1024); assert.equal(report.summedPrivateBytes, null);
  assert.equal(report.processes[0].privateBytes, 5 * 1024); assert.equal(report.processes[1].privateBytes, null);
  assert.equal(report.processes[0].cpuPercent, 8); assert.equal(report.processes[0].peakWorkingSetBytes, 12 * 1024);
  assert.equal(summarizeProcessMemory([]).summedWorkingSetBytes, null);
});
