import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mergeConfiguration } from '../src/config/index.mjs';
import { MiragineSimulation, validateCoreConfiguration } from '../src/core/index.mjs';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const sandboxPrefix = 'miragine-custom-preservation-';

function childPath(root, relative) {
  assert.equal(typeof relative, 'string');
  assert.ok(!path.isAbsolute(relative), 'fixture copy paths must be relative');
  const absolute = path.resolve(root, relative);
  const inside = path.relative(path.resolve(root), absolute);
  assert.ok(inside && inside !== '..' && !inside.startsWith(`..${path.sep}`) && !path.isAbsolute(inside),
    'fixture path must resolve inside its intended root');
  return absolute;
}

test('R05: real isolated regeneration preserves edited custom configuration and extension byte-for-byte, and their settings remain effective', async t => {
  const tempParent = path.resolve(os.tmpdir());
  const fixtureRoot = await fs.mkdtemp(path.join(tempParent, sandboxPrefix));
  t.after(async () => {
    // Verify the resolved deletion target is this uniquely named temporary
    // fixture, never the project or a computed parent directory.
    const absolute = path.resolve(fixtureRoot);
    assert.equal(path.dirname(absolute), tempParent);
    assert.ok(path.basename(absolute).startsWith(sandboxPrefix));
    await fs.rm(absolute, { recursive: true, force: true });
  });

  const baselineDefaults = await fs.readFile(childPath(projectRoot, 'config/defaults.generated.json'));
  const baselineProvenance = await fs.readFile(childPath(projectRoot, 'generated/config-provenance.json'));
  const provenance = JSON.parse(baselineProvenance.toString('utf8'));
  const sourcePaths = provenance.sources.map(source => source.path);
  assert.ok(sourcePaths.length >= 9, 'copy the complete extraction-source manifest, including P-code corroboration');
  const requiredFiles = [
    'tools/extract_game_config.py', ...sourcePaths,
    'reference/super-original.swf', 'reference/super-assets-original.swf',
  ];
  for (const relative of new Set(requiredFiles)) {
    const destination = childPath(fixtureRoot, relative);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.copyFile(childPath(projectRoot, relative), destination);
  }
  for (const source of provenance.sources) {
    assert.equal(digest(await fs.readFile(childPath(fixtureRoot, source.path))), source.sha256,
      `fixture must preserve exact source evidence: ${source.path}`);
  }

  // These are deliberate user edits in a disposable copy, not changes to the
  // project's faithful default profile. Preserve non-generator formatting too.
  const customDocument = {
    schemaVersion: 1,
    $comment: '人工修改：重新生成不能覆盖这份配置。',
    profile: 'custom-preservation-test',
    overrides: { units: { 0: { cost: 7, hp: 99 } }, rules: { startingIncome: 777 } },
  };
  const customBytes = Buffer.from(`${JSON.stringify(customDocument, null, '\t').replaceAll('\n', '\r\n')}\r\n`, 'utf8');
  const extensionBytes = Buffer.from('// 人工扩展哨兵：重新生成必须逐字节保留。\r\nexport const sentinel = "user-extension-kept";\r\n', 'utf8');
  const customPath = childPath(fixtureRoot, 'config/custom.json');
  const extensionPath = childPath(fixtureRoot, 'src/extensions/custom.mjs');
  await fs.mkdir(path.dirname(customPath), { recursive: true });
  await fs.mkdir(path.dirname(extensionPath), { recursive: true });
  await fs.writeFile(customPath, customBytes);
  await fs.writeFile(extensionPath, extensionBytes);

  // Stale generated files prove this invokes the real writer rather than only
  // testing a no-op/read-only --check or a stubbed regeneration path.
  const defaultsPath = childPath(fixtureRoot, 'config/defaults.generated.json');
  const provenancePath = childPath(fixtureRoot, 'generated/config-provenance.json');
  await fs.mkdir(path.dirname(provenancePath), { recursive: true });
  await fs.writeFile(defaultsPath, 'stale generated fixture defaults\n');
  await fs.writeFile(provenancePath, 'stale generated fixture provenance\n');
  const extraction = spawnSync(process.env.PYTHON ?? 'python', ['-B', 'tools/extract_game_config.py'], {
    cwd: fixtureRoot, encoding: 'utf8', windowsHide: true, timeout: 30_000,
  });
  assert.equal(extraction.error, undefined, extraction.error?.message);
  assert.equal(extraction.status, 0, extraction.stderr || extraction.stdout);
  assert.match(extraction.stdout, /Generated: config\/defaults\.generated\.json/);
  assert.match(extraction.stdout, /Generated: generated\/config-provenance\.json/);
  assert.deepEqual(await fs.readFile(customPath), customBytes, 'custom configuration must remain byte-identical');
  assert.deepEqual(await fs.readFile(extensionPath), extensionBytes, 'custom extension must remain byte-identical');
  const regeneratedDefaults = await fs.readFile(defaultsPath);
  assert.equal(digest(regeneratedDefaults), digest(baselineDefaults), 'regenerated faithful defaults must retain the committed hash');
  assert.equal(digest(await fs.readFile(provenancePath)), digest(baselineProvenance), 'regenerated provenance must be deterministic');
  const customExtension = await import(pathToFileURL(extensionPath).href);
  assert.equal(customExtension.sentinel, 'user-extension-kept');

  const defaults = JSON.parse(regeneratedDefaults.toString('utf8'));
  const effective = mergeConfiguration(defaults, JSON.parse((await fs.readFile(customPath)).toString('utf8')),
    { validateEffective: validateCoreConfiguration });
  const simulation = new MiragineSimulation({ config: effective, rng: () => 0.5, autoStart: false });
  assert.equal(simulation.leftMoney, 0, 'start with the genuine zero-money economy, without a test money injection');
  assert.equal(simulation.leftIncome, 777);
  simulation.step(179);
  assert.equal(simulation.leftMoney, 0); assert.equal(simulation.friendList.length, 1);
  simulation.step(); // Original initial 180-frame settlement and automatic recruitment.
  assert.equal(simulation.round, 900);
  assert.equal(simulation.leftMoney, 770, '777 natural settlement minus custom cost 7');
  assert.equal(simulation.leftIncome, 781, 'custom initial income 777 plus original recruit income 4');
  assert.equal(simulation.leftPopulation, 79);
  assert.equal(simulation.friendList.length, 2);
  assert.equal(simulation.friendList[1].id, 0);
  assert.equal(simulation.friendList[1].nowHP, 99, 'custom health must reach the actual recruited entity');
  assert.equal(defaults.units[0].cost, 20); assert.equal(defaults.units[0].hp, 45);
  assert.equal(defaults.rules.startingIncome, 500, 'effective overrides must not mutate generated defaults');
});
