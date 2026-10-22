import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
import { createInflate } from 'node:zlib';
import { pathToFileURL } from 'node:url';

const repositoryExcludes = new Set(['.local', '.cache', '.tmp', '.git', 'node_modules', 'dist', 'artifacts', 'output', '__pycache__']);
const binaryExtensions = new Set(['.swf', '.exe', '.dll', '.node', '.bin', '.dat', '.wasm', '.pak', '.asar', '.zip', '.7z']);
const archiveExtensions = new Set(['.zip', '.7z', '.asar', '.pak']);
const genericUsernames = new Set(['root', 'admin', 'administrator', 'user', 'runner', 'system', 'default', 'guest']);
const portable = (value) => value.split(path.sep).join('/');
const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const within = (root, target) => {
  const relative = path.relative(root, target);
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
};
const lineCount = (text) => (text.match(/\n/g) ?? []).length;

function rulesFor(username) {
  const rules = [
    ['absolute-user-path', /(?:[a-z]:[\\/]+(?:users|documents and settings)[\\/]+|\/(?:home|Users)\/)[^\s"'<>|]+/gi],
    ['root-home-path', /(?:^|[\s"'=:(])\/root\/[\w.\-\/]+/g],
    ['file-url-user-path', /file:\/{2,}[a-z]:\/(?:users|documents%20and%20settings)\/[^\s"'<>]+/gi],
    ['api-secret-token', /\bsk-(?:proj-|svcacct-|ant-)?[A-Za-z0-9_-]{20,}/g],
    ['github-secret-token', /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})/g],
    ['gitlab-secret-token', /\bglpat-[A-Za-z0-9_-]{20,}/g],
    ['cloud-access-key', /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g],
    ['google-api-key', /\bAIza[0-9A-Za-z_-]{30,}/g],
    ['slack-secret-token', /\bxox[baprs]-[A-Za-z0-9-]{20,}/g],
    ['payment-secret-token', /\b(?:sk|rk)_live_[A-Za-z0-9]{16,}/g],
    ['private-key', /-----BEGIN (?:RSA |EC |DSA |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/g],
    ['jwt-token', /\beyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{20,}/g],
    ['credential-assignment', /["']?(?:api[_-]?key|access[_-]?token|auth[_-]?token|password|client[_-]?secret|secret[_-]?access[_-]?key)["']?\s*[:=]\s*(["'])([^\r\n"']{8,})\1/gi,
      (match) => !/^(?:\$\{|<|your[_ -]|example|sample|placeholder|change[_ -]?me|replace[_ -]?me|not[_ -]a[_ -]secret|undefined|null|false|true)/i.test(match[2])],
  ];
  // Generic service-account names are normal code identifiers. Their private
  // home paths are still covered by the path rules above.
  if (typeof username === 'string' && username.length >= 3 && !genericUsernames.has(username.toLowerCase())) {
    rules.push(['current-user-name', new RegExp(`(?<![\\p{L}\\p{N}_])${escapeRegExp(username)}(?![\\p{L}\\p{N}_])`, 'gu')]);
  }
  return rules;
}

function redactLocation(location, rules) {
  let result = location;
  for (const [, expression, accept] of rules) {
    expression.lastIndex = 0;
    result = result.replace(expression, (...args) => {
      const match = args.slice(0, -2);
      return !accept || accept(match) ? '[redacted]' : match[0];
    });
  }
  return result;
}

function git(root, args, input) {
  const env = { ...process.env };
  for (const key of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR']) delete env[key];
  return spawnSync('git', ['-C', root, ...args], { encoding: 'utf8', input, env, windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
}

function gitFiles(root) {
  const top = git(root, ['rev-parse', '--show-toplevel']);
  if (top.status !== 0 || path.resolve(top.stdout.trim()) !== root) throw new Error('root must be the Git worktree root');
  const result = git(root, ['ls-files', '--cached', '--others', '--exclude-standard', '-z']);
  if (result.status !== 0) throw new Error('Git file enumeration failed');
  return result.stdout.split('\0').filter(Boolean);
}

function gitIgnored(root, files) {
  if (!files.length) return new Set();
  const result = git(root, ['check-ignore', '-z', '--stdin'], `${files.join('\0')}\0`);
  if (result.status !== 0 && result.status !== 1) throw new Error('Git ignore verification failed');
  return new Set(result.stdout.split('\0').filter(Boolean).map((file) => portable(file)));
}

function isRepositoryExcluded(relative) {
  return portable(relative).split('/').some((part) => repositoryExcludes.has(part));
}

async function enumerate(root, start, { release = false, descend = true } = {}, skipped = []) {
  const absolute = path.resolve(root, start);
  if (!within(root, absolute)) throw new Error('Candidate paths must remain within the project root');
  const relative = portable(path.relative(root, absolute));
  if (!release && isRepositoryExcluded(relative)) {
    skipped.push({ path: relative, reason: 'repository-excluded' });
    return [];
  }
  // Check every component, not only the final file; do not follow junctions.
  let current = root;
  for (const part of path.relative(root, absolute).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    let stat;
    try { stat = await fs.lstat(current); } catch (error) {
      if (error.code === 'ENOENT') { skipped.push({ path: relative, reason: 'missing' }); return []; }
      throw error;
    }
    if (stat.isSymbolicLink()) { skipped.push({ path: relative, reason: 'symlink-not-followed' }); return []; }
  }
  const canonical = await fs.realpath(absolute);
  if (!within(root, canonical)) { skipped.push({ path: relative, reason: 'outside-root' }); return []; }
  const stat = await fs.lstat(absolute);
  if (stat.isFile()) return [{ absolute, relative, release }];
  if (!stat.isDirectory()) { skipped.push({ path: relative, reason: 'not-a-regular-file' }); return []; }
  if (!descend) { skipped.push({ path: relative, reason: 'gitlink-directory' }); return []; }
  const files = [];
  for (const name of (await fs.readdir(absolute)).sort()) {
    // Git internals never belong in a public artifact, and may contain auth.
    if (name === '.git') { skipped.push({ path: portable(path.join(relative, name)), reason: 'git-internals' }); continue; }
    files.push(...await enumerate(root, path.join(absolute, name), { release, descend }, skipped));
  }
  return files;
}

async function scanFile(file, rules, { maxFileBytes, maxDecodedBytes }) {
  const findings = [];
  const warnings = [];
  const seen = new Set();
  const add = (rule, line, encoding) => {
    const key = `${rule}:${line}:${encoding}`;
    if (!seen.has(key)) { findings.push({ path: file.relative, line, rule, encoding }); seen.add(key); }
  };
  const stat = await fs.stat(file.absolute);
  if (stat.size > maxFileBytes) {
    add('scan-incomplete-file-size', 1, 'file');
    return { findings, warnings, bytes: 0 };
  }
  const handle = await fs.open(file.absolute, 'r');
  const header = Buffer.alloc(Math.min(8192, stat.size));
  try { await handle.read(header, 0, header.length, 0); } finally { await handle.close(); }
  const extension = path.extname(file.relative).toLowerCase();
  const binary = binaryExtensions.has(extension) || header.includes(0);
  const compressedSwf = extension === '.swf' && header.subarray(0, 3).toString('ascii') === 'CWS';
  if (archiveExtensions.has(extension)) warnings.push({ path: file.relative, rule: 'archive-contents-not-decoded' });
  if (extension === '.swf' && header.subarray(0, 3).toString('ascii') === 'ZWS') {
    warnings.push({ path: file.relative, rule: 'lzma-swf-contents-not-decoded' });
  }
  const source = createReadStream(file.absolute, { highWaterMark: 1024 * 1024, start: compressedSwf ? 8 : 0 });
  const stream = compressedSwf ? source.pipe(createInflate()) : source;
  if (compressedSwf) source.on('error', (error) => stream.destroy(error));
  const states = [{ decoder: new StringDecoder('utf8'), tail: '', line: 1, encoding: binary ? 'binary-utf8' : 'utf8' }];
  if (binary) states.push({ decoder: new StringDecoder('utf16le'), tail: '', line: 1, encoding: 'binary-utf16le' });
  const scanText = (state, chunk) => {
    const text = state.tail + chunk;
    for (const [rule, expression, accept] of rules) {
      expression.lastIndex = 0;
      for (const match of text.matchAll(expression)) {
        if (!accept || accept(match)) add(rule, state.line + lineCount(text.slice(0, match.index)), state.encoding);
      }
    }
    const retained = Math.min(4096, text.length);
    state.line += lineCount(text.slice(0, text.length - retained));
    state.tail = text.slice(-retained);
  };
  let decodedBytes = 0;
  try {
    for await (const chunk of stream) {
      decodedBytes += chunk.length;
      if (decodedBytes > maxDecodedBytes) { add('scan-incomplete-decoded-size', 1, 'file'); break; }
      for (const state of states) scanText(state, state.decoder.write(chunk));
    }
    for (const state of states) scanText(state, state.decoder.end());
  } catch {
    add('scan-incomplete-read-error', 1, 'file');
  } finally { stream.destroy(); source.destroy(); }
  return { findings, warnings, bytes: stat.size };
}

/**
 * Check Git-tracked and nonignored candidate files without reading outside root.
 * Explicit release directories are scanned in full, including normally ignored
 * build directories. Archive warnings mean callers should check the unpacked
 * release directory too; an encoded archive scan is not a completeness claim.
 */
export async function scanPublicFiles({ root, candidates = [], releaseDirs = [], username = os.userInfo().username,
  maxFileBytes = 512 * 1024 * 1024, maxDecodedBytes = 512 * 1024 * 1024 } = {}) {
  if (typeof root !== 'string' || !root) throw new TypeError('An explicit project root is required');
  if (!Array.isArray(candidates) || !Array.isArray(releaseDirs)
    || [...candidates, ...releaseDirs].some((entry) => typeof entry !== 'string' || !entry)) {
    throw new TypeError('Candidate and release paths must be nonempty strings');
  }
  if (![maxFileBytes, maxDecodedBytes].every((limit) => Number.isSafeInteger(limit) && limit > 0)) {
    throw new TypeError('Scan size limits must be positive safe integers');
  }
  if (typeof username !== 'string') throw new TypeError('username must be a string');
  const project = await fs.realpath(path.resolve(root));
  const skipped = [];
  const listed = gitFiles(project);
  let selected = [];
  for (const file of listed) selected.push(...await enumerate(project, file, { descend: false }, skipped));
  for (const candidate of candidates) selected.push(...await enumerate(project, candidate, {}, skipped));
  const ignored = gitIgnored(project, selected.map((file) => file.relative));
  selected = selected.filter((file) => {
    if (!ignored.has(file.relative)) return true;
    skipped.push({ path: file.relative, reason: 'git-ignored' });
    return false;
  });
  for (const directory of releaseDirs) {
    const absolute = path.resolve(project, directory);
    if (!within(project, absolute)) throw new Error('Release directories must remain within the project root');
    const stat = await fs.lstat(absolute);
    if (!stat.isDirectory() && !stat.isSymbolicLink()) throw new Error('Release paths must be directories');
    selected.push(...await enumerate(project, absolute, { release: true }, skipped));
  }
  const unique = [...new Map(selected.map((file) => [file.relative, file])).values()].sort((a, b) => a.relative.localeCompare(b.relative));
  const report = { scannedFiles: 0, scannedBytes: 0, findings: [], warnings: [], skipped };
  const rules = rulesFor(username);
  for (const file of unique) {
    for (const [rule, expression, accept] of rules) {
      expression.lastIndex = 0;
      if ([...file.relative.matchAll(expression)].some((match) => !accept || accept(match))) {
        report.findings.push({ path: file.relative, line: 1, rule: `filename-${rule}`, encoding: 'filename' });
      }
    }
    const result = await scanFile(file, rules, { maxFileBytes, maxDecodedBytes });
    report.scannedFiles++;
    report.scannedBytes += result.bytes;
    report.findings.push(...result.findings);
    report.warnings.push(...result.warnings);
  }
  // A relative filename can itself contain a token or private username. Keep the
  // useful relative location while redacting sensitive segments in every mode.
  for (const item of [...report.findings, ...report.warnings, ...report.skipped]) {
    item.path = redactLocation(item.path, rules);
  }
  return report;
}

export function formatPrivacyReport(report, { json = false } = {}) {
  if (json) return JSON.stringify(report, null, 2);
  const lines = [`Privacy check: ${report.scannedFiles} files, ${report.findings.length} findings, ${report.warnings.length} warnings.`];
  for (const finding of report.findings) lines.push(`${finding.path}:${finding.line}: ${finding.rule}`);
  for (const warning of report.warnings) lines.push(`${warning.path}: warning: ${warning.rule}`);
  return lines.join('\n');
}

function cliOptions(argv) {
  const options = { candidates: [], releaseDirs: [] };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--json') { options.json = true; continue; }
    if (!['--root', '--candidate', '--release-dir'].includes(arg) || !argv[index + 1]) throw new Error('Invalid CLI options');
    const value = argv[++index];
    if (arg === '--root') options.root = value;
    else if (arg === '--candidate') options.candidates.push(value);
    else options.releaseDirs.push(value);
  }
  return options;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const options = cliOptions(process.argv.slice(2));
    const report = await scanPublicFiles(options);
    process.stdout.write(`${formatPrivacyReport(report, options)}\n`);
    process.exitCode = report.findings.length ? 1 : 0;
  } catch {
    // Never echo filesystem exception messages or raw argv: they may themselves
    // contain the very local paths or credentials this guard is protecting.
    process.stderr.write('Privacy check could not complete. Use --root <project> [--candidate <path>] [--release-dir <directory>] [--json].\n');
    process.exitCode = 2;
  }
}
