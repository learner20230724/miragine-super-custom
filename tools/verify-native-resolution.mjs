/** Actual UI-driven baseline/native render profiling. No simulation or RNG injection. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { setTimeout as delay } from 'node:timers/promises';
import { bounded, redact } from './verify-desktop.mjs';
import { summarizeIntervals, summarizeCpuProfile } from './profile-desktop.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const expect = (value, message) => { if (!value) throw new Error(message); };
const sha = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
export function parseNativeOptions(args) {
  const result = { mode: 'native', seconds: 8, matrix: 'full', out: '.local/native-resolution.json', prefix: 'native-resolution', channel: 'msedge' };
  const seen = new Set();
  for (let index = 0; index < args.length; index++) {
    const name = args[index];
    if (name === '--help') { result.help = true; continue; }
    if (!['--dir', '--url', '--source-electron', '--mode', '--matrix', '--seconds', '--out', '--prefix', '--channel'].includes(name)) throw new Error(`Unknown option: ${name}`);
    if (seen.has(name)) throw new Error(`Duplicate option: ${name}`); seen.add(name);
    const value = args[++index]; if (!value || value.startsWith('--')) throw new Error(`Missing value: ${name}`);
    result[name.slice(2)] = name === '--seconds' ? Number(value) : value;
  }
  if (result.help) return result;
  expect([result.dir, result.url, result['source-electron']].filter(Boolean).length === 1, 'Specify exactly one --dir, --source-electron or --url');
  expect(['baseline', 'native'].includes(result.mode), 'Invalid mode');
  expect(['full', 'high'].includes(result.matrix), 'Invalid resolution matrix');
  expect(Number.isFinite(result.seconds) && result.seconds >= 1 && result.seconds <= 30, 'Invalid duration');
  expect(/^[a-z0-9-]+$/i.test(result.prefix), 'Unsafe screenshot prefix');
  const relative = path.relative(root, path.resolve(root, result.out));
  expect(relative && !relative.startsWith('..') && !path.isAbsolute(relative)
    && ['.local', 'output', 'artifacts'].includes(relative.split(path.sep)[0]) && /\.json$/.test(relative), 'Use an ignored JSON report path');
  if (result.url) { const url = new URL(result.url); expect(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)
    && !url.username && !url.password, 'Only an unauthenticated loopback URL is allowed'); }
  return result;
}

export function nativeSurfaceMatches(state, canvas) {
  const p = state?.presentationStats, v = state?.viewport;
  return Boolean(p?.mode === 'native-resolution' && p.logicalWidth === 640 && p.logicalHeight === 480
    && Number.isInteger(canvas?.width) && canvas.width > 0 && Number.isInteger(canvas.height) && canvas.height > 0
    && p.backingWidth === canvas.width && p.backingHeight === canvas.height
    && v?.backingWidth === canvas.width && v?.backingHeight === canvas.height
    && Math.abs(p.renderScaleX - canvas.width / 640) < 1e-8
    && Math.abs(p.renderScaleY - canvas.height / 480) < 1e-8);
}

export function visibleHotspotPoint(hotspot, viewport) {
  if (!hotspot || !viewport) return null;
  const left = Math.max(0, hotspot.left), right = Math.min(640, hotspot.right);
  const top = Math.max(0, hotspot.top), bottom = Math.min(480, hotspot.bottom);
  if (![left, right, top, bottom, viewport.scale, viewport.clientLeft, viewport.clientTop, viewport.left, viewport.top].every(Number.isFinite)
    || right <= left || bottom <= top || viewport.scale <= 0) return null;
  return { x: viewport.clientLeft + viewport.left + (left + right) * .5 * viewport.scale,
    y: viewport.clientTop + viewport.top + (top + bottom) * .5 * viewport.scale };
}

export function sameRenderViewport(before, after) {
  const keys = ['viewportWidth', 'viewportHeight', 'gameWidth', 'gameHeight', 'scale', 'left', 'top', 'width', 'height',
    'right', 'bottom', 'clientLeft', 'clientTop', 'devicePixelRatio', 'backingWidth', 'backingHeight', 'pixelScaleX', 'pixelScaleY'];
  return Boolean(before && after && keys.every(key => Number.isFinite(before[key]) && before[key] === after[key]));
}

export function summarizeNativeSample(before, after, observer, mode) {
  const elapsedMs = after.atMs - before.atMs;
  expect(Number.isFinite(elapsedMs) && elapsedMs > 0, 'Invalid sample interval');
  const frames = mode === 'native' ? after.game.presentationStats.framesPresented - before.game.presentationStats.framesPresented : observer.presentations;
  expect(Number.isInteger(frames) && frames >= 0, 'Invalid presentation count');
  return { elapsedMs, presentationFrames: frames, presentationFps: frames * 1000 / elapsedMs,
    simulationFrames: after.game.frame - before.game.frame,
    simulationHz: (after.game.frame - before.game.frame) * 1000 / elapsedMs,
    animateCpu: summarizeIntervals(observer.cpuMs), animateIntervals: summarizeIntervals(observer.intervals),
    nativeRenderCpu: mode === 'native' ? {
      totalMs: after.game.presentationStats.renderCpuTotalMs - before.game.presentationStats.renderCpuTotalMs,
      averageMs: frames ? (after.game.presentationStats.renderCpuTotalMs - before.game.presentationStats.renderCpuTotalMs) / frames : null,
      lifetimeMaxMs: after.game.presentationStats.renderCpuMaxMs,
    } : null };
}

// Both versions use the same wrapper. It observes the complete animate callback,
// including logic and control work, not GPU completion. Baseline only: count its
// one final display drawImage. Native: use production's read-only present count.
const observation = `(() => {
  if (window.__NATIVE_QA_OBSERVER__) return;
  const value={active:false,cpuMs:[],intervals:[],last:null,presentations:0};
  Object.defineProperty(window,'__NATIVE_QA_OBSERVER__',{value});
  const original=requestAnimationFrame;
  window.requestAnimationFrame=function(callback){
    if(callback.name!=='animate')return Reflect.apply(original,this,[callback]);
    return Reflect.apply(original,this,[function(...args){
      const started=performance.now();
      try{return Reflect.apply(callback,this,args);}finally{
        if(value.active){value.cpuMs.push(performance.now()-started);
          if(value.last!==null)value.intervals.push(started-value.last);value.last=started;}
      }
    }]);
  };
  const proto=CanvasRenderingContext2D.prototype, draw=proto.drawImage;
  const descriptor=Object.getOwnPropertyDescriptor(proto,'drawImage');
  Object.defineProperty(proto,'drawImage',{...descriptor,value:function(...args){
    const result=Reflect.apply(draw,this,args);
    if(value.active&&this.canvas.id==='game')value.presentations++;
    return result;
  }});
})();`;

async function until(probe, description, timeout = 20000) {
  const end = Date.now() + timeout;
  do { const result = await probe(); if (result) return result; await delay(100); } while (Date.now() < end);
  throw new Error(`Timed out: ${description}`);
}

export async function verifyNativeResolution(options) {
  const { mode, seconds, prefix, channel } = options;
  const output = path.resolve(root, options.out), sourceElectron = Boolean(options['source-electron']);
  const directory = (options.dir || options['source-electron']) && path.resolve(root, options.dir || options['source-electron']);
  fs.mkdirSync(path.dirname(output), { recursive: true }); fs.mkdirSync(path.join(root, 'output/playwright'), { recursive: true });
  expect(!fs.existsSync(output), 'Refusing to overwrite an earlier verification report');
  let username = ''; try { username = os.userInfo().username; } catch { /* Optional. */ }
  const privateValues = [root, os.homedir(), username, ...(directory ? [directory] : [])];
  const report = { schemaVersion: 1, status: 'running', mode, seconds, matrix: options.matrix, startedAt: new Date().toISOString(), checks: [], scenarios: [], screenshots: [], errors: [], cleanup: {},
    protocol: 'Actual mapped menu clicks, F2 controls, finite 64-per-side sandbox generation, native pause, disabled recruitment, 240 presentation target. Owned test process mute-audio safeguard plus actual music-off button as first input. Same CSS viewport/DPR emulation in baseline and native, original 30 Hz logic. Read-only state inspection; no simulation/RNG/clock injection.',
    limits: ['Synchronous animate CPU includes logic/control work and excludes GPU completion.', 'Presentation submissions are not physical monitor refresh or pixel-change counts.',
      'Seed and external desktop load are not controlled. Paused fixtures have equal army counts; live scenes may diverge.', 'DPR emulation allocates actual device-pixel buffers; it is not a physical display throughput guarantee.'] };
  const save = progress => { report.progress = progress; fs.writeFileSync(output, JSON.stringify(redact(report, privateValues), null, 2) + '\n'); };
  const check = (value, name, details) => { report.checks.push({ name, passed: Boolean(value), ...(details === undefined ? {} : { details }) }); save(name); expect(value, name); };
  let app, browser, context, page, cdp, editable, targetMetrics;
  const state = () => bounded(page.evaluate(() => window.__MIRAGINE__.getState()), 'read-only game state', 20000);
  const action = name => page.locator(`[data-settings-action="${name}"]`);
  const playback = name => page.locator(`[data-playback-controls] [data-action="${name}"]`);
  const open = async () => { if (!(await state()).customization.settingsOpen) await page.keyboard.press('F2'); await until(async () => (await state()).customization.settingsOpen, 'settings open'); };
  const close = async () => { if ((await state()).customization.settingsOpen) await page.keyboard.press('F2'); await until(async () => !(await state()).customization.settingsOpen, 'settings closed'); };
  const pause = async value => { await open(); if ((await state()).customization.paused !== value) await playback('pause').click(); await until(async () => (await state()).customization.paused === value, 'pause state'); };
  async function hit(name, match = {}) {
    let last = '', since = 0;
    const target = await until(async () => {
      const value = await page.evaluate(({ name, match }) => {
      const h = window.__MIRAGINE__.getHotspots().find(item => item.action === name && Object.entries(match).every(([key, value]) => item[key] === value));
      const v = window.__MIRAGINE__.getState().viewport;
      // Some original title symbols extend beyond the logical 640x480 stage
      // (music x=616..679). Click the visible intersection, not hidden center.
      return { hotspot: h, viewport: v };
      }, { name, match });
      const candidate = visibleHotspotPoint(value.hotspot, value.viewport);
      if (!candidate) return false;
      const signature = JSON.stringify(candidate);
      if (signature !== last) { last = signature; since = Date.now(); return false; }
      return Date.now() - since >= 100 ? candidate : false;
    }, `stable hotspot ${name}`);
    await page.mouse.click(target.x, target.y); await delay(150);
  }
  async function setupArmy() {
    await pause(true); await action('tab-sandbox').click();
    await page.locator('[data-live-recruitment="left"]').uncheck(); await page.locator('[data-live-recruitment="right"]').uncheck();
    await action('clear-all').click(); await page.locator('[data-sandbox-unit]').selectOption('0'); await page.locator('[data-sandbox-count]').fill('64');
    await action('spawn-left').click(); await until(async () => (await state()).alive.left === 65, '64 red soldiers');
    await action('spawn-right').click(); await until(async () => (await state()).alive.right === 65, '64 blue soldiers');
    await playback('render-rate').selectOption('240');
    await playback('speed-number').fill('1'); await playback('speed-number').press('Tab');
    await pause(true); await close();
    check((await state()).customization.paused, 'finite army fixture is manually paused after speed selection');
    check((await state()).config.frameRate === 30, 'original logic rate remains 30 Hz');
  }
  async function capture(name) {
    const file = `output/playwright/${prefix}-${name}.png`;
    // Element screenshot may temporarily override and then reset Electron's
    // emulated DPR to the OS DPR. Raw CDP capture does not change our viewport.
    const before = await state();
    const screenshot = await bounded(cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true,
      captureBeyondViewport: false }), 'device-pixel viewport screenshot', 20000);
    fs.writeFileSync(path.join(root, file), Buffer.from(screenshot.data, 'base64'));
    const after = await state();
    check(sameRenderViewport(before.viewport, after.viewport), `${name}: screenshot preserves viewport and DPR`,
      { before: before.viewport, after: after.viewport });
    report.screenshots.push(file); save(`captured ${name}`);
  }
  async function measure(name, moving = false) {
    await cdp.send('Emulation.setDeviceMetricsOverride', { ...targetMetrics, mobile: false });
    await delay(1000); save(`measuring ${name}`);
    // Atomically align observer boundaries with state/time snapshots so slow
    // baseline frames between two CDP round trips cannot inflate its FPS.
    const before = await page.evaluate(() => {
      const o = window.__NATIVE_QA_OBSERVER__; o.active = true; o.cpuMs = []; o.intervals = []; o.last = null; o.presentations = 0;
      return { atMs: performance.now(), game: window.__MIRAGINE__.getState(), hidden: document.hidden, focused: document.hasFocus() };
    });
    await cdp.send('Profiler.start');
    expect(Math.abs(before.game.viewport.devicePixelRatio - targetMetrics.deviceScaleFactor) < 1e-5,
      'Scenario DPR differs from its requested controlled target');
    if (moving) {
      const end = Date.now() + seconds * 1000; let direction = 0;
      while (Date.now() < end) {
        const key = direction++ % 2 ? 'KeyL' : 'KeyJ';
        await page.keyboard.down(key);
        try { await delay(Math.min(1500, Math.max(1, end - Date.now()))); }
        finally { await page.keyboard.up(key); }
      }
    } else await delay(seconds * 1000);
    const cpu = await cdp.send('Profiler.stop');
    const after = await page.evaluate(() => {
      const o = window.__NATIVE_QA_OBSERVER__; o.active = false;
      return { atMs: performance.now(), game: window.__MIRAGINE__.getState(), hidden: document.hidden, focused: document.hasFocus(),
        observer: { cpuMs: o.cpuMs, intervals: o.intervals, presentations: o.presentations } };
    });
    expect(sameRenderViewport(before.game.viewport, after.game.viewport), 'Viewport changed during a performance sample');
    const observer = after.observer;
    const sample = summarizeNativeSample(before, after, observer, mode);
    const brief = value => ({ atMs: value.atMs, frame: value.game.frame, alive: value.game.alive, phase: value.game.phase,
      rendering: value.game.rendering, presentationStats: value.game.presentationStats, camera: value.game.customization.displayCamera,
      viewport: value.game.viewport, muted: value.game.muted, paused: value.game.customization.paused, hidden: value.hidden, focused: value.focused });
    report.scenarios.push({ name, moving, ...sample, start: brief(before), end: brief(after), cpu: summarizeCpuProfile(cpu.profile, page.url()) });
    check(after.game.ready && !after.game.error && after.game.phase === 'game', `${name}: game stays healthy`);
    check(before.game.muted && after.game.muted, `${name}: test music remains disabled`);
    check(sample.animateCpu.count > 0 && sample.presentationFrames > 0, `${name}: actual animate callbacks and presentation submissions observed`);
    if (before.game.customization.paused) check(sample.simulationFrames === 0, `${name}: render refresh never advances paused simulation`);
    await capture(name);
  }
  try {
    const playwright = await import('playwright');
    if (directory) {
      expect(!fs.existsSync(path.join(directory, 'userdata')), 'Use a fresh isolated portable extraction');
      const executable = sourceElectron ? createRequire(import.meta.url)('electron') : path.join(directory, 'MiragineSuper.exe');
      report.fixture = sourceElectron ? { kind: 'isolated-source-electron', executableSha256: sha(executable),
        inventory: JSON.parse(fs.readFileSync(path.join(directory, 'qa-source-inventory.json'), 'utf8')) }
        : { kind: 'portable-release', build: JSON.parse(fs.readFileSync(path.join(directory, 'build-info.json'), 'utf8')), executableSha256: sha(executable), archiveSha256: sha(path.join(directory, 'resources/app.asar')) };
      editable = (sourceElectron ? ['config/custom.json'] : ['config/custom.json', 'ui-helper/original-graphics.js'])
        .map(name => ({ file: path.join(directory, name), hash: sha(path.join(directory, name)) }));
      const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
      app = await playwright._electron.launch({ executablePath: executable, args: sourceElectron ? [directory, '--mute-audio'] : ['--mute-audio'], cwd: directory, env, timeout: 60000 });
      const identity = await app.evaluate(() => process.execPath);
      check(fs.realpathSync(identity).toLowerCase() === fs.realpathSync(executable).toLowerCase(), 'owned actual Electron executable identity verified');
      context = app.context(); page = await app.firstWindow(); await page.waitForURL(/^http:\/\/127\.0\.0\.1:\d+\//, { timeout: 60000 });
      report.platform = await app.evaluate(({ app, BrowserWindow }) => { const win = BrowserWindow.getAllWindows()[0]; win.show(); win.focus(); return { gpuFeatureStatus: app.getGPUFeatureStatus(), contentBounds: win.getContentBounds() }; });
    } else {
      browser = await playwright.chromium.launch({ channel, headless: true, args: ['--mute-audio'] }); context = await browser.newContext(); page = await context.newPage(); await page.goto(options.url);
      report.platform = { browser: browser.version(), channel, headless: true };
    }
    page.on('pageerror', error => report.errors.push({ type: 'pageerror', message: error.message }));
    page.on('console', message => { if (message.type() === 'error') report.errors.push({ type: 'console', message: message.text() }); });
    page.on('dialog', dialog => dialog.accept());
    cdp = await context.newCDPSession(page); await cdp.send('Page.enable');
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: observation });
    await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 1000 });
    await page.reload({ waitUntil: 'domcontentloaded' }); await page.waitForFunction(() => window.__MIRAGINE__?.getState().ready, null, { timeout: 60000 });
    await cdp.send('Runtime.evaluate', { expression: observation });
    const startup = await state();
    report.startup = { viewport: startup.viewport, presentationStats: startup.presentationStats,
      scope: 'First ready title after test reload; fresh view caches but network/runtime may be warmed by initial launch.' };
    // The first actual UI action must silence this owned test application.
    // Never change system volume or touch any pre-existing player window.
    if (!(await state()).muted) await hit('music');
    await until(async () => (await state()).muted === true, 'actual music button disables owned test audio', 3000);
    check((await state()).muted === true, 'owned test game music disabled before all other UI inputs');
    check((await state()).phase === 'title', 'fresh original title');
    await hit('single'); await hit('difficulty', { value: 1 });
    if ((await state()).overlay === 'tutorial') await hit('tutorial-never');
    await until(async () => (await state()).phase === 'game' && !(await state()).overlay, 'normal match begins');
    const sizes = options.matrix === 'high' ? [{ width: 1920, height: 1227, deviceScaleFactor: 2 }]
      : [{ width: 1280, height: 960, deviceScaleFactor: 1 }, { width: 1920, height: 1227, deviceScaleFactor: 2 }];
    for (const size of sizes) {
      targetMetrics = size;
      const name = `${size.width}x${size.height}-dpr${size.deviceScaleFactor}`;
      await cdp.send('Emulation.setDeviceMetricsOverride', { ...size, mobile: false }); await delay(400);
      await setupArmy();
      let s = await state();
      const canvas = await page.locator('#game').evaluate(node => ({ width: node.width, height: node.height, cssWidth: node.getBoundingClientRect().width, cssHeight: node.getBoundingClientRect().height, dpr: devicePixelRatio }));
      check(Math.abs(canvas.dpr - size.deviceScaleFactor) < 1e-5, `${name}: requested device pixel ratio is active`, canvas);
      if (mode === 'native') check(nativeSurfaceMatches(s, canvas), `${name}: final rendering target matches actual backing pixels`, { canvas, presentation: s.presentationStats });
      const selection = JSON.stringify(s.selection.left), selectedId = s.selection.left[0] + s.selection.left[1] * 8;
      // Production intentionally ignores recruitment selection while paused.
      // Resume only for the real pointer check, then freeze the fixture again.
      await pause(false); await close();
      await hit('unit', { side: 'left', id: selectedId === 1 ? 0 : 1 });
      check(JSON.stringify((await state()).selection.left) !== selection, `${name}: resized/DPR mapped unit click changes actual selection`);
      await pause(true); await close();
      await open(); await playback('follow').click(); await close(); await measure(`${name}-paused-follow`);
      await measure(`${name}-paused-moving-camera`, true);
      await open(); await playback('overview').click(); await close();
      check((await state()).customization.displayCamera.mode === 'overview', `${name}: overview control works`);
      await measure(`${name}-paused-overview`);
      s = await state(); const v = s.viewport;
      await page.mouse.move(v.clientLeft + v.left + v.width / 2, v.clientTop + v.top + v.height * .4); await page.mouse.wheel(0, -500); await delay(300);
      check((await state()).customization.displayCamera.zoom > s.customization.displayCamera.zoom, `${name}: wheel zoom increases camera zoom`);
      await measure(`${name}-paused-zoom`);
      await open(); await playback('overview').click(); await pause(false); await close(); await measure(`${name}-live-1x-overview`);
    }
    if (mode === 'native') {
      // This is a brief functional resize/DPR smoke, not another performance matrix.
      await pause(true); await close();
      await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 960, deviceScaleFactor: 1, mobile: false });
      await delay(300);
      const initial = await state(), canvas = await page.locator('#game').evaluate(node => ({ width: node.width, height: node.height }));
      check(nativeSurfaceMatches(initial, canvas) && Math.abs(initial.viewport.devicePixelRatio - 1) < 1e-5,
        'DPR1 resize smoke: actual target remains native with original logical coordinates', { viewport: initial.viewport, presentation: initial.presentationStats });
      const v = initial.viewport, x = v.clientLeft + v.left + 320 * v.scale, y = v.clientTop + v.top + 200 * v.scale;
      await page.mouse.move(x, y); await page.mouse.wheel(0, -300); await delay(150);
      const zoomed = await state();
      check(zoomed.customization.displayCamera.zoom > initial.customization.displayCamera.zoom, 'DPR1 resize smoke: actual wheel zoom still works');
      await page.mouse.down({ button: 'right' }); await page.mouse.move(x + 60, y + 30, { steps: 4 }); await page.mouse.up({ button: 'right' }); await delay(100);
      const dragged = await state(), oldCamera = zoomed.customization.displayCamera, newCamera = dragged.customization.displayCamera;
      check(newCamera.centerX !== oldCamera.centerX || newCamera.centerY !== oldCamera.centerY, 'DPR1 resize smoke: actual right-button camera dragging works');
      check(dragged.frame === initial.frame, 'DPR1 resize smoke: resize and observation input never step paused logic');
      const selection = JSON.stringify(dragged.selection.left), id = dragged.selection.left[0] + dragged.selection.left[1] * 8;
      await pause(false); await close(); await hit('unit', { side: 'left', id: id === 1 ? 0 : 1 });
      check(JSON.stringify((await state()).selection.left) !== selection, 'DPR1 resize smoke: real resized unit hit-testing remains accurate');
      await pause(true); await close(); await capture('dpr1-resize-smoke');
    }
    check(report.errors.length === 0, 'no renderer exceptions or console errors'); report.status = 'completed';
  } catch (error) {
    report.status = 'failed'; report.failure = { name: error.name, message: error.message };
    if (page && !page.isClosed()) {
      try { report.failureState = await state(); await capture('failure'); } catch { /* Preserve original failure. */ }
    }
  }
  finally {
    if (app) { try { await bounded(app.close(), 'close owned portable only', 10000); report.cleanup.ownedApplicationClosed = true; } catch (error) { report.cleanup.error = error.message; report.status = 'failed'; } }
    if (browser) { try { await bounded(browser.close(), 'close owned browser', 10000); report.cleanup.ownedBrowserClosed = true; } catch (error) { report.cleanup.error = error.message; report.status = 'failed'; } }
    if (editable) { report.fixture.editableFilesUnchanged = editable.every(item => sha(item.file) === item.hash); if (!report.fixture.editableFilesUnchanged) report.status = 'failed'; }
    report.finishedAt = new Date().toISOString(); save('finished');
  }
  console.log(JSON.stringify({ status: report.status, checks: report.checks.length, scenarios: report.scenarios.map(s => ({ name: s.name, fps: s.presentationFps, cpuMs: s.animateCpu.averageMs, simulationHz: s.simulationHz })), failure: report.failure, output: options.out }, null, 2));
  if (report.status !== 'completed') process.exitCode = 1;
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { const options = parseNativeOptions(process.argv.slice(2)); if (options.help) console.log('Usage: node tools/verify-native-resolution.mjs (--dir <fresh-portable> | --source-electron <fresh-source-copy> | --url <loopback>) [--mode baseline|native] [--matrix full|high] [--seconds 8] [--out .local/proof.json] [--prefix proof]'); else await verifyNativeResolution(options); }
  catch (error) { console.error(redact(error.message, [root, os.homedir()])); process.exitCode = 1; }
}
