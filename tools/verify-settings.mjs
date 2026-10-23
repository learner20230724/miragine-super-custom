/**
 * Real-input acceptance of the opt-in settings dock. Not @playwright/test.
 * node tools/verify-settings.mjs --url http://127.0.0.1:51286/
 * node tools/verify-settings.mjs --dir <fresh isolated unpacked portable>
 *
 * Uses mouse/keyboard/form/file-input interactions, read-only __MIRAGINE__,
 * and read-only DOM inspection. Never calls game/private preload APIs, changes
 * localStorage, rewrites configuration, or injects simulation/pause state.
 * Portable mode includes a second actual EXE launch to verify durable presets.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { parseCustomOptions, correctFit, rectanglesOverlap } from './verify-custom.mjs';
import { bounded, redact } from './verify-desktop.mjs';
import { projectViewPoint, projectViewSymbol } from '../src/render/view-camera.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const hash = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const expect = (condition, message) => { if (!condition) throw new Error(message); };

export function parseSettingsOptions(args) {
  const options = parseCustomOptions(args);
  if (!args.includes('--out')) options.out = '.local/settings-verification.json';
  if (!args.includes('--screenshot-prefix')) options.screenshotPrefix = 'settings';
  if (!args.includes('--sample-seconds')) options.sampleSeconds = 1;
  return options;
}

/** Measured throughput is evidence, not a requirement to hit the requested 20x. */
export function summarizeSettingsTiming(samples, requestedSpeed, logicalHz = 30) {
  const valid = samples.filter(s => s && typeof s.atMs === 'number' && Number.isFinite(s.atMs)
    && s.atMs >= 0 && typeof s.frame === 'number' && Number.isInteger(s.frame) && s.frame >= 0);
  const first = valid[0], last = valid.at(-1);
  const elapsedMs = valid.length >= 2 ? last.atMs - first.atMs : null;
  const frameDelta = valid.length >= 2 ? last.frame - first.frame : null;
  const measurable = elapsedMs > 0 && frameDelta >= 0 && Number.isFinite(requestedSpeed)
    && requestedSpeed >= 0 && requestedSpeed <= 20 && Number.isFinite(logicalHz) && logicalHz > 0;
  const simulationHz = measurable ? frameDelta * 1000 / elapsedMs : null;
  return { sampleCount: valid.length, elapsedMs, frameDelta, requestedSpeed, logicalHz,
    simulationHz, actualSpeed: measurable ? simulationHz / logicalHz : null,
    requestedSimulationHz: measurable ? requestedSpeed * logicalHz : null,
    frozen: measurable && requestedSpeed === 0 && frameDelta === 0,
    advancing: measurable && requestedSpeed > 0 && frameDelta > 0 };
}

export function reportPath(relative) {
  const output = path.resolve(root, relative), inside = path.relative(root, output);
  expect(inside && !inside.startsWith('..') && !path.isAbsolute(inside)
    && ['.local', '.tmp', 'output', 'artifacts'].includes(inside.split(path.sep)[0]) && /\.json$/i.test(output),
  '--out must be a JSON file under an ignored output directory');
  return output;
}

/** Reconstruct presentation offsets from read-only projected map corners. */
export function compactCrystalBounds(camera, rules, sprites) {
  const view = { ...camera, width: 640, height: 400, nearPlane: 24, offsetX: 0, offsetY: 0 };
  const reference = projectViewPoint(0, 0, view);
  view.offsetX = camera.mapCorners[0].x - reference.x;
  view.offsetY = camera.mapCorners[0].y - reference.y;
  return ['left', 'right'].map(side => {
    const bitmap = sprites[side === 'left' ? 'A_crystal' : 'B_crystal'].rasterized;
    const p = projectViewSymbol({ px: side === 'left' ? rules.baseSpawnInset : rules.mapWidth - rules.baseSpawnInset,
      py: rules.mapHeight / 2, pz: 0 }, view);
    return { side, centerX: p.x, centerY: p.y, left: p.x + bitmap.offX * p.scale,
      right: p.x + (bitmap.offX + bitmap.width) * p.scale,
      top: p.y + bitmap.offY * p.scale, bottom: p.y + (bitmap.offY + bitmap.height) * p.scale,
      drawable: p.drawable };
  });
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

function coreHashes() {
  return Object.fromEntries(fs.readdirSync(path.join(root, 'src/core')).filter(name => name.endsWith('.mjs')).sort()
    .map(name => [name, hash(path.join(root, 'src/core', name))]));
}

export async function verifySettings(options) {
  const { url, dir, sampleSeconds = 1, headless = false, browserChannel,
    screenshotPrefix = 'settings', out = '.local/settings-verification.json' } = options;
  expect(Boolean(url) !== Boolean(dir), 'Choose exactly one of --url or --dir');
  // Share the original harness URL, duration, and output-name validation.
  parseSettingsOptions([...(url ? ['--url', url] : ['--dir', dir]), '--sample-seconds', String(sampleSeconds),
    '--screenshot-prefix', screenshotPrefix, ...(browserChannel ? ['--browser-channel', browserChannel] : [])]);
  const destination = reportPath(out), directory = dir ? path.resolve(dir) : null;
  let username = ''; try { username = os.userInfo().username; } catch { /* Optional redaction. */ }
  const privateValues = [root, directory, os.homedir(), username];
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.mkdirSync(path.join(root, 'output/playwright'), { recursive: true });
  const report = { schemaVersion: 1, status: 'running', mode: dir ? 'portable' : 'browser',
    startedAt: new Date().toISOString(), checks: [], timing: [], cameras: [], screenshots: [], runs: [], errors: [],
    policy: 'Actual mouse, keyboard, forms and file input only. Read-only game/DOM inspection. No simulation, clock, RNG, storage or preload API injection.',
    limits: ['Requested multipliers are targets; actual throughput is measured without requiring 20x hardware performance.',
      'Render ceiling and submitted frames do not prove physical 240 Hz display scan-out.',
      'Logic parity and source-level configuration validation are separate test gates.',
      'This tool changes settings/presets by UI in its fresh isolated fixture only. It never edits published configuration files.'],
    cleanup: { ownedApplicationClosed: false } };
  let app, browser, server, context, page, launcher, verifiedPid, currentRun, editable, beforeCore;
  let exported, presetId;
  const save = stage => {
    report.progress = { stage, at: new Date().toISOString() };
    fs.writeFileSync(destination, JSON.stringify(redact(report, privateValues), null, 2) + '\n');
  };
  const check = (condition, name, details) => {
    report.checks.push({ name, passed: Boolean(condition), ...(details === undefined ? {} : { details }) });
    save(name); expect(condition, `Settings verification failed: ${name}`);
  };
  const state = () => bounded(page.evaluate(() => window.__MIRAGINE__.getState()), 'read-only state');
  const point = (fit, x, y) => ({ x: fit.clientLeft + fit.left + x * fit.scale, y: fit.clientTop + fit.top + y * fit.scale });
  const element = selector => page.locator(selector);
  const act = name => element(`[data-settings-action="${name}"]`);
  const playback = name => element(`[data-playback-controls] [data-action="${name}"]`);
  const field = name => element(`[data-field-path="${name}"]`);
  async function hit(action, matches = {}) {
    let previous = '', stableSince = 0;
    const target = await until(async () => {
      const candidate = await page.evaluate(({ action, matches }) => ({
        hotspot: window.__MIRAGINE__.getHotspots().find(h => h.action === action
          && Object.entries(matches).every(([key, value]) => h[key] === value)),
        fit: window.__MIRAGINE__.getState().viewport,
      }), { action, matches });
      if (!candidate.hotspot) return false;
      const signature = JSON.stringify(candidate);
      if (signature !== previous) { previous = signature; stableSince = Date.now(); return false; }
      return Date.now() - stableSince >= 100 ? candidate : false;
    }, `mapped hotspot ${action}`);
    const h = target.hotspot, p = point(target.fit, (h.left + h.right) / 2, (h.top + h.bottom) / 2);
    await page.mouse.click(p.x, p.y); await delay(100);
  }
  async function open() {
    if (!(await state()).customization.settingsOpen) await element('[data-custom-controls] [data-action="settings"]').click();
    await until(async () => (await state()).customization.settingsOpen, 'settings open');
  }
  async function close() {
    if ((await state()).customization.settingsOpen) await act('close').click();
    await until(async () => !(await state()).customization.settingsOpen, 'settings closed');
  }
  async function speed(value) {
    const control = playback('speed-number'); await control.fill(String(value)); await control.press('Tab');
    await until(async () => (await state()).customization.speed === value, `${value}x speed via number input`);
  }
  async function edit(name, value) {
    const control = field(name); await control.fill(String(value)); await control.press('Tab'); await delay(50);
    expect(await control.inputValue() === String(value), `Edited field did not retain value: ${name}`);
  }
  async function screenshot(name) {
    const relative = `output/playwright/${screenshotPrefix}-${name}.png`;
    await bounded(page.screenshot({ path: path.join(root, relative), scale: 'css', timeout: 5000 }), 'screenshot', 6000);
    report.screenshots.push(relative); save(`captured ${name}`);
  }
  async function sample(requestedSpeed, milliseconds = sampleSeconds * 1000) {
    const samples = [], start = performance.now();
    do {
      const value = await bounded(page.evaluate(() => {
        const game = window.__MIRAGINE__.getState();
        return { atMs: performance.now(), frame: game.frame, phase: game.phase, winner: game.winner };
      }), 'natural timing sample');
      expect(value.phase === 'game' && !value.winner, 'Match ended during timing measurement');
      samples.push({ atMs: value.atMs, frame: value.frame });
      if (performance.now() - start >= milliseconds) break;
      await delay(90);
    } while (true);
    const result = { ...summarizeSettingsTiming(samples, requestedSpeed), samples,
      display: (await state()).customization.measured };
    report.timing.push(result); save(`measured ${requestedSpeed}x`); return result;
  }
  async function frozen(name) {
    const measurement = await sample(0, 350);
    check(measurement.frozen, name, measurement);
  }
  async function layout(name, settingsVisible = true) {
    const geometry = await page.evaluate(() => {
      const rect = selector => {
        const r = document.querySelector(selector)?.getBoundingClientRect();
        return r && { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height };
      };
      return { canvas: rect('#game'), panel: rect('[data-settings-panel]'),
        scrollWidth: document.documentElement.scrollWidth, width: innerWidth, height: innerHeight };
    });
    check(correctFit((await state()).viewport), `${name}: aspect-preserving canvas fit`);
    if (settingsVisible) check(geometry.panel?.width > 0 && geometry.panel.height > 0
      && !rectanglesOverlap(geometry.canvas, geometry.panel), `${name}: dock does not cover canvas`, geometry);
    check(geometry.scrollWidth <= geometry.width + 1, `${name}: no horizontal document overflow`, geometry);
  }
  async function compactGeometry(name) {
    const geometry = await page.evaluate(() => {
      const r = document.querySelector('[data-custom-controls]').getBoundingClientRect();
      return { rect: { left: r.left, right: r.right, top: r.top, bottom: r.bottom },
        hotspots: window.__MIRAGINE__.getHotspots(), fit: window.__MIRAGINE__.getState().viewport };
    });
    const collisions = geometry.hotspots.filter(h => h.action !== 'blocked').filter(h => {
      const a = point(geometry.fit, h.left, h.top), b = point(geometry.fit, h.right, h.bottom);
      return rectanglesOverlap(geometry.rect, { left: a.x, right: b.x, top: a.y, bottom: b.y });
    }).map(h => ({ action: h.action, side: h.side, id: h.id }));
    check(collisions.length === 0, `${name}: compact settings/pause buttons do not cover original controls`, { rect: geometry.rect, collisions });
  }
  async function fullscreen() {
    if (app) {
      await bounded(app.evaluate(({ BrowserWindow }) => {
        const win = BrowserWindow.getAllWindows()[0]; win.focus(); win.webContents.focus();
        win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'F11' });
        win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'F11' });
      }), 'actual native F11 input');
    } else await page.keyboard.press('F11');
  }
  function attach(candidate) {
    candidate.on('pageerror', error => report.errors.push({ type: 'pageerror', message: error.message }));
    candidate.on('console', message => { if (message.type() === 'error') report.errors.push({ type: 'console', message: message.text() }); });
    candidate.on('dialog', async dialog => {
      (report.dialogs ??= []).push({ type: dialog.type(), message: dialog.message() });
      if (dialog.type() === 'confirm') await dialog.accept();
      else { report.errors.push({ type: 'unexpected-dialog', message: dialog.message() }); await dialog.dismiss(); }
    });
  }
  async function launchPortable(round) {
    const executable = path.join(directory, 'MiragineSuper.exe');
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
    const { _electron } = await import('playwright');
    app = await _electron.launch({ executablePath: executable, args: [], cwd: directory, env, timeout: 60000,
      artifactsDir: path.join(root, '.local/settings-automation') });
    launcher = app.process();
    const identity = await bounded(app.evaluate(() => ({ executable: process.execPath, pid: process.pid })), 'portable identity');
    check(fs.realpathSync(identity.executable).toLowerCase() === fs.realpathSync(executable).toLowerCase(), `round ${round}: actual packaged EXE launched`);
    verifiedPid = identity.pid; context = app.context(); page = await app.firstWindow({ timeout: 60000 }); attach(page);
    await page.waitForURL(/^http:\/\/127\.0\.0\.1:\d+\//, { timeout: 60000 });
    await bounded(app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].maximize(); }), 'maximize owned application');
    currentRun = { round, pid: verifiedPid, origin: new URL(page.url()).origin, closed: false }; report.runs.push(currentRun);
  }
  async function closeOwned() {
    if (app) {
      await bounded(app.close(), 'owned Electron close', 8000);
      if (currentRun) currentRun.closed = true;
      app = null; page = null; context = null; launcher = null; verifiedPid = null;
    } else {
      if (context) await bounded(context.close(), 'owned context close', 5000);
      if (browser) await bounded(browser.close(), 'owned browser close', 5000);
      if (server) await bounded(server.close(), 'owned server close', 8000);
      context = browser = server = page = launcher = null;
    }
  }
  async function ready() {
    page.setDefaultTimeout(10000);
    await page.waitForFunction(() => window.__MIRAGINE__?.getState().ready, null, { timeout: 60000 });
  }

  try {
    save('preparing isolated settings verification'); beforeCore = coreHashes(); report.coreSha256Before = beforeCore;
    if (directory) {
      expect(!fs.existsSync(path.join(directory, 'userdata/custom-settings.json')), 'Use a fresh isolated portable fixture, not an existing player profile');
      report.portable = { executableSha256: hash(path.join(directory, 'MiragineSuper.exe')),
        appAsarSha256: hash(path.join(directory, 'resources/app.asar')) };
      editable = ['config/custom.json', 'ui-helper/original-graphics.js'].map(name => ({ name, file: path.join(directory, name) }));
      for (const item of editable) item.before = hash(item.file);
      await launchPortable(1);
    } else {
      const { chromium } = await import('playwright');
      server = await chromium.launchServer({ headless, ...(browserChannel ? { channel: browserChannel } : {}) }); launcher = server.process();
      browser = await chromium.connect(server.wsEndpoint());
      context = await browser.newContext({ viewport: { width: 1280, height: 960 }, acceptDownloads: true });
      page = await context.newPage(); attach(page); await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    }
    await ready();
    const initial = await state();
    check(initial.phase === 'title' && initial.implementation === 'native-javascript-canvas', 'original title loads in native reconstruction');
    const defaults = JSON.parse(fs.readFileSync(path.join(root, 'config/defaults.generated.json'), 'utf8'));
    check(initial.config.frameRate === 30 && initial.config.firstUnitCost === defaults.units[0].cost && initial.config.firstUnitHp === defaults.units[0].hp,
      'fresh application starts with original 30 Hz rules and first-unit defaults', initial.config);
    check(initial.customization.rulesMode?.current === 'original', 'fresh application explicitly identifies its rule mode as original');
    check(!initial.customization.settingsOpen, 'large editor is closed by default');
    await hit('single'); await until(async () => (await state()).panel === 'difficulty', 'difficulty panel');
    await hit('difficulty', { value: 1 }); await until(async () => (await state()).phase === 'game', 'normal battle');
    if ((await state()).overlay === 'tutorial') await hit('tutorial-never');
    await compactGeometry('default battle');
    await screenshot('default-battle');
    const normal = await sample(1);
    check(normal.advancing && normal.actualSpeed > .5 && normal.actualSpeed < 1.5, 'untouched normal game advances naturally near 1x', normal);
    await open(); await frozen('opening editor pauses battle automatically'); await layout('wide dock');
    await screenshot('dock');
    const dockPoint = point((await state()).viewport, 320, 250);
    await page.mouse.click(dockPoint.x, dockPoint.y); await page.keyboard.press('Escape');
    check(!(await state()).customization.settingsOpen && !(await state()).overlay, 'Escape with canvas focus closes dock before opening original quit dialog');
    await page.keyboard.press('F2');
    check((await state()).customization.settingsOpen, 'actual F2 shortcut reopens dock');
    await act('pause').click();
    check(!(await state()).customization.paused, 'continue button releases editor pause without closing dock');
    for (const multiplier of [0.5, 1.5, 2, 4, 8, 12, 20]) {
      await speed(multiplier);
      const measurement = await sample(multiplier);
      check(measurement.advancing, `${multiplier}x input advances naturally; measured throughput is reported, not assumed`, measurement);
      check((await state()).config.frameRate === 30, `${multiplier}x leaves logical rules at 30 Hz`);
    }
    await speed(0); await frozen('zero speed freezes game while settings remain interactive');
    for (const rate of [30, 60, 120, 240]) {
      await playback('render-rate').selectOption(String(rate));
      check((await state()).customization.renderHz === rate, `display ceiling ${rate} remains independently selectable while paused`);
    }
    await close(); await frozen('closing editor does not clear explicit zero-speed pause');
    await open(); await speed(1);
    await frozen('nonzero rate does not accidentally clear separately owned editor pause');
    await act('pause').click(); check(!(await state()).customization.paused, 'continue releases remaining editor pause');
    // Exercise the actual range keyboard path, not a programmatic value/event write.
    await playback('speed-range').focus(); await playback('speed-range').press('Home');
    for (let i = 0; i < 5; i++) await playback('speed-range').press('ArrowRight');
    check((await state()).customization.speed === .5, 'native slider keyboard input supports 0.1x increments');
    await speed(1); await act('pause').click(); await frozen('editor pause can be reacquired while dock stays open');
    await close();
    await element('[data-custom-controls] [data-action="pause"]').click();
    await frozen('compact lower-left pause freezes normal gameplay');
    const pausedSelection = (await state()).selection.left;
    await hit('unit', { side: 'left', id: 3 });
    await page.keyboard.press('Space');
    check(JSON.stringify((await state()).selection.left) === JSON.stringify(pausedSelection), 'paused game ignores unit-selection and recruitment inputs');
    await open(); await close(); await frozen('closing editor preserves explicit manual pause');
    await element('[data-custom-controls] [data-action="pause"]').click();
    check(!(await state()).customization.paused, 'compact resume releases manual pause');
    const resumed = await sample(1, 450);
    check(resumed.advancing && resumed.actualSpeed < 2, 'resume advances normally without replaying pause wall time', resumed);
    await open();
    const selectionBeforeHeldKey = (await state()).selection.left;
    await playback('speed-number').focus(); await page.keyboard.down('Space');
    try {
      await close();
      const p = point((await state()).viewport, 320, 250); await page.mouse.click(p.x, p.y);
      await page.keyboard.down('Space'); await delay(120); // Real auto-repeat after focus returned to game.
    } finally { await page.keyboard.up('Space'); }
    check(JSON.stringify((await state()).selection.left) === JSON.stringify(selectionBeforeHeldKey), 'held editor Space does not leak recruitment auto-repeat after dock closes');
    await page.keyboard.down('Space'); try { await delay(100); } finally { await page.keyboard.up('Space'); }
    check((await state()).selection.left[2] !== selectionBeforeHeldKey[2], 'new game Space press still toggles recruitment after old held key is released');
    await page.keyboard.down('Space'); try { await delay(100); } finally { await page.keyboard.up('Space'); }
    await open();
    await act('tab-units').click();
    check(await element('[data-entry-select="units"] option').count() === 16, 'all 16 original units are editable');
    await element('[data-entry-select="units"]').selectOption('0');
    const configBeforeDraft = (await state()).config;
    await edit('config.units.0.cost', 7); await edit('config.units.0.hp', 99);
    check(JSON.stringify((await state()).config) === JSON.stringify(configBeforeDraft), 'draft cost/HP edits do not silently change battle rules');
    await field('config.units.0.hp').fill('-1'); await field('config.units.0.hp').press('Tab');
    check(await field('config.units.0.hp').getAttribute('aria-invalid') === 'true' && await act('apply-current').isDisabled(),
      'invalid numeric draft is marked and cannot be applied');
    await edit('config.units.0.hp', 99); await act('apply-current').click();
    await until(async () => (await state()).config.firstUnitCost === 7 && (await state()).config.firstUnitHp === 99, 'apply edited rules');
    check((await state()).config.frameRate === 30, 'live configuration application preserves 30 Hz logic');
    check((await state()).customization.rulesMode?.current === 'custom' && (await state()).config.profile === 'custom',
      'applied custom battle is explicitly identified as custom, not faithful original');
    await act('tab-sandbox').click();
    await act('clear-all').click();
    await element('[data-sandbox-side]').selectOption('left'); await element('[data-sandbox-unit]').selectOption('0');
    await act('select-unit').click();
    await element('[data-live-recruitment="left"]').check(); await element('[data-live-recruitment="right"]').uncheck();
    await element('[data-resource-side]').selectOption('left');
    for (const [key, value] of Object.entries({ money: 7, income: 100, population: 50 })) await element(`[data-resource-value="${key}"]`).fill(String(value));
    await act('set-resources').click();
    const resources = await state();
    check(resources.money.left === 7 && resources.income.left === 100 && resources.population.left === 50,
      'resource form sets current money/income/remaining population', resources.money);
    check(resources.alive.left === 1 && resources.alive.right === 1, 'clear-all removes troops but leaves both bases');
    await act('pause').click();
    await until(async () => (await state()).units.left.some(unit => unit.id === 0), 'natural paid recruitment with edited cost', 5000);
    await act('pause').click();
    const recruited = await state();
    check(recruited.money.left === 0 && recruited.units.left.some(unit => unit.id === 0 && unit.nowHP === 99),
      'natural recruitment really spends cost 7 and creates HP 99 unit, not just edited labels', { money: recruited.money, units: recruited.units });
    await element('[data-live-recruitment="left"]').uncheck();
    const beforeSpawn = await state();
    await element('[data-sandbox-unit]').selectOption('2'); await element('[data-sandbox-count]').fill('2'); await act('spawn').click();
    const spawnedLeft = await state();
    check(spawnedLeft.alive.left === beforeSpawn.alive.left + 2 && spawnedLeft.money.left === beforeSpawn.money.left
      && spawnedLeft.population.left === beforeSpawn.population.left && spawnedLeft.customization.rulesMode?.current === 'custom',
      'manual red spawning adds exact quantity without charging recruitment resources and remains explicitly custom');
    await element('[data-sandbox-side]').selectOption('right'); await element('[data-sandbox-count]').fill('3'); await act('spawn').click();
    check((await state()).alive.right === beforeSpawn.alive.right + 3, 'manual blue spawning adds exact quantity');
    const basesBeforeClear = (await state()).baseHp;
    await act('clear-side').click();
    check((await state()).alive.right === 1 && (await state()).alive.left === spawnedLeft.alive.left, 'clear selected side leaves opposite army intact');
    await act('clear-all').click();
    const cleared = await state();
    check(cleared.alive.left === 1 && cleared.alive.right === 1
      && JSON.stringify(cleared.baseHp) === JSON.stringify(basesBeforeClear), 'clear-all preserves base HP and both crystals');
    await screenshot('sandbox');
    const incomeBeforeDraftApply = (await state()).income.left;
    await act('tab-economy').click(); await edit('config.rules.startingIncome', 777); await act('apply-current').click();
    check((await state()).income.left === incomeBeforeDraftApply, 'next-match starting income does not rewrite current resources');
    await act('tab-difficulties').click();
    check(await element('[data-entry-select="difficulties"] option').count() === 4, 'all four original difficulties are editable');
    await element('[data-entry-select="difficulties"]').selectOption('1'); await edit('config.difficulties.1.rightStartingIncome', 888);
    await act('tab-bases').click();
    check(await field('config.rules.baseHp').count() === 1, 'base health and combat fields are exposed');
    await act('tab-behavior').click();
    check(await field('rules.enemyAi').count() === 1 && await field('rules.leftRecruitment').count() === 1, 'AI and both recruitment behavior fields are exposed');
    await act('tab-presets').click();
    await element('[data-preset-name]').fill('Verifier cost 7 HP 99'); await act('save-preset').click();
    await until(async () => /已保存/.test(await element('[data-settings-message]').textContent()), 'preset save acknowledgement');
    presetId = await element('[data-preset-select]').inputValue();
    check(Boolean(presetId), 'saving creates a selected named preset through UI');
    await element('[data-preset-name]').fill('Disposable verification preset'); await act('save-preset').click();
    await until(async () => (await element('[data-preset-select]').inputValue()) !== presetId, 'second independent preset');
    await act('delete-preset').click();
    check(!(await element('[data-preset-select] option').allTextContents()).includes('Disposable verification preset')
      && (await element('[data-preset-select] option').allTextContents()).includes('Verifier cost 7 HP 99'),
      'deleting a selected preset leaves the other named preset intact');
    await element('[data-preset-select]').selectOption(presetId); await element('[data-preset-name]').fill('Verifier cost 7 HP 99');
    const downloadPromise = page.waitForEvent('download', { timeout: 10000 }); await act('export').click();
    const download = await downloadPromise, exportFile = path.join(root, '.local', `${screenshotPrefix}-export.json`);
    await download.saveAs(exportFile); exported = JSON.parse(fs.readFileSync(exportFile, 'utf8'));
    check(exported.schemaVersion === 1 && exported.profile.config.units[0].cost === 7 && exported.profile.config.units[0].hp === 99,
      'actual downloaded JSON includes edited cost and HP');
    report.export = { sha256: hash(exportFile), bytes: fs.statSync(exportFile).size, schemaVersion: exported.schemaVersion };
    const currentBeforeImport = (await state()).config;
    await element('[data-preset-file]').setInputFiles({ name: 'invalid.json', mimeType: 'application/json', buffer: Buffer.from('{ invalid JSON') });
    await until(async () => await element('[data-settings-message]').getAttribute('data-error') === 'true', 'invalid file error');
    check(JSON.stringify((await state()).config) === JSON.stringify(currentBeforeImport), 'malformed import reports an error and does not mutate applied config');
    const imported = structuredClone(exported); imported.profile.config.units[0].cost = 11;
    await element('[data-preset-file]').setInputFiles({ name: 'valid-import.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(imported)) });
    await until(async () => /校验通过/.test(await element('[data-settings-message]').textContent()), 'valid file import');
    await act('tab-units').click();
    check(await field('config.units.0.cost').inputValue() === '11' && (await state()).config.firstUnitCost === 7,
      'valid file import only replaces draft, not active game');
    await act('undo').click(); check(await field('config.units.0.cost').inputValue() === '7', 'undo restores previous valid draft');
    await act('reset').click();
    check(await field('config.units.0.cost').inputValue() === String(defaults.units[0].cost) && (await state()).config.firstUnitCost === 7,
      'restore-defaults changes only draft and preserves running custom rules');
    await act('tab-presets').click(); await element('[data-preset-select]').selectOption(presetId); await act('load-preset').click();
    await act('tab-units').click(); check(await field('config.units.0.cost').inputValue() === '7', 'saved named preset restores draft after reset');
    await field('config.units.0.cost').focus(); await fullscreen();
    await until(async () => app ? app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isFullScreen())
      : page.evaluate(() => Boolean(document.fullscreenElement)), 'fullscreen with focused settings input');
    await layout('fullscreen dock'); await compactGeometry('fullscreen dock'); await screenshot('fullscreen');
    await fullscreen();
    await until(async () => app ? app.evaluate(({ BrowserWindow }) => !BrowserWindow.getAllWindows()[0].isFullScreen())
      : page.evaluate(() => !document.fullscreenElement), 'exit actual fullscreen');
    await screenshot('units');
    await act('tab-sandbox').click();
    await page.getByLabel('新战局难度', { exact: true }).selectOption('1'); await act('start-battle').click();
    await until(async () => (await state()).income.left === 777, 'custom new match uses starting income');
    const customStart = await state();
    check(customStart.income.left === 777 && customStart.income.right === 888 && customStart.config.firstUnitCost === 7
      && customStart.config.firstUnitHp === 99, 'start-by-draft applies unit and difficulty-specific starting values', customStart.config);
    await frozen('new custom match remains paused while editor owns pause');
    await playback('overview').click(); const overview = (await state()).customization.displayCamera;
    check(overview.mode === 'overview' && overview.zoom > .145, 'compact panorama uses crystal-to-crystal framing instead of all map corners', overview);
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'generated/asset-manifest.json'), 'utf8'));
    const crystals = compactCrystalBounds(overview, defaults.rules, manifest.sprites);
    check(crystals.every(p => p.drawable && p.left >= 0 && p.right <= 640 && p.top >= 0 && p.bottom <= 400)
      && crystals[0].left >= 12 && crystals[0].left <= 20 && crystals[1].right >= 620 && crystals[1].right <= 628,
      'panorama contains complete crystal bitmaps near opposite edges with small safe margins', crystals);
    report.crystalBounds = crystals;
    await close();
    await element('[data-custom-controls] [data-action="pause"]').click();
    await frozen('pause works after custom new match');
    await screenshot('compact-panorama');
    for (const zoomDelta of [0, -500]) {
      if (zoomDelta) {
        const current = await state(), p = point(current.viewport, 320, 200);
        await page.mouse.move(p.x, p.y); await page.mouse.wheel(0, zoomDelta); await delay(100);
      }
      const map = await page.evaluate(() => window.__MIRAGINE__.getHotspots().find(h => h.action === 'minimap'));
      const mapPoint = point((await state()).viewport, map.left + defaults.rules.baseSpawnInset * map.scale,
        map.top + defaults.rules.mapHeight / 2 * map.scale);
      await page.mouse.click(mapPoint.x, mapPoint.y); await delay(100);
      const start = await state();
      check(Math.abs(start.customization.displayCamera.centerX - defaults.rules.baseSpawnInset) < 20, 'actual minimap click centers on red crystal before crossing');
      await page.locator('#game').focus(); const heldAt = performance.now(); await page.keyboard.down('l');
      try { await delay(4000); } finally { await page.keyboard.up('l'); }
      const holdElapsedMs = performance.now() - heldAt;
      const end = await state(), distance = end.customization.displayCamera.centerX - start.customization.displayCamera.centerX;
      const result = { zoom: start.customization.displayCamera.zoom, distance, nominalWorldUnitsPerSecond: 975,
        holdMs: 4000, actualInputHoldElapsedMs: holdElapsedMs, startX: start.customization.displayCamera.centerX, endX: end.customization.displayCamera.centerX };
      report.cameras.push(result);
      check(distance > 3600 && distance < 4200, `four-second keyboard hold crosses from red to blue at zoom ${result.zoom.toFixed(3)}`, result);
      check(end.frame === start.frame, 'camera navigation remains usable while battle is paused');
    }
    await open(); await playback('overview').click(); await layout('post-camera dock');
    if (!app) {
      await page.setViewportSize({ width: 640, height: 720 }); await delay(200);
      await layout('narrow dock'); await compactGeometry('narrow dock'); await screenshot('narrow');
      await act('tab-units').click(); await edit('config.units.0.cost', 7);
      await page.setViewportSize({ width: 1280, height: 960 }); await delay(200);
    }
    await act('tab-presets').click(); await element('[data-preset-select]').selectOption(presetId); await act('load-preset').click();
    // Flush is reached through the explicit UI save action, never a preload call.
    await element('[data-preset-name]').fill('Verifier cost 7 HP 99'); await act('overwrite-preset').click();
    await until(async () => /已保存/.test(await element('[data-settings-message]').textContent()), 'durable preset save before restart');
    await act('tab-sandbox').click(); await act('return-original').click();
    check((await state()).phase === 'title' && (await state()).config.firstUnitCost === defaults.units[0].cost
      && (await state()).customization.rulesMode?.current === 'original',
      'return-original leaves custom match and restores faithful menu configuration without deleting draft');
    await close();
    if (directory) {
      await closeOwned(); await launchPortable(2); await ready();
      check(report.runs[0].pid !== report.runs[1].pid && report.runs[0].origin !== report.runs[1].origin,
        'preset durability is checked across distinct EXE processes and loopback origins', report.runs);
    } else { await page.reload({ waitUntil: 'domcontentloaded' }); await ready(); }
    const restarted = await state();
    check(restarted.phase === 'title' && restarted.config.firstUnitCost === defaults.units[0].cost
      && restarted.config.firstUnitHp === defaults.units[0].hp && restarted.config.startingIncome === defaults.rules.startingIncome
      && restarted.customization.rulesMode?.current === 'original',
      'relaunch retains faithful gameplay defaults; saved draft is not automatically applied', restarted.config);
    await open(); await act('tab-units').click();
    check(await field('config.units.0.cost').inputValue() === '7' && await field('config.units.0.hp').inputValue() === '99',
      `${directory ? 'new actual EXE' : 'browser reload'} restores saved custom draft without altering defaults`);
    await act('tab-presets').click();
    const persistedOptions = await element('[data-preset-select] option').allTextContents();
    check(persistedOptions.includes('Verifier cost 7 HP 99'), 'named preset is durable across restart');
    await element('[data-preset-select]').selectOption(presetId); await act('load-preset').click();
    await act('tab-units').click(); check(await field('config.units.0.cost').inputValue() === '7', 'persisted preset can be loaded through actual UI');
    await screenshot('restarted-draft');
    check(report.errors.length === 0 && (await state()).ready && !(await state()).error, 'no runtime JavaScript or console errors');
    report.status = 'passed'; report.final = await state();
  } catch (error) {
    report.status = 'failed'; report.failure = { name: error.name, message: error.message };
    if (page && !page.isClosed()) try { await screenshot('failure'); } catch { /* Bounded diagnostics only. */ }
  } finally {
    save('closing only owned verification processes');
    const owned = Boolean(app || server);
    try { await closeOwned(); report.cleanup.ownedApplicationClosed = owned; }
    catch (error) {
      report.status = 'failed'; report.cleanup.error = error.message;
      try { report.cleanup.termination = await terminateOwned(launcher, verifiedPid); }
      catch (failure) { report.cleanup.terminationError = failure.message; }
    }
    if (beforeCore) {
      report.coreSha256After = coreHashes(); report.coreUnchanged = JSON.stringify(beforeCore) === JSON.stringify(report.coreSha256After);
      if (!report.coreUnchanged) { report.status = 'failed'; report.errors.push({ type: 'integrity', message: 'Core source changed during verification' }); }
    }
    if (editable) {
      report.editableFiles = editable.map(item => ({ name: item.name, before: item.before, after: hash(item.file), unchanged: item.before === hash(item.file) }));
      if (report.editableFiles.some(item => !item.unchanged)) { report.status = 'failed'; report.errors.push({ type: 'integrity', message: 'Portable editable file changed during verification' }); }
    }
    if (report.errors.length) report.status = 'failed';
    report.finishedAt = new Date().toISOString(); save('verification finished');
  }
  const safe = redact(report, privateValues);
  console.log(JSON.stringify({ status: safe.status, checks: safe.checks.length,
    report: path.relative(root, destination).split(path.sep).join('/'), timing: safe.timing.map(({ samples, ...summary }) => summary),
    ...(safe.failure ? { failure: safe.failure } : {}), cleanup: safe.cleanup }, null, 2));
  if (safe.status !== 'passed') process.exitCode = 1;
  return safe;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parseSettingsOptions(process.argv.slice(2));
    if (options.help) console.log('Usage: node tools/verify-settings.mjs (--url <loopback> | --dir <fresh portable>) [--out .local/settings-verification.json] [--sample-seconds 1] [--screenshot-prefix settings] [--headless]');
    else await verifySettings(options);
  } catch (error) { console.error(redact(error.message, [root, os.homedir()])); process.exitCode = 1; }
}
