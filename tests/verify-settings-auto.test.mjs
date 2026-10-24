import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAutoOptions, correctAutoOrder, autoTiming } from '../tools/verify-settings-auto.mjs';

const args = ['--dir', 'dist/settings-auto-proof/MiragineSuper', '--version', '0.7.0-preview.1', '--commit', 'a'.repeat(40)];
test('automatic-settings verifier requires explicit provenance and safe local outputs', () => {
  assert.equal(parseAutoOptions(args).out, '.local/settings-auto-qa.json');
  assert.throws(() => parseAutoOptions(args.slice(0, 4)), /Supply/);
  assert.throws(() => parseAutoOptions([...args, '--unknown', 'x']), /Expected/);
  assert.throws(() => parseAutoOptions([...args, '--out', 'README.json']), /ignored output/);
  assert.throws(() => parseAutoOptions([...args, '--screenshot-prefix', '../escape']), /safe/);
});
test('automatic-settings verifier checks actual homepage order and both sides', () => {
  const parts = [{ kind: 'summary' }, { title: '生成士兵 / 清场' }, { title: '通用基础规则' }, { sides: ['left', 'right'] }];
  assert.equal(correctAutoOrder(parts), true);
  assert.equal(correctAutoOrder([parts[0], parts[2], parts[1], parts[3]]), false);
  assert.equal(correctAutoOrder([...parts.slice(0, 3), { sides: ['left'] }]), false);
});
test('high-target observation reports measured throughput instead of assuming target achieved', () => {
  const result = autoTiming({ at: 100, frame: 10 }, { at: 600, frame: 40 }, 100);
  assert.equal(result.simulationHz, 60); assert.equal(result.actualSpeed, 2); assert.equal(result.target, 100);
  assert.equal(result.logicalHz, 30); assert.equal(result.advancing, true);
  assert.equal(autoTiming({ at: 0, frame: 0 }, { at: 100, frame: 0 }, 0).frozen, true);
  assert.throws(() => autoTiming({ at: 10, frame: 0 }, { at: 10, frame: 0 }, 1), /Invalid/);
  assert.throws(() => autoTiming({ at: 0, frame: 0 }, { at: 100, frame: 1 }, 101), /Invalid/);
});
