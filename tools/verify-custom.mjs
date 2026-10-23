/**
 * Standalone real-input customization acceptance harness (not @playwright/test).
 * Usage: node tools/verify-custom.mjs --url http://127.0.0.1:51286/
 *        node tools/verify-custom.mjs --dir <isolated-portable-directory>
 * Never writes game state, preferences, clocks, configuration, or victory flags.
 * Evaluation is restricted to read-only public state, DOM geometry, and timing.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const hash = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const expect = (condition, message) => { if (!condition) throw new Error(message); };

function loopbackUrl(input) {
  let url;
  try { url = new URL(input); } catch { throw new Error('--url must be an absolute loopback HTTP URL'); }
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
    || url.username || url.password) throw new Error('--url must be a loopback HTTP URL without credentials');
  return url.href;
}

export function parseCustomOptions(args) {
  const options = { out: '.local/custom-verification.json', sampleSeconds: 2, headless: false, screenshotPrefix: 'custom' };
  const seen = new Set();
  for (let index = 0; index < args.length; index++) {
    const flag = args[index];
    if (flag === '--help' || flag === '-h') { options.help = true; continue; }
    if (!['--url', '--dir', '--out', '--sample-seconds', '--headless', '--browser-channel', '--screenshot-prefix'].includes(flag)) throw new Error(`Unknown option: ${flag}`);
    if (seen.has(flag)) throw new Error(`Duplicate option: ${flag}`);
    seen.add(flag);
    if (flag === '--headless') { options.headless = true; continue; }
    const value = args[++index];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${flag}`);
    const key = flag === '--sample-seconds' ? 'sampleSeconds' : flag === '--browser-channel' ? 'browserChannel'
      : flag === '--screenshot-prefix' ? 'screenshotPrefix' : flag.slice(2);
    options[key] = flag === '--sample-seconds' ? Number(value) : value;
  }
  if (!Number.isFinite(options.sampleSeconds) || options.sampleSeconds < 0.5 || options.sampleSeconds > 10) {
    throw new Error('--sample-seconds must be finite and between 0.5 and 10');
  }
  if (options.url) options.url = loopbackUrl(options.url);
  if (options.browserChannel && !['chrome', 'msedge'].includes(options.browserChannel)) throw new Error('--browser-channel must be chrome or msedge');
  if (!/^[a-z0-9][a-z0-9-]{0,47}$/i.test(options.screenshotPrefix)) throw new Error('--screenshot-prefix must be 1-48 ASCII letters, digits, or hyphens, starting with a letter or digit');
  if (options.url && options.dir) throw new Error('Choose exactly one of --url or --dir');
  if (!options.help && !options.url && !options.dir) throw new Error('One of --url or --dir is required');
  return options;
}

export function summarizeTiming(samples, { speed, logicalHz = 30, tolerance = 0.25 } = {}) {
  const valid = samples.filter(sample => sample && typeof sample.atMs === 'number' && Number.isFinite(sample.atMs)
    && sample.atMs >= 0 && typeof sample.frame === 'number' && Number.isFinite(sample.frame) && sample.frame >= 0);
  const elapsedMs = valid.length >= 2 ? valid.at(-1).atMs - valid[0].atMs : null;
  const frameDelta = valid.length >= 2 ? valid.at(-1).frame - valid[0].frame : null;
  const expectedSimulationHz = Number.isFinite(speed) && speed > 0 && Number.isFinite(logicalHz) && logicalHz > 0
    ? speed * logicalHz : null;
  const measurable = expectedSimulationHz !== null && elapsedMs > 0 && frameDelta >= 0;
  const simulationHz = measurable ? frameDelta * 1000 / elapsedMs : null;
  const framesPerGameSecond = measurable ? simulationHz / speed : null;
  const relativeError = measurable ? Math.abs(simulationHz - expectedSimulationHz) / expectedSimulationHz : null;
  return { sampleCount: valid.length, elapsedMs, frameDelta, simulationHz, framesPerGameSecond,
    expectedSimulationHz, relativeError,
    passed: measurable && Number.isFinite(tolerance) && tolerance >= 0 && relativeError <= tolerance };
}

export function summarizeSubmissions(timestamps, elapsedMs) {
  const times = timestamps.filter(value => typeof value === 'number' && Number.isFinite(value) && value >= 0);
  const intervals = times.slice(1).map((value, index) => value - times[index])
    .filter(value => Number.isFinite(value) && value >= 0).sort((a, b) => a - b);
  const count = intervals.length;
  return { count: times.length,
    framesPerSecond: Number.isFinite(elapsedMs) && elapsedMs > 0 ? times.length * 1000 / elapsedMs : null,
    intervals: { count, medianMs: count ? (count % 2 ? intervals[(count - 1) / 2]
      : (intervals[count / 2 - 1] + intervals[count / 2]) / 2) : null,
    p95Ms: count ? intervals[Math.ceil(count * 0.95) - 1] : null, maxMs: count ? intervals.at(-1) : null } };
}

const presentationObserver = `(() => {
  if(window.__MIRAGINE_CUSTOM_OBSERVER__)return;
  const observation={active:false,times:[]};
  Object.defineProperty(window,'__MIRAGINE_CUSTOM_OBSERVER__',{value:observation});
  const proto=globalThis.CanvasRenderingContext2D?.prototype;
  if(!proto?.drawImage)return;
  const descriptor=Object.getOwnPropertyDescriptor(proto,'drawImage'),original=proto.drawImage;
  Object.defineProperty(proto,'drawImage',{...descriptor,value:function(...args){
    const result=Reflect.apply(original,this,args);
    if(observation.active&&this.canvas.id==='game')observation.times.push(performance.now());
    return result;
  }});
})();`;

export function rectanglesOverlap(a, b, epsilon = 0.5) {
  const valid = rect => rect && ['left', 'top', 'right', 'bottom'].every(key => Number.isFinite(rect[key]))
    && rect.right > rect.left && rect.bottom > rect.top;
  return Boolean(valid(a) && valid(b) && Number.isFinite(epsilon) && epsilon >= 0
    && Math.min(a.right, b.right) - Math.max(a.left, b.left) > epsilon
    && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > epsilon);
}

export function correctFit(v) {
  return Boolean(v && ['width', 'height', 'left', 'top', 'viewportWidth', 'viewportHeight'].every(key => Number.isFinite(v[key]))
    && v.width > 0 && v.height > 0 && v.viewportWidth > 0 && v.viewportHeight > 0
    && Math.abs(v.width / v.height - 4 / 3) < 1e-10 && v.left >= -1e-8 && v.top >= -1e-8
    && v.left + v.width <= v.viewportWidth + 1e-8 && v.top + v.height <= v.viewportHeight + 1e-8
    && (Math.abs(v.width - v.viewportWidth) < 1e-8 || Math.abs(v.height - v.viewportHeight) < 1e-8));
}

function bounded(operation, description, timeout = 10000) {
  let timer;
  return Promise.race([Promise.resolve(operation), new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Timed out: ${description}`)), timeout);
  })]).finally(() => clearTimeout(timer));
}

function redact(value, privateValues) {
  if (Array.isArray(value)) return value.map(entry => redact(entry, privateValues));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, redact(entry, privateValues)]));
  if (typeof value !== 'string') return value;
  let result = value;
  for (const item of privateValues.filter(Boolean).sort((a, b) => b.length - a.length)) {
    for (const form of [item, encodeURI(item), encodeURIComponent(item)]) result = result.split(form).join('[local]');
  }
  return result.replace(/file:\/\/\/[^\s"'<>]+/gi, '[local-file]')
    .replace(/\b[A-Z]:[\\/][^\r\n"'<>|]*/gi, '[local-path]')
    .replace(/\/(?:Users|home)\/[^\s"'<>]+/g, '[local-path]');
}

async function until(probe, description, timeout = 15000) {
  const deadline = Date.now() + timeout;
  do {
    const value = await bounded(Promise.resolve().then(probe), description);
    if (value) return value;
    await delay(75);
  } while (Date.now() < deadline);
  throw new Error(`Timed out: ${description}`);
}

async function terminateOwned(launcher, verifiedPid) {
  if (launcher?.exitCode === null && Number.isInteger(launcher.pid) && launcher.pid > 0) {
    if (process.platform === 'win32') {
      await new Promise((resolve, reject) => execFile('taskkill.exe', ['/PID', String(launcher.pid), '/T', '/F'],
        { windowsHide: true, timeout: 5000 }, error => error ? reject(error) : resolve()));
      return 'owned-launcher-tree';
    }
    launcher.kill('SIGKILL'); return 'owned-launcher-handle';
  }
  if (Number.isInteger(verifiedPid) && verifiedPid > 0 && verifiedPid !== process.pid) {
    process.kill(verifiedPid, 'SIGKILL'); return 'verified-owned-application-pid';
  }
  throw new Error('No owned process handle is available for cleanup');
}

function outputPath(relative) {
  const output = path.resolve(root, relative), inside = path.relative(root, output);
  expect(inside && !inside.startsWith('..') && !path.isAbsolute(inside)
    && ['.local', '.tmp', 'output', 'artifacts'].includes(inside.split(path.sep)[0]) && /\.json$/i.test(output),
  '--out must be a JSON file under an ignored output directory');
  return output;
}

function sourceHashes() {
  return Object.fromEntries(fs.readdirSync(path.join(root, 'src', 'core')).filter(name => name.endsWith('.mjs')).sort()
    .map(name => [name, hash(path.join(root, 'src', 'core', name))]));
}

export async function verifyCustom({ url, dir, out = '.local/custom-verification.json', sampleSeconds = 2, headless = false, browserChannel, screenshotPrefix = 'custom' }) {
  expect(Boolean(url) !== Boolean(dir), 'Choose exactly one of --url or --dir');
  expect(Number.isFinite(sampleSeconds) && sampleSeconds >= 0.5 && sampleSeconds <= 10, 'Invalid sample duration');
  expect(/^[a-z0-9][a-z0-9-]{0,47}$/i.test(screenshotPrefix), 'Invalid screenshot prefix');
  if (url) url = loopbackUrl(url);
  const output = outputPath(out), screenshots = path.join(root, 'output', 'playwright');
  fs.mkdirSync(path.dirname(output), { recursive: true }); fs.mkdirSync(screenshots, { recursive: true });
  const directory = dir ? path.resolve(dir) : null;
  let username = ''; try { username = os.userInfo().username; } catch { /* Optional metadata. */ }
  const privateValues = [root, directory, os.homedir(), username];
  const report = { schemaVersion: 1, status: 'running', startedAt: new Date().toISOString(), mode: dir ? 'portable' : 'browser',
    sampleSeconds, checks: [], timing: [], renderRates: [], gestures: [], screenshots: [], errors: [],
    policy: 'Actual pointer, wheel, drag and keyboard input; read-only state/DOM/timing inspection; transparent successful Canvas#game drawImage counting only; no simulation/clock/RNG injection or forced result',
    limits: ['Timing is a real-time observation with 20% acceptance tolerance, not a deterministic benchmark.',
      'Requested render limits are ceilings, not a promise to exceed the monitor or hardware refresh rate.',
      'Canvas submissions are completed drawImage calls, not physical display scan-out or independently proven pixel changes; no pixel readback is used.',
      'Actual local submission measurements do not prove 240 Hz scheduling on a 240 Hz display; deterministic clock unit tests are a separate gate.',
      'Fresh browser context/isolated portable only; verification never writes saved game preferences directly.'],
    cleanup: { ownedApplicationClosed: false } };
  let app, browser, server, context, page, launcher, verifiedPid, origin, editable;
  let coreBefore;
  const save = stage => {
    if (stage) report.progress = { stage, at: new Date().toISOString() };
    fs.writeFileSync(output, JSON.stringify(redact(report, privateValues), null, 2) + '\n');
  };
  const check = (condition, name, details) => {
    report.checks.push({ name, passed: Boolean(condition), ...(details === undefined ? {} : { details }) });
    save(name); expect(condition, `Customization verification failed: ${name}`);
  };
  const state = () => bounded(page.evaluate(() => window.__MIRAGINE__.getState()), 'read-only game state');
  const point = (fit, x, y) => ({ x: fit.clientLeft + fit.left + x * fit.scale, y: fit.clientTop + fit.top + y * fit.scale });
  async function hit(action, matches = {}) {
    let previous = '', stableSince = 0;
    const target = await until(async () => {
      const candidate = await bounded(page.evaluate(({ action, matches }) => ({
        hotspot: window.__MIRAGINE__.getHotspots().find(h => h.action === action
          && Object.entries(matches).every(([key, value]) => h[key] === value)),
        fit: window.__MIRAGINE__.getState().viewport,
      }), { action, matches }), 'read-only mapped hotspot');
      if (!candidate.hotspot) return false;
      const signature = JSON.stringify(candidate);
      if (signature !== previous) { previous = signature; stableSince = Date.now(); return false; }
      return Date.now() - stableSince >= 100 ? candidate : false;
    }, `stable hotspot ${action}`);
    const { hotspot: h, fit } = target, p = point(fit, (h.left + h.right) / 2, (h.top + h.bottom) / 2);
    await bounded(page.mouse.click(p.x, p.y), `actual click ${action}`); await delay(150);
  }
  async function press(code) {
    if (app && code === 'F11') {
      await bounded(app.evaluate(({ BrowserWindow }) => {
        const win = BrowserWindow.getAllWindows()[0]; win.focus(); win.webContents.focus();
        win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'F11' });
      }), 'native fullscreen keyDown');
      try { await delay(55); } finally {
        await bounded(app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents
          .sendInputEvent({ type: 'keyUp', keyCode: 'F11' })), 'native fullscreen keyUp');
      }
    } else {
      await page.keyboard.down(code); try { await delay(55); } finally { await page.keyboard.up(code); }
    }
    await delay(150);
  }
  async function toolbarInput(selector, action, name) {
    const before = await state();
    await action(page.locator(`[data-custom-controls] ${selector}`));
    await delay(120);
    const after = await state();
    check(JSON.stringify(before.selection.left) === JSON.stringify(after.selection.left)
      && before.phase === after.phase && before.overlay === after.overlay, `${name}: toolbar input does not penetrate original game controls`);
    return after;
  }
  async function screenshot(name) {
    const relative = `output/playwright/${screenshotPrefix}-${name}.png`;
    await bounded(page.screenshot({ path: path.join(root, relative), scale: 'css', timeout: 5000 }), 'verification screenshot', 6000);
    report.screenshots.push(relative); save(`captured ${name}`);
  }
  async function sample(speed, seconds = sampleSeconds) {
    const samples = [], start = performance.now();
    await bounded(page.evaluate(() => {
      const observer = window.__MIRAGINE_CUSTOM_OBSERVER__; observer.times = []; observer.active = true;
    }), 'start independent presentation counting');
    do {
      const value = await bounded(page.evaluate(() => {
        const game = window.__MIRAGINE__.getState();
        return { atMs: performance.now(), frame: game.frame, phase: game.phase, winner: game.winner };
      }), 'natural frame sampling');
      expect(value.phase === 'game' && !value.winner, 'Natural match ended before timing sample completed');
      samples.push({ atMs: value.atMs, frame: value.frame });
      if (performance.now() - start >= seconds * 1000) break;
      await delay(100);
    } while (true);
    const times = await bounded(page.evaluate(() => {
      const observer = window.__MIRAGINE_CUSTOM_OBSERVER__; observer.active = false; return observer.times;
    }), 'stop independent presentation counting');
    const timing = summarizeTiming(samples, { speed, logicalHz: 30, tolerance: 0.2 });
    return { speed, requestedSeconds: seconds, samples, ...timing, presentations: summarizeSubmissions(times, timing.elapsedMs) };
  }
  async function toolbarGeometry(label) {
    const dom = await bounded(page.evaluate(() => {
      const toolbar = document.querySelector('[data-custom-controls]');
      const r = toolbar?.getBoundingClientRect();
      return { rect: r ? { left: r.left, top: r.top, right: r.right, bottom: r.bottom } : null,
        visible: Boolean(r && r.width && r.height && getComputedStyle(toolbar).visibility !== 'hidden'
          && getComputedStyle(toolbar).display !== 'none'),
        hotspots: window.__MIRAGINE__.getHotspots(), fit: window.__MIRAGINE__.getState().viewport };
    }), 'read-only toolbar and HUD geometry');
    const layout = JSON.parse(fs.readFileSync(path.join(root, 'generated', 'ui', 'layout.generated.json'), 'utf8'));
    const staticHud = [...layout.sprites['210'].placements.filter(p => p.name && p.bounds),
      ...layout.rootFrames.game.placements.filter(p => p.name === 'tt')]
      .map(p => ({ name: p.name, left: p.bounds.xMin, right: p.bounds.xMax, top: p.bounds.yMin, bottom: p.bounds.yMax }));
    const hud = [...staticHud, ...dom.hotspots.map(h => ({ ...h, name: h.action }))].map(h => {
      const a = point(dom.fit, h.left, h.top), b = point(dom.fit, h.right, h.bottom);
      return { name: h.name, left: a.x, top: a.y, right: b.x, bottom: b.y };
    });
    const collisions = hud.filter(rect => rectanglesOverlap(dom.rect, rect));
    check(dom.visible && collisions.length === 0, `${label}: custom toolbar does not cover original HUD/buttons/cards`,
      { toolbar: dom.rect, collisions, viewport: dom.fit });
  }
  const attach = candidate => {
    candidate.on('pageerror', error => report.errors.push({ type: 'pageerror', message: error.message }));
    candidate.on('console', message => { if (message.type() === 'error') report.errors.push({ type: 'console', message: message.text() }); });
  };
  try {
    save('preparing independent verification');
    coreBefore = sourceHashes(); report.coreSha256Before = coreBefore;
    const { chromium, _electron } = await import('playwright');
    if (directory) {
      const executable = path.join(directory, 'MiragineSuper.exe');
      editable = ['config/custom.json', 'ui-helper/original-graphics.js'].map(name => ({ name, file: path.join(directory, name) }));
      for (const file of [executable, path.join(directory, 'resources', 'app.asar'), ...editable.map(item => item.file)]) {
        expect(fs.statSync(file).isFile(), 'Portable fixture is missing a required file');
      }
      editable.forEach(item => { item.before = hash(item.file); });
      const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
      app = await _electron.launch({ executablePath: executable, args: [], cwd: directory, env, timeout: 60000,
        artifactsDir: path.join(root, '.local', 'custom-automation') });
      launcher = app.process();
      const identity = await bounded(app.evaluate(() => ({ executable: process.execPath, pid: process.pid })), 'actual portable identity');
      check(fs.realpathSync(identity.executable).toLowerCase() === fs.realpathSync(executable).toLowerCase(), 'requested portable EXE was actually launched');
      verifiedPid = identity.pid; context = app.context(); page = await app.firstWindow({ timeout: 60000 }); attach(page);
      app.on('console', message => { if (message.type() === 'error') report.errors.push({ type: 'main-console', message: message.text() }); });
      await page.waitForURL(/^http:\/\/127\.0\.0\.1:\d+\//, { timeout: 60000 });
      await bounded(app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].maximize(); }), 'maximize owned application');
      report.platform = await bounded(app.evaluate(({ app, BrowserWindow, screen }) => ({
        bounds: BrowserWindow.getAllWindows()[0].getContentBounds(), gpu: app.getGPUFeatureStatus(),
        displayScaleFactors: screen.getAllDisplays().map(d => d.scaleFactor),
      })), 'read-only desktop metadata');
    } else {
      server = await chromium.launchServer({ headless, ...(browserChannel ? { channel: browserChannel } : {}) }); launcher = server.process();
      browser = await chromium.connect(server.wsEndpoint());
      context = await browser.newContext({ viewport: { width: 1280, height: 960 } });
      await context.addInitScript({ content: presentationObserver });
      page = await context.newPage(); attach(page); await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    }
    origin = new URL(page.url()).origin;
    check(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(origin).hostname), 'verification runs against a private loopback origin');
    await page.waitForFunction(() => window.__MIRAGINE__?.getState().ready, null, { timeout: 60000 });
    // Electron can already be ready when its firstWindow becomes inspectable.
    // Idempotent diagnostic wrapping never changes the application-owned state.
    await bounded(page.evaluate(presentationObserver), 'install independent Canvas submission observer');
    const initial = await state();
    check(initial.implementation === 'native-javascript-canvas' && initial.phase === 'title', 'native source application loads at original title');
    report.documentTitle = await page.title();
    await screenshot('title');
    check(initial.config.frameRate === 30, 'original logical rule remains 30 frames per game second');
    check(correctFit(initial.viewport), 'initial game canvas keeps aspect-preserving fit');
    await hit('single'); await until(async () => (await state()).panel === 'difficulty', 'normal difficulty panel');
    await hit('difficulty', { value: 1 }); await until(async () => (await state()).phase === 'game', 'normal single-player');
    if ((await state()).overlay === 'tutorial') await hit('tutorial-okay');
    const start = await state();
    check(start.singlePlay && start.difficulty === 1 && !start.overlay && !start.stopTimer, 'normal game starts through UI and tutorial is dismissed');
    check(start.customization?.timing?.stepHz === 30, 'custom clock retains the original 30 Hz logical step');
    await toolbarGeometry('initial');
    await hit('unit', { side: 'left', id: 3 }); check((await state()).selection.left[0] === 3, 'legacy unit selection works with toolbar visible');
    const recruit = (await state()).selection.left[2];
    await press('Space'); check((await state()).selection.left[2] !== recruit, 'legacy recruitment toggle still works');
    await press('Space'); await hit('unit', { side: 'left', id: 0 });
    for (const speed of [1, 2, 4, 8]) {
      const current = await toolbarInput(`[data-speed="${speed}"]`, locator => locator.click(), `speed ${speed}x`);
      check(current.customization.speed === speed, `actual speed ${speed}x button is reflected in read-only state`);
      const measurement = await sample(speed); report.timing.push(measurement); save(`sampled speed ${speed}x`);
      check(measurement.passed, `speed ${speed}x advances naturally within 20% of ${30 * speed} frames/wall-second`, measurement);
      check((await state()).config.frameRate === 30, `speed ${speed}x does not alter original unit/rule game-second length`);
    }
    await toolbarInput('[data-speed="1"]', locator => locator.click(), 'restore 1x');
    await until(async () => (await state()).income.left > 500 && (await state()).alive.left > 1, 'natural first settlement/recruitment', 20000);
    check((await state()).units.left.some(unit => unit.id === 0), 'natural economy recruits original selected unit without state injection');
    for (const rate of [30, 60, 120, 240]) {
      const current = await toolbarInput('[data-action="render-rate"]', locator => locator.selectOption(String(rate)), `render ceiling ${rate}`);
      check(current.customization.renderHz === rate, `render ceiling ${rate} is accepted through actual select control`);
      const measurement = await sample(1, Math.min(sampleSeconds, 1));
      const ceilingPassed = measurement.presentations.count > 0 && measurement.presentations.framesPerSecond <= rate * 1.2;
      report.renderRates.push({ requestedHz: rate, measured: (await state()).customization.measured,
        independentPresentations: measurement.presentations, ceilingPassed, simulation: measurement });
      check(ceilingPassed, `render ceiling ${rate} bounds independently observed final submissions`, measurement.presentations);
      check(measurement.passed, `render ceiling ${rate} does not change 1x simulation rate`, measurement);
    }
    const beforeWheel = await state(), p = point(beforeWheel.viewport, 320, 250);
    await page.mouse.move(p.x, p.y); await page.mouse.wheel(0, -360); await delay(150);
    const zoomed = await state();
    check(zoomed.customization.displayCamera.zoom > beforeWheel.customization.displayCamera.zoom, 'actual battlefield wheel zooms the display camera');
    check(JSON.stringify(zoomed.selection.left) === JSON.stringify(beforeWheel.selection.left), 'wheel zoom does not change unit selection/recruitment');
    for (const button of ['right', 'middle']) {
      let changed = false;
      for (const delta of [70, -140]) {
        const before = await state(), fit = before.viewport;
        const a = point(fit, 320, 260), b = point(fit, 320 + delta, 270);
        await page.mouse.move(a.x, a.y); await page.mouse.down({ button });
        try { await page.mouse.move(b.x, b.y, { steps: 8 }); } finally { await page.mouse.up({ button }); }
        await delay(150);
        const after = await state(), from = before.customization.displayCamera, to = after.customization.displayCamera;
        changed = Math.hypot(to.centerX - from.centerX, to.centerY - from.centerY) > 0.1;
        report.gestures.push({ button, delta, from, to, changed });
        check(JSON.stringify(before.selection.left) === JSON.stringify(after.selection.left), `${button} drag does not trigger left-click game controls`);
        if (changed) break;
      }
      check(changed, `actual ${button}-button drag pans the display camera`);
    }
    let current = await toolbarInput('[data-action="overview"]', locator => locator.click(), 'overview');
    check(current.customization.displayCamera.mode === 'overview', 'one-click overview enters full-map mode');
    const corners = current.customization.displayCamera.mapCorners;
    check(Array.isArray(corners) && corners.length === 4 && corners.every(corner => corner.visible && corner.drawable
      && Number.isFinite(corner.x) && Number.isFinite(corner.y) && corner.x >= 0 && corner.x <= 640
      && corner.y >= 0 && corner.y <= 400), 'overview projects all four original map corners inside the 640x400 battlefield', corners);
    report.overview = current.customization.displayCamera;
    await screenshot('overview');
    current = await toolbarInput('[data-action="follow"]', locator => locator.click(), 'follow');
    check(current.customization.displayCamera.mode === 'follow', 'one-click follow restores source-camera following');
    await screenshot('follow');
    await press('F11');
    await until(async () => app
      ? app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isFullScreen())
      : page.evaluate(() => Boolean(document.fullscreenElement)), 'actual F11 fullscreen');
    check(correctFit((await state()).viewport), 'fullscreen preserves canvas aspect ratio');
    await hit('unit', { side: 'left', id: 1 }); check((await state()).selection.left[0] === 1, 'fullscreen legacy pointer mapping remains accurate');
    await toolbarGeometry('fullscreen'); await screenshot('fullscreen');
    await press('F11');
    await until(async () => app
      ? app.evaluate(({ BrowserWindow }) => !BrowserWindow.getAllWindows()[0].isFullScreen())
      : page.evaluate(() => !document.fullscreenElement), 'exit actual fullscreen');
    if (!app) for (const [width, height] of [[1920, 1080], [900, 1200], [640, 480]]) {
      await page.setViewportSize({ width, height }); await delay(150);
      check(correctFit((await state()).viewport), `legacy fit remains valid at ${width}x${height}`);
      await toolbarGeometry(`${width}x${height}`);
      await hit('unit', { side: 'left', id: 2 }); check((await state()).selection.left[0] === 2, `legacy pointer mapping remains accurate at ${width}x${height}`);
    }
    await press('Escape'); check((await state()).overlay === 'quit', 'legacy Escape opens quit confirmation');
    const overlayControls = await page.locator('[data-custom-controls]').evaluate(node => {
      const rect = node.getBoundingClientRect(), style = getComputedStyle(node);
      const controls = [...node.querySelectorAll('button,select,input')];
      return { hidden: !rect.width || !rect.height || style.display === 'none' || style.visibility === 'hidden',
        disabled: controls.length > 0 && controls.every(control => control.disabled) };
    });
    check(overlayControls.hidden || overlayControls.disabled, 'custom toolbar is hidden or disabled under original modal overlay', overlayControls);
    await hit('quit-cancel'); check(!(await state()).overlay, 'legacy quit cancel restores game');
    await press('Escape'); await hit('quit-confirm');
    await until(async () => (await state()).phase === 'title', 'legacy quit returns to title');
    check((await state()).phase === 'title', 'legacy quit confirm returns to original menu');
    check(report.errors.length === 0 && (await state()).ready && !(await state()).error, 'no runtime JavaScript or console errors');
    report.final = await state(); report.status = 'passed';
  } catch (error) {
    report.status = 'failed'; report.failure = { name: error.name, message: error.message };
    if (page && !page.isClosed()) try { await screenshot('failure'); } catch { /* Bounded best-effort diagnostics. */ }
  } finally {
    save('closing only owned verification process');
    try {
      if (app) await bounded(app.close(), 'owned Electron close', 8000);
      else {
        if (context) await bounded(context.close(), 'owned browser context close', 5000);
        if (browser) await bounded(browser.close(), 'owned browser connection close', 5000);
        if (server) await bounded(server.close(), 'owned browser server close', 8000);
      }
      report.cleanup.ownedApplicationClosed = Boolean(app || server);
    } catch (error) {
      report.cleanup.error = error.message; report.status = 'failed';
      try { report.cleanup.termination = await terminateOwned(launcher, verifiedPid); }
      catch (failure) { report.cleanup.terminationError = failure.message; }
    }
    if (coreBefore) {
      try {
        report.coreSha256After = sourceHashes();
        report.coreUnchanged = JSON.stringify(coreBefore) === JSON.stringify(report.coreSha256After);
        if (!report.coreUnchanged) throw new Error('Core source bytes changed during verification');
      } catch (error) {
        report.status = 'failed'; report.errors.push({ type: 'source-integrity', message: error.message });
      }
    }
    if (editable) {
      try {
        report.editableFiles = editable.map(item => {
          const after = hash(item.file);
          return { name: item.name, before: item.before ?? null, after, unchanged: after === item.before };
        });
        if (report.editableFiles.some(item => !item.unchanged)) throw new Error('An editable portable file changed during verification');
      } catch (error) {
        report.status = 'failed'; report.errors.push({ type: 'editable-integrity', message: error.message });
      }
    }
    if (report.errors.length) report.status = 'failed';
    report.finishedAt = new Date().toISOString(); save('verification finished');
  }
  const safe = redact(report, privateValues);
  console.log(JSON.stringify({ status: safe.status, checks: safe.checks.length,
    report: path.relative(root, output).split(path.sep).join('/'), timing: safe.timing,
    ...(safe.failure ? { failure: safe.failure } : {}), cleanup: safe.cleanup }, null, 2));
  if (safe.status !== 'passed') process.exitCode = 1;
  return safe;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parseCustomOptions(process.argv.slice(2));
    if (options.help) console.log('Usage: node tools/verify-custom.mjs (--url <loopback-dev-server> | --dir <isolated-portable>) [--browser-channel chrome|msedge] [--out .local/custom-verification.json] [--screenshot-prefix custom] [--sample-seconds 2] [--headless]');
    else await verifyCustom(options);
  } catch (error) {
    console.error(redact(error.message, [root, os.homedir()])); process.exitCode = 1;
  }
}
