import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const python = process.env.PYTHON || 'python';
const tool = path.join(root, 'tools/create_release_archive.py');
const digest = (data) => createHash('sha256').update(data).digest('hex');
const info = { version: '0.1.0-preview.1', sourceCommit: 'a'.repeat(40), platform: 'win32', arch: 'x64', electronVersion: '44.4.3' };

function fixture(t) {
  const prefix = path.join(os.tmpdir(), 'miragine-archive-test-');
  const directory = fs.mkdtempSync(prefix);
  t.after(() => {
    assert.ok(path.resolve(directory).startsWith(path.resolve(prefix)));
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return directory;
}

function put(directory, name, bytes = name) {
  const file = path.join(directory, name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, bytes);
  return file;
}

function portable(directory) {
  const files = {
    'MiragineSuper.exe': Buffer.from([77, 90, 0, 128, 255, 42]),
    'resources/app.asar': Buffer.from('fake-asar\0original bytes'),
    'LICENSE': 'Electron original license\r\n', 'LICENSE.project.txt': 'Project MIT license\n', 'NOTICE.txt': 'Original notice',
    'README.md': '双击 Start-Game.cmd', 'README.en.md': 'Start-Game.cmd',
    'Start-Game.cmd': '@echo off\r\n',
    'config/custom.json': '{"unitOverrides":{}}\n',
    'ui-helper/original-graphics.js': 'window.OriginalGraphics = {};\n',
    'ui-helper/source/canvas.js': '// helper source\n',
    'docs/licenses/LGPL.txt': 'license text',
    'locales/en-US.pak': 'locale',
    'build-info.json': JSON.stringify(info, null, 2),
  };
  for (const [name, bytes] of Object.entries(files)) put(directory, name, bytes);
  return files;
}

function archive(directory, output) {
  return spawnSync(python, ['-B', tool, '--dir', directory, '--out', output], { cwd: root, encoding: 'utf8', windowsHide: true });
}

function inspect(file) {
  const code = 'import sys,zipfile,json,base64\nwith zipfile.ZipFile(sys.argv[1]) as z:\n print(json.dumps([{ "name":i.filename,"date":i.date_time,"extra":i.extra.hex(),"data":base64.b64encode(z.read(i)).decode()} for i in z.infolist()]))';
  const result = spawnSync(python, ['-B', '-c', code, file], { encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

test('clean ZIP preserves original bytes, has one fixed top-level, and excludes private runtime data', (t) => {
  const directory = fixture(t);
  const source = path.join(directory, 'build');
  const files = portable(source);
  const secret = 'PRIVATE_SENTINEL_' + ['C:', 'Users', 'PrivateUser', 'Desktop', 'token-secret'].join('\\');
  put(source, 'userdata/logs/private.log', secret);
  put(source, '.tmp/cache/private.txt', secret);
  put(source, 'resources/userdata/nested.txt', secret);
  const originalTimes = Object.fromEntries(Object.keys(files).map((name) => [name, fs.statSync(path.join(source, name)).mtimeMs]));
  const output = path.join(directory, 'release', 'portable.zip');
  const result = archive(source, output);
  assert.equal(result.status, 0, result.stderr);
  const entries = inspect(output);
  assert.equal(entries[0].name, 'MiragineSuper/');
  assert.deepEqual(entries.slice(1).map((entry) => entry.name), Object.keys(files).sort().map((name) => `MiragineSuper/${name}`));
  for (const entry of entries) {
    assert.ok(entry.name.startsWith('MiragineSuper/'));
    assert.deepEqual(entry.date, [1980, 1, 1, 0, 0, 0]);
    assert.equal(entry.extra, '');
    const bytes = Buffer.from(entry.data, 'base64');
    assert.ok(!bytes.toString().includes(secret));
    if (entry.name !== 'MiragineSuper/') {
      const relative = entry.name.slice('MiragineSuper/'.length);
      assert.deepEqual(bytes, Buffer.from(files[relative]));
      assert.deepEqual(fs.readFileSync(path.join(source, relative)), bytes);
      assert.equal(fs.statSync(path.join(source, relative)).mtimeMs, originalTimes[relative]);
    }
  }
  assert.equal(fs.readFileSync(path.join(source, 'userdata/logs/private.log'), 'utf8'), secret);
  const inventoryText = fs.readFileSync(`${output}.inventory.json`, 'utf8');
  const inventory = JSON.parse(inventoryText);
  assert.equal(inventory.version, info.version);
  assert.equal(inventory.sourceCommit, info.sourceCommit);
  assert.equal(inventory.fileCount, Object.keys(files).length);
  assert.equal(inventory.originalBytes, Object.values(files).reduce((sum, value) => sum + Buffer.byteLength(value), 0));
  assert.equal(inventory.zipBytes, fs.statSync(output).size);
  assert.equal(inventory.sha256, digest(fs.readFileSync(output)));
  assert.deepEqual(inventory.excludedDirectories, ['.tmp', 'resources/userdata', 'userdata']);
  assert.ok(!inventoryText.includes(directory));
  assert.ok(!inventoryText.includes('PrivateUser'));
  assert.ok(!inventoryText.includes(secret));
  for (const file of inventory.files) {
    assert.equal(file.sha256, digest(Buffer.from(files[file.path.slice('MiragineSuper/'.length)])));
  }
  const checksums = fs.readFileSync(path.join(path.dirname(output), 'SHA256SUMS'), 'utf8');
  assert.equal(checksums, `${inventory.sha256}  portable.zip\n${digest(Buffer.from(inventoryText))}  portable.zip.inventory.json\n`);
});

test('identical inputs generate identical ZIP bytes despite filesystem timestamps', (t) => {
  const directory = fixture(t);
  const source = path.join(directory, 'build');
  const files = portable(source);
  const first = path.join(directory, 'first', 'game.zip');
  const second = path.join(directory, 'second', 'game.zip');
  assert.equal(archive(source, first).status, 0);
  for (const name of Object.keys(files)) fs.utimesSync(path.join(source, name), 1_000_000, 2_000_000);
  const result = archive(source, second);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(fs.readFileSync(first), fs.readFileSync(second));
  assert.deepEqual(fs.readFileSync(`${first}.inventory.json`), fs.readFileSync(`${second}.inventory.json`));
});

test('existing ZIP or sidecars are never overwritten', (t) => {
  const directory = fixture(t);
  const source = path.join(directory, 'build');
  portable(source);
  for (const blocked of ['portable.zip', 'portable.zip.inventory.json', 'SHA256SUMS']) {
    const folder = path.join(directory, blocked.replaceAll('.', '-'));
    const existing = put(folder, blocked, 'DO NOT OVERWRITE');
    const result = archive(source, path.join(folder, 'portable.zip'));
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Refusing to overwrite/);
    assert.equal(fs.readFileSync(existing, 'utf8'), 'DO NOT OVERWRITE');
    if (blocked !== 'portable.zip') assert.ok(!fs.existsSync(path.join(folder, 'portable.zip')));
  }
});

test('unexpected private/cache directories and credentials fail closed', (t) => {
  const directory = fixture(t);
  for (const [index, name] of ['private/note.txt', 'resources/cache/file.bin', '.local/thread.json', 'resources/logs/run.log', 'config/token.json', 'resources/secret.key'].entries()) {
    const source = path.join(directory, `build-${index}`);
    portable(source);
    put(source, name, 'PRIVATE');
    const output = path.join(directory, `release-${index}`, 'game.zip');
    const result = archive(source, output);
    assert.equal(result.status, 1, name);
    assert.match(result.stderr, /rejected/i);
    assert.ok(!fs.existsSync(output));
  }
});

test('invalid build version, commit and platform cannot become a release', (t) => {
  const directory = fixture(t);
  for (const [index, change] of [{ version: '../invalid' }, { sourceCommit: 'wrong' }, { platform: 'linux' }, { arch: 'unknown' }].entries()) {
    const source = path.join(directory, `build-${index}`);
    portable(source);
    put(source, 'build-info.json', JSON.stringify({ ...info, ...change }));
    const output = path.join(directory, `release-${index}`, 'game.zip');
    const result = archive(source, output);
    assert.equal(result.status, 1);
    assert.ok(!fs.existsSync(output));
  }
});

test('symlink/junction is rejected before exclusion, without following its target', (t) => {
  const directory = fixture(t);
  const source = path.join(directory, 'build');
  portable(source);
  put(directory, 'outside/private.txt', 'SECRET');
  try { fs.symlinkSync(path.join(directory, 'outside'), path.join(source, 'userdata'), process.platform === 'win32' ? 'junction' : 'dir'); }
  catch (error) {
    if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) { t.skip('Symlinks/junctions unavailable'); return; }
    throw error;
  }
  const output = path.join(directory, 'release', 'game.zip');
  const result = archive(source, output);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Symlink\/reparse point rejected: userdata/);
  assert.ok(!fs.existsSync(output));
  assert.equal(fs.readFileSync(path.join(directory, 'outside/private.txt'), 'utf8'), 'SECRET');
});

test('output cannot be created inside the original portable build', (t) => {
  const directory = fixture(t);
  portable(directory);
  const result = archive(directory, path.join(directory, 'release.zip'));
  assert.equal(result.status, 1);
  assert.match(result.stderr, /outside the original build/);
  assert.ok(!fs.existsSync(path.join(directory, 'release.zip')));
});
