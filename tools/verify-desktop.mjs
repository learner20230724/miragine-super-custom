/**
 * Verify a built portable EXE, not a development Electron entry point.
 * Usage: node tools/verify-desktop.mjs --dir <portable-directory>
 *        node tools/verify-desktop.mjs --dir <isolated-custom-copy> --profile custom
 *
 * The caller prepares any custom fixture. This tool never edits configuration,
 * drawing helpers, localStorage, simulation state, clocks, or victory flags.
 * Game actions use actual mapped mouse hotspots or 55 ms CDP key holds.
 * F11 uses Electron webContents.sendInputEvent so the native before-input-event
 * shortcut runs; CDP dispatch does not exercise that Electron event path.
 * Native window maximize/fullscreen and read-only package inspection are tested
 * separately from the game's read-only __MIRAGINE__ inspection hook.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { _electron } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function parseOptions(args) {
  const result = { profile: 'default' };
  for (let index = 0; index < args.length; index += 1) {
    const option = args[index];
    if (option === '--help' || option === '-h') { result.help = true; continue; }
    if (option !== '--dir' && option !== '--profile') throw new Error(`Unknown option: ${option}`);
    const value = args[++index];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${option}`);
    const key = option.slice(2);
    if (key === 'dir' && result.dir) throw new Error('--dir may be supplied only once');
    result[key] = value;
  }
  if (!['default', 'custom'].includes(result.profile)) throw new Error('--profile must be default or custom');
  if (!result.help && !result.dir) throw new Error('--dir <portable-directory> is required');
  return result;
}

function hash(file) { return createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }

/** Reports and terminal summaries must never retain local absolute paths. */
export function redact(value, privateValues = []) {
  if (Array.isArray(value)) return value.map(entry => redact(entry, privateValues));
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, redact(entry, privateValues)]));
  }
  if (typeof value !== 'string') return value;
  let text = value;
  for (const entry of privateValues.filter(Boolean).sort((left, right) => right.length - left.length)) {
    text = text.split(entry).join('[local]');
    text = text.split(encodeURI(entry)).join('[local]');
    text = text.split(encodeURIComponent(entry)).join('[local]');
  }
  return text.replace(/file:\/\/\/[^\s"'<>]+/gi, '[local-file]')
    .replace(/\b[A-Z]:[\\/][^\r\n"'<>|]*/gi, '[local-path]')
    .replace(/\/(?:Users|home)\/[^\s"'<>]+/g, '[local-path]');
}

function expect(condition, message) { if (!condition) throw new Error(message); }

/** A modal native ErrorBox can block the main inspector and app.close(). */
export function bounded(operation, description, timeout = 10000) {
  let timer;
  return Promise.race([
    Promise.resolve(operation),
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`Timed out: ${description}`)), timeout); }),
  ]).finally(() => clearTimeout(timer));
}

/** Kill only the launcher handle/tree created by this invocation, never a name. */
async function terminateOwnedApplication(launcher, applicationPid) {
  if (launcher?.exitCode === null && Number.isInteger(launcher.pid) && launcher.pid > 0) {
    if (process.platform === 'win32') {
      await new Promise((resolve, reject) => {
        execFile('taskkill.exe', ['/PID', String(launcher.pid), '/T', '/F'],
          { windowsHide: true, timeout: 5000 }, error => error ? reject(error) : resolve());
      });
      return 'owned-launcher-tree';
    }
    launcher.kill('SIGKILL');
    return 'owned-launcher-handle';
  }
  // The PID is read from the launched app itself only after execPath matches.
  if (Number.isInteger(applicationPid) && applicationPid > 0 && applicationPid !== process.pid) {
    process.kill(applicationPid, 'SIGKILL');
    return 'verified-owned-application-pid';
  }
  throw new Error('No live owned launcher or verified application PID is available for cleanup');
}

async function until(probe, description, timeout = 10000) {
  const deadline = Date.now() + timeout;
  do {
    const result = await probe();
    if (result) return result;
    await delay(75);
  } while (Date.now() < deadline);
  throw new Error(`Timed out: ${description}`);
}

function correctFit(viewport) {
  return viewport && Math.abs(viewport.width / viewport.height - 4 / 3) < 1e-10
    && viewport.left >= -1e-8 && viewport.top >= -1e-8
    && viewport.width <= viewport.viewportWidth + 1e-8
    && viewport.height <= viewport.viewportHeight + 1e-8
    && (Math.abs(viewport.width - viewport.viewportWidth) < 1e-8
      || Math.abs(viewport.height - viewport.viewportHeight) < 1e-8);
}

export async function verifyDesktop({ dir, profile = 'default' }) {
  expect(['default', 'custom'].includes(profile), 'Unsupported verification profile');
  const directory = path.resolve(dir);
  const executable = path.join(directory, 'MiragineSuper.exe');
  const archive = path.join(directory, 'resources', 'app.asar');
  const customFile = path.join(directory, 'config', 'custom.json');
  const helperFile = path.join(directory, 'ui-helper', 'original-graphics.js');
  const screenshot = `output/playwright/desktop-${profile}.png`;
  const reportFile = path.join(root, '.local', `desktop-proof-${profile}.json`);
  fs.mkdirSync(path.dirname(reportFile), { recursive: true });
  fs.mkdirSync(path.join(root, 'output', 'playwright'), { recursive: true });
  let username = '';
  try { username = os.userInfo().username; } catch { /* Optional OS metadata. */ }
  const privateValues = [directory, root, os.homedir(), username];
  const report = {
    schemaVersion: 1, profile, status: 'running',
    startedAt: new Date().toISOString(), checks: [], errors: [],
    inputPolicy: 'Mapped pointer hotspots; 55 ms CDP game keys; native F11 via Electron webContents.sendInputEvent; real-time simulation; no state injection',
    keyboardInputs: [],
    network: { scope: 'Renderer BrowserContext requests, including a full observed reload',
      auditCompleted: false, requests: 0, paths: [], forbiddenRuntimeRequests: [], externalRequests: [], failedRequests: [] },
    cleanup: { ownedApplicationClosed: false },
  };
  let app;
  let page;
  let ownedProcess;
  let ownedApplicationPid;
  let origin = null;
  let customHash;
  let helperHash;
  const requestUrls = new Set();
  const httpFailures = [];
  const writeProgress = stage => {
    if (stage) report.progress = { stage, at: new Date().toISOString() };
    fs.writeFileSync(reportFile, `${JSON.stringify(redact(report, privateValues), null, 2)}\n`);
  };
  const check = (condition, name, details) => {
    report.checks.push({ name, passed: Boolean(condition), ...(details === undefined ? {} : { details }) });
    writeProgress(name);
    expect(condition, `Desktop verification failed: ${name}`);
  };
  const state = () => bounded(page.evaluate(() => window.__MIRAGINE__.getState()), 'read-only game state');
  const nativeState = () => bounded(app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    return { maximized: win.isMaximized(), fullscreen: win.isFullScreen(), content: win.getContentBounds() };
  }), 'native window state');
  async function press(code) {
    if (code === 'F11') {
      // Input.dispatchKeyEvent used by page.keyboard does not reach Electron's
      // before-input-event shortcut. Send a real native-window input event;
      // never call setFullScreen from this verification tool.
      await bounded(app.evaluate(({ BrowserWindow }) => {
        const win = BrowserWindow.getAllWindows()[0];
        win.focus();
        win.webContents.focus();
        win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'F11' });
      }), 'native F11 keyDown');
      try { await delay(55); }
      finally {
        await bounded(app.evaluate(({ BrowserWindow }) => {
          BrowserWindow.getAllWindows()[0].webContents.sendInputEvent({ type: 'keyUp', keyCode: 'F11' });
        }), 'native F11 keyUp');
      }
      report.keyboardInputs.push({ code, backend: 'Electron webContents.sendInputEvent', holdMs: 55 });
      writeProgress('native F11 sent through Electron before-input-event path');
      await delay(150);
      return;
    }
    await page.keyboard.down(code);
    try { await page.waitForTimeout(55); } finally { await page.keyboard.up(code); }
    report.keyboardInputs.push({ code, backend: 'Playwright CDP keyboard input', holdMs: 55 });
    await page.waitForTimeout(110);
  }
  async function hit(action, matches = {}) {
    // The original title buttons slide under a mask. Wait for the actual
    // hotspot/viewport to settle instead of clicking guessed stale coordinates.
    let previous = null;
    let stableSince = 0;
    const target = await until(async () => {
      const candidate = await bounded(page.evaluate(({ action, matches }) => ({
        hotspot: window.__MIRAGINE__.getHotspots().find(value => value.action === action
          && Object.entries(matches).every(([key, expected]) => value[key] === expected)),
        viewport: window.__MIRAGINE__.getState().viewport,
      }), { action, matches }), 'read-only current hotspot');
      if (!candidate.hotspot) return false;
      const signature = JSON.stringify(candidate);
      if (signature !== previous) { previous = signature; stableSince = Date.now(); return false; }
      return Date.now() - stableSince >= 100 ? candidate : false;
    }, `stable current hotspot: ${action}`);
    const { hotspot, viewport } = target;
    await page.mouse.click(viewport.clientLeft + viewport.left + (hotspot.left + hotspot.right) * 0.5 * viewport.scale,
      viewport.clientTop + viewport.top + (hotspot.top + hotspot.bottom) * 0.5 * viewport.scale);
    await page.waitForTimeout(150);
  }
  const listenPage = candidate => {
    candidate.on('pageerror', error => report.errors.push({ type: 'pageerror', message: error.message }));
    candidate.on('console', message => {
      if (message.type() === 'error') report.errors.push({ type: 'console', message: message.text() });
    });
  };
  try {
    writeProgress('checking portable release files');
    for (const file of [executable, archive, customFile, helperFile, path.join(directory, 'build-info.json')]) {
      expect(fs.statSync(file).isFile(), 'The portable directory is missing a required release file');
    }
    const buildInfo = readJson(path.join(directory, 'build-info.json'));
    customHash = hash(customFile);
    helperHash = hash(helperFile);
    report.fixture = { configurationSha256: customHash, drawingHelperSha256: helperHash };
    if (profile === 'custom') {
      const overrides = readJson(customFile).overrides;
      check(overrides?.units?.['0']?.cost === 7 && overrides?.units?.['0']?.hp === 99
        && overrides?.rules?.startingIncome === 777, 'caller-prepared external custom fixture exists');
    }
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    writeProgress('launching the supplied portable executable');
    app = await _electron.launch({ executablePath: executable, args: [], cwd: directory,
      env, timeout: 60000, artifactsDir: path.join(root, '.local', `desktop-automation-${profile}`) });
    app.on('console', message => {
      if (message.type() === 'error') report.errors.push({ type: 'main-console', message: message.text() });
    });
    ownedProcess = app.process();
    report.launcher = { executable: path.basename(ownedProcess.spawnfile) };
    writeProgress('reading actual Electron executable identity');
    const actualProcess = await bounded(app.evaluate(() => ({ executable: process.execPath, pid: process.pid })),
      'actual Electron executable identity');
    const normalize = file => fs.realpathSync(file).toLowerCase();
    check(normalize(actualProcess.executable) === normalize(executable), 'the supplied portable EXE was actually launched');
    ownedApplicationPid = actualProcess.pid;
    const context = app.context();
    const observedPages = new WeakSet();
    const attachPage = candidate => {
      if (!observedPages.has(candidate)) { observedPages.add(candidate); listenPage(candidate); }
    };
    context.on('page', attachPage);
    for (const candidate of context.pages()) attachPage(candidate);
    context.on('request', request => { report.network.requests += 1; requestUrls.add(request.url()); });
    context.on('requestfailed', request => {
      const error = request.failure()?.errorText ?? 'Unknown network failure';
      if (!error.includes('ERR_ABORTED')) report.network.failedRequests.push({ url: request.url(), error });
    });
    context.on('response', response => {
      if (response.status() >= 400) httpFailures.push({ url: response.url(), status: response.status() });
    });
    writeProgress('waiting for the packaged application window');
    page = await app.firstWindow({ timeout: 60000 });
    attachPage(page);
    await page.waitForURL(/^http:\/\/127\.0\.0\.1:\d+\//, { timeout: 60000 });
    origin = new URL(page.url()).origin;
    check(/^http:\/\/127\.0\.0\.1:\d+$/.test(origin), 'packaged application uses its private loopback server');
    const identity = await bounded(app.evaluate(({ app }) => {
      // Electron's default Node inspector context need not expose CommonJS
      // require to callFunctionOn. The bundled modern Node provides this API.
      const fs = process.getBuiltinModule('node:fs');
      const path = process.getBuiltinModule('node:path');
      const archive = app.getAppPath();
      const metadata = JSON.parse(fs.readFileSync(path.join(archive, 'build-info.json'), 'utf8'));
      return { packaged: app.isPackaged, archiveName: path.basename(archive),
        asar: /[/\\]app\.asar$/.test(archive), version: app.getVersion(), metadata };
    }), 'packaged app.asar identity');
    check(identity.packaged && identity.asar && identity.archiveName === 'app.asar', 'application code executes from packaged app.asar');
    check(identity.version === buildInfo.version && identity.metadata.version === buildInfo.version
      && identity.metadata.sourceCommit === buildInfo.sourceCommit,
    'portable metadata matches packaged version and source commit');
    report.launch = { executable: 'MiragineSuper.exe', archive: identity.archiveName,
      packaged: identity.packaged, version: identity.version, sourceCommit: buildInfo.sourceCommit,
      executableSha256: hash(executable), archiveSha256: hash(archive) };
    // Observe the complete ordinary page load, not only requests after attachment.
    writeProgress('observing a complete packaged renderer reload');
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForFunction(() => window.__MIRAGINE__?.getState().ready,
      null, { timeout: 60000 });
    let current = await state();
    check(current.implementation === 'native-javascript-canvas' && current.phase === 'title'
      && current.panel === 'home', 'native original menu loads independently from the source workspace');
    check(await page.evaluate(() => Object.keys(window.__MIRAGINE__).sort().join(',') === 'getHotspots,getState'),
      'inspection hook provides read-only getters only');
    const expected = profile === 'custom' ? { cost: 7, hp: 99, income: 777 } : { cost: 20, hp: 45, income: 500 };
    check(current.config.firstUnitCost === expected.cost && current.config.firstUnitHp === expected.hp
      && current.config.startingIncome === expected.income, 'effective packaged configuration matches requested profile', expected);

    await bounded(app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].maximize()), 'native maximize request');
    await until(async () => (await nativeState()).maximized, 'native maximize');
    await until(async () => correctFit((await state()).viewport), 'maximized aspect-preserving viewport');
    current = await state();
    check(correctFit(current.viewport), 'maximized game uses all available space without cropping', current.viewport);
    if (current.viewport.left > 2 || current.viewport.top > 2) {
      const fit = current.viewport;
      await page.mouse.click(fit.clientLeft + (fit.left > 2 ? fit.left / 2 : fit.viewportWidth / 2),
        fit.clientTop + (fit.left > 2 ? fit.viewportHeight / 2 : fit.top / 2));
      check((await state()).panel === 'home', 'maximized black-bar click does not activate the game');
    }
    await hit('single');
    await page.waitForFunction(() => window.__MIRAGINE__.getState().panel === 'difficulty');
    check((await state()).panel === 'difficulty', 'actual maximized pointer opens single-player difficulty menu');
    await hit('difficulty', { value: 1 });
    await page.waitForFunction(() => window.__MIRAGINE__.getState().phase === 'game');
    current = await state();
    check(current.singlePlay && current.difficulty === 1 && current.income.left === expected.income,
      'normal single-player starts with the actual configured income');
    if (current.overlay !== 'tutorial') await hit('tutorial');
    check((await state()).overlay === 'tutorial', 'original tutorial opens through normal UI');
    await hit('tutorial-okay');
    check(!(await state()).overlay && !(await state()).stopTimer, 'tutorial confirmation enables the original round clock');
    await hit('unit', { side: 'left', id: 3 });
    check((await state()).selection.left[0] === 3, 'scaled pointer selects an original unit');
    await press('KeyD');
    check((await state()).selection.left[0] === 4, '55 ms keyboard input is consumed on real simulation frames');
    await hit('unit', { side: 'left', id: 0 });

    await press('F11');
    await until(async () => (await nativeState()).fullscreen, 'native F11 fullscreen');
    await until(async () => correctFit((await state()).viewport), 'fullscreen aspect-preserving viewport');
    check(correctFit((await state()).viewport), 'native fullscreen scales the game without cropping');
    await hit('unit', { side: 'left', id: 1 });
    check((await state()).selection.left[0] === 1, 'fullscreen pointer coordinates remain accurate');
    await hit('unit', { side: 'left', id: 0 });
    await press('F11');
    await until(async () => !(await nativeState()).fullscreen, 'exit native fullscreen');
    check(!(await nativeState()).fullscreen, 'F11 restores the window without replacing the application');

    const startFrame = (await state()).frame;
    writeProgress('waiting for 180 natural simulation frames and recruitment');
    await page.waitForFunction(({ frame, income }) => {
      const value = window.__MIRAGINE__.getState();
      return value.frame >= frame + 180 && value.income.left > income
        && value.alive.left > 1 && value.units.left.some(unit => unit.id === 0);
    }, { frame: startFrame, income: expected.income }, { timeout: 20000 });
    current = await state();
    check(current.frame >= startFrame + 180 && current.income.left > expected.income && current.alive.left > 1,
      '180 natural frames settle income and recruit units without simulation injection',
      { startFrame, endFrame: current.frame, income: current.income.left, alive: current.alive.left });
    check(current.units.left.some(unit => unit.id === 0 && unit.nowHP === expected.hp),
      'configured first-unit HP is applied to actual naturally recruited units', { expectedHp: expected.hp });
    check(current.rendering?.spritesDrawn > 0 && current.rendering?.missingSprites?.length === 0
      && current.rendering?.ground?.triangleCount > 0,
    'original sprites and native WebGL perspective terrain actually render');
    check(current.ready && !current.error && report.errors.length === 0, 'no runtime JavaScript or console errors');
    report.final = current;
    await page.screenshot({ path: path.join(root, screenshot), scale: 'css' });
    report.screenshot = screenshot;
    for (const raw of requestUrls) {
      const url = new URL(raw);
      if (/\.swf(?:$|[?#])|ruffle/i.test(raw)) report.network.forbiddenRuntimeRequests.push(url.pathname);
      if (['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol) && url.origin !== origin) {
        report.network.externalRequests.push({ protocol: url.protocol, host: url.host, path: url.pathname });
      }
      if (url.origin === origin) report.network.paths.push(url.pathname);
    }
    report.network.paths = [...new Set(report.network.paths)].sort();
    report.network.httpFailures = httpFailures;
    report.network.auditCompleted = true;
    check(report.network.forbiddenRuntimeRequests.length === 0 && report.network.externalRequests.length === 0,
      'observed packaged renderer requests no SWF, Ruffle, or external sites');
    check(httpFailures.length === 0 && report.network.failedRequests.length === 0, 'all observed runtime resources load successfully');
    check(hash(customFile) === customHash && hash(helperFile) === helperHash, 'verification and startup never overwrite editable configuration or drawing helpers');
    report.fixture.configurationUnchanged = true;
    report.fixture.drawingHelperUnchanged = true;
    report.status = 'passed';
  } catch (error) {
    report.status = 'failed';
    report.failure = { name: error.name, message: error.message };
    writeProgress('verification failed; collecting bounded diagnostics');
    if (page && !page.isClosed()) {
      try {
        await bounded(page.screenshot({ path: path.join(root, screenshot), scale: 'css', timeout: 5000 }),
          'diagnostic screenshot', 6000);
        report.screenshot = screenshot;
      }
      catch { /* A launch or page crash may prevent a diagnostic screenshot. */ }
    }
  } finally {
    if (app) {
      writeProgress('closing only the owned application');
      const closing = app.close();
      try { await bounded(closing, 'owned application graceful close', 8000); report.cleanup.ownedApplicationClosed = true; }
      catch (error) {
        report.cleanup.closeError = error.message;
        writeProgress('graceful close timed out; terminating only the owned launcher/application');
        try {
          report.cleanup.termination = await terminateOwnedApplication(ownedProcess, ownedApplicationPid);
          try { await bounded(closing, 'owned application disconnect after termination', 1500); }
          catch { /* The report already records forced cleanup and failure. */ }
        } catch (terminationError) {
          report.cleanup.terminationError = terminationError.message;
        }
        report.status = 'failed';
      }
    }
    if (report.status === 'passed' && report.errors.length > 0) {
      report.status = 'failed';
      report.failure = { name: 'RuntimeError', message: 'A runtime error was observed before application shutdown completed' };
    }
    if (customHash && helperHash) {
      try {
        const unchanged = hash(customFile) === customHash && hash(helperFile) === helperHash;
        if (!unchanged) {
          report.status = 'failed';
          report.failure = { name: 'EditableFileChanged', message: 'An editable release file changed during verification or shutdown' };
        }
        if (report.fixture) report.fixture.unchangedAfterShutdown = unchanged;
      } catch {
        report.status = 'failed';
        report.failure = { name: 'EditableFileMissing', message: 'An editable release file could not be checked after shutdown' };
      }
    }
    report.finishedAt = new Date().toISOString();
    const safe = redact(report, privateValues);
    fs.writeFileSync(reportFile, `${JSON.stringify(safe, null, 2)}\n`);
  }
  const safe = redact(report, privateValues);
  console.log(JSON.stringify({ status: safe.status, profile, checks: safe.checks.length,
    proof: `.local/desktop-proof-${profile}.json`, screenshot: safe.screenshot ?? null,
    ...(safe.failure ? { failure: safe.failure } : {}) }, null, 2));
  if (safe.status !== 'passed') process.exitCode = 1;
  return safe;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parseOptions(process.argv.slice(2));
    if (options.help) console.log('Usage: node tools/verify-desktop.mjs --dir <portable-directory> [--profile default|custom]');
    else await verifyDesktop(options);
  } catch (error) {
    let username = '';
    try { username = os.userInfo().username; } catch { /* Optional OS metadata. */ }
    console.error(redact(error.message, [root, os.homedir(), username]));
    process.exitCode = 1;
  }
}
