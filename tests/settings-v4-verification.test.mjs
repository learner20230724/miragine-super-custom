import assert from 'node:assert/strict';
import test from 'node:test';
import { parseV4Options, exactSafeResource, cancelledSpawn, legacyFixture, SAFE_INTEGER_TEXT,
  compactFooterLayout, compactFooterRegion, preservedCrystalFractions, visibleHotspotCenter } from '../tools/verify-settings-v4.mjs';

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

test('mapped hotspot clicks use the visible logical-canvas intersection, including clipped music', () => {
  const music = { left: 616, right: 679, top: 440, bottom: 465, action: 'music' };
  const before = structuredClone(music);
  assert.deepEqual(visibleHotspotCenter(music), { x: 628, y: 452.5 });
  assert.deepEqual(visibleHotspotCenter({ left: 10, right: 30, top: 50, bottom: 80 }), { x: 20, y: 65 });
  assert.deepEqual(visibleHotspotCenter({ left: -40, right: 20, top: -10, bottom: 30 }), { x: 10, y: 15 });
  assert.deepEqual(visibleHotspotCenter({ left: 610, right: 700, top: 470, bottom: 500 }), { x: 625, y: 475 });
  assert.deepEqual(visibleHotspotCenter({ left: -100, right: 1000, top: -100, bottom: 1000 }), { x: 320, y: 240 });
  assert.deepEqual(music, before);
});

test('mapped hotspot clicks reject invisible, edge-only, inverted and invalid rectangles', () => {
  for (const rectangle of [
    { left: 640, right: 679, top: 10, bottom: 30 },
    { left: 700, right: 740, top: 10, bottom: 30 },
    { left: -10, right: 0, top: 10, bottom: 30 },
    { left: 10, right: 30, top: 480, bottom: 500 },
    { left: 10, right: 30, top: -20, bottom: 0 },
  ]) assert.throws(() => visibleHotspotCenter(rectangle), /no visible intersection/);
  for (const rectangle of [null, undefined, {},
    { left: 10, right: 10, top: 10, bottom: 30 },
    { left: 30, right: 10, top: 10, bottom: 30 },
    { left: 10, right: 30, top: 30, bottom: 10 },
    { left: '10', right: 30, top: 10, bottom: 30 },
    { left: NaN, right: 30, top: 10, bottom: 30 },
    { left: -Infinity, right: Infinity, top: 10, bottom: 30 },
  ]) assert.throws(() => visibleHotspotCenter(rectangle), /Invalid hotspot/);
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

test('unified footer proof requires three visible nonoverlapping buttons on the same row', () => {
  const buttons = ['undo', 'reset', 'apply-current'].map((action, index) => ({ action, visible: true,
    left: 10 + 100 * index, right: 100 + 100 * index, top: 500, bottom: 532 }));
  const before = structuredClone(buttons);
  assert.equal(compactFooterLayout(buttons), true);
  assert.equal(compactFooterLayout(buttons.map((button, index) => ({ ...button, top: button.top + .3 * index }))), true);
  for (const invalid of [null, [], buttons.slice(1), [...buttons, buttons[0]],
    buttons.map((button, index) => ({ ...button, visible: index !== 2 })),
    buttons.map((button, index) => ({ ...button, action: index === 2 ? 'apply-next' : button.action })),
    buttons.map((button, index) => ({ ...button, top: index === 2 ? 540 : button.top, bottom: index === 2 ? 572 : button.bottom })),
    buttons.map((button, index) => ({ ...button, left: index === 1 ? 90 : button.left })),
    buttons.map(button => ({ ...button, top: NaN }))]) assert.equal(compactFooterLayout(invalid), false);
  assert.equal(compactFooterLayout(buttons, -1), false); assert.deepEqual(buttons, before);
  for (const height of [53, 59.99, 60]) assert.equal(compactFooterRegion({ buttons, height }), true);
  for (const height of [0, -1, 60.01, 90, Infinity, NaN, '53', undefined]) {
    assert.equal(compactFooterRegion({ buttons, height }), false);
  }
  assert.equal(compactFooterRegion(), false);
  assert.equal(compactFooterRegion({ buttons: buttons.slice(1), height: 53 }), false);
});

test('fixed health-policy proof compares each damaged crystal fraction and rejects reset/clamp', () => {
  const before = { left: { baseHp: 777, baseMaxHp: 2000 }, right: { baseHp: 888, baseMaxHp: 3000 } };
  const after = { left: { baseHp: 1554, baseMaxHp: 4000 }, right: { baseHp: 1776, baseMaxHp: 6000 } };
  assert.equal(preservedCrystalFractions(before, after), true);
  for (const invalid of [null, {}, { ...after, left: { baseHp: 777, baseMaxHp: 4000 } },
    { ...after, right: { baseHp: 6000, baseMaxHp: 6000 } }, { ...after, left: { baseHp: 0, baseMaxHp: 4000 } },
    { ...after, right: { baseHp: Infinity, baseMaxHp: Infinity } }]) assert.equal(preservedCrystalFractions(before, invalid), false);
  assert.equal(preservedCrystalFractions(before, after, NaN), false);
  assert.deepEqual(before.left, { baseHp: 777, baseMaxHp: 2000 });
});
