import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { expectedSettingsStartup, matchesSettingsStartup, sameEffectiveSettingsStartup } from '../tools/settings-startup-profile.mjs';

const defaults = JSON.parse(fs.readFileSync(new URL('../config/defaults.generated.json', import.meta.url), 'utf8'));
const document = overrides => ({ schemaVersion: 1, profile: 'faithful', overrides });
const stateFor = expected => ({ config: structuredClone(expected.observableConfig), customization: {
  rulesMode: { current: expected.mode, next: expected.mode }, editor: { mode: expected.mode, nextMode: expected.mode,
    applied: structuredClone(expected.editorProfile), next: structuredClone(expected.editorProfile), draft: structuredClone(expected.editorProfile) } } });

test('startup mode follows effective overrides, not an envelope profile label or mere nonempty overrides', () => {
  assert.equal(expectedSettingsStartup(defaults, document({})).mode, 'original');
  assert.equal(expectedSettingsStartup(defaults, { ...document({}), profile: 'extended-caster-projectiles' }).mode, 'original');
  assert.equal(expectedSettingsStartup(defaults, document({ rules: { incomeLimit: defaults.rules.incomeLimit } })).mode, 'original');
  const expected = expectedSettingsStartup(defaults, { ...document({ casterProjectileLifetime: { mapWidths: 1.1, unitIds: [9, 12] } }), profile: 'extended-caster-projectiles' });
  assert.equal(expected.mode, 'custom'); assert.equal(expected.observableConfig.profile, defaults.profile);
  assert.deepEqual(expected.evidence.overrideKeys, ['casterProjectileLifetime']);
  assert.equal(expected.evidence.envelopeProfile, 'extended-caster-projectiles');
  assert.notEqual(expected.evidence.defaultsSha256, expected.evidence.effectiveConfigurationSha256);
  assert.equal(matchesSettingsStartup(stateFor(expected), expected), true);
});

test('unexposed and unknown extensions are compared strictly and never mistaken for faithful rules', () => {
  const original = structuredClone(defaults), custom = document({ qaUnexposedExtension: { nested: { enabled: true } } });
  const expected = expectedSettingsStartup(defaults, custom), faithful = expectedSettingsStartup(defaults, document({}));
  assert.equal(expected.mode, 'custom'); assert.deepEqual(expected.editorProfile, faithful.editorProfile);
  assert.equal(matchesSettingsStartup(stateFor(faithful), expected), false);
  assert.equal(matchesSettingsStartup(stateFor(expected), faithful), false);
  assert.equal(expectedSettingsStartup(defaults, document({ profile: 'different-effective-profile' })).mode, 'custom');
  assert.deepEqual(defaults, original); assert.deepEqual(custom.overrides, { qaUnexposedExtension: { nested: { enabled: true } } });
  for (const invalid of [{ ...document({}), unknownEnvelope: true }, document(null), document({ schemaVersion: 2 }),
    document({ rules: { frameRate: '30' } }), { ...document({}), schemaVersion: 2 }]) {
    assert.throws(() => expectedSettingsStartup(defaults, invalid));
  }
});

test('startup evidence checks actual active and staged profiles, including ordinary numerical overrides', () => {
  const expected = expectedSettingsStartup(defaults, document({ rules: { incomeLimit: 12345 }, units: { 0: { hp: 99 } } }));
  const initial = stateFor(expected); assert.equal(matchesSettingsStartup(initial, expected), true);
  assert.equal(expected.observableConfig.firstUnitHp, 99); assert.equal(expected.editorProfile.config.rules.incomeLimit, 12345);
  for (const mutate of [s => { s.config.firstUnitHp = 45; }, s => { s.customization.rulesMode.next = 'original'; },
    s => { s.customization.editor.mode = 'original'; }, s => { s.customization.editor.next.config.rules.incomeLimit++; },
    s => { s.customization.editor.applied.config.sides.left.units[0].hp++; }]) {
    const changed = structuredClone(initial); mutate(changed); assert.equal(matchesSettingsStartup(changed, expected), false);
  }
  assert.equal(matchesSettingsStartup(null, expected), false);
});

test('restart must restore initial applied/next identity while retaining, not activating, saved drafts', () => {
  for (const overrides of [{}, { casterProjectileLifetime: { mapWidths: 1.1, unitIds: [9, 12] } }]) {
    const expected = expectedSettingsStartup(defaults, document(overrides)), initial = stateFor(expected), restarted = structuredClone(initial);
    restarted.customization.editor.draft.config.sides.left.units[0].hp = 99;
    restarted.customization.editor.draft.config.sides.right.units[0].hp = 123;
    assert.equal(sameEffectiveSettingsStartup(initial, restarted), true);
    assert.equal(matchesSettingsStartup(restarted, expected), true);
    for (const key of ['applied', 'next']) {
      const bad = structuredClone(restarted); bad.customization.editor[key] = structuredClone(bad.customization.editor.draft);
      assert.equal(sameEffectiveSettingsStartup(initial, bad), false); assert.equal(matchesSettingsStartup(bad, expected), false);
    }
    const badConfig = structuredClone(restarted); badConfig.config.profile = 'unexpected';
    assert.equal(sameEffectiveSettingsStartup(initial, badConfig), false);
  }
  assert.equal(sameEffectiveSettingsStartup(null, null), false);
});
