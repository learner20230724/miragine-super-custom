/** Finite, real-input large-army comparison. Never attaches to an existing game. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { bounded, redact } from './verify-desktop.mjs';
import { visibleHotspotPoint, sameRenderViewport } from './verify-native-resolution.mjs';
import { summarizeCpuProfile } from './profile-desktop.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const expect = (value, message) => { if (!value) throw new Error(message); };
const hash = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const scenarioNames = ['paused-overview', '1x-overview', '8x-overview', '8x-empty-view'];

export function parseLargeBattleOptions(args) {
  const options = { seconds: 3, perSide: 500, unit: 0, width: 1280, height: 960, dpr: 1.5,
    renderHz: 120, out: '.local/large-battle.json', prefix: 'large-battle', cpuProfile: false };
  const numeric = new Map([['--seconds', 'seconds'], ['--per-side', 'perSide'], ['--unit', 'unit'],
    ['--width', 'width'], ['--height', 'height'], ['--dpr', 'dpr'], ['--render-hz', 'renderHz']]);
  const strings = new Map([['--dir', 'dir'], ['--source-electron', 'sourceElectron'], ['--out', 'out'], ['--prefix', 'prefix']]);
  const seen = new Set();
  for (let index = 0; index < args.length; index++) {
    const option = args[index];
    if (option === '--help') { options.help = true; continue; }
    expect(!seen.has(option), `Duplicate option: ${option}`); seen.add(option);
    if (option === '--cpu-profile') { options.cpuProfile = true; continue; }
    expect(numeric.has(option) || strings.has(option), `Unknown option: ${option}`);
    const value = args[++index]; expect(value && !value.startsWith('--'), `Missing value: ${option}`);
    options[(numeric.get(option) ?? strings.get(option))] = numeric.has(option) ? Number(value) : value;
  }
  if (options.help) return options;
  expect(Boolean(options.dir) !== Boolean(options.sourceElectron), 'Choose exactly one fresh --dir or --source-electron');
  expect(Number.isFinite(options.seconds) && options.seconds >= 1 && options.seconds <= 10, '--seconds must be 1..10');
  expect(Number.isSafeInteger(options.perSide) && options.perSide >= 1 && options.perSide <= 800, '--per-side must be 1..800 (test safety only, not a game limit)');
  expect(Number.isInteger(options.unit) && options.unit >= 0 && options.unit <= 15, '--unit must be 0..15');
  expect(Number.isInteger(options.width) && options.width >= 960 && options.width <= 2560, '--width must be 960..2560');
  expect(Number.isInteger(options.height) && options.height >= 720 && options.height <= 1600, '--height must be 720..1600');
  expect(Number.isFinite(options.dpr) && options.dpr >= 1 && options.dpr <= 2, '--dpr must be 1..2');
  expect([120, 240].includes(options.renderHz), '--render-hz must be 120 or 240');
  expect(/^[a-z0-9-]+$/i.test(options.prefix), 'Unsafe screenshot prefix');
  const relative = path.relative(root, path.resolve(root, options.out));
  expect(relative && !relative.startsWith('..') && !path.isAbsolute(relative)
    && ['.local', 'output', 'artifacts'].includes(relative.split(path.sep)[0]) && relative.endsWith('.json'), 'Use an ignored JSON output path');
  return options;
}

/** Electron reports each working set/private memory value in KB, not bytes.
 * A sum of working sets may count shared pages repeatedly: it is not physical RAM. */
export function summarizeProcessMemory(metrics = []) {
  const processes = metrics.map(entry => ({ type: entry.type ?? 'unknown',
    workingSetBytes: Number.isFinite(entry.memory?.workingSetSize) ? entry.memory.workingSetSize * 1024 : null,
    peakWorkingSetBytes: Number.isFinite(entry.memory?.peakWorkingSetSize) ? entry.memory.peakWorkingSetSize * 1024 : null,
    privateBytes: Number.isFinite(entry.memory?.privateBytes) ? entry.memory.privateBytes * 1024 : null,
    cpuPercent: Number.isFinite(entry.cpu?.percentCPUUsage) ? entry.cpu.percentCPUUsage : null }));
  const sum = key => processes.length && processes.every(entry => entry[key] !== null)
    ? processes.reduce((value, entry) => value + entry[key], 0) : null;
  return { processes, summedWorkingSetBytes: sum('workingSetBytes'), summedPrivateBytes: sum('privateBytes') };
}

/** Snapshot sampling is deliberately not a high-frequency instrumented draw wrapper. */
export function summarizeLargeBattleSamples(samples, requestedSpeed) {
  expect(Array.isArray(samples) && samples.length >= 2, 'At least two samples required');
  const first = samples[0], last = samples.at(-1), elapsedMs = last.atMs - first.atMs;
  expect(Number.isFinite(elapsedMs) && elapsedMs > 0, 'Invalid sample duration');
  const simulationFrames = last.frame - first.frame, presentations = last.presentations - first.presentations;
  expect(Number.isInteger(simulationFrames) && simulationFrames >= 0 && Number.isInteger(presentations) && presentations >= 0, 'Invalid frame counters');
  const renderCpuMs = last.renderCpuTotalMs - first.renderCpuTotalMs;
  expect(Number.isFinite(renderCpuMs) && renderCpuMs >= 0, 'Invalid render CPU counters');
  const range = key => {
    const values = samples.map(sample => sample[key]).filter(Number.isFinite);
    return values.length ? { min: Math.min(...values), max: Math.max(...values), average: values.reduce((a, b) => a + b, 0) / values.length, samples: values.length } : null;
  };
  return { elapsedMs, requestedSpeed, targetSimulationHz: 30 * requestedSpeed,
    simulationFrames, simulationHz: simulationFrames * 1000 / elapsedMs, actualSpeed: simulationFrames * 1000 / elapsedMs / 30,
    presentations, presentationFps: presentations * 1000 / elapsedMs,
    renderCpuMs, averageRenderCpuMs: presentations ? renderCpuMs / presentations : null,
    sampledSpritesDrawn: range('spritesDrawn'), sampledCulledSprites: range('culledSprites'), sampledJsHeapBytes: range('jsHeapUsedBytes'),
    initialAlive: first.alive, finalAlive: last.alive };
}

async function until(probe, description, timeout = 60000) {
  const end = Date.now() + timeout;
  do { const value = await bounded(Promise.resolve().then(probe), description, 30000); if (value) return value; await delay(100); } while (Date.now() < end);
  throw new Error(`Timed out: ${description}`);
}

export async function verifyLargeBattle(options) {
  const directory = fs.realpathSync(path.resolve(root, options.dir ?? options.sourceElectron));
  expect(directory.toLowerCase() !== fs.realpathSync(root).toLowerCase(), 'Never run the live source workspace as a fixture');
  expect(!fs.existsSync(path.join(directory, 'userdata')), 'Use a fresh isolated copy, without userdata');
  const output = path.resolve(root, options.out), screenshotPaths = [...scenarioNames, 'failure'].map(name => `output/playwright/${options.prefix}-${name}.png`);
  expect(!fs.existsSync(output) && screenshotPaths.every(file => !fs.existsSync(path.join(root, file))), 'Refusing to overwrite an earlier report or screenshot');
  fs.mkdirSync(path.dirname(output), { recursive: true }); fs.mkdirSync(path.join(root, 'output/playwright'), { recursive: true });
  const source = Boolean(options.sourceElectron), executable = source ? createRequire(import.meta.url)('electron') : path.join(directory, 'MiragineSuper.exe');
  const fixture = source ? { kind: 'isolated-source-electron', inventory: JSON.parse(fs.readFileSync(path.join(directory, 'qa-source-inventory.json'), 'utf8')) }
    : { kind: 'portable', build: JSON.parse(fs.readFileSync(path.join(directory, 'build-info.json'), 'utf8')), asarSha256: hash(path.join(directory, 'resources/app.asar')) };
  fixture.executableSha256 = hash(executable);
  const editable = (source ? ['config/custom.json'] : ['config/custom.json', 'ui-helper/original-graphics.js'])
    .map(name => ({ name, sha256: hash(path.join(directory, name)) }));
  let username = ''; try { username = os.userInfo().username; } catch { /* optional redaction */ }
  const privateValues = [directory, root, os.homedir(), username];
  const report = { schemaVersion: 1, suite: 'large-battle', status: 'running', startedAt: new Date().toISOString(), fixture,
    parameters: { perSide: options.perSide, unit: options.unit, seconds: options.seconds, renderHz: options.renderHz,
      viewport: { width: options.width, height: options.height, dpr: options.dpr }, cpuProfile: options.cpuProfile },
    protocol: 'Fresh owned Electron only; first real input clicks music off, with mute-audio safety. New normal match for each scenario, manual pause, disable both recruitments, clear soldiers, finite equal-army generation through settings. No simulation/RNG/clock/storage injection. Fixed native-resolution viewport, read-only game/CDP/process metrics.',
    limits: ['No RNG seed or external desktop load control. Army counts can change naturally while running; start/end counts are reported.',
      'Requested speed and display cap are targets, not achieved performance guarantees.',
      'Render CPU excludes GPU completion; presentation counters do not prove physical screen refresh.',
      'Draw/cull values are last-frame observations sampled every ~300 ms, not aggregate draw counts. Baselines without cull counters report null.',
      'Electron working sets may double-count shared pages. JS heap is not total GPU/native memory. No forced GC or expensive heap snapshots.',
      'The empty-view scenario uses zoom and dragging at map center. Actual drawn/cull counts, not the scenario name, establish emptiness.',
      '1600 soldiers is this test runner safety maximum, not a product population cap.'],
    checks: [], scenarios: [], screenshots: [], errors: [], dialogs: [], inputs: [], cleanup: {} };
  const save = progress => { report.progress = progress; fs.writeFileSync(output, JSON.stringify(redact(report, privateValues), null, 2) + '\n'); };
  const check = (value, name, details) => { report.checks.push({ name, passed: Boolean(value), ...(details === undefined ? {} : { details }) }); save(name); expect(value, name); };
  // CDP session creation and Electron main-process evaluation have no useful
  // default action timeout. Persist the exact pending step before starting it,
  // so a hung protocol request is bounded and distinguishable from slow play.
  const stage = async (name, run, timeout = 30000) => {
    save(`starting ${name}`);
    const result = await bounded(Promise.resolve().then(run), name, timeout);
    save(`completed ${name}`); return result;
  };
  let app, page, cdp;
  const state = () => bounded(page.evaluate(() => window.__MIRAGINE__.getState()), 'read-only game state', 30000);
  const action = name => page.locator(`[data-settings-action="${name}"]`);
  const playback = name => page.locator(`[data-playback-controls] [data-action="${name}"]`);
  const open = async () => { if (!(await state()).customization.settingsOpen) await page.keyboard.press('F2'); await until(async () => (await state()).customization.settingsOpen, 'settings open'); };
  const close = async () => { if ((await state()).customization.settingsOpen) await page.keyboard.press('F2'); await until(async () => !(await state()).customization.settingsOpen, 'settings closed'); };
  const pause = async value => { await open(); if ((await state()).customization.paused !== value) await playback('pause').click(); await until(async () => (await state()).customization.paused === value, 'manual pause state'); };
  async function hit(name, match = {}) {
    let last = '', stableSince = 0;
    save(`waiting for stable ${name} hotspot`);
    const point = await until(async () => {
      const data = await page.evaluate(({ name, match }) => ({ hotspot: window.__MIRAGINE__.getHotspots().find(item => item.action === name
        && Object.entries(match).every(([key, value]) => item[key] === value)), viewport: window.__MIRAGINE__.getState().viewport }), { name, match });
      const candidate = visibleHotspotPoint(data.hotspot, data.viewport);
      if (!candidate) { last = ''; stableSince = 0; return false; }
      // Title buttons slide horizontally. A merely visible target can move
      // between down/up and fail the game's same-hotspot click guard.
      const signature = JSON.stringify(candidate);
      if (signature !== last) { last = signature; stableSince = Date.now(); return false; }
      return Date.now() - stableSince >= 100 ? candidate : false;
    }, `mapped ${name} hotspot`);
    report.inputs.push({ action: name, match, point }); save(`clicking stable ${name} hotspot`);
    await page.mouse.click(point.x, point.y); await delay(150);
    const s = await state(); report.inputs.at(-1).after = { phase: s.phase, panel: s.panel, overlay: s.overlay, muted: s.muted };
    save(`clicked ${name} hotspot`);
  }
  async function setupArmy(index) {
    await pause(true);
    if (index) {
      const previousBattle = (await state()).customization.editor.battle.battleId;
      await action('tab-starting').click(); await page.locator('[data-start-difficulty="1"]').click(); await action('start-battle').click();
      await until(async () => (await state()).customization.editor.battle?.battleId !== previousBattle, 'new independent battle');
      await pause(true);
    }
    await action('tab-sandbox').click();
    await page.locator('[data-live-recruitment="left"]').uncheck(); await page.locator('[data-live-recruitment="right"]').uncheck();
    await action('clear-all').click(); await until(async () => { const s = await state(); return s.alive.left === 1 && s.alive.right === 1; }, 'only two crystals remain');
    await page.locator('[data-sandbox-unit]').selectOption(String(options.unit)); await page.locator('[data-sandbox-count]').fill(String(options.perSide));
    for (const side of ['left', 'right']) { await action(`spawn-${side}`).click(); await until(async () => (await state()).alive[side] === options.perSide + 1, `${options.perSide} ${side} soldiers`, 90000); }
    await playback('render-rate').selectOption(String(options.renderHz)); await playback('overview').click();
    const s = await state();
    check(s.config.frameRate === 30 && s.alive.left === options.perSide + 1 && s.alive.right === options.perSide + 1,
      `${scenarioNames[index]}: equal finite armies, original 30 Hz logic`, { alive: s.alive });
    check(s.customization.editor.battle.left.recruitment === false && s.customization.editor.battle.right.recruitment === false,
      `${scenarioNames[index]}: both automatic recruitments disabled`);
  }
  async function screenshot(name) {
    const file = `output/playwright/${options.prefix}-${name}.png`;
    expect(!fs.existsSync(path.join(root, file)), 'Refusing screenshot overwrite');
    const capture = await bounded(cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false }), 'capture viewport', 30000);
    fs.writeFileSync(path.join(root, file), Buffer.from(capture.data, 'base64'), { flag: 'wx' }); report.screenshots.push(file); save(`captured ${name}`);
  }
  async function readSample() {
    const sample = await bounded(page.evaluate(() => {
      const s = window.__MIRAGINE__.getState(), r = s.rendering, p = s.presentationStats;
      return { atMs: performance.now(), frame: s.frame, phase: s.phase, winner: s.winner, error: s.error,
        alive: s.alive, muted: s.muted, hidden: document.hidden, focused: document.hasFocus(),
        paused: s.customization.paused, speed: s.customization.speed, camera: s.customization.displayCamera,
        viewport: s.viewport, presentations: p.framesPresented, renderCpuTotalMs: p.renderCpuTotalMs,
        renderCpuLastMs: p.renderCpuLastMs, spritesDrawn: r?.spritesDrawn ?? null, culledSprites: r?.culledSprites ?? null,
        spriteSurfaces: r?.spriteSurfaces ?? null, sourcePlacements: r?.sourcePlacements ?? null,
        jsHeapUsedBytes: performance.memory?.usedJSHeapSize ?? null };
    }), 'game counter sample', 30000);
    const metrics = await bounded(cdp.send('Performance.getMetrics'), 'CDP heap sample', 30000);
    sample.jsHeapUsedBytes = metrics.metrics.find(item => item.name === 'JSHeapUsedSize')?.value ?? sample.jsHeapUsedBytes;
    sample.processMemory = summarizeProcessMemory(await bounded(app.evaluate(({ app }) => app.getAppMetrics()), 'owned process memory', 30000));
    return sample;
  }
  try {
    save('launching fresh owned fixture'); const playwright = await import('playwright');
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
    app = await playwright._electron.launch({ executablePath: executable, args: source ? [directory, '--mute-audio'] : ['--mute-audio'], cwd: directory, env, timeout: 60000 });
    const identity = await stage('owned Electron identity', () => app.evaluate(() => process.execPath));
    check(fs.realpathSync(identity).toLowerCase() === fs.realpathSync(executable).toLowerCase(), 'owned Electron identity verified');
    page = await app.firstWindow(); page.setDefaultTimeout(30000);
    page.on('pageerror', error => report.errors.push({ type: 'pageerror', message: error.message }));
    page.on('console', message => { if (message.type() === 'error') report.errors.push({ type: 'console', message: message.text() }); });
    page.on('dialog', async dialog => { report.dialogs.push({ type: dialog.type(), message: dialog.message() }); await dialog.accept(); });
    await page.waitForURL(/^http:\/\/127\.0\.0\.1:\d+\//, { timeout: 60000 });
    await page.waitForFunction(() => window.__MIRAGINE__?.getState().ready, null, { timeout: 60000 });
    // Safety switch alone does not satisfy the user: use the actual game button.
    if (!(await state()).muted) await hit('music');
    await until(async () => (await state()).muted, 'actual game music disabled');
    check((await state()).muted, 'music off before every other game interaction');
    cdp = await stage('CDP new session', () => app.context().newCDPSession(page));
    await stage('CDP Page.enable', () => cdp.send('Page.enable'));
    await stage('CDP Performance.enable', () => cdp.send('Performance.enable'));
    await stage('CDP native viewport emulation', () => cdp.send('Emulation.setDeviceMetricsOverride', {
      width: options.width, height: options.height, deviceScaleFactor: options.dpr, mobile: false }));
    report.platform = await stage('owned Electron platform and focus', () => app.evaluate(({ app, BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0]; win.show(); win.focus();
      return { versions: process.versions, gpuFeatureStatus: app.getGPUFeatureStatus(), contentBounds: win.getContentBounds() };
    }));
    if (options.cpuProfile) {
      await stage('CDP Profiler.enable', () => cdp.send('Profiler.enable'));
      await stage('CDP Profiler.setSamplingInterval', () => cdp.send('Profiler.setSamplingInterval', { interval: 1000 }));
    }
    await delay(300); await hit('single');
    await until(async () => (await state()).panel === 'difficulty', 'difficulty panel selected');
    await hit('difficulty', { value: 1 });
    await until(async () => (await state()).phase === 'game', 'difficulty click starts match');
    if ((await state()).overlay === 'tutorial') await hit('tutorial-never');
    await until(async () => (await state()).phase === 'game' && !(await state()).overlay, 'normal match starts');
    for (let index = 0; index < scenarioNames.length; index++) {
      const name = scenarioNames[index], requestedSpeed = index === 0 ? 0 : index === 1 ? 1 : 8;
      await setupArmy(index); await playback('speed-number').fill(String(requestedSpeed || 1)); await playback('speed-number').press('Tab'); await pause(true); await close();
      if (index === 3) {
        // The bases/armies spawn at the two ends; the center starts empty.
        const v = (await state()).viewport, x = v.clientLeft + v.left + 320 * v.scale, y = v.clientTop + v.top + 200 * v.scale;
        await page.mouse.move(x, y); await page.mouse.wheel(0, -2200); await delay(150);
        // Genuine drag, not a private camera mutation; move slightly upfield.
        await page.mouse.down({ button: 'right' }); await page.mouse.move(x, y + 50 * v.scale, { steps: 5 }); await page.mouse.up({ button: 'right' });
        check((await state()).customization.displayCamera.mode === 'manual', 'empty-view uses real zoom and drag');
      }
      await delay(300);
      if (requestedSpeed) { await pause(false); await close(); }
      save(`measuring ${name}`); if (options.cpuProfile) await stage(`${name} CDP Profiler.start`, () => cdp.send('Profiler.start'));
      const samples = [await readSample()];
      do { await delay(300); samples.push(await readSample()); } while (samples.at(-1).atMs - samples[0].atMs < options.seconds * 1000);
      const cpu = options.cpuProfile ? summarizeCpuProfile((await stage(`${name} CDP Profiler.stop`, () => cdp.send('Profiler.stop'))).profile, page.url()) : null;
      const summary = summarizeLargeBattleSamples(samples, requestedSpeed);
      report.scenarios.push({ name, ...summary, samples, ...(cpu ? { cpu } : {}) });
      check(samples.every(s => s.phase === 'game' && !s.error && !s.winner && s.muted), `${name}: healthy match, music stays off`);
      check(samples.every(s => sameRenderViewport(samples[0].viewport, s.viewport)) && Math.abs(samples[0].viewport.devicePixelRatio - options.dpr) < 1e-8,
        `${name}: controlled viewport and DPR remain fixed`);
      check(summary.presentations > 0, `${name}: real render submissions observed`);
      check(requestedSpeed ? summary.simulationFrames > 0 : summary.simulationFrames === 0, `${name}: simulation advances only when resumed`);
      await pause(true); await close(); await screenshot(name);
    }
    check(report.errors.length === 0, 'no renderer errors'); report.status = 'completed';
  } catch (error) {
    report.status = 'failed'; report.failure = { name: error.name, message: error.message, stage: report.progress }; save('failure recorded');
    if (page && !page.isClosed() && cdp) { try { report.failureState = await state(); await screenshot('failure'); } catch { /* keep primary failure */ } }
  } finally {
    if (app) { try { await bounded(app.close(), 'close owned application only', 15000); report.cleanup.ownedApplicationClosed = true; }
      catch (error) { report.cleanup.error = error.message; report.status = 'failed'; } }
    report.fixture.editableFilesUnchanged = editable.every(file => hash(path.join(directory, file.name)) === file.sha256);
    if (!report.fixture.editableFilesUnchanged) report.status = 'failed';
    report.finishedAt = new Date().toISOString(); save('finished');
  }
  console.log(JSON.stringify({ status: report.status, checks: report.checks.length, output: options.out,
    scenarios: report.scenarios.map(s => ({ name: s.name, simulationHz: s.simulationHz, presentationFps: s.presentationFps,
      renderCpuMs: s.averageRenderCpuMs, drawn: s.sampledSpritesDrawn, culled: s.sampledCulledSprites })), failure: report.failure }, null, 2));
  if (report.status !== 'completed') process.exitCode = 1;
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { const options = parseLargeBattleOptions(process.argv.slice(2));
    if (options.help) console.log('Usage: node tools/verify-large-battle.mjs (--dir <fresh-portable> | --source-electron <fresh-source-copy>) [--per-side 500] [--unit 0] [--seconds 3] [--width 1280 --height 960 --dpr 1.5] [--render-hz 120] [--cpu-profile] [--out .local/proof.json] [--prefix proof]');
    else await verifyLargeBattle(options);
  } catch (error) { console.error(redact(error.message, [root, os.homedir()])); process.exitCode = 1; }
}
