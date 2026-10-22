import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';
import { buildMetadataHook, createBuildPlan, isProductionPath, sourceCommit, writePortableExtras } from '../tools/build-windows.mjs';

const require = createRequire(import.meta.url);
const { createStaticServer } = require('../desktop/static-server.cjs');
const { portablePaths, seedEditableFile } = require('../desktop/main.cjs');

test('packager 20 metadata hook accepts its options object and returns a promise', async (t) => {
  const directory = fixture(t);
  const source = path.join(directory, 'source');
  const build = path.join(directory, 'build');
  fs.mkdirSync(source); fs.mkdirSync(build);
  const info = { version: '0.1.0-preview.1', sourceCommit: 'a'.repeat(40) };
  const hook = buildMetadataHook(source, info);
  await hook({ buildPath: build, electronVersion: '44.4.3', platform: 'win32', arch: 'x64' });
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(build, 'build-info.json'), 'utf8')), info);
  await assert.rejects(hook({ buildPath: source }), /source tree/);
});

function fixture(t) {
  const prefix = path.join(os.tmpdir(), 'miragine-desktop-test-');
  const directory = fs.mkdtempSync(prefix);
  t.after(() => {
    const absolute = path.resolve(directory);
    assert.ok(absolute.startsWith(path.resolve(prefix)) && absolute !== path.parse(absolute).root);
    fs.rmSync(absolute, { recursive: true, force: true });
  });
  return directory;
}

function put(root, name, contents = name) {
  const file = path.join(root, name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, contents);
  return file;
}

async function serve(t, root, options) {
  const server = createStaticServer(root, options);
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  t.after(() => new Promise((resolve) => { server.close(resolve); server.closeAllConnections?.(); }));
  return server.address().port;
}

function request(port, resource, { method = 'GET', headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: resource, method, headers: { Connection: 'close', ...headers } }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.once('end', () => resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks).toString() }));
      response.once('error', reject);
    });
    req.once('error', reject);
    req.end();
  });
}

function linkDirectory(t, target, link) {
  try { fs.symlinkSync(target, link, process.platform === 'win32' ? 'junction' : 'dir'); return true; }
  catch (error) {
    if (['EPERM', 'ENOTSUP', 'EACCES'].includes(error.code)) { t.skip('Directory symlinks/junctions unavailable'); return false; }
    throw error;
  }
}

function minimalApp(root) {
  put(root, 'index.html', '<h1>game</h1>');
  put(root, 'src/app/main.mjs', 'export const game = true;');
  put(root, 'assets/generated/image.png', 'image-bytes');
  put(root, 'generated/ui/original-graphics.js', 'window.OriginalGraphics = {};');
  put(root, 'config/defaults.generated.json', '{"default":true}');
  put(root, 'config/custom.json', '{"original":true}');
}

test('portable paths keep editable files next to the EXE, outside app.asar', (t) => {
  const directory = fixture(t);
  const appRoot = path.join(directory, 'resources', 'app.asar');
  const executable = path.join(directory, 'MiragineSuper.exe');
  const locations = portablePaths(appRoot, executable, true);
  assert.equal(locations.appRoot, appRoot);
  assert.equal(locations.portableRoot, directory);
  assert.equal(locations.custom, path.join(directory, 'config', 'custom.json'));
  assert.equal(locations.helper, path.join(directory, 'ui-helper', 'original-graphics.js'));
  assert.equal(locations.data, path.join(directory, 'userdata'));
  assert.equal(portablePaths(appRoot, executable, false).portableRoot, appRoot);
});

test('initial seeding never overwrites existing user configuration or helper edits', (t) => {
  const directory = fixture(t);
  const source = put(directory, 'bundled/default.json', '{"default":true}');
  const destination = path.join(directory, 'portable/config/custom.json');
  assert.equal(seedEditableFile(source, destination), true);
  fs.writeFileSync(destination, '{"userEdit":42}');
  assert.equal(seedEditableFile(source, destination), false);
  assert.equal(fs.readFileSync(destination, 'utf8'), '{"userEdit":42}');
  const helper = path.join(directory, 'portable/ui-helper/original-graphics.js');
  assert.equal(seedEditableFile(source, helper), true);
  fs.writeFileSync(helper, 'custom-helper();');
  assert.equal(seedEditableFile(source, helper), false);
  assert.equal(fs.readFileSync(helper, 'utf8'), 'custom-helper();');
});

test('static server handles game-only GET/HEAD routes and security headers', async (t) => {
  const root = fixture(t);
  minimalApp(root);
  const port = await serve(t, root);
  for (const resource of ['/', '/index.html', '/src/app/main.mjs', '/assets/generated/image.png', '/config/custom.json', '/config/defaults.generated.json']) {
    const response = await request(port, resource);
    assert.equal(response.status, 200, resource);
    assert.equal(response.headers['cache-control'], 'no-store');
    assert.equal(response.headers['content-security-policy'], "frame-ancestors 'none'");
    assert.equal(response.headers['x-frame-options'], 'DENY');
    assert.equal(response.headers['x-content-type-options'], 'nosniff');
    assert.equal(response.headers['cross-origin-resource-policy'], 'same-origin');
  }
  const head = await request(port, '/', { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(head.body, '');
  assert.equal(Number(head.headers['content-length']), '<h1>game</h1>'.length);
  const post = await request(port, '/', { method: 'POST' });
  assert.equal(post.status, 405);
  assert.equal(post.headers.allow, 'GET, HEAD');
  assert.equal((await request(port, '/', { headers: { Host: `attacker.example:${port}` } })).status, 403);
});

test('raw traversal, private routes, invalid encodings and SWF requests are denied', async (t) => {
  const root = fixture(t);
  minimalApp(root);
  for (const file of ['reference/game.swf', 'recovered/private.json', '.local/token.json', 'docs/private.json', 'config/secrets.json', 'assets/reference/private.json']) put(root, file);
  const port = await serve(t, root);
  for (const resource of [
    '/reference/game.swf', '/recovered/private.json', '/.local/token.json', '/docs/private.json', '/desktop/main.cjs',
    '/config/secrets.json', '/assets/reference/private.json', '/assets/anything.swf', '/assets', '/missing.json',
    '/src/../config/custom.json', '/src/%2e%2e/config/custom.json', '/src/%2E%2E%2fconfig/custom.json',
    '/src/%252e%252e/config/custom.json', '/src/%5c../config/custom.json', '/src/%00oops.js', '/src/%zz.js', '//src/app/main.mjs',
  ]) assert.equal((await request(port, resource)).status, 404, resource);
});

test('realpath checks deny symlinks both outside root and into nonpublic recovered files', async (t) => {
  const directory = fixture(t);
  const root = path.join(directory, 'app');
  minimalApp(root);
  put(directory, 'outside/private.json', '{"secret":true}');
  put(root, 'recovered/private.json', '{"secret":true}');
  if (!linkDirectory(t, path.join(directory, 'outside'), path.join(root, 'assets', 'outside'))) return;
  if (!linkDirectory(t, path.join(root, 'recovered'), path.join(root, 'assets', 'recovered-link'))) return;
  const port = await serve(t, root);
  assert.equal((await request(port, '/assets/outside/private.json')).status, 404);
  assert.equal((await request(port, '/assets/recovered-link/private.json')).status, 404);
});

test('external custom configuration and LGPL helper replacements really take precedence', async (t) => {
  const directory = fixture(t);
  const root = path.join(directory, 'resources', 'app.asar');
  minimalApp(root);
  const customFile = put(directory, 'config/custom.json', '{"edited":42}');
  const helperFile = put(directory, 'ui-helper/original-graphics.js', 'window.OriginalGraphics = {replacement:true};');
  const port = await serve(t, root, { customFile, helperFile, externalRoot: directory });
  assert.equal((await request(port, '/config/custom.json')).body, '{"edited":42}');
  assert.match((await request(port, '/generated/ui/original-graphics.js')).body, /replacement:true/);
  fs.writeFileSync(customFile, '{"edited":99}');
  assert.equal((await request(port, '/config/custom.json')).body, '{"edited":99}');
  assert.equal((await request(port, '/config/defaults.generated.json')).body, '{"default":true}');
  assert.throws(() => createStaticServer(root, { customFile }), /externalRoot/);
  assert.throws(() => createStaticServer(root, { customFile: path.join(directory, '..', 'escape.json'), externalRoot: directory }), /outside/);
});

test('external override directory symlinks cannot expose another portable/private directory', async (t) => {
  const directory = fixture(t);
  const root = path.join(directory, 'app');
  const portable = path.join(directory, 'portable');
  minimalApp(root);
  put(portable, 'userdata/custom.json', '{"private":true}');
  if (!linkDirectory(t, path.join(portable, 'userdata'), path.join(portable, 'config'))) return;
  const port = await serve(t, root, { customFile: path.join(portable, 'config/custom.json'), externalRoot: portable });
  assert.equal((await request(port, '/config/custom.json')).status, 404);
});

test('asar-shaped root directories remain valid without weakening realpath checks', async (t) => {
  const directory = fixture(t);
  const root = path.join(directory, 'resources', 'app.asar');
  minimalApp(root);
  const port = await serve(t, root);
  assert.equal((await request(port, '/')).status, 200);
  assert.equal((await request(port, '/src/app/main.mjs')).status, 200);
  // This is a filesystem compatibility unit test, not an Electron/ASAR runtime claim.
});

test('packaging whitelist excludes originals, references, private files and runtime tools', () => {
  for (const file of [
    'index.html', 'package.json', 'LICENSE', 'NOTICE.txt', 'README.md', 'README.en.md',
    'src/app/main.mjs', 'assets/generated/scenery/terrain.png', 'generated/ui/original-graphics.js',
    'generated/ui/NOTICE.md', 'config/custom.json', 'config/defaults.generated.json',
    'desktop/main.cjs', 'desktop/static-server.cjs', 'docs/licenses/GPL-3.0.txt', 'docs/parameters.zh-CN.md',
  ]) assert.equal(isProductionPath(file), true, file);
  for (const file of [
    '.local/token.json', 'recovered/unit-sprites/frame.png', 'reference/super.swf', 'assets/game.swf',
    'assets/reference/file.json', 'src/recovered/source.json', 'config/private.json', 'tools/dev-server.mjs',
    'tests/desktop.test.mjs', 'node_modules/electron/index.js', 'docs/provenance.json', 'desktop/unused.cjs',
    'src/.env', 'src/../recovered/private.json', 'C:/private/config.json',
  ]) assert.equal(isProductionPath(file), false, file);
  for (const directory of ['src', 'src/app', 'assets', 'generated/ui', 'docs', 'docs/licenses', 'desktop']) {
    assert.equal(isProductionPath(directory, { directory: true }), true, directory);
  }
  assert.equal(isProductionPath('recovered', { directory: true }), false);
});

test('each build uses a fresh output directory and refuses source symlinks', (t) => {
  const root = fixture(t);
  minimalApp(root);
  const now = new Date('2026-10-23T00:00:00.000Z');
  const one = createBuildPlan(root, '0.1.0-preview.1', { now });
  const two = createBuildPlan(root, '0.1.0-preview.1', { now });
  assert.notEqual(one.out, two.out);
  assert.ok(one.out.startsWith(path.join(root, 'dist') + path.sep));
  assert.equal(one.overwrite, false);
  assert.equal(one.asar, true);
  assert.equal(one.ignore('/src/app/main.mjs'), false);
  assert.equal(one.ignore('/config/private.json'), true);
  put(root, 'outside/example.json');
  if (linkDirectory(t, path.join(root, 'outside'), path.join(root, 'assets', 'linked'))) assert.equal(one.ignore('/assets/linked'), true);
  assert.throws(() => createBuildPlan(root, '../../unsafe'), /version/);
  assert.throws(() => createBuildPlan(root, '0.1.0', { nonce: '../escape' }), /nonce/);
});

test('release metadata pins committed code and rejects uncommitted public changes', () => {
  const commit = 'a'.repeat(40);
  const clean = (_git, args) => args[0] === 'rev-parse' ? `${commit}\n` : '';
  assert.equal(sourceCommit('.', clean), commit);
  const dirty = (_git, args) => args[0] === 'rev-parse' ? `${commit}\n` : ' M src/app/main.mjs\n';
  assert.throws(() => sourceCommit('.', dirty), /Commit all/);
  const untracked = (_git, args) => args[0] === 'rev-parse' ? `${commit}\n` : '?? src/new-module.mjs\n';
  assert.throws(() => sourceCommit('.', untracked), /Commit all/);
  assert.throws(() => sourceCommit('.', () => 'not-a-commit'), /committed Git revision/);
});

test('portable extras include licenses, replacement source/instructions and matching build info', (t) => {
  const directory = fixture(t);
  const project = path.join(directory, 'project');
  const output = path.join(directory, 'portable');
  const required = [
    'LICENSE', 'NOTICE.txt', 'README.md', 'README.en.md', 'docs/licenses/LGPL.txt', 'docs/licenses/GPL.txt',
    'config/custom.json', 'generated/ui/original-graphics.js', 'generated/ui/NOTICE.md',
    'generated/ui/LGPL-3.0.txt', 'generated/ui/GPL-3.0.txt', 'tools/build_ui.py', 'recovered/game-canvas/canvas.js',
  ];
  for (const file of required) put(project, file);
  const info = { version: '0.1.0-preview.1', sourceCommit: 'a'.repeat(40), platform: 'win32', arch: 'x64', electronVersion: '44.4.3' };
  writePortableExtras(project, output, info);
  for (const file of ['LICENSE', 'LICENSE.project.txt', 'NOTICE.txt', 'README.md', 'README.en.md', 'docs/licenses/LGPL.txt', 'docs/licenses/GPL.txt',
    'config/custom.json', 'ui-helper/original-graphics.js', 'ui-helper/source/canvas.js', 'ui-helper/source/build_ui.py', 'Start-Game.cmd']) {
    assert.ok(fs.statSync(path.join(output, file)).isFile(), file);
  }
  assert.match(fs.readFileSync(path.join(output, 'ui-helper/README.md'), 'utf8'), /actually loads/);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(output, 'build-info.json'))), info);
  assert.ok(!fs.readFileSync(path.join(output, 'build-info.json'), 'utf8').includes(directory));
  assert.match(fs.readFileSync(path.join(output, 'Start-Game.cmd'), 'utf8'), /%~dp0MiragineSuper\.exe/);
  put(output, 'config/custom.json', '{"userEdited":true}');
  put(output, 'ui-helper/original-graphics.js', 'customHelper();');
  writePortableExtras(project, output, info);
  assert.equal(fs.readFileSync(path.join(output, 'config/custom.json'), 'utf8'), '{"userEdited":true}');
  assert.equal(fs.readFileSync(path.join(output, 'ui-helper/original-graphics.js'), 'utf8'), 'customHelper();');
  assert.throws(() => writePortableExtras(project, output, { ...info, sourceCommit: 'b'.repeat(40) }), /different source version/);
});
