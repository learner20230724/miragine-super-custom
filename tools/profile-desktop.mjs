/**
 * Profile an isolated portable EXE using ordinary game inputs and read-only state.
 * Canvas instrumentation preserves arguments, receiver, return value and errors;
 * it counts/times getImageData and counts final game-canvas drawImage calls
 * without changing drawing output or game state. Presentation calls are distinct
 * from independent rAF callbacks; neither proves a physical display scan-out.
 * Usage: node tools/profile-desktop.mjs --dir <portable> --out .local/perf.json
 *        [--seconds 10]
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { _electron } from 'playwright';
import { bounded, redact } from './verify-desktop.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const hash = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const expect = (condition, message) => { if (!condition) throw new Error(message); };

export function parseProfileOptions(args) {
  const options = { out: '.local/performance-profile.json', seconds: 10 };
  const seen = new Set();
  for (let index = 0; index < args.length; index++) {
    const option = args[index];
    if (option === '--help' || option === '-h') { options.help = true; continue; }
    if (!['--dir', '--out', '--seconds'].includes(option)) throw new Error(`Unknown option: ${option}`);
    if (seen.has(option)) throw new Error(`Duplicate option: ${option}`);
    seen.add(option);
    const value = args[++index];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${option}`);
    options[option.slice(2)] = option === '--seconds' ? Number(value) : value;
  }
  if (!Number.isFinite(options.seconds) || options.seconds <= 0 || options.seconds > 120) {
    throw new Error('--seconds must be a finite number greater than 0 and at most 120');
  }
  if (!options.help && !options.dir) throw new Error('--dir <portable-directory> is required');
  return options;
}

export function summarizeIntervals(intervals) {
  const values = intervals.filter(value => typeof value === 'number' && Number.isFinite(value) && value >= 0)
    .sort((a, b) => a - b);
  const n = values.length;
  return {
    count: n,
    medianMs: n ? (n % 2 ? values[(n - 1) / 2] : (values[n / 2 - 1] + values[n / 2]) / 2) : null,
    p95Ms: n ? values[Math.ceil(n * 0.95) - 1] : null,
    maxMs: n ? values[n - 1] : null,
    averageMs: n ? values.reduce((sum, value) => sum + value, 0) / n : null,
    over50Ms: values.filter(value => value > 50).length,
    over100Ms: values.filter(value => value > 100).length,
  };
}

/** Final game-canvas submissions, not rAF callback or physical scan-out FPS. */
export function summarizePresentations(timestamps, elapsedMs) {
  const times = timestamps.filter(value => typeof value === 'number' && Number.isFinite(value) && value >= 0);
  return { count: times.length,
    framesPerSecond: Number.isFinite(elapsedMs) && elapsedMs > 0 ? times.length * 1000 / elapsedMs : null,
    intervals: summarizeIntervals(times.slice(1).map((value, index) => value - times[index])) };
}

/** CPU samples never retain private script URLs, query strings, or file paths. */
export function sanitizeScriptUrl(input, baseUrl = '') {
  const value = String(input ?? '');
  if (!value) return '';
  if (/^(?:file:|[a-z]:[\\/]|\\\\)|\/(?:Users|home)\//i.test(value)) return '[local]';
  try {
    const url = new URL(value, baseUrl || undefined);
    if (url.protocol === 'file:') return '[local]';
    if (['http:', 'https:'].includes(url.protocol)) return url.pathname;
    if (url.protocol === 'node:') return value.split(/[?#]/)[0];
    if (url.protocol === 'chrome-extension:' || url.protocol === 'devtools:') return `[${url.protocol.slice(0, -1)}]`;
  } catch { /* Anonymous/native scripts need no URL. */ }
  return value.split(/[?#]/)[0];
}

export function summarizeCpuProfile(profile, baseUrl = '') {
  const nodes = new Map((profile?.nodes ?? []).map(node => [node.id, node]));
  const parents = new Map();
  for (const node of nodes.values()) for (const child of node.children ?? []) parents.set(child, node.id);
  const groups = new Map();
  const nodeGroups = new Map();
  for (const node of nodes.values()) {
    const call = node.callFrame ?? {};
    const entry = { functionName: call.functionName || '(anonymous)',
      url: sanitizeScriptUrl(call.url, baseUrl), lineNumber: call.lineNumber ?? -1,
      columnNumber: call.columnNumber ?? -1, selfSamples: 0, inclusiveSamples: 0 };
    const key = JSON.stringify([entry.functionName, entry.url, entry.lineNumber, entry.columnNumber]);
    if (!groups.has(key)) groups.set(key, entry);
    nodeGroups.set(node.id, key);
  }
  const samples = profile?.samples ?? [];
  for (const id of samples) {
    const own = nodeGroups.get(id);
    if (own) groups.get(own).selfSamples++;
    const seenNodes = new Set(), seenGroups = new Set();
    for (let current = id; current !== undefined && !seenNodes.has(current); current = parents.get(current)) {
      seenNodes.add(current);
      const group = nodeGroups.get(current);
      if (group && !seenGroups.has(group)) { groups.get(group).inclusiveSamples++; seenGroups.add(group); }
    }
  }
  const entries = [...groups.values()].map(entry => ({ ...entry,
    selfPercent: samples.length ? entry.selfSamples / samples.length * 100 : 0,
    inclusivePercent: samples.length ? entry.inclusiveSamples / samples.length * 100 : 0 }));
  return { sampleCount: samples.length,
    topSelf: entries.filter(entry => entry.selfSamples).sort((a, b) => b.selfSamples - a.selfSamples).slice(0, 10),
    topInclusive: entries.filter(entry => entry.inclusiveSamples).sort((a, b) => b.inclusiveSamples - a.inclusiveSamples).slice(0, 10) };
}

const instrumentation = `(() => {
  if(window.__MIRAGINE_PROFILE__)return;
  const state = {calls:0,totalMs:0,maxMs:0,byContext:{},active:false,intervals:[],last:null,presentationTimes:[]};
  Object.defineProperty(window,'__MIRAGINE_PROFILE__',{value:state,configurable:false});
  for(const name of ['CanvasRenderingContext2D','OffscreenCanvasRenderingContext2D']) {
    const proto=globalThis[name]?.prototype;
    if(!proto?.getImageData)continue;
    const descriptor=Object.getOwnPropertyDescriptor(proto,'getImageData');
    const original=proto.getImageData;
    const wrapper=function(...args){
      const start=performance.now();
      try{return Reflect.apply(original,this,args);}
      finally{
        const elapsed=performance.now()-start;
        state.calls++;state.totalMs+=elapsed;state.maxMs=Math.max(state.maxMs,elapsed);
        const context=state.byContext[name]??={calls:0,totalMs:0,maxMs:0};
        context.calls++;context.totalMs+=elapsed;context.maxMs=Math.max(context.maxMs,elapsed);
      }
    };
    Object.defineProperty(proto,'getImageData',{...descriptor,value:wrapper});
  }
  const displayProto=globalThis.CanvasRenderingContext2D?.prototype;
  if(displayProto?.drawImage) {
    const descriptor=Object.getOwnPropertyDescriptor(displayProto,'drawImage');
    const original=displayProto.drawImage;
    const wrapper=function(...args){
      const result=Reflect.apply(original,this,args);
      if(state.active&&this.canvas.id==='game')state.presentationTimes.push(performance.now());
      return result;
    };
    Object.defineProperty(displayProto,'drawImage',{...descriptor,value:wrapper});
  }
  state.sample=function sample(now){
    if(!state.active)return;
    if(state.last!==null)state.intervals.push(now-state.last);
    state.last=now;requestAnimationFrame(sample);
  };
})();`;

async function until(probe, description, timeout = 15000) {
  const end = Date.now() + timeout;
  do { const result = await probe(); if (result) return result; await delay(100); } while (Date.now() < end);
  throw new Error(`Timed out: ${description}`);
}

async function terminateOwned(launcher, pid) {
  if (launcher?.exitCode === null && launcher.pid > 0) {
    if (process.platform === 'win32') {
      await new Promise((resolve, reject) => execFile('taskkill.exe', ['/PID', String(launcher.pid), '/T', '/F'],
        { windowsHide: true, timeout: 5000 }, error => error ? reject(error) : resolve()));
      return 'owned-launcher-tree';
    }
    launcher.kill('SIGKILL'); return 'owned-launcher-handle';
  }
  if (Number.isInteger(pid) && pid > 0 && pid !== process.pid) { process.kill(pid, 'SIGKILL'); return 'verified-owned-pid'; }
  throw new Error('No owned application handle available');
}

function ignoredOutput(output) {
  const relative = path.relative(root, output);
  return relative && !relative.startsWith('..') && !path.isAbsolute(relative)
    && ['.local', '.tmp', 'output', 'artifacts'].includes(relative.split(path.sep)[0]) && /\.json$/i.test(output);
}

export async function profileDesktop({ dir, out = '.local/performance-profile.json', seconds = 10 }) {
  expect(Number.isFinite(seconds) && seconds > 0 && seconds <= 120, 'Invalid measurement duration');
  const directory = path.resolve(dir), output = path.resolve(root, out);
  expect(ignoredOutput(output), '--out must be a JSON file under ignored .local, .tmp, output, or artifacts');
  fs.mkdirSync(path.dirname(output), { recursive: true });
  let username = ''; try { username = os.userInfo().username; } catch { /* Optional OS metadata. */ }
  const privateValues = [directory, root, os.homedir(), username];
  const executable = path.join(directory, 'MiragineSuper.exe');
  const archive = path.join(directory, 'resources', 'app.asar');
  const editable = ['config/custom.json', 'ui-helper/original-graphics.js'].map(name => path.join(directory, name));
  const report = { schemaVersion: 1, status: 'running', startedAt: new Date().toISOString(),
    secondsPerScenario: seconds, scenarios: [], consoleErrors: [], errors: [],
    policy: 'Actual isolated portable EXE; native maximize; ordinary mapped single/normal/tutorial inputs; natural income; Canvas readback timing, final game-canvas drawImage submission counting, and independent rAF observation; no game/rules/state injection',
    limits: ['CPU sampling and Canvas wrappers add diagnostic overhead, equally applied before/after.',
      'rAF measures browser callbacks; presentations measure completed drawImage calls to canvas#game, not physical display scan-out or pixel changes.',
      'Two sequential scenes are not the same army size or random seed; record starting/ending state and repeat if needed.',
      'Whole-desktop concurrent load is not controlled; no other applications are terminated.'],
    cleanup: { ownedApplicationClosed: false } };
  let app, page, cdp, launcher, ownedPid, origin;
  let initialHashes;
  const save = stage => {
    if (stage) report.progress = { stage, at: new Date().toISOString() };
    fs.writeFileSync(output, JSON.stringify(redact(report, privateValues), null, 2) + '\n');
  };
  const state = () => bounded(page.evaluate(() => window.__MIRAGINE__.getState()), 'read-only game state', 15000);
  async function target(action, matches = {}) {
    let signature = '', stable = 0;
    return until(async () => {
      const value = await bounded(page.evaluate(({ action, matches }) => ({
        hotspot: window.__MIRAGINE__.getHotspots().find(h => h.action === action
          && Object.entries(matches).every(([key, expected]) => h[key] === expected)),
        viewport: window.__MIRAGINE__.getState().viewport,
      }), { action, matches }), 'mapped hotspot');
      if (!value.hotspot) return false;
      const next = JSON.stringify(value);
      if (next !== signature) { signature = next; stable = Date.now(); return false; }
      return Date.now() - stable >= 100 ? value : false;
    }, `stable hotspot ${action}`);
  }
  function client(value) {
    const { hotspot: h, viewport: v } = value;
    return { x: v.clientLeft + v.left + (h.left + h.right) * 0.5 * v.scale,
      y: v.clientTop + v.top + (h.top + h.bottom) * 0.5 * v.scale };
  }
  async function hit(action, matches = {}) {
    const point = client(await target(action, matches));
    await bounded(page.mouse.click(point.x, point.y), `actual pointer click ${action}`);
    await delay(200);
  }
  async function measure(name) {
    save(`measuring ${name}`);
    const heapStart = await bounded(cdp.send('Runtime.getHeapUsage'), 'heap usage start');
    const before = await bounded(page.evaluate(() => {
      const profile = window.__MIRAGINE_PROFILE__;
      profile.maxMs=0;
      profile.presentationTimes = [];
      profile.intervals = []; profile.last = null; profile.active = true;
      requestAnimationFrame(profile.sample);
      return { now: performance.now(), game: window.__MIRAGINE__.getState(),
        readbacks: { calls: profile.calls, totalMs: profile.totalMs },
        byContext: JSON.parse(JSON.stringify(profile.byContext)) };
    }), 'start frame/readback observation', 15000);
    const profilingSeconds = Math.min(seconds, 5);
    let cpu;
    await bounded(cdp.send('Profiler.start'), 'CPU profile start');
    const started = performance.now();
    try { await delay(profilingSeconds * 1000); }
    finally { cpu = await bounded(cdp.send('Profiler.stop'), 'CPU profile stop', 20000); }
    const profileElapsedMs = performance.now() - started;
    if (seconds > profilingSeconds) await delay((seconds - profilingSeconds) * 1000);
    const after = await bounded(page.evaluate(() => {
      const profile = window.__MIRAGINE_PROFILE__;
      profile.active = false;
      return { now: performance.now(), game: window.__MIRAGINE__.getState(), intervals: profile.intervals,
        presentationTimes: profile.presentationTimes,
        readbacks: { calls: profile.calls, totalMs: profile.totalMs, maxMs: profile.maxMs },
        byContext: JSON.parse(JSON.stringify(profile.byContext)) };
    }), 'finish frame/readback observation', 20000);
    const heapEnd = await bounded(cdp.send('Runtime.getHeapUsage'), 'heap usage end');
    const elapsedMs = after.now - before.now;
    const frameDelta = after.game.frame - before.game.frame;
    const calls = after.readbacks.calls - before.readbacks.calls;
    const totalMs = after.readbacks.totalMs - before.readbacks.totalMs;
    const byContext = {};
    for (const [key, value] of Object.entries(after.byContext)) {
      const previous = before.byContext[key] ?? { calls: 0, totalMs: 0 };
      byContext[key] = { calls: value.calls - previous.calls, totalMs: value.totalMs - previous.totalMs };
    }
    const snapshot = game => ({ frame: game.frame, phase: game.phase, overlay: game.overlay,
      ready: game.ready, error: game.error, alive: game.alive, income: game.income,
      viewport: game.viewport, rendering: game.rendering });
    const result = { name, requestedSeconds: seconds, elapsedMs,
      rAF: summarizeIntervals(after.intervals), presentations: summarizePresentations(after.presentationTimes, elapsedMs),
      simulation: { startFrame: before.game.frame,
        endFrame: after.game.frame, frameDelta, framesPerSecond: frameDelta * 1000 / elapsedMs },
      heap: { start: heapStart, end: heapEnd, usedDeltaBytes: heapEnd.usedSize - heapStart.usedSize },
      canvasGetImageData: { calls, totalMs, averageMs: calls ? totalMs / calls : 0,
        timeFractionPercent: totalMs / elapsedMs * 100, maxObservedCallMs: after.readbacks.maxMs, byContext },
      cpu: { requestedSeconds: profilingSeconds, elapsedMs: profileElapsedMs,
        ...summarizeCpuProfile(cpu.profile, origin) },
      start: snapshot(before.game), end: snapshot(after.game) };
    report.scenarios.push(result);
    expect(after.game.ready && !after.game.error, `Game reported failure during ${name}`);
    save(`${name} measured`);
    return result;
  }
  try {
    save('checking isolated portable fixture');
    for (const file of [executable, archive, ...editable, path.join(directory, 'build-info.json')]) {
      expect(fs.statSync(file).isFile(), 'Portable fixture is missing a required file');
    }
    initialHashes = editable.map(hash);
    report.fixture = { build: JSON.parse(fs.readFileSync(path.join(directory, 'build-info.json'), 'utf8')),
      executableSha256: hash(executable), archiveSha256: hash(archive),
      customSha256: initialHashes[0], drawingHelperSha256: initialHashes[1] };
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
    app = await _electron.launch({ executablePath: executable, args: [], cwd: directory, env,
      timeout: 60000, artifactsDir: path.join(root, '.local', 'performance-automation') });
    launcher = app.process();
    const identity = await bounded(app.evaluate(() => ({ executable: process.execPath, pid: process.pid })), 'EXE identity');
    expect(fs.realpathSync(identity.executable).toLowerCase() === fs.realpathSync(executable).toLowerCase(), 'Unexpected launched executable');
    ownedPid = identity.pid;
    app.on('console', message => { if (message.type() === 'error') report.consoleErrors.push({ source: 'main', message: message.text() }); });
    page = await app.firstWindow({ timeout: 60000 });
    page.on('console', message => { if (message.type() === 'error') report.consoleErrors.push({ source: 'renderer', message: message.text() }); });
    page.on('pageerror', error => report.errors.push({ source: 'renderer', message: error.message }));
    await page.waitForURL(/^http:\/\/127\.0\.0\.1:\d+\//, { timeout: 60000 });
    origin = new URL(page.url()).origin;
    cdp = await app.context().newCDPSession(page);
    await bounded(cdp.send('Page.enable'), 'enable renderer page inspection');
    await bounded(cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: instrumentation }), 'install Canvas observation');
    await bounded(cdp.send('Profiler.enable'), 'enable CPU profiling');
    await bounded(cdp.send('Profiler.setSamplingInterval', { interval: 1000 }), 'set CPU sampling interval');
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForFunction(() => window.__MIRAGINE__?.getState().ready, null, { timeout: 60000 });
    // Some Electron navigations replace the inspected RenderFrame after the
    // new-document registration. Install again in the actual ready main world;
    // the guard makes this idempotent and does not touch game-owned properties.
    const observer = await bounded(cdp.send('Runtime.evaluate', { expression: instrumentation,
      returnByValue: true }), 'install observer in the ready renderer');
    expect(!observer.exceptionDetails, 'Canvas/rAF observer installation failed');
    expect(await page.evaluate(() => Boolean(window.__MIRAGINE_PROFILE__)), 'Profiling observer is not in the main renderer world');
    await bounded(app.evaluate(({ BrowserWindow }) => { const win = BrowserWindow.getAllWindows()[0]; win.maximize(); win.focus(); }), 'maximize owned window');
    report.platform = await bounded(app.evaluate(({ app, BrowserWindow, screen }) => {
      const win = BrowserWindow.getAllWindows()[0];
      return { gpuFeatureStatus: app.getGPUFeatureStatus(), nativeBounds: win.getBounds(), contentBounds: win.getContentBounds(),
        maximized: win.isMaximized(), displays: screen.getAllDisplays().map(display => ({
          bounds: display.bounds, workArea: display.workArea, scaleFactor: display.scaleFactor, size: display.size,
        })) };
    }), 'GPU/window read-only information');
    await until(async () => {
      const current = await state(); return current.viewport && current.viewport.viewportWidth > 0;
    }, 'maximized game viewport');
    await hit('single');
    await until(async () => (await state()).panel === 'difficulty', 'difficulty menu');
    await hit('difficulty', { value: 1 });
    await until(async () => (await state()).phase === 'game', 'normal game');
    if ((await state()).overlay === 'tutorial') await hit('tutorial-okay');
    expect(!(await state()).overlay && !(await state()).stopTimer, 'Tutorial did not enable natural simulation');
    save('waiting for first natural income/recruitment');
    await until(async () => {
      const current = await state(); return current.income?.left > 500 && current.alive?.left > 1;
    }, 'first natural income', 90000);
    const viewport = (await state()).viewport;
    await page.mouse.move(viewport.clientLeft + viewport.left + 320 * viewport.scale,
      viewport.clientTop + viewport.top + 220 * viewport.scale);
    await delay(500);
    await measure('game-no-tooltip');
    const hover = client(await target('unit', { side: 'left', id: 0 }));
    await bounded(page.mouse.move(hover.x, hover.y), 'hover actual unit 0 hotspot');
    await delay(500);
    await measure('unit0-tooltip');
    report.status = 'completed';
  } catch (error) {
    report.status = 'failed';
    report.failure = { name: error.name, message: error.message };
  } finally {
    if (app) {
      save('closing owned profiling application');
      const closing = app.close();
      try { await bounded(closing, 'owned profiling app close', 8000); report.cleanup.ownedApplicationClosed = true; }
      catch (error) {
        report.cleanup.closeError = error.message;
        try { report.cleanup.termination = await terminateOwned(launcher, ownedPid); }
        catch (failure) { report.cleanup.terminationError = failure.message; }
        report.status = 'failed';
      }
    }
    if (initialHashes) {
      try { report.fixture.editableFilesUnchanged = editable.every((file, index) => hash(file) === initialHashes[index]); }
      catch { report.fixture.editableFilesUnchanged = false; }
      if (!report.fixture.editableFilesUnchanged) { report.status = 'failed'; report.errors.push({ message: 'Editable portable files changed' }); }
    }
    if (report.consoleErrors.length || report.errors.length) report.status = 'failed';
    report.finishedAt = new Date().toISOString();
    save('profiling finished');
  }
  const safe = redact(report, privateValues);
  console.log(JSON.stringify({ status: safe.status, output: path.relative(root, output).split(path.sep).join('/'),
    scenarios: safe.scenarios.map(value => ({ name: value.name, rAF: value.rAF, presentations: value.presentations,
      simulationFramesPerSecond: value.simulation.framesPerSecond, getImageData: value.canvasGetImageData,
      topSelf: value.cpu.topSelf.slice(0, 3) })), ...(safe.failure ? { failure: safe.failure } : {}),
    cleanup: safe.cleanup }, null, 2));
  if (safe.status !== 'completed') process.exitCode = 1;
  return safe;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parseProfileOptions(process.argv.slice(2));
    if (options.help) console.log('Usage: node tools/profile-desktop.mjs --dir <isolated-portable> --out <ignored-report.json> [--seconds 10]');
    else await profileDesktop(options);
  } catch (error) {
    let username = ''; try { username = os.userInfo().username; } catch { /* Optional OS metadata. */ }
    console.error(redact(error.message, [root, os.homedir(), username]));
    process.exitCode = 1;
  }
}
