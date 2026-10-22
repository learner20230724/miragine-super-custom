import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { root, localEnvironment } from './environment.mjs';

const rootFiles = new Set(['index.html', 'package.json', 'LICENSE', 'NOTICE.txt', 'README.md', 'README.en.md']);
const runtimeDirectories = new Set(['src', 'assets', 'generated', 'config']);
const runtimeExtensions = new Set(['.mjs', '.js', '.css', '.json', '.png', '.jpg', '.jpeg', '.svg', '.mp3', '.wav', '.ttf', '.woff', '.woff2', '.ico']);

/** Packaging whitelist, independent from the HTTP server's smaller route list. */
export function isProductionPath(input, { directory = false } = {}) {
  const relative = input.replaceAll('\\', '/').replace(/^\/+/, '');
  if (relative === '') return directory;
  const parts = relative.split('/');
  if (parts.some((part) => !part || part.startsWith('.') || ['recovered', 'reference', 'node_modules'].includes(part)) || relative.includes(':')) return false;
  if (parts.length === 1 && rootFiles.has(relative)) return !directory;
  if (parts[0] === 'desktop') {
    return directory ? parts.length === 1 : ['desktop/main.cjs', 'desktop/static-server.cjs'].includes(relative);
  }
  if (parts[0] === 'docs') {
    if (directory) return relative === 'docs' || parts[1] === 'licenses';
    return parts[1] === 'licenses' || /^docs\/parameters\.(?:en|zh-CN)\.md$/.test(relative);
  }
  if (!runtimeDirectories.has(parts[0])) return false;
  if (directory) return true;
  if (parts[0] === 'config') return ['config/custom.json', 'config/defaults.generated.json'].includes(relative);
  if (parts[0] === 'generated' && /\.(?:md|txt)$/i.test(relative)) return true;
  return runtimeExtensions.has(path.posix.extname(relative).toLowerCase());
}

export function sourceCommit(projectRoot, runGit = execFileSync) {
  const git = (args) => runGit('git', args, { cwd: projectRoot, encoding: 'utf8', windowsHide: true }).trim();
  const commit = git(['rev-parse', 'HEAD']);
  if (!/^[a-f0-9]{40}$/i.test(commit)) throw new Error('A committed Git revision is required for a release');
  // Ignored caches/builds do not appear; uncommitted public files would make the
  // release differ from its advertised source commit and must be committed first.
  if (git(['status', '--porcelain', '--untracked-files=normal'])) throw new Error('Commit all non-ignored source changes before building a release');
  return commit;
}

export function createBuildPlan(projectRoot, version, { now = new Date(), nonce = randomUUID(), electronVersion = '44.4.3' } = {}) {
  if (!/^\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?(?:\+[a-z0-9.-]+)?$/i.test(version)) throw new TypeError('Invalid app version');
  if (!/^[a-z0-9-]+$/i.test(nonce)) throw new TypeError('Invalid build nonce');
  const project = path.resolve(projectRoot);
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  const out = path.join(project, 'dist', `build-${version}-${stamp}-${nonce}`);
  const ignore = (file) => {
    const relative = file.replace(/^[/\\]+/, '');
    if (relative === '') return false;
    try {
      const stat = fs.lstatSync(path.join(project, relative));
      return stat.isSymbolicLink() || !isProductionPath(relative, { directory: stat.isDirectory() });
    } catch { return true; }
  };
  return {
    dir: project, out, name: 'MiragineSuper', executableName: 'MiragineSuper',
    platform: 'win32', arch: 'x64', electronVersion, appVersion: version,
    asar: true, prune: true, overwrite: false,
    tmpdir: path.join(project, '.tmp'), download: { cacheRoot: path.join(project, '.cache', 'electron') },
    ignore,
    appCopyright: 'Super Miragine War source reconstruction. Original materials retain their respective rights.',
  };
}

const helperInstructions = `# 可替换的 UI 绘图源码 / Replaceable UI drawing source

运行时真正加载的是本目录 original-graphics.js，而不是只读 app.asar 中的副本。
关闭游戏，备份后编辑或替换该文件，再重新启动即可生效。保留 OriginalGraphics
接口。删除此文件后，下次启动会从内置副本恢复；已有文件永不被自动覆盖。

The game actually loads this directory's original-graphics.js, not the immutable
copy in app.asar. Close the game, back up, edit or replace this readable source,
and restart. Preserve its OriginalGraphics API. If deleted, the bundled default
is restored on the next launch; existing edits are never overwritten.

source/canvas.js is the original upstream drawing helper; source/build_ui.py
records deterministic adaptations. original-graphics.js contains the modified
helper and original-game artwork. These have separate applicable rights; see
NOTICE.md, the root NOTICE.txt, and docs/licenses. No ActionScript VM is used.

Pinned upstream corresponding source:
https://github.com/jindrapetrik/jpexs-decompiler/blob/version26.4.0/libsrc/ffdec_lib/src/com/jpexs/helpers/resource/canvas.js

User configuration is separately editable at ../config/custom.json.
`;

/** Copy curated redistribution/replaceability files without clobbering edits. */
export function writePortableExtras(projectRoot, output, buildInfo) {
  const project = path.resolve(projectRoot);
  const destination = path.resolve(output);
  const copy = (sourceName, destinationName = sourceName) => {
    const source = path.join(project, sourceName);
    const target = path.join(destination, destinationName);
    if (!fs.lstatSync(source).isFile()) throw new Error(`Missing required regular release file: ${sourceName}`);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    try { fs.writeFileSync(target, fs.readFileSync(source), { flag: 'wx' }); }
    catch (error) { if (error.code !== 'EEXIST' || !fs.statSync(target).isFile()) throw error; }
  };
  for (const name of ['LICENSE', 'NOTICE.txt', 'README.md', 'README.en.md']) copy(name);
  const licenseFiles = fs.readdirSync(path.join(project, 'docs', 'licenses'), { withFileTypes: true });
  if (!licenseFiles.length) throw new Error('Release license texts are missing');
  for (const file of licenseFiles) {
    if (!file.isFile()) throw new Error('Only regular license files may be bundled');
    copy(`docs/licenses/${file.name}`);
  }
  for (const name of ['parameters.en.md', 'parameters.zh-CN.md']) {
    if (fs.existsSync(path.join(project, 'docs', name))) copy(`docs/${name}`);
  }
  copy('config/custom.json');
  copy('generated/ui/original-graphics.js', 'ui-helper/original-graphics.js');
  copy('generated/ui/NOTICE.md', 'ui-helper/NOTICE.md');
  copy('generated/ui/LGPL-3.0.txt', 'ui-helper/LGPL-3.0.txt');
  copy('generated/ui/GPL-3.0.txt', 'ui-helper/GPL-3.0.txt');
  copy('tools/build_ui.py', 'ui-helper/source/build_ui.py');
  copy('recovered/game-canvas/canvas.js', 'ui-helper/source/canvas.js');
  const writeOnce = (name, data) => {
    try { fs.writeFileSync(path.join(destination, name), data, { flag: 'wx' }); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
  };
  writeOnce('ui-helper/README.md', helperInstructions);
  writeOnce('Start-Game.cmd', '@echo off\r\nsetlocal\r\nset ELECTRON_RUN_AS_NODE=\r\ncd /d "%~dp0"\r\nstart "" "%~dp0MiragineSuper.exe"\r\n');
  if (!buildInfo || !/^[a-f0-9]{40}$/i.test(buildInfo.sourceCommit)) throw new Error('Valid build provenance is required');
  const info = JSON.stringify(buildInfo, null, 2) + '\n';
  const infoPath = path.join(destination, 'build-info.json');
  if (fs.existsSync(infoPath) && fs.readFileSync(infoPath, 'utf8') !== info) throw new Error('Output belongs to a different source version');
  writeOnce('build-info.json', info);
}

export async function buildWindows() {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const commit = sourceCommit(root);
  for (const name of ['index.html', 'LICENSE', 'NOTICE.txt', 'README.md', 'README.en.md',
    'generated/ui/original-graphics.js', 'generated/ui/NOTICE.md', 'generated/ui/LGPL-3.0.txt',
    'generated/ui/GPL-3.0.txt', 'tools/build_ui.py', 'recovered/game-canvas/canvas.js']) {
    if (!fs.statSync(path.join(root, name)).isFile()) throw new Error(`Missing required release file: ${name}`);
  }
  Object.assign(process.env, localEnvironment());
  delete process.env.ELECTRON_RUN_AS_NODE;
  const plan = createBuildPlan(root, pkg.version, { electronVersion: pkg.devDependencies.electron });
  const buildInfo = { version: pkg.version, sourceCommit: commit, platform: plan.platform, arch: plan.arch, electronVersion: plan.electronVersion };
  plan.afterCopy = [(buildPath, _electronVersion, _platform, _arch, callback) => {
    try {
      if (path.resolve(buildPath) === path.resolve(root)) throw new Error('Refusing to write build metadata into the source tree');
      fs.writeFileSync(path.join(buildPath, 'build-info.json'), JSON.stringify(buildInfo, null, 2) + '\n');
      callback();
    } catch (error) { callback(error); }
  }];
  const dist = path.join(root, 'dist');
  fs.mkdirSync(dist, { recursive: true });
  if (fs.realpathSync(dist) !== dist) throw new Error('Build destination must not be a symlink or junction');
  fs.mkdirSync(plan.out, { recursive: false });
  const { packager } = await import('@electron/packager');
  const outputs = await packager(plan);
  for (const output of outputs) {
    const relative = path.relative(plan.out, path.resolve(output));
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Packager returned an unexpected output directory');
    writePortableExtras(root, output, buildInfo);
  }
  fs.mkdirSync(path.join(root, '.local'), { recursive: true });
  fs.writeFileSync(path.join(root, '.local', 'windows-build.json'), JSON.stringify({ version: pkg.version, outputs }, null, 2));
  console.log('Windows build:', outputs.join('\n'));
  return outputs;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await buildWindows();
