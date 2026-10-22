import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { deflateSync } from 'node:zlib';
import { scanPublicFiles, formatPrivacyReport } from '../tools/check-public.mjs';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temporaryRoot = path.join(project, '.tmp');
const slash = String.fromCharCode(92);
const syntheticUsername = ['synthetic', 'private', 'person'].join('-');
const userPath = (unicode = false) => ['C:', 'Users', unicode ? String.fromCodePoint(0x6d4b, 0x8bd5, 0x7528, 0x6237) : syntheticUsername, 'private', 'file.txt'].join(slash);
const syntheticSecret = () => ['sk', '-proj-', 'Q'.repeat(36)].join('');

function git(root, ...args) {
  const result = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 0, 'Fixture Git operation failed');
}

async function fixture(t) {
  await fs.mkdir(temporaryRoot, { recursive: true });
  const root = await fs.mkdtemp(path.join(temporaryRoot, 'privacy-test-'));
  t.after(async () => {
    const absolute = path.resolve(root);
    assert.equal(path.dirname(absolute), path.resolve(temporaryRoot));
    assert.ok(path.basename(absolute).startsWith('privacy-test-'));
    await fs.rm(absolute, { recursive: true, force: true });
  });
  git(root, 'init', '--quiet');
  await fs.writeFile(path.join(root, '.gitignore'), ['.local/', '.tmp/', 'dist/', '*.log', ''].join('\n'));
  return root;
}

const check = (root, options = {}) => scanPublicFiles({ root, username: syntheticUsername, ...options });

test('private conversation references are rejected without forbidding ordinary game UUIDs', async (t) => {
  const root = await fixture(t);
  const uuid = ['12345678', '1234', '4234', '8234', '123456789abc'].join('-');
  await fs.writeFile(path.join(root, 'context.json'), JSON.stringify({ ['reference' + 'ThreadId']: uuid }));
  await fs.writeFile(path.join(root, 'notes.md'), ['thread', '://', uuid].join(''));
  await fs.writeFile(path.join(root, 'game.json'), JSON.stringify({ entityId: uuid }));
  const report = await check(root);
  const leaks = report.findings.filter(finding => finding.rule === 'private-chat-reference');
  assert.deepEqual(leaks.map(finding => finding.path).sort(), ['context.json', 'notes.md']);
  assert.ok(!formatPrivacyReport(report, { json: true }).includes(uuid));
});

test('benign relative paths and ordinary source are accepted, including tracked ignored files', async (t) => {
  const root = await fixture(t);
  await fs.writeFile(path.join(root, 'source.mjs'), 'const root = "./assets/game.swf";\nexport const count = 2;\n');
  await fs.writeFile(path.join(root, 'tracked.log'), 'A tracked, deliberately ignored filename.\n');
  git(root, 'add', '--force', 'tracked.log');
  const report = await check(root);
  assert.equal(report.scannedFiles, 3);
  assert.deepEqual(report.findings, []);
});

test('ASCII, UTF-8, escaped JSON, and file-URL user paths are found with safe relative locations', async (t) => {
  const root = await fixture(t);
  const url = ['file:', '', '', 'C:', 'Users', syntheticUsername, 'private', 'data'].join('/');
  await fs.writeFile(path.join(root, 'paths.txt'), ['relative/file.txt', userPath(), userPath(true), url, JSON.stringify({ path: userPath() }), ''].join('\n'));
  const report = await check(root);
  assert.ok(report.findings.some((finding) => finding.rule === 'absolute-user-path' && finding.line === 2));
  assert.ok(report.findings.some((finding) => finding.rule === 'absolute-user-path' && finding.line === 3));
  assert.ok(report.findings.some((finding) => finding.rule === 'file-url-user-path' && finding.line === 4));
  assert.ok(report.findings.some((finding) => finding.rule === 'absolute-user-path' && finding.line === 5));
  assert.ok(report.findings.every((finding) => finding.path === 'paths.txt'));
  const output = formatPrivacyReport(report);
  assert.ok(!output.includes(userPath()) && !output.includes(syntheticUsername));
});

test('secrets and the dynamic current username are detected without echoing values', async (t) => {
  const root = await fixture(t);
  const privateMarker = ['-----BEGIN ', 'PRIVATE KEY', '-----'].join('');
  await fs.writeFile(path.join(root, 'credentials.txt'), [syntheticSecret(), privateMarker, syntheticUsername, ''].join('\n'));
  const report = await check(root);
  assert.ok(report.findings.some((finding) => finding.rule === 'api-secret-token'));
  assert.ok(report.findings.some((finding) => finding.rule === 'private-key'));
  assert.ok(report.findings.some((finding) => finding.rule === 'current-user-name'));
  for (const output of [formatPrivacyReport(report), formatPrivacyReport(report, { json: true })]) {
    assert.ok(!output.includes(syntheticSecret()) && !output.includes(privateMarker) && !output.includes(syntheticUsername));
  }
});

test('binary SWF magic is not itself sensitive; UTF-16 binary private strings are detected', async (t) => {
  const root = await fixture(t);
  await fs.writeFile(path.join(root, 'clean.swf'), Buffer.from([0x46, 0x57, 0x53, 9, 8, 0, 0, 0]));
  await fs.writeFile(path.join(root, 'private.bin'), Buffer.concat([Buffer.from([0, 1, 2, 0]), Buffer.from(userPath(), 'utf16le')]));
  const report = await check(root);
  assert.ok(!report.findings.some((finding) => finding.path === 'clean.swf'));
  assert.ok(report.findings.some((finding) => finding.path === 'private.bin' && finding.encoding === 'binary-utf16le'));
});

test('compressed SWF strings are decoded and checked without changing the SWF', async (t) => {
  const root = await fixture(t);
  const body = Buffer.from(`synthetic payload\n${userPath()}\n`, 'utf8');
  const header = Buffer.from([0x43, 0x57, 0x53, 9, 0, 0, 0, 0]);
  header.writeUInt32LE(body.length + 8, 4);
  const swf = Buffer.concat([header, deflateSync(body)]);
  const file = path.join(root, 'compressed.swf');
  await fs.writeFile(file, swf);
  const report = await check(root);
  assert.ok(report.findings.some((finding) => finding.path === 'compressed.swf' && finding.rule === 'absolute-user-path'));
  assert.deepEqual(await fs.readFile(file), swf);
});

test('private exports and caches are excluded even if tracked or explicitly selected', async (t) => {
  const root = await fixture(t);
  await fs.mkdir(path.join(root, '.local'));
  await fs.writeFile(path.join(root, '.local', 'export.json'), JSON.stringify({ private: userPath(), value: syntheticSecret() }));
  git(root, 'add', '--force', '.local/export.json');
  const report = await check(root, { candidates: ['.local'] });
  assert.deepEqual(report.findings, []);
  assert.ok(report.skipped.some((item) => item.path.startsWith('.local') && item.reason === 'repository-excluded'));
});

test('explicit candidates respect Git ignores, and release directories scan ignored build content', async (t) => {
  const root = await fixture(t);
  await fs.mkdir(path.join(root, 'dist'));
  await fs.writeFile(path.join(root, 'dist', 'release.txt'), userPath());
  await fs.writeFile(path.join(root, 'ignored.log'), syntheticSecret());
  const regular = await check(root, { candidates: ['dist', 'ignored.log'] });
  assert.deepEqual(regular.findings, []);
  assert.ok(regular.skipped.some((item) => item.path === 'ignored.log' && item.reason === 'git-ignored'));
  const release = await check(root, { releaseDirs: ['dist'] });
  assert.ok(release.findings.some((item) => item.path === 'dist/release.txt'));
});

test('symlink or junction escapes are skipped, never followed or leaked', async (t) => {
  const root = await fixture(t);
  const outside = await fixture(t);
  await fs.writeFile(path.join(outside, 'private.txt'), syntheticSecret());
  try { await fs.symlink(outside, path.join(root, 'linked'), process.platform === 'win32' ? 'junction' : 'dir'); }
  catch (error) {
    if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) { t.skip('Host cannot create symlinks'); return; }
    throw error;
  }
  const report = await check(root, { candidates: ['linked/private.txt'] });
  assert.deepEqual(report.findings, []);
  assert.ok(report.skipped.some((item) => item.reason === 'symlink-not-followed'));
  assert.ok(!JSON.stringify(report).includes(outside));
});

test('outside paths and nonexplicit roots are rejected without scanning external data', async (t) => {
  const root = await fixture(t);
  await assert.rejects(scanPublicFiles(), /explicit project root/);
  await assert.rejects(check(root, { candidates: ['../outside.txt'] }), /within the project/);
  await assert.rejects(check(root, { releaseDirs: ['../outside'] }), /within the project/);
  await assert.rejects(check(root, { maxFileBytes: NaN }), /positive safe integers/);
  await assert.rejects(check(root, { maxDecodedBytes: -1 }), /positive safe integers/);
});

test('a sensitive filename is itself detected and redacted in all report formats', async (t) => {
  const root = await fixture(t);
  const filename = `${syntheticUsername}-${syntheticSecret()}.txt`;
  await fs.writeFile(path.join(root, filename), 'Benign contents.\n');
  const report = await check(root);
  assert.ok(report.findings.some((finding) => finding.encoding === 'filename'));
  for (const output of [formatPrivacyReport(report), formatPrivacyReport(report, { json: true })]) {
    assert.ok(!output.includes(syntheticUsername) && !output.includes(syntheticSecret()));
    assert.ok(output.includes('[redacted]'));
  }
});

test('size limits are blocking findings rather than silent success', async (t) => {
  const root = await fixture(t);
  await fs.writeFile(path.join(root, 'large.txt'), 'a'.repeat(128));
  const report = await check(root, { maxFileBytes: 64 });
  assert.ok(report.findings.some((item) => item.rule === 'scan-incomplete-file-size'));
});

test('CLI exits nonzero for findings and emits no secrets or absolute root', async (t) => {
  const root = await fixture(t);
  await fs.writeFile(path.join(root, 'secret.txt'), syntheticSecret());
  const result = spawnSync(process.execPath, [path.join(project, 'tools', 'check-public.mjs'), '--root', root], { encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /secret\.txt:1: api-secret-token/);
  assert.ok(!result.stdout.includes(syntheticSecret()) && !result.stdout.includes(root));
});
