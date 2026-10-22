import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const config = JSON.parse(read('config/defaults.generated.json'));
const provenance = JSON.parse(read('generated/config-provenance.json'));
const digest = value => createHash('sha256').update(value).digest('hex');

test('all 16 stable unit IDs preserve the recovered Grid raw numeric values', () => {
  const source = read('recovered/as3/scripts/Grid.as');
  const rows = JSON.parse(source.match(/this\.entity\s*=\s*(\[[\s\S]*?\]);/)[1]);
  assert.equal(config.schemaVersion, 1);
  assert.deepEqual(Object.keys(config.units), Array.from({length: 16}, (_, i) => String(i)));
  for (const row of rows) {
    for (const [key, value] of Object.entries(row)) {
      assert.deepEqual(config.units[row.id][key], value, `unit ${row.id}.${key}`);
    }
  }
  assert.deepEqual(rows.map(u => u.ss), [5,15,6,12,0,11,7,1,14,10,8,9,4,3,13,2]);
});

test('actual stat conversions are world units and integer frames, not tooltip seconds', () => {
  const expectedFrames = [16,17,40,24,26,26,48,28,30,48,20,29,48,21,23,31];
  for (const unit of Object.values(config.units)) {
    assert.equal(unit.runtime.moveSpeed, unit.moveSpeed * 1.3);
    assert.equal(unit.runtime.range, unit.range * 60);
    assert.equal(unit.runtime.weaponSpeed, unit.weaponSpeed * 20);
    assert.equal(unit.runtime.attackCooldownFrames, expectedFrames[unit.id]);
    assert.equal(unit.runtime.attackCooldownSeconds, expectedFrames[unit.id] / 30);
  }
  assert.equal(config.units['0'].runtime.attackCooldownFrames, 16);
  assert.notEqual(config.units['0'].runtime.attackCooldownSeconds, 0.83);
});

test('raw unit IDs are mapped through ss to the original animation symbols', () => {
  assert.equal(Object.keys(config.animations).length, 133);
  for (const unit of Object.values(config.units)) {
    for (const [action, expectedSpeed, expectedLoop] of [
      ['idle', 0.15, true], ['run', 0.3, true],
      ['attack', 0.3, false], ['dead', 0.2, false],
    ]) {
      const animation = unit.animation[action];
      assert.equal(animation.redSymbol, `A${unit.ss}_${action}`);
      assert.equal(animation.blueSymbol, `B${unit.ss}_${action}`);
      assert.equal(animation.speed, expectedSpeed);
      assert.equal(animation.loop, expectedLoop);
      assert.equal(animation.frames, config.animations[animation.redSymbol].frames);
      assert.equal(animation.frames, config.animations[animation.blueSymbol].frames);
    }
  }
  assert.equal(config.animations.A_crystal.frames, 1);
  assert.equal(config.animations.B_crystal.frames, 1);
  assert.equal(config.animations.fireball.frames, 3);
  assert.equal(config.animations.fireball.speed, 0.15);
  assert.equal(config.animations.thunderball.frames, 16);
  assert.equal(config.animations.storm.frames, 10);
  assert.equal(config.units['0'].animation.attack.frames, 5);
  assert.equal(config.units['1'].animation.attack.frames, 5);
  assert.equal(config.units['8'].animation.attack.frames, 7);
});

test('economy defaults use init values, not replaced class property initializers', () => {
  const rules = config.rules;
  assert.equal(rules.frameRate, 30);
  assert.equal(rules.initialMoney, 0);
  assert.equal(rules.startingIncome, 500);
  assert.equal(rules.populationLimit, 80);
  assert.equal(rules.incomeLimit, 8000);
  assert.equal(rules.initialRoundFrames, 180);
  assert.equal(rules.roundFrames, 900);
  assert.equal(rules.recruitEveryFrames, 3);
  assert.equal(rules.baseHp, 3500);
  assert.deepEqual(rules.baseDamage, [100, 100]);
  assert.equal(rules.baseWeaponSpeedFrames, 30);
});

test('difficulty changes are the exact probability and impossible-side overrides', () => {
  assert.deepEqual(Object.values(config.difficulties).map(d => d.counterSelectionProbability), [0, 0.5, 1, 1]);
  for (const key of ['0', '1', '2']) {
    const difficulty = config.difficulties[key];
    assert.equal(difficulty.rightStartingIncome, 500);
    assert.equal(difficulty.rightStartingPopulation, 80);
    assert.deepEqual(difficulty.blueBaseDamage, [100, 100]);
    assert.equal(difficulty.blueBaseWeaponSpeedFrames, 30);
  }
  const impossible = config.difficulties['3'];
  assert.equal(impossible.rightStartingIncome, 600);
  assert.equal(impossible.rightStartingPopulation, 100);
  assert.deepEqual(impossible.blueBaseDamage, [110, 110]);
  assert.equal(impossible.blueBaseWeaponSpeedFrames, 25);
  assert.match(provenance.semantics.population, /reset/);
  assert.match(provenance.mappings.difficulties, /subsequently resets/);
});

test('AI counter table and strict branch thresholds match the source', () => {
  assert.equal(Object.keys(config.ai.counterChoices).length, 15);
  assert.deepEqual(config.ai.counterChoices['2'], [4,6,7,8]);
  assert.deepEqual(config.ai.counterChoices['15'], [9,10,11]);
  assert.equal(config.ai.newbieIncomeThreshold, 200);
  assert.equal(config.ai.counterFallbackIncomeThreshold, 1000);
  assert.equal(config.ai.randomIncomeThreshold, 450);
  assert.equal(config.ai.forceOverlordMoneyThreshold, 15030);
  assert.equal(config.ai.forceOverlordEliteCountThreshold, 2);
});

test('provenance has source hashes and exact raw field line mappings without machine paths', () => {
  for (const source of provenance.sources) {
    assert.equal(source.sha256, digest(read(source.path)));
    assert.ok(!source.path.includes('\\'));
    assert.ok(!/^[A-Za-z]:/.test(source.path));
  }
  const lines = read('recovered/as3/scripts/Grid.as').split(/\r?\n/);
  for (const unit of Object.values(config.units)) {
    const record = provenance.unitFields[unit.id];
    assert.equal(record.source, 'recovered/as3/scripts/Grid.as');
    assert.match(lines[record.fields.cost - 1], new RegExp(`"cost":${unit.cost}\\b`));
    assert.match(lines[record.fields.weaponSpeed - 1], /"weaponSpeed":/);
  }
  assert.deepEqual(config.notApplicable, ['buildingConstruction','buildingUpgrades','playerSkills','levelWaves']);
});

test('both parameter documents list every original unit without numeric transcription errors', () => {
  for (const path of ['docs/parameters.zh-CN.md', 'docs/parameters.en.md']) {
    const document = read(path);
    for (const u of Object.values(config.units)) {
      const row = `| ${u.id} | ${u.name} | ${u.cost} | ${u.population} | ${u.income} | ${u.hp} | ${u.armorTypeID} / ${u.armor} | ${u.damage[0]} / ${u.damage[1]} |`;
      assert.ok(document.includes(row), `${path} missing exact unit ${u.id} economy/combat row`);
    }
    assert.ok(document.includes('custom.json'));
    assert.ok(document.includes('animationSpeeds'));
    assert.ok(document.includes('15030'));
  }
});

test('regeneration is deterministic and does not overwrite custom configuration', () => {
  const customBefore = read('config/custom.json');
  const defaultsBefore = read('config/defaults.generated.json');
  const provenanceBefore = read('generated/config-provenance.json');
  const result = spawnSync(process.env.PYTHON ?? 'python', ['-B', 'tools/extract_game_config.py'], {
    cwd: root, encoding: 'utf8', windowsHide: true,
  });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  assert.equal(read('config/custom.json'), customBefore);
  assert.equal(read('config/defaults.generated.json'), defaultsBefore);
  assert.equal(read('generated/config-provenance.json'), provenanceBefore);
  const checked = spawnSync(process.env.PYTHON ?? 'python', ['-B', 'tools/extract_game_config.py', '--check'], {
    cwd: root, encoding: 'utf8', windowsHide: true,
  });
  assert.equal(checked.status, 0, checked.stderr || checked.error?.message);
});
