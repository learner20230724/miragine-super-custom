import assert from 'node:assert/strict';
import test from 'node:test';
import { parseV4Options, exactSafeResource, cancelledSpawn, legacyFixture, SAFE_INTEGER_TEXT } from '../tools/verify-settings-v4.mjs';

test('v4 verifier has separate proof names and retains validated options', () => {
  const value = parseV4Options(['--url', 'http://127.0.0.1:43210/']);
  assert.equal(value.out, '.local/settings-v4-verification.json');
  assert.equal(value.screenshotPrefix, 'settings-v4');
  assert.equal(value.sampleSeconds, 1);
  const explicit = parseV4Options(['--dir', 'fresh-v4-fixture', '--out', '.local/v4-final.json', '--screenshot-prefix', 'v4-final', '--headless']);
  assert.equal(explicit.out, '.local/v4-final.json'); assert.equal(explicit.screenshotPrefix, 'v4-final'); assert.equal(explicit.headless, true);
});

test('v4 verifier rejects remote authenticated or ambiguous targets', () => {
  for (const args of [[], ['--url', 'https://example.com'], ['--url', 'http://user:pass@localhost/'],
    ['--dir', 'a', '--url', 'http://127.0.0.1'], ['--dir', 'a', '--sample-seconds', 'NaN'],
    ['--dir', 'a', '--screenshot-prefix', '../private']]) assert.throws(() => parseV4Options(args));
  assert.equal(parseV4Options(['--help']).help, true);
});

test('large-resource assertions require exact nonnegative safe integers', () => {
  assert.equal(SAFE_INTEGER_TEXT, '9007199254740991');
  for (const number of [0, 3000000000, 4000000001, Number.MAX_SAFE_INTEGER]) assert.equal(exactSafeResource(number, number), true);
  for (const invalid of [-1, .5, NaN, Infinity, -Infinity, '3000000000', Number.MAX_SAFE_INTEGER + 1, null, undefined]) {
    assert.equal(exactSafeResource(invalid, invalid), false);
  }
  assert.equal(exactSafeResource(3000000000, 3000000001), false);
});

test('cancelled spawn proof must be a genuine partial cancellation', () => {
  const job = { status: 'cancelled', requested: Number.MAX_SAFE_INTEGER, completed: 32 };
  assert.equal(cancelledSpawn(job), true);
  assert.equal(cancelledSpawn({ ...job, completed: 0 }), true);
  for (const invalid of [null, {}, { ...job, status: 'completed' }, { ...job, status: 'running' },
    { ...job, requested: Infinity }, { ...job, requested: '1000' }, { ...job, completed: -1 },
    { ...job, completed: .5 }, { ...job, completed: job.requested }, { ...job, completed: job.requested + 1 }]) {
    assert.equal(cancelledSpawn(invalid), false);
  }
  assert.deepEqual(job, { status: 'cancelled', requested: Number.MAX_SAFE_INTEGER, completed: 32 });
});

test('legacy fixture removes v2-only fields without mutating actual export', () => {
  const document = { schemaVersion: 1, name: 'current', profile: { schemaVersion: 2,
    config: { units: { 0: { hp: 100, cost: 20 } }, sides: { left: {}, right: {} },
      rules: { incomeLimit: 5000, leftStartingPopulation: 60 }, difficulties: { 0: { rightStartingIncome: 50, ai: { forceMoneyEnabled: true } } } },
    rules: { enemyAi: true } } };
  const before = structuredClone(document), legacy = legacyFixture(document);
  assert.equal(legacy.schemaVersion, 1); assert.equal(legacy.profile.schemaVersion, 1);
  assert.equal(legacy.profile.config.units[0].hp, 145); assert.equal(legacy.profile.config.units[0].cost, 19);
  assert.equal('sides' in legacy.profile.config, false); assert.equal('leftStartingPopulation' in legacy.profile.config.rules, false);
  assert.equal('ai' in legacy.profile.config.difficulties[0], false); assert.equal(legacy.profile.config.difficulties[0].rightStartingIncome, 50);
  assert.deepEqual(document, before);
  for (const input of [null, {}, { profile: { schemaVersion: 1 } }]) assert.throws(() => legacyFixture(input));
});
