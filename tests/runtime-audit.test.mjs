import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temporary = path.join(project, '.tmp');

function pe(text, resource = 'original') {
  const data = Buffer.alloc(2048);
  data.write('MZ'); data.writeUInt32LE(128, 60); data.write('PE\0\0', 128);
  data.writeUInt16LE(2, 134); data.writeUInt16LE(0, 148);
  for (const [index, name, contents] of [[0, '.text', text], [1, '.rsrc', resource]]) {
    const entry = 152 + index * 40;
    data.write(name, entry); data.writeUInt32LE(256, entry + 8); data.writeUInt32LE(4096 * (index + 1), entry + 12);
    data.writeUInt32LE(256, entry + 16); data.writeUInt32LE(512 + 256 * index, entry + 20);
    data.write(`${contents} `, 512 + 256 * index);
  }
  return data;
}

async function fixture(t) {
  await fs.mkdir(temporary, { recursive: true });
  const root = await fs.mkdtemp(path.join(temporary, 'runtime-audit-'));
  t.after(async () => {
    assert.equal(path.dirname(path.resolve(root)), path.resolve(temporary));
    assert.ok(path.basename(root).startsWith('runtime-audit-'));
    await fs.rm(root, { recursive: true, force: true });
  });
  await fs.mkdir(path.join(root, 'release'));
  // Synthetic public-URL-shaped constant, assembled only in ignored fixtures.
  const constant = ['https:', '', 'example.test', 'Home', 'public-test'].join('/');
  await fs.writeFile(path.join(root, 'electron.exe'), pe(constant));
  await fs.writeFile(path.join(root, 'release', 'Game.exe'), pe(constant, 'packaged metadata'));
  await fs.writeFile(path.join(root, 'LICENSES.chromium.html'), constant);
  await fs.writeFile(path.join(root, 'release', 'LICENSES.chromium.html'), constant);
  await fs.writeFile(path.join(root, 'release', 'resources.pak'), 'synthetic runtime data');
  await fs.writeFile(path.join(root, 'resources.pak'), 'synthetic runtime data');
  await fs.writeFile(path.join(root, 'LICENSE'), 'Synthetic authored-project license.');
  await fs.writeFile(path.join(root, 'release', 'LICENSE.project.txt'), 'Synthetic authored-project license.');
  await fs.writeFile(path.join(root, 'scan.json'), JSON.stringify({ findings: [
    { path: 'release/Game.exe', rule: 'absolute-user-path' },
    { path: 'release/LICENSES.chromium.html', rule: 'absolute-user-path' },
  ], warnings: [{ path: 'release/resources.pak', rule: 'archive-contents-not-decoded' }] }));
  const code = 'import zipfile,sys,pathlib; p=pathlib.Path(sys.argv[1]); z=zipfile.ZipFile(p/"electron.zip","w"); [z.write(p/n,n) for n in ["electron.exe","LICENSES.chromium.html","resources.pak"]]; z.close()';
  const zipped = spawnSync('python', ['-B', '-c', code, root], { encoding: 'utf8', windowsHide: true });
  assert.equal(zipped.status, 0, 'Fixture ZIP creation failed');
  return { root, constant };
}

function audit(root, { pinned = false } = {}) {
  const code = `import importlib.util,pathlib,hashlib,json,sys; spec=importlib.util.spec_from_file_location('audit',sys.argv[1]); m=importlib.util.module_from_spec(spec); spec.loader.exec_module(m); p=pathlib.Path(sys.argv[2]); print(json.dumps(m.audit_runtime(p,'release','electron.zip','scan.json',expected_digest=${pinned ? 'm.PINNED_SHA256' : "hashlib.sha256((p/'electron.zip').read_bytes()).hexdigest()"},username='synthetic-auditor')))`;
  return spawnSync('python', ['-B', '-c', code, path.join(project, 'tools', 'audit_electron_runtime.py'), root], { encoding: 'utf8', windowsHide: true });
}

test('only exact upstream constants and unchanged non-resource PE sections can be reviewed', async (t) => {
  const { root, constant } = await fixture(t);
  const run = audit(root);
  assert.equal(run.status, 0, 'Fixture audit failed');
  const report = JSON.parse(run.stdout);
  assert.equal(report.rawFindingCount, 2);
  assert.equal(report.reviewedUpstreamConstants, 2);
  assert.equal(report.unresolved, 0);
  assert.equal(report.matchedConstantCount, 2);
  assert.ok(!run.stdout.includes(constant) && !run.stdout.includes(root));
  assert.equal(report.archiveWarnings[0].coverage, 'exact-pinned-upstream-bytes-not-decoded');
  assert.equal(report.authoredLicense.matchesProjectLicense, true);
});

test('a tampered non-resource section is not exempted', async (t) => {
  const { root, constant } = await fixture(t);
  await fs.writeFile(path.join(root, 'release', 'Game.exe'), pe(`${constant} changed`));
  const report = JSON.parse(audit(root).stdout);
  assert.ok(report.unresolved > 0);
});

test('new paths in a permitted resource section are not exempted', async (t) => {
  const { root, constant } = await fixture(t);
  const newPath = ['C:', 'Users', 'synthetic-new-person', 'private'].join(String.fromCharCode(92));
  await fs.writeFile(path.join(root, 'release', 'Game.exe'), pe(constant, newPath));
  const report = JSON.parse(audit(root).stdout);
  assert.ok(report.unresolved > 0);
});

test('a new secret never receives upstream path exemptions', async (t) => {
  const { root, constant } = await fixture(t);
  const secret = ['sk', '-proj-', 'Q'.repeat(36)].join('');
  await fs.writeFile(path.join(root, 'release', 'Game.exe'), pe(constant, secret));
  const run = audit(root);
  const report = JSON.parse(run.stdout);
  assert.ok(report.unresolved > 0);
  assert.ok(!run.stdout.includes(secret));
});

test('the production digest rejects synthetic or altered archives', async (t) => {
  const { root } = await fixture(t);
  const run = audit(root, { pinned: true });
  assert.notEqual(run.status, 0);
  assert.match(run.stderr, /electron-zip-digest-mismatch/);
});

test('UTF-16 paths and the current username never receive resource exemptions', async (t) => {
  const { root, constant } = await fixture(t);
  for (const payload of [Buffer.from(['C:', 'Users', 'new-private', 'data'].join(String.fromCharCode(92)), 'utf16le'),
    Buffer.from('synthetic-auditor')]) {
    const modified = pe(constant);
    payload.copy(modified, 768);
    await fs.writeFile(path.join(root, 'release', 'Game.exe'), modified);
    const report = JSON.parse(audit(root).stdout);
    assert.ok(report.unresolved > 0);
  }
});

test('license changes and added non-path secret findings cannot be reviewed away', async (t) => {
  const { root } = await fixture(t);
  await fs.appendFile(path.join(root, 'release', 'LICENSES.chromium.html'), ' modified');
  const report = JSON.parse(audit(root).stdout);
  assert.ok(report.unresolved > 0);
  const scan = JSON.parse(await fs.readFile(path.join(root, 'scan.json'), 'utf8'));
  scan.findings.push({ path: 'release/Game.exe', rule: 'api-secret-token' });
  await fs.writeFile(path.join(root, 'scan.json'), JSON.stringify(scan));
  assert.ok(JSON.parse(audit(root).stdout).unresolved > report.unresolved);
});

test('only the exact named authored license with the current source hash is accepted', async (t) => {
  const { root } = await fixture(t);
  await fs.appendFile(path.join(root, 'release', 'LICENSE.project.txt'), ' changed');
  const report = JSON.parse(audit(root).stdout);
  assert.ok(report.unresolvedDetails.some(item => item.file === 'LICENSE.project.txt' && item.reason === 'authored-license-does-not-match-project-source'));
  await fs.writeFile(path.join(root, 'release', 'LICENSE.unapproved.txt'), 'Unrelated license file.');
  assert.ok(JSON.parse(audit(root).stdout).unresolvedDetails.some(item => item.file === 'LICENSE.unapproved.txt'));
});

test('odd-offset UTF-16 resource paths and secrets are detected too', async (t) => {
  const { root, constant } = await fixture(t);
  const newPath = ['C:', 'Users', 'odd-private-person', 'data'].join(String.fromCharCode(92));
  const secret = ['sk', '-proj-', 'Q'.repeat(36)].join('');
  for (const value of [newPath, secret]) {
    const modified = pe(constant);
    Buffer.from(value, 'utf16le').copy(modified, 769);
    await fs.writeFile(path.join(root, 'release', 'Game.exe'), modified);
    assert.ok(JSON.parse(audit(root).stdout).unresolved > 0);
  }
});
