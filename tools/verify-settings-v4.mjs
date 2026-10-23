/**
 * Real-input acceptance for the side-specific settings revision. Not @playwright/test.
 * Uses an isolated browser context or a fresh portable directory. Only read-only
 * game/DOM diagnostics are evaluated: all changes use actual buttons, keyboard,
 * forms and file input. Never touches another running game or its profile.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { correctFit, rectanglesOverlap } from './verify-custom.mjs';
import { bounded, redact } from './verify-desktop.mjs';
import { parseSettingsOptions, summarizeSettingsTiming, reportPath, foregroundOwnedWindow,
  registerNativeExport, completedNativeExport, compactCrystalBounds } from './verify-settings.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const hash = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const expect = (condition, message) => { if (!condition) throw new Error(message); };
export const SAFE_INTEGER_TEXT = String(Number.MAX_SAFE_INTEGER);

export function parseV4Options(args) {
  const options = parseSettingsOptions(args);
  if (!args.includes('--out')) options.out = '.local/settings-v4-verification.json';
  if (!args.includes('--screenshot-prefix')) options.screenshotPrefix = 'settings-v4';
  return options;
}

/** No fuzzy equality: a large balance must remain an exact safe integer. */
export function exactSafeResource(value, expected) {
  return Number.isSafeInteger(value) && value >= 0 && value === expected;
}

/** Identify an actually stopped partial job, never confuse it with completion. */
export function cancelledSpawn(job) {
  return Boolean(job && job.status === 'cancelled' && Number.isSafeInteger(job.requested)
    && Number.isSafeInteger(job.completed) && job.completed >= 0 && job.completed < job.requested);
}

/** A v1 document deliberately has no side tables or configurable AI. */
export function legacyFixture(document) {
  const result = structuredClone(document), profile = result.profile;
  expect(profile?.schemaVersion === 2 && profile.config?.sides, 'A current exported profile is required');
  result.name = 'Legacy migration verification'; profile.schemaVersion = 1;
  delete profile.config.sides; delete profile.config.rules.leftStartingPopulation;
  for (const difficulty of Object.values(profile.config.difficulties)) delete difficulty.ai;
  profile.config.units[0].hp = 145; profile.config.units[0].cost = 19;
  return result;
}

function coreHashes() {
  return Object.fromEntries(fs.readdirSync(path.join(root, 'src/core')).filter(name => name.endsWith('.mjs')).sort()
    .map(name => [name, hash(path.join(root, 'src/core', name))]));
}

async function until(probe, description, timeout = 15000) {
  const deadline = Date.now() + timeout;
  do {
    const value = await bounded(Promise.resolve().then(probe), description);
    if (value) return value;
    await delay(60);
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
  throw new Error('No owned process handle available for cleanup');
}

export async function verifySettingsV4(options) {
  const { url, dir, sampleSeconds = 1, headless = false, browserChannel,
    screenshotPrefix = 'settings-v4', out = '.local/settings-v4-verification.json' } = options;
  expect(Boolean(url) !== Boolean(dir), 'Choose exactly one of --url or --dir');
  parseV4Options([...(url ? ['--url', url] : ['--dir', dir]), '--sample-seconds', String(sampleSeconds),
    '--screenshot-prefix', screenshotPrefix, ...(browserChannel ? ['--browser-channel', browserChannel] : [])]);
  const destination = reportPath(out), directory = dir ? path.resolve(dir) : null;
  let username = ''; try { username = os.userInfo().username; } catch { /* Optional redaction. */ }
  const privateValues = [root, directory, os.homedir(), username];
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.mkdirSync(path.join(root, 'output/playwright'), { recursive: true });
  const report = { schemaVersion: 1, suite: 'settings-v4', status: 'running', mode: dir ? 'portable' : 'browser',
    startedAt: new Date().toISOString(), checks: [], timing: [], screenshots: [], runs: [], errors: [],
    policy: 'Genuine mouse/keyboard/form/file input only; read-only game and DOM diagnostics. No injected simulation, RNG, clock, storage or private preload API calls.',
    limits: ['Target speed is not a guarantee of achieved simulation rate or physical screen refresh.',
      'Unbounded spawn is tested by finite 501-troop generation and cancellation, not by materializing MAX_SAFE_INTEGER troops.',
      'Default full-match parity, extreme arithmetic and source privacy are separate verification gates.',
      'Portable foreground setup affects only the app launched by this verifier.'],
    cleanup: { ownedApplicationClosed: false } };
  let app, browser, server, context, page, launcher, verifiedPid, currentRun, editable, beforeCore;
  let presetId, exported;
  const save = stage => {
    report.progress = { stage, at: new Date().toISOString() };
    fs.writeFileSync(destination, JSON.stringify(redact(report, privateValues), null, 2) + '\n');
  };
  const check = (condition, name, details) => {
    report.checks.push({ name, passed: Boolean(condition), ...(details === undefined ? {} : { details }) });
    save(name); expect(condition, `V4 verification failed: ${name}`);
  };
  const state = () => bounded(page.evaluate(() => window.__MIRAGINE__.getState()), 'read-only state');
  const model = async () => (await state()).customization.editor;
  const point = (fit, x, y) => ({ x: fit.clientLeft + fit.left + x * fit.scale, y: fit.clientTop + fit.top + y * fit.scale });
  const element = selector => page.locator(selector);
  const act = name => element(`[data-settings-action="${name}"]`);
  const playback = name => element(`[data-playback-controls] [data-action="${name}"]`);
  const hud = name => element(`[data-game-action="${name}"]`);
  const field = name => element(`[data-field-path="${name}"]`);
  const resource = (side, name) => element(`[data-live-resource="${side}.${name}"]`);
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
    }, `stable mapped hotspot ${action}`);
    const h = target.hotspot, p = point(target.fit, (h.left + h.right) / 2, (h.top + h.bottom) / 2);
    await page.mouse.click(p.x, p.y); await delay(100);
  }
  async function open() {
    if (!(await state()).customization.settingsOpen) await page.keyboard.press('F2');
    await until(async () => (await state()).customization.settingsOpen, 'F2 opens dock');
  }
  async function close() {
    if ((await state()).customization.settingsOpen) await page.keyboard.press('F2');
    await until(async () => !(await state()).customization.settingsOpen, 'F2 closes dock');
  }
  async function editControl(control, value) {
    await control.fill(String(value)); await control.press('Tab'); await delay(50);
  }
  async function edit(name, value) { await editControl(field(name), value); }
  async function speed(value) {
    await editControl(playback('speed-number'), value);
    await until(async () => (await state()).customization.speed === value, `${value}x speed input`);
  }
  async function pause(paused = true) {
    if ((await state()).customization.paused !== paused) await playback('pause').click();
    await until(async () => (await state()).customization.paused === paused, paused ? 'manual pause' : 'manual resume');
  }
  async function screenshot(name) {
    const relative = `output/playwright/${screenshotPrefix}-${name}.png`;
    await bounded(page.screenshot({ path: path.join(root, relative), scale: 'css', timeout: 5000 }), 'screenshot', 6000);
    report.screenshots.push(relative); save(`captured ${name}`);
  }
  async function sample(requestedSpeed, milliseconds = sampleSeconds * 1000) {
    const foregroundSetup = app ? { before: await bounded(app.evaluate(foregroundOwnedWindow), 'owned foreground'), settleMs: 120 } : null;
    if (foregroundSetup) await delay(foregroundSetup.settleMs);
    const samples = [], start = performance.now();
    do {
      const value = await bounded(page.evaluate(() => {
        const game = window.__MIRAGINE__.getState();
        return { atMs: performance.now(), frame: game.frame, phase: game.phase, winner: game.winner,
          hidden: document.hidden, focused: document.hasFocus() };
      }), 'natural timing sample');
      expect(value.phase === 'game' && !value.winner, 'Match ended during timing observation'); samples.push(value);
      if (performance.now() - start >= milliseconds) break;
      await delay(90);
    } while (true);
    const result = { ...summarizeSettingsTiming(samples, requestedSpeed), samples, foregroundSetup };
    report.timing.push(result); save(`sampled ${requestedSpeed}x`); return result;
  }
  async function frozen(name) { check((await sample(0, 300)).frozen, name); }
  async function layout(name) {
    const geometry = await page.evaluate(() => {
      const rect = selector => {
        const r = document.querySelector(selector)?.getBoundingClientRect();
        return r && { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height };
      };
      return { canvas: rect('#game'), panel: rect('[data-settings-panel]'), width: innerWidth,
        scrollWidth: document.documentElement.scrollWidth };
    });
    check(correctFit((await state()).viewport), `${name}: aspect-preserving canvas`);
    check(geometry.panel?.width > 0 && !rectanglesOverlap(geometry.canvas, geometry.panel), `${name}: dock does not cover battlefield`, geometry);
    check(geometry.scrollWidth <= geometry.width + 1, `${name}: no horizontal document overflow`, geometry);
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
      artifactsDir: path.join(root, '.local/settings-v4-automation') });
    launcher = app.process();
    const identity = await bounded(app.evaluate(() => ({ executable: process.execPath, pid: process.pid })), 'owned EXE identity');
    check(fs.realpathSync(identity.executable).toLowerCase() === fs.realpathSync(executable).toLowerCase(), `round ${round}: actual packaged EXE`);
    verifiedPid = identity.pid; context = app.context(); page = await app.firstWindow({ timeout: 60000 }); attach(page);
    await page.waitForURL(/^http:\/\/127\.0\.0\.1:\d+\//, { timeout: 60000 });
    await bounded(app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].maximize(); }), 'maximize owned window');
    currentRun = { round, pid: verifiedPid, origin: new URL(page.url()).origin, closed: false }; report.runs.push(currentRun);
  }
  async function closeOwned() {
    if (app) {
      await bounded(app.close(), 'owned Electron close', 8000); if (currentRun) currentRun.closed = true;
      app = page = context = launcher = verifiedPid = null;
    } else {
      if (context) await bounded(context.close(), 'owned context close', 5000);
      if (browser) await bounded(browser.close(), 'owned browser close', 5000);
      if (server) await bounded(server.close(), 'owned browser server close', 8000);
      context = browser = server = page = launcher = null;
    }
  }
  async function ready() {
    page.setDefaultTimeout(10000);
    await page.waitForFunction(() => window.__MIRAGINE__?.getState().ready, null, { timeout: 60000 });
  }

  try {
    save('preparing isolated v4 verification'); beforeCore = coreHashes(); report.coreSha256Before = beforeCore;
    if (directory) {
      expect(!fs.existsSync(path.join(directory, 'userdata/custom-settings.json')), 'Use a fresh isolated portable fixture, not a player profile');
      report.portable = { executableSha256: hash(path.join(directory, 'MiragineSuper.exe')), appAsarSha256: hash(path.join(directory, 'resources/app.asar')) };
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
    check(initial.phase === 'title' && initial.implementation === 'native-javascript-canvas', 'native original title loads');
    const defaults = JSON.parse(fs.readFileSync(path.join(root, 'config/defaults.generated.json'), 'utf8'));
    // Keep the dock open across an original-menu launch, not only the custom
    // new-match button. Its current blue-crystal editors must rebind correctly.
    await open(); await act('tab-sandbox').click();
    await hit('single'); await hit('difficulty', { value: 3 });
    if ((await state()).overlay === 'tutorial') await hit('tutorial-never');
    await until(async () => (await state()).phase === 'game' && !(await state()).overlay, 'original battle begins');
    await until(async () => await element('[data-live-field-path="config.difficulties.3.blueBaseDamage.0"]').count() === 1,
      'home live blue crystal rules rebind after native difficulty launch');
    check((await state()).difficulty === 3 && (await model()).battle.difficulty === 3,
      'opening settings on the menu then native-starting another difficulty binds live fields to that new battle');
    check(await element('[data-action="settings"]').count() === 0, 'no permanently displayed settings launcher');
    check(await hud('pause').isVisible() && await hud('tutorial').isVisible() && await hud('quit').isVisible(), 'all three clear text game actions are visible');
    check(!await page.evaluate(() => window.__MIRAGINE__.getHotspots().some(h => h.action === 'tutorial' || h.action === 'quit')),
      'old raster help/quit hotspots are removed instead of duplicated beneath the clear text controls');
    const hudStyle = await hud('pause').evaluate(node => { const s = getComputedStyle(node); return { background: s.backgroundColor, borderWidth: s.borderWidth, text: node.textContent }; });
    check(hudStyle.background === 'rgba(0, 0, 0, 0)' && hudStyle.borderWidth === '0px', 'game pause is plain clickable text, not a framed settings button', hudStyle);
    await open();
    check(!(await state()).customization.paused && !(await state()).customization.pauseReasons.includes('editor'), 'F2 opening does not install an automatic pause reason');
    check((await sample(1)).advancing, 'game continues while settings are open');
    const selectionBeforeHeldKey = (await state()).selection.left;
    await act('tab-sandbox').focus(); await page.keyboard.down('Space');
    try {
      await close(); await element('#game').focus(); await page.keyboard.down('Space'); await delay(100);
    } finally { await page.keyboard.up('Space'); }
    check(JSON.stringify((await state()).selection.left) === JSON.stringify(selectionBeforeHeldKey),
      'held settings Space does not leak a repeat into the live battle when F2 closes');
    await page.keyboard.press('Space'); await delay(100);
    check((await state()).selection.left[2] !== selectionBeforeHeldKey[2], 'fresh Space after release still controls original recruitment');
    await page.keyboard.press('Space'); await open();
    const order = await element('[data-control-section]').evaluateAll(nodes => nodes.map(node => node.dataset.controlSection));
    check(JSON.stringify(order) === JSON.stringify(['time', 'view']), 'time/speed/pause section precedes separate camera section', order);
    check(await playback('pause').isVisible() && await playback('fullscreen').isVisible() && await playback('free').isVisible(), 'pause, fullscreen and free-observer controls are explicit');
    await playback('speed-number').click(); await screenshot('time-and-view');
    await pause(); await frozen('large time-section pause freezes logic');
    await close(); await open(); await frozen('manual pause survives F2 close and reopen');
    await pause(false); await speed(0); await close(); await open(); await frozen('zero speed survives F2 close and reopen');
    await pause(false); await speed(1.5); check((await sample(1.5)).advancing, 'fractional speed runs with dock open');
    await playback('speed-number').fill('999999999999999999999');
    await playback('speed-number').press('Tab');
    check((await state()).customization.speed === 20 && await playback('speed-number').inputValue() === '20', 'excessive speed clamps to 20 without a rejection dialog');
    check((await sample(20)).advancing, '20x target executes real logic; actual throughput recorded separately');
    await speed(1); await pause();
    await hud('pause').click(); check(!(await state()).customization.paused, 'HUD text resumes the same pause state');
    await hud('pause').click(); await frozen('HUD text pauses the same clock');
    await close(); await hud('tutorial').click();
    check((await state()).overlay === 'tutorial', 'clear help text opens original help');
    await hit('tutorial-okay'); await hud('quit').click();
    check((await state()).overlay === 'quit', 'clear quit text opens original confirmation');
    await hit('quit-cancel'); await open(); await frozen('help/quit interactions do not release manual pause');
    await act('tab-sandbox').click();
    check(await element('[data-resource-side]').count() === 0, 'resource editing needs no red/blue selector');
    for (const side of ['left', 'right']) for (const key of ['money', 'income', 'population', 'baseHp']) {
      check(await resource(side, key).count() === 1, `${side} current ${key} has its own homepage field`);
    }
    await element('[data-live-recruitment="left"]').uncheck(); await element('[data-live-recruitment="right"]').uncheck();
    await act('clear-all').click();
    await resource('left', 'money').fill('999999999999999999999999999999999');
    check(await resource('left', 'money').inputValue() === SAFE_INTEGER_TEXT, 'pasted balance above safe integer clamps inside the input before confirmation');
    await resource('left', 'money').press('Tab');
    check(exactSafeResource((await state()).money.left, Number.MAX_SAFE_INTEGER), 'clamped MAX_SAFE_INTEGER balance really reaches simulation');
    for (const [side, values] of Object.entries({ left: { money: 3000000000, income: 3000000001, population: 3000000002 },
      right: { money: 4000000000, income: 4000000001, population: 4000000002 } })) {
      for (const [key, value] of Object.entries(values)) await editControl(resource(side, key), value);
    }
    const large = await state();
    check(exactSafeResource(large.money.left, 3000000000) && exactSafeResource(large.money.right, 4000000000)
      && exactSafeResource(large.income.left, 3000000001) && exactSafeResource(large.population.right, 4000000002),
    'independent large current resources exceed int32 without wrapping', { money: large.money, income: large.income, population: large.population });
    await edit('config.sides.left.base.hp', 2000); await edit('config.sides.right.base.hp', 3000);
    const crystalRules = (await model()).applied.config.sides;
    check(crystalRules.left.base.hp === 2000 && crystalRules.right.base.hp === 3000, 'red/blue crystal maximum-health rules are separately live-editable');
    await editControl(resource('left', 'baseHp'), 777); await editControl(resource('right', 'baseHp'), 888);
    check((await state()).baseHp.left === 777 && (await state()).baseHp.right === 888, 'current red/blue crystal health edits are independent');
    await screenshot('homepage');
    await element('[data-sandbox-unit]').selectOption('0'); await element('[data-sandbox-count]').fill('101'); await act('spawn-left').click();
    await until(async () => (await state()).alive.left === 102, '101 red troops finish spawning');
    await element('[data-sandbox-count]').fill('400'); await act('spawn-right').click();
    await until(async () => (await state()).alive.right === 401, '400 blue troops finish spawning');
    check((await state()).alive.left + (await state()).alive.right === 503, 'single-spawn 100 and total-army 500 artificial caps are removed');
    await act('clear-left').click(); check((await state()).alive.left === 1 && (await state()).alive.right === 401, 'direct clear-red preserves blue army');
    await act('clear-right').click(); check((await state()).alive.left === 1 && (await state()).alive.right === 1, 'direct clear-blue preserves both crystals');
    // Keep logic paused while testing cancellation. Materializing a giant army is not a performance test.
    await element('[data-sandbox-count]').fill(SAFE_INTEGER_TEXT); await act('spawn-left').click();
    await act('cancel-spawn').click();
    await until(async () => cancelledSpawn((await model()).spawnJob), 'large queued spawn cancelled');
    const cancelled = (await model()).spawnJob; report.spawnCancellation = cancelled;
    check(cancelledSpawn(cancelled), 'MAX-safe spawn request remains cancellable without allocating the request upfront', cancelled);
    await act('clear-all').click(); await delay(150);
    check((await state()).alive.left === 1 && (await state()).alive.right === 1, 'clear-all leaves crystals and no cancelled spawn continuation');
    await act('tab-units').click();
    check(await element('[data-entry-select="units"] option').count() === 16, 'all original 16 unit types remain available');
    await element('[data-entry-select="units"]').selectOption('0');
    const sidePath = (side, key) => `config.sides.${side}.units.0.${key}`;
    for (const [side, cost, hp] of [['left', 7, 99], ['right', 11, 123]]) { await edit(sidePath(side, 'cost'), cost); await edit(sidePath(side, 'hp'), hp); }
    check(await field(sidePath('left', 'hp')).isVisible() && await field(sidePath('right', 'hp')).isVisible(), 'same unit red/blue values are shown side by side');
    await field(sidePath('left', 'hp')).click(); await screenshot('independent-unit-values');
    await act('apply-current').click();
    await act('tab-sandbox').click(); await element('[data-sandbox-count]').fill('1');
    await act('spawn-left').click(); await until(async () => (await state()).alive.left === 2, 'one red custom troop');
    await act('spawn-right').click(); await until(async () => (await state()).alive.right === 2, 'one blue custom troop');
    const sideUnits = await state();
    check(sideUnits.units.left.some(unit => unit.id === 0 && unit.nowHP === 99)
      && sideUnits.units.right.some(unit => unit.id === 0 && unit.nowHP === 123), 'spawn uses actual distinct side health, not merely separate labels', sideUnits.units);
    await act('clear-all').click();
    for (const side of ['left', 'right']) {
      const selector = element(`[data-live-selected-unit="${side}"]`);
      // First exercise the usual focused interaction, then the original
      // unfocused change repro. Busy-state repaint must not overwrite the
      // selected value before the handler consumes it.
      await selector.focus(); await selector.selectOption('1'); await selector.press('Tab');
      await selector.selectOption('0');
    }
    check((await state()).selection.left[0] === 0 && (await state()).selection.left[1] === 0
      && (await state()).selection.right[0] === 0 && (await state()).selection.right[1] === 0,
    'live side selectors actually select each side unit 0 before recruitment');
    for (const [side, money] of [['left', 7], ['right', 11]]) {
      await editControl(resource(side, 'money'), money); await editControl(resource(side, 'population'), 50);
      await element(`[data-live-recruitment="${side}"]`).check();
    }
    await element('[data-live-ai]').uncheck();
    await pause(false);
    await until(async () => { const s = await state(); return s.alive.left === 2 && s.alive.right === 2; }, 'natural paid recruitment of both sides', 8000);
    await pause();
    const paid = await state();
    check(paid.money.left === 0 && paid.money.right === 0 && paid.units.left[0]?.nowHP === 99 && paid.units.right[0]?.nowHP === 123,
      'natural paid recruitment spends each side own cost and creates each side own HP', { money: paid.money, units: paid.units });
    for (const side of ['left', 'right']) await element(`[data-live-recruitment="${side}"]`).uncheck();
    await act('clear-all').click();
    await act('tab-difficulties').click();
    check(await element('[data-ai-difficulty]').count() === 4 && await element('[data-entry-select="difficulties"]').count() === 0,
      'all four AI difficulty cards are expanded rather than hidden in a select');
    const aiFields = await element('[data-ai-difficulty="1"] [data-field-path]').evaluateAll(nodes => nodes.map(node => node.dataset.fieldPath));
    const forcedMoney = aiFields.find(name => name.endsWith('.forceOverlordMoneyThreshold'));
    const forcedCount = aiFields.find(name => name.endsWith('.forceOverlordEliteCountThreshold'));
    check(Boolean(forcedMoney && forcedCount), 'AI money and elite-count force-selection thresholds are editable');
    await edit(forcedMoney, 150); await edit(forcedCount, 8); await screenshot('ai');
    await act('tab-starting').click();
    check(await element('[data-start-difficulty]').count() === 4 && await act('start-battle').count() === 1, 'new-game settings have direct difficulty buttons and their own start action');
    const startingFields = await element('[data-field-path]').evaluateAll(nodes => nodes.map(node => ({ path: node.dataset.fieldPath, label: node.getAttribute('aria-label') ?? '' })));
    report.startingFields = startingFields;
    const startMoney = startingFields.find(item => item.path === 'config.sides.left.initial.money');
    check(Boolean(startMoney), 'red startup money is isolated on the startup page');
    const moneyBeforeStartupEdit = (await state()).money.left;
    await edit(startMoney.path, 12345);
    check((await state()).money.left === moneyBeforeStartupEdit, 'editing starting money does not rewrite current balance');
    await act('tab-presets').click(); await element('[data-preset-name]').fill('V4 independent sides'); await act('save-preset').click();
    await until(async () => /已保存/.test(await element('[data-settings-message]').textContent()), 'durable preset acknowledgement');
    presetId = await element('[data-preset-select]').inputValue(); check(Boolean(presetId), 'independent side/AI/startup preset saved');
    const exportFile = path.join(root, '.local', `${screenshotPrefix}-export.json`);
    if (app) {
      await bounded(app.evaluate(registerNativeExport, exportFile), 'owned native Save As destination'); await act('export').click();
      report.nativeExport = await bounded(app.evaluate(async () => {
        try { return await globalThis.__SETTINGS_VERIFY_DOWNLOAD__; }
        finally { delete globalThis.__SETTINGS_VERIFY_DOWNLOAD__; }
      }), 'native export completed', 20000);
      check(completedNativeExport(report.nativeExport, fs.statSync(exportFile).size), 'native preset export really writes complete downloaded bytes', report.nativeExport);
    } else {
      const download = page.waitForEvent('download', { timeout: 10000 }); await act('export').click(); await (await download).saveAs(exportFile);
    }
    exported = JSON.parse(fs.readFileSync(exportFile, 'utf8'));
    check(exported.profile.config.sides.left.units[0].hp === 99 && exported.profile.config.sides.right.units[0].hp === 123,
      'downloaded profile preserves distinct red/blue stats');
    report.export = { sha256: hash(exportFile), bytes: fs.statSync(exportFile).size, schemaVersion: exported.profile.schemaVersion };
    await element('[data-preset-file]').setInputFiles({ name: 'malformed.json', mimeType: 'application/json', buffer: Buffer.from('{ invalid') });
    await until(async () => await element('[data-settings-message]').getAttribute('data-error') === 'true', 'malformed import reports error');
    check((await state()).money.left === moneyBeforeStartupEdit, 'malformed imported file does not mutate live resources');
    await element('[data-preset-file]').setInputFiles({ name: 'valid-v4.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(exported)) });
    await until(async () => /校验通过/.test(await element('[data-settings-message]').textContent()), 'valid profile imports through actual file input');
    await element('[data-preset-file]').setInputFiles({ name: 'legacy-v1.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(legacyFixture(exported))) });
    await until(async () => /校验通过/.test(await element('[data-settings-message]').textContent()), 'legacy profile imports through actual file input');
    await act('tab-units').click();
    check(await field(sidePath('left', 'hp')).inputValue() === '145' && await field(sidePath('right', 'hp')).inputValue() === '145'
      && await field(sidePath('left', 'cost')).inputValue() === '19' && await field(sidePath('right', 'cost')).inputValue() === '19',
    'legacy shared-unit profile migrates to both side tables without changing live state');
    await act('tab-presets').click();
    await element('[data-preset-file]').setInputFiles({ name: 'restore-v4.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(exported)) });
    await until(async () => /校验通过/.test(await element('[data-settings-message]').textContent()), 'restore v4 draft after migration test');
    await act('tab-starting').click(); await element('[data-start-difficulty="1"]').click(); await act('start-battle').click();
    await until(async () => (await state()).money.left === 12345, 'custom new match uses edited startup money');
    check((await state()).customization.rulesMode.current === 'custom', 'new custom match remains identified as custom');
    await frozen('new-match action does not silently release manual pause');
    await playback('overview').click();
    const camera = (await state()).customization.displayCamera;
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'generated/asset-manifest.json'), 'utf8'));
    const crystals = compactCrystalBounds(camera, defaults.rules, manifest.sprites); report.crystalBounds = crystals;
    check(camera.mode === 'overview' && crystals[0].left >= 12 && crystals[0].left <= 20 && crystals[1].right >= 620 && crystals[1].right <= 628,
      'compact full map still places complete crystals close to opposite edges', crystals);
    await playback('free').click(); check((await state()).customization.displayCamera.mode === 'manual', 'free camera button actually selects manual observation');
    await playback('follow').click(); check((await state()).customization.displayCamera.mode === 'follow', 'follow button actually restores original observation');
    await playback('overview').click(); await layout('wide dock'); await screenshot('panorama');
    await playback('speed-number').focus();
    await playback('fullscreen').click();
    await until(async () => app ? app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isFullScreen())
      : page.evaluate(() => Boolean(document.fullscreenElement)), 'clickable fullscreen enters actual fullscreen');
    await layout('fullscreen dock'); await screenshot('fullscreen');
    await playback('fullscreen').click();
    await until(async () => app ? app.evaluate(({ BrowserWindow }) => !BrowserWindow.getAllWindows()[0].isFullScreen())
      : page.evaluate(() => !document.fullscreenElement), 'clickable fullscreen exits');
    if (!app) {
      await page.setViewportSize({ width: 640, height: 720 }); await delay(200); await layout('narrow dock'); await screenshot('narrow');
      await page.setViewportSize({ width: 1280, height: 960 }); await delay(200);
    }
    await act('tab-units').click(); await screenshot('units');
    await act('tab-sandbox').click(); await act('return-original').click();
    check((await state()).phase === 'title' && (await state()).customization.rulesMode.current === 'original', 'return-original restores original menu without deleting draft');
    await close();
    if (directory) {
      await closeOwned(); await launchPortable(2); await ready();
      check(report.runs[0].pid !== report.runs[1].pid && report.runs[0].origin !== report.runs[1].origin,
        'preset durability uses two distinct real EXE processes and loopback origins', report.runs);
    } else { await page.reload({ waitUntil: 'domcontentloaded' }); await ready(); }
    check((await state()).phase === 'title' && (await state()).customization.rulesMode.current === 'original', 'restart never silently activates saved custom rules');
    await open(); await act('tab-units').click();
    check(await field(sidePath('left', 'hp')).inputValue() === '99' && await field(sidePath('right', 'hp')).inputValue() === '123', 'distinct side drafts survive restart');
    await act('tab-presets').click();
    check((await element('[data-preset-select] option').allTextContents()).includes('V4 independent sides'), 'named preset survives restart');
    await element('[data-preset-select]').selectOption(presetId); await act('load-preset').click();
    await screenshot('restarted-preset');
    check(report.errors.length === 0 && !(await state()).error, 'no browser or runtime JavaScript errors');
    report.status = 'passed'; report.final = await state();
  } catch (error) {
    report.status = 'failed'; report.failure = { name: error.name, message: error.message };
    if (page && !page.isClosed()) {
      try { report.failureState = await state(); } catch { /* Read-only bounded diagnostics. */ }
      try { await screenshot('failure'); } catch { /* Bounded diagnostics. */ }
    }
  } finally {
    save('closing only owned verification processes'); const owned = Boolean(app || server);
    try { await closeOwned(); report.cleanup.ownedApplicationClosed = owned; }
    catch (error) {
      report.status = 'failed'; report.cleanup.error = error.message;
      try { report.cleanup.termination = await terminateOwned(launcher, verifiedPid); }
      catch (failure) { report.cleanup.terminationError = failure.message; }
    }
    if (beforeCore) {
      report.coreSha256After = coreHashes(); report.coreUnchanged = JSON.stringify(beforeCore) === JSON.stringify(report.coreSha256After);
      if (!report.coreUnchanged) { report.status = 'failed'; report.errors.push({ type: 'integrity', message: 'Core changed during verification' }); }
    }
    if (editable) {
      report.editableFiles = editable.map(item => ({ name: item.name, before: item.before, after: hash(item.file), unchanged: item.before === hash(item.file) }));
      if (report.editableFiles.some(item => !item.unchanged)) { report.status = 'failed'; report.errors.push({ type: 'integrity', message: 'Portable editable files changed during verification' }); }
    }
    if (report.errors.length) report.status = 'failed'; report.finishedAt = new Date().toISOString(); save('v4 verification finished');
  }
  const safe = redact(report, privateValues);
  console.log(JSON.stringify({ status: safe.status, checks: safe.checks.length, report: path.relative(root, destination).split(path.sep).join('/'),
    timing: safe.timing.map(({ samples, ...summary }) => summary), ...(safe.failure ? { failure: safe.failure } : {}), cleanup: safe.cleanup }, null, 2));
  if (safe.status !== 'passed') process.exitCode = 1;
  return safe;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parseV4Options(process.argv.slice(2));
    if (options.help) console.log('Usage: node tools/verify-settings-v4.mjs (--url <loopback> | --dir <fresh portable>) [--out .local/settings-v4-verification.json] [--sample-seconds 1] [--screenshot-prefix settings-v4] [--headless]');
    else await verifySettingsV4(options);
  } catch (error) { console.error(redact(error.message, [root, os.homedir()])); process.exitCode = 1; }
}
