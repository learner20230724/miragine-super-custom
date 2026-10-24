import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDualAIOptions, dualAIInventoryRows, summarizeDualAI, chooseDifficultyByHotspot, recruitmentKey } from '../tools/verify-dual-ai.mjs';

const args = ['--dir', 'dist/dual-ai-qa-example/MiragineSuper', '--archive', 'artifacts/release-example.zip',
  '--version', '0.7.4-preview.1', '--commit', 'a'.repeat(40)];

test('dual AI verifier requires exact release provenance and ignored report destinations', () => {
  assert.equal(parseDualAIOptions(args).out, '.local/dual-ai-clean-hud-qa.json');
  assert.equal(parseDualAIOptions(args).screenshotPrefix, 'dual-ai-clean-hud');
  assert.equal(parseDualAIOptions([...args, '--out', 'output/dual-ai.json', '--screenshot-prefix', 'dual-ai-isolated']).out, 'output/dual-ai.json');
  assert.throws(() => parseDualAIOptions(args.slice(0, -2)), /Supply/);
  assert.throws(() => parseDualAIOptions(args.filter((_, index) => index !== 2 && index !== 3)), /Supply/);
  for (const suffix of [['--unknown', 'x'], ['--dir'], ['--dir', '--out']]) assert.throws(() => parseDualAIOptions([...args, ...suffix]), /Expected/);
  assert.throws(() => parseDualAIOptions([...args, '--dir', 'another']), /Duplicate/);
  assert.throws(() => parseDualAIOptions([...args, '--out', '.local/a.json', '--out', '.local/b.json']), /Duplicate/);
  assert.throws(() => parseDualAIOptions([...args, '--out', 'README.json']), /ignored output/);
  assert.throws(() => parseDualAIOptions([...args, '--screenshot-prefix', '../escape']), /safe/);
});

const inventory = () => ({ archiveRoot: 'MiragineSuper/', fileCount: 2, files: [
  { path: 'MiragineSuper/MiragineSuper.exe', bytes: 10, sha256: 'a'.repeat(64) },
  { path: 'MiragineSuper/config/custom.json', bytes: 20, sha256: 'b'.repeat(64) },
] });

test('dual AI archive verification preserves exact names and hashes without mutating inventory', () => {
  const input = inventory(), before = structuredClone(input), rows = dualAIInventoryRows(input);
  assert.deepEqual(rows, [{ name: 'MiragineSuper.exe', bytes: 10, sha256: 'a'.repeat(64) },
    { name: 'config/custom.json', bytes: 20, sha256: 'b'.repeat(64) }]);
  assert.deepEqual(input, before);
  rows[0].name = 'changed'; assert.deepEqual(input, before);
});

test('dual AI inventory rejects unsafe, personal and ambiguous paths before filesystem use', () => {
  for (const name of ['elsewhere.exe', 'MiragineSuper/', '/MiragineSuper/x', 'MiragineSuper//x', 'MiragineSuper/../x',
    'MiragineSuper/./x', 'MiragineSuper/C:/x', 'MiragineSuper/x\\y', 'MiragineSuper/x\ny',
    'MiragineSuper/x\ry', 'MiragineSuper/x\0y', 'MiragineSuper/userdata/private.json', 'MiragineSuper/USERDATA/private.json',
    'MiragineSuper/.tmp/file', 'MiragineSuper/config/../private']) {
    const input = inventory(); input.files[0].path = name;
    assert.throws(() => dualAIInventoryRows(input), /Unsafe/, name);
  }
  const duplicate = inventory(); duplicate.files[1].path = 'MiragineSuper/miraginesuper.EXE';
  assert.throws(() => dualAIInventoryRows(duplicate), /Case-colliding/);
});

test('dual AI inventory rejects malformed schema, size and digest data', () => {
  for (const input of [undefined, null, {}, { ...inventory(), archiveRoot: '/' },
    { ...inventory(), files: [] }, { ...inventory(), fileCount: 1 }]) assert.throws(() => dualAIInventoryRows(input), /Invalid/);
  for (const bytes of [-1, 1.5, Infinity, NaN, '1', Number.MAX_SAFE_INTEGER + 1]) {
    const input = inventory(); input.files[0].bytes = bytes; assert.throws(() => dualAIInventoryRows(input), /digest\/size/);
  }
  for (const sha256 of [undefined, '', 'a'.repeat(63), 'x'.repeat(64)]) {
    const input = inventory(); input.files[0].sha256 = sha256; assert.throws(() => dualAIInventoryRows(input), /digest\/size/);
  }
});

function fixtureState() {
  return { frame: 610, round: 890, matchMode: 'ai-vs-ai',
    dualAI: { leftDifficulty: 0, rightDifficulty: 3, applyDifficultyStats: true,
      statsDifficulties: { left: 0, right: 3 }, decisions: {
        left: { count: 1, lastFrame: 600, selectedUnit: 4 }, right: { count: 1, lastFrame: 600, selectedUnit: 2 },
      } }, selection: { left: [4, 0, 0], right: [2, 0, 1] },
    alive: { left: 1, right: 2 }, income: { left: 500, right: 600 },
    population: { left: 80, right: 98 }, money: { left: 500, right: 590 },
    customization: { paused: false, speed: 20 } };
}

test('dual AI observation summarizes independent strategy, real selection and recruitment flags', () => {
  const input = fixtureState(), before = structuredClone(input), summary = summarizeDualAI(input);
  assert.equal(summary.mode, 'ai-vs-ai'); assert.equal(summary.frame, 610);
  assert.deepEqual(summary.difficulty, { left: 0, right: 3 });
  assert.deepEqual(summary.recruitment, { left: false, right: true });
  assert.deepEqual(summary.decisions, input.dualAI.decisions);
  assert.equal(summary.speed, 20); assert.equal(summary.paused, false);
  assert.deepEqual(input, before);
  summary.decisions.left.count = 99; summary.selection.left[0] = 15;
  summary.statsDifficulties.right = 0; summary.money.left = 1; summary.alive.left = 99;
  assert.deepEqual(input, before, 'The report must never retain mutable simulation references');
});

test('dual AI observation does not claim AI state for original single or two-player games', () => {
  for (const mode of ['single', 'dual', undefined]) {
    assert.throws(() => summarizeDualAI({ ...fixtureState(), matchMode: mode }), /Missing/);
  }
  assert.throws(() => summarizeDualAI({ ...fixtureState(), dualAI: null }), /Missing/);
  const invalid = fixtureState(); invalid.dualAI.decisions.left.count = -1;
  assert.throws(() => summarizeDualAI(invalid), /Missing/);
});

for (const side of ['left', 'right']) for (const value of [0, 1, 2, 3]) {
  test(`dual AI ${side} difficulty ${value} clicks the original-style button hotspot`, async () => {
    const calls = [], hit = async (...args) => calls.push(args);
    await chooseDifficultyByHotspot({ hit, side, value });
    assert.deepEqual(calls, [[`dual-ai-${side}`, { value }]]);
  });
}

test('dual AI difficulty selection refuses invalid difficulty before any input', async () => {
  for (const { side, value } of [{ side: 'other', value: 0 }, { side: 'left', value: -1 }, { side: 'right', value: 4 },
    { side: 'left', value: '1' }, { side: 'right', value: 1.5 }]) {
    const calls = [], hit = async (...args) => calls.push(args);
    await assert.rejects(chooseDifficultyByHotspot({ hit, side, value }), /Difficulty/);
    assert.deepEqual(calls, []);
  }
});

test('dual AI difficulty selection requires a real hotspot helper and propagates click failures', async () => {
  await assert.rejects(chooseDifficultyByHotspot({ side: 'left', value: 1 }), /genuine mapped/);
  const failure = new Error('No visible original-style button');
  await assert.rejects(chooseDifficultyByHotspot({ hit() { throw failure; }, side: 'left', value: 3 }), error => error === failure);
});

test('dual AI recruitment acceptance binds red to physical Space and blue to Enter', () => {
  assert.equal(recruitmentKey('left'), 'Space'); assert.equal(recruitmentKey('right'), 'Enter');
  for (const side of [undefined, null, '', 'red', 'blue', 0, 1, 'Space', 'Enter']) {
    assert.throws(() => recruitmentKey(side), /left or right/);
  }
});
