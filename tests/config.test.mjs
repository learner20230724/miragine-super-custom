import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadConfiguration, mergeConfiguration, validateConfiguration, validateJsonValue,
  validateOverrideDocument } from '../src/config/index.mjs';
import { assertGeneratedTarget, writeGeneratedJsonAtomic } from '../tools/config-generation.mjs';

// Explicitly synthetic fixture. These are not recovered game stats or systems.
const fixture = () => ({ schemaVersion: 1, units: { synthetic: { health: 12, cost: 3 } },
  rules: { synthetic: { enabled: true, sequence: [1, 2], nullable: null } } });
const envelope = (overrides = {}) => ({ schemaVersion: 1, profile: 'faithful', overrides });

async function sandbox(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'miragine-config-test-'));
  t.after(async () => {
    const absolute = path.resolve(root);
    assert.equal(path.dirname(absolute), path.resolve(os.tmpdir()));
    assert.ok(path.basename(absolute).startsWith('miragine-config-test-'));
    await fs.rm(absolute, { recursive: true, force: true });
  });
  return root;
}

test('nested overrides take effect without changing generated defaults or custom data', () => {
  const defaults = fixture();
  const custom = envelope({ units: { synthetic: { cost: 8 } }, rules: { synthetic: { sequence: [7] } } });
  const beforeDefaults = JSON.stringify(defaults);
  const beforeCustom = JSON.stringify(custom);
  const effective = mergeConfiguration(defaults, custom);
  assert.equal(effective.units.synthetic.health, 12);
  assert.equal(effective.units.synthetic.cost, 8);
  assert.deepEqual(effective.rules.synthetic.sequence, [7]);
  assert.equal(effective.profile, undefined);
  assert.equal(effective.overrides, undefined);
  assert.equal(JSON.stringify(defaults), beforeDefaults);
  assert.equal(JSON.stringify(custom), beforeCustom);
  assert.ok(Object.isFrozen(effective.units.synthetic));
  assert.throws(() => { effective.units.synthetic.cost = 2; }, TypeError);
});

test('empty overrides preserve exact data and do not manufacture missing sections', () => {
  const effective = mergeConfiguration({ schemaVersion: 1 }, envelope());
  assert.deepEqual(effective, { schemaVersion: 1 });
});

test('arrays replace, null remains explicit, and mutable results do not alias inputs', () => {
  const defaults = fixture();
  const custom = envelope({ rules: { synthetic: { nullable: 'configured' } }, extra: null });
  const effective = mergeConfiguration(defaults, custom, { freeze: false });
  effective.rules.synthetic.sequence.push(4);
  assert.deepEqual(defaults.rules.synthetic.sequence, [1, 2]);
  assert.equal(effective.rules.synthetic.nullable, 'configured');
  assert.equal(effective.extra, null);
});

test('schema versions, envelopes, and attempts to override schemaVersion are rejected', () => {
  for (const value of [null, [], {}, { schemaVersion: 2 }, { schemaVersion: '1' }]) {
    assert.throws(() => validateConfiguration(value), TypeError);
  }
  for (const value of [{ schemaVersion: 1 }, envelope([]), { ...envelope(), typo: 1 },
    { ...envelope(), profile: '' }, { ...envelope(), $comment: 3 }, envelope({ schemaVersion: 1 })]) {
    assert.throws(() => validateOverrideDocument(value), TypeError);
  }
});

test('prototype-pollution keys are rejected at every depth, including inside arrays', () => {
  for (const key of ['__proto__', 'prototype', 'constructor']) {
    const custom = JSON.parse(`{"schemaVersion":1,"overrides":{"nested":[{"${key}":{"polluted":true}}]}}`);
    assert.throws(() => mergeConfiguration(fixture(), custom), /forbidden property/);
  }
  assert.equal({}.polluted, undefined);
});

test('only finite, plain, dense JSON data is accepted, without evaluating accessors', () => {
  const circular = {}; circular.circular = circular;
  let getterCalled = false;
  const accessor = { get value() { getterCalled = true; return 1; } };
  const hidden = Object.defineProperty({}, 'hidden', { value: 1 });
  const symbol = { [Symbol('hidden')]: 1 };
  const extraArrayKey = [1]; extraArrayKey.extra = 2;
  for (const value of [undefined, NaN, Infinity, 1n, () => {}, new Date(), circular, accessor,
    hidden, symbol, [, 1], extraArrayKey]) {
    assert.throws(() => validateJsonValue(value), TypeError);
  }
  assert.equal(getterCalled, false);
  assert.doesNotThrow(() => validateJsonValue(Object.assign(Object.create(null), { valid: true })));
  assert.throws(() => validateJsonValue({ nested: {} }, { maxDepth: 0 }), /nesting/);
});

test('recovered-domain validator can reject invalid effective values', () => {
  const validateEffective = (configuration) => {
    if (configuration.units.synthetic.cost < 0) throw new RangeError('synthetic cost must be nonnegative');
  };
  assert.throws(() => mergeConfiguration(fixture(), envelope({ units: { synthetic: { cost: -1 } } }),
    { validateEffective }), /nonnegative/);
  assert.throws(() => mergeConfiguration(fixture(), envelope(), { freeze: 'yes' }), /freeze/);
  assert.throws(() => mergeConfiguration(fixture(), envelope(), { validateEffective: true }), /validateEffective/);
});

test('browser-compatible loader fetches separate documents and uses effective overrides', async () => {
  const calls = [];
  const signal = new AbortController().signal;
  const documents = { defaults: fixture(), custom: envelope({ units: { synthetic: { cost: 6 } } }) };
  const fetchImpl = async (url, options) => {
    calls.push([url, options]);
    return { ok: true, json: async () => documents[url] };
  };
  const effective = await loadConfiguration({ defaultsUrl: 'defaults', customUrl: 'custom', fetchImpl, signal });
  assert.equal(effective.units.synthetic.cost, 6);
  assert.deepEqual(calls.map(([url]) => url), ['defaults', 'custom']);
  assert.ok(calls.every(([, options]) => options.signal === signal && options.cache === 'no-store'));
  const unchanged = await loadConfiguration({ defaultsUrl: 'defaults', fetchImpl });
  assert.equal(unchanged.units.synthetic.cost, 3);
});

test('missing, malformed, and invalid custom documents fail rather than hiding edits', async () => {
  await assert.rejects(loadConfiguration({}), /defaultsUrl/);
  await assert.rejects(loadConfiguration({ defaultsUrl: 'defaults', customUrl: null }), /customUrl/);
  await assert.rejects(loadConfiguration({ defaultsUrl: 'defaults', fetchImpl: null }), /fetchImpl/);
  const missing = async (url) => url === 'defaults' ? { ok: true, json: async () => fixture() }
    : { ok: false, status: 404 };
  await assert.rejects(loadConfiguration({ defaultsUrl: 'defaults', customUrl: 'custom', fetchImpl: missing }), /custom.*404/);
  const malformed = async () => ({ ok: true, json: async () => { throw new SyntaxError('synthetic failure'); } });
  await assert.rejects(loadConfiguration({ defaultsUrl: 'defaults', fetchImpl: malformed }), /invalid JSON/);
  const invalid = async (url) => ({ ok: true, json: async () => url === 'defaults' ? fixture() : {} });
  await assert.rejects(loadConfiguration({ defaultsUrl: 'defaults', customUrl: 'custom', fetchImpl: invalid }), /schemaVersion/);
});

test('regeneration writes only allowed outputs and preserves custom configuration and extensions byte-for-byte', async (t) => {
  const root = await sandbox(t);
  await fs.mkdir(path.join(root, 'config'));
  await fs.mkdir(path.join(root, 'src', 'extensions'), { recursive: true });
  const customPath = path.join(root, 'config', 'custom.json');
  const extensionPath = path.join(root, 'src', 'extensions', 'custom.mjs');
  const customText = `${JSON.stringify(envelope({ units: { synthetic: { cost: 9 } } }), null, 3)}\r\n`;
  const extensionText = '// synthetic user-owned extension\r\nexport const synthetic = true;\r\n';
  await fs.writeFile(customPath, customText);
  await fs.writeFile(extensionPath, extensionText);
  await writeGeneratedJsonAtomic(root, 'config/defaults.generated.json', fixture());
  const revised = fixture(); revised.units.synthetic.health = 15;
  await writeGeneratedJsonAtomic(root, 'config/defaults.generated.json', revised);
  await writeGeneratedJsonAtomic(root, 'generated/nested/recovery.json', { recovered: true });
  assert.equal(await fs.readFile(customPath, 'utf8'), customText);
  assert.equal(await fs.readFile(extensionPath, 'utf8'), extensionText);
  const defaults = JSON.parse(await fs.readFile(path.join(root, 'config/defaults.generated.json'), 'utf8'));
  const custom = JSON.parse(await fs.readFile(customPath, 'utf8'));
  const effective = mergeConfiguration(defaults, custom);
  assert.equal(effective.units.synthetic.health, 15);
  assert.equal(effective.units.synthetic.cost, 9);
  assert.deepEqual((await fs.readdir(path.join(root, 'config'))).sort(), ['custom.json', 'defaults.generated.json']);
});

test('generated output rejects custom paths, extensions, traversal, outside paths, and directories', async (t) => {
  const root = await sandbox(t);
  for (const output of ['config/custom.json', 'config/nested/defaults.generated.json', 'src/extensions/custom.mjs',
    'generated/../config/custom.json', '../outside.generated.json', path.join(path.dirname(root), 'outside.json'),
    'config/defaults.json', '.', '', 'generated/invalid\0.json', 'config/custom.json:extra.generated.json',
    'generated/CON.json', 'generated/LPT1', 'generated/space .json ', 'generated/dot.']) {
    await assert.rejects(assertGeneratedTarget(root, output));
  }
  await fs.mkdir(path.join(root, 'generated', 'directory.json'), { recursive: true });
  await assert.rejects(assertGeneratedTarget(root, 'generated/directory.json'), /not a file/);
  assert.equal(await assertGeneratedTarget(root, 'config/defaults.generated.json'), path.join(root, 'config/defaults.generated.json'));
});

test('generated output rejects a symlink or Windows junction pointing outside the project', async (t) => {
  const root = await sandbox(t);
  const outside = await sandbox(t);
  await fs.mkdir(path.join(root, 'generated'));
  try {
    await fs.symlink(outside, path.join(root, 'generated', 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
  } catch (error) {
    if (['EPERM', 'ENOTSUP', 'EACCES'].includes(error.code)) { t.skip('Host does not permit symlink creation'); return; }
    throw error;
  }
  await assert.rejects(writeGeneratedJsonAtomic(root, 'generated/linked/escaped.json', {}), /symbolic links|junctions/);
  assert.deepEqual(await fs.readdir(outside), []);
});

test('invalid generated JSON fails before creating any output', async (t) => {
  const root = await sandbox(t);
  await assert.rejects(writeGeneratedJsonAtomic(root, 'generated/invalid.json', { value: undefined }), /JSON value/);
  await assert.rejects(writeGeneratedJsonAtomic(root, 'generated/invalid.json', {}, { space: 20 }), /space/);
  assert.deepEqual(await fs.readdir(root), []);
});
