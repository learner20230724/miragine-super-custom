/** Real-input EXE acceptance of automatic settings. Never targets an existing player install. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { bounded, redact } from './verify-desktop.mjs';
import { visibleHotspotCenter } from './verify-settings-v4.mjs';
import { reportPath, registerNativeExport, completedNativeExport } from './verify-settings.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const expect = (condition, message) => { if (!condition) throw new Error(message); };
const hash = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export function parseAutoOptions(args) {
  const options = { out: '.local/settings-auto-qa.json', screenshotPrefix: 'settings-auto' };
  const keys = { '--dir': 'dir', '--version': 'version', '--commit': 'commit', '--out': 'out', '--screenshot-prefix': 'screenshotPrefix' };
  for (let i = 0; i < args.length; i += 2) {
    const key = keys[args[i]], value = args[i + 1];
    expect(key && typeof value === 'string' && value && !value.startsWith('--'), 'Expected --dir, --version, --commit and optional --out/--screenshot-prefix pairs');
    expect(!Object.hasOwn(options, key) || ['out', 'screenshotPrefix'].includes(key), `Duplicate option ${args[i]}`);
    options[key] = value;
  }
  expect(options.dir && /^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(options.version ?? '') && /^[a-f0-9]{40}$/.test(options.commit ?? ''),
    'Supply an isolated portable directory, exact version and 40-character source commit');
  expect(/^settings-auto(?:-[a-z0-9]+)*$/.test(options.screenshotPrefix), 'Use a safe settings-auto screenshot prefix');
  reportPath(options.out);
  return options;
}

/** Meaningful order is based on actual nodes, not just matching heading text anywhere. */
export function correctAutoOrder(parts) {
  return Array.isArray(parts) && parts.length >= 4 && parts[0]?.kind === 'summary'
    && parts[1]?.title === '生成士兵 / 清场' && parts[2]?.title === '通用基础规则'
    && same(parts[3]?.sides, ['left', 'right']);
}

/** Targets above hardware throughput are recorded honestly, never asserted as achieved. */
export function autoTiming(first, last, target) {
  expect([first?.at, last?.at, first?.frame, last?.frame, target].every(Number.isFinite)
    && last.at > first.at && last.frame >= first.frame && target >= 0 && target <= 100, 'Invalid timing observation');
  const seconds = (last.at - first.at) / 1000, steps = last.frame - first.frame;
  return { target, seconds, steps, simulationHz: steps / seconds, actualSpeed: steps / seconds / 30,
    logicalHz: 30, advancing: target > 0 && steps > 0, frozen: target === 0 && steps === 0 };
}

export async function verifySettingsAuto(options) {
  parseAutoOptions(['--dir', options.dir, '--version', options.version, '--commit', options.commit,
    '--out', options.out, '--screenshot-prefix', options.screenshotPrefix]);
  const directory = fs.realpathSync(path.resolve(root, options.dir));
  const relative = path.relative(root, directory);
  expect(relative && !relative.startsWith('..') && !path.isAbsolute(relative) && /settings-auto/i.test(relative),
    'Use an explicitly isolated settings-auto QA extraction inside this checkout');
  expect(!fs.existsSync(path.join(directory, 'userdata')), 'A fresh extraction without any user data is required');
  const build = JSON.parse(fs.readFileSync(path.join(directory, 'build-info.json'), 'utf8'));
  expect(build.version === options.version && build.sourceCommit === options.commit, 'Build provenance differs from the requested release');
  const executable = path.join(directory, 'MiragineSuper.exe'), destination = reportPath(options.out);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.mkdirSync(path.join(root, 'output/playwright'), { recursive: true });
  const editable = ['config/custom.json', 'ui-helper/original-graphics.js'].map(name => ({ name, before: hash(path.join(directory, name)) }));
  const report = { schemaVersion: 1, suite: 'automatic-settings-real-exe', status: 'running', build,
    startedAt: new Date().toISOString(), checks: [], screenshots: [], timing: [], runs: [], errors: [],
    policy: 'Fresh isolated portable EXE only; genuine mouse, keyboard, form and file input. Read-only game and DOM diagnostics. First game input turns music off. No injected settings, simulation, RNG, clock or storage. No other window or system volume is controlled.',
    limits: ['Requested 50x/100x are targets, not guarantees of measured hardware throughput.',
      'High-rate tests use two crystals and no troops, not an extreme-population performance benchmark.',
      'Detailed damage/armor, original death timeline and full-match parity are separate unit/acceptance gates.'],
    cleanup: { ownedApplicationsClosed: false } };
  let app, page, run;
  const privateValues = [root, directory, os.homedir(), os.userInfo().username];
  const save = stage => { report.progress = stage; fs.writeFileSync(destination, JSON.stringify(redact(report, privateValues), null, 2) + '\n'); };
  const check = (condition, name, details) => {
    report.checks.push({ name, passed: Boolean(condition), ...(details === undefined ? {} : { details }) }); save(name); expect(condition, name);
  };
  const state = () => bounded(page.evaluate(() => window.__MIRAGINE__.getState()), 'read-only QA state');
  const model = async () => (await state()).customization.editor;
  const act = name => page.locator(`[data-settings-action="${name}"]`);
  const field = name => page.locator(`[data-field-path="${name}"]`);
  const playback = name => page.locator(`[data-playback-controls] [data-action="${name}"]`);
  const unitPath = key => `config.sides.left.units.0.${key}`;
  const compact = s => ({ phase: s.phase, frame: s.frame, round: s.round, alive: s.alive, money: s.money,
    income: s.income, population: s.population, baseHp: s.baseHp, winner: s.winner,
    muted: s.muted, speed: s.customization.speed, paused: s.customization.paused });
  async function until(probe, name, timeout = 15000) {
    const deadline = Date.now() + timeout;
    do { const value = await bounded(Promise.resolve().then(probe), name, 20000); if (value) return value; await delay(50); } while (Date.now() < deadline);
    throw new Error(`Timed out: ${name}`);
  }
  async function saved() { await until(async () => (await model()).settingsSaved && (await model()).storageStatus === 'ready', 'automatic settings durable acknowledgement'); }
  async function screenshot(name) {
    const relative = `output/playwright/${options.screenshotPrefix}-${name}.png`;
    await page.screenshot({ path: path.join(root, relative), scale: 'css', timeout: 15000 }); report.screenshots.push(relative); save(name);
  }
  async function hit(action, matches = {}) {
    let previous = '', stableSince = 0;
    const target = await until(async () => {
      const result = await page.evaluate(({ action, matches }) => ({
        hotspot: window.__MIRAGINE__.getHotspots().find(h => h.action === action && Object.entries(matches).every(([k, v]) => h[k] === v)),
        fit: window.__MIRAGINE__.getState().viewport,
      }), { action, matches });
      if (!result.hotspot) return false;
      const signature = JSON.stringify(result);
      if (signature !== previous) { previous = signature; stableSince = Date.now(); return false; }
      return Date.now() - stableSince >= 100 ? result : false;
    }, `visible mapped ${action} hotspot`);
    const p = visibleHotspotCenter(target.hotspot), f = target.fit;
    await page.mouse.click(f.clientLeft + f.left + p.x * f.scale, f.clientTop + f.top + p.y * f.scale); await delay(100);
  }
  async function launch(round) {
    const { _electron } = await import('playwright'), env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
    app = await _electron.launch({ executablePath: executable, cwd: directory, args: [], env, timeout: 60000 });
    const identity = await app.evaluate(({ app }) => ({ executable: process.execPath, pid: process.pid, version: app.getVersion() }));
    check(fs.realpathSync(identity.executable).toLowerCase() === fs.realpathSync(executable).toLowerCase() && identity.version === options.version,
      `launch ${round}: actual owned packaged EXE identity`, { pid: identity.pid, version: identity.version });
    run = { round, pid: identity.pid, closed: false }; report.runs.push(run);
    page = await app.firstWindow({ timeout: 60000 }); page.setDefaultTimeout(10000);
    // Temporary native muting prevents startup sound, not a substitute for the required game control.
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.setAudioMuted(true));
    page.on('pageerror', error => report.errors.push({ type: 'pageerror', message: error.message }));
    page.on('console', message => { if (message.type() === 'error') report.errors.push({ type: 'console', message: message.text() }); });
    page.on('dialog', async dialog => {
      (report.dialogs ??= []).push({ type: dialog.type(), message: dialog.message() });
      if (dialog.type() === 'confirm') await dialog.accept();
      else { report.errors.push({ type: 'unexpected-dialog', message: dialog.message() }); await dialog.dismiss(); }
    });
    await page.waitForURL(/^http:\/\/127\.0\.0\.1:\d+\//, { timeout: 60000 });
    await page.waitForFunction(() => window.__MIRAGINE__?.getState().ready, null, { timeout: 60000 });
    const alreadyMuted = (await state()).muted;
    if (!alreadyMuted) await hit('music');
    check((await state()).muted === true, `launch ${round}: first game interaction turns music off or verifies retained OFF`, { alreadyMuted });
    await app.evaluate(({ BrowserWindow }) => { const win = BrowserWindow.getAllWindows()[0]; win.webContents.setAudioMuted(false); win.maximize(); win.show(); win.focus(); });
  }
  async function closeOwned() {
    if (!app) return;
    await bounded(app.close(), 'close only the owned settings-auto QA EXE', 15000); if (run) run.closed = true; app = null; page = null;
  }
  async function open() {
    if (!(await state()).customization.settingsOpen) await page.keyboard.press('F2');
    await until(async () => (await state()).customization.settingsOpen, 'settings opened with F2');
  }
  async function pause(value = true) {
    if ((await state()).customization.paused !== value) await playback('pause').click();
    await until(async () => (await state()).customization.paused === value, value ? 'paused' : 'resumed');
  }
  async function speed(value) {
    await playback('speed-number').fill(String(value)); await playback('speed-number').press('Tab');
    await until(async () => (await state()).customization.speed === value, `${value}x selected`);
  }
  async function edit(name, value, key = 'Enter') {
    const control = field(name);
    if (await control.evaluate(node => node.tagName === 'SELECT')) await control.selectOption(String(value));
    else { await control.fill(String(value)); await control.press(key); }
    await saved();
  }
  async function startNative() {
    await hit('single'); await hit('difficulty', { value: 1 });
    if ((await state()).overlay === 'tutorial') await hit('tutorial-okay');
    await until(async () => (await state()).phase === 'game' && !(await state()).overlay, 'normal native match');
    await open(); await pause();
  }
  async function spawn(side, count = 1) {
    await act('tab-sandbox').click(); await page.locator('[data-sandbox-unit]').selectOption('0');
    await page.locator('[data-sandbox-count]').fill(String(count));
    const before = (await state()).alive[side]; await act(`spawn-${side}`).click();
    await until(async () => (await state()).alive[side] === before + count, `real ${side} spawn`);
  }
  async function sample(target) {
    const read = () => page.evaluate(() => ({ at: performance.now(), frame: window.__MIRAGINE__.getState().frame }));
    const first = await read(); await delay(350); const last = await read();
    const value = autoTiming(first, last, target); report.timing.push(value); save(`sample ${target}x`); return value;
  }
  async function verifyLeftUnit(hp, range, name) {
    const s = await state(), units = s.customization.unitDetails?.left;
    check(units?.length === 1 && units[0].spawnHP === hp && units[0].range === range * s.customization.editor.applied.config.rules.rangeMultiplier,
      name, units);
  }
  try {
    save('package provenance');
    const { extractFile } = await import('@electron/asar');
    for (const name of ['src/app/main.mjs', 'src/app/settings-panel.mjs', 'src/customization/index.mjs', 'src/app/custom-controls.mjs', 'src/runtime/game-clock.mjs']) {
      check(extractFile(path.join(directory, 'resources/app.asar'), name.split('/').join(path.sep)).equals(fs.readFileSync(path.join(root, name))),
        `packaged runtime exactly matches verified checkout: ${name}`);
    }
    await launch(1); await startNative(); await act('tab-sandbox').click();
    const order = await page.locator('#miragine-settings-content').evaluate(node => [...node.children].map(child => ({
      kind: child.hasAttribute('data-battle-summary') ? 'summary' : 'section', title: child.querySelector('h3')?.textContent,
      sides: [...child.querySelectorAll('[data-live-side]')].map(side => side.dataset.liveSide),
    })));
    check(correctAutoOrder(order), 'homepage order is summary, spawn/clear, common rules, then red/blue state', order);
    check(await act('apply-current').count() === 0 && !/草稿未保存/.test(await page.locator('[data-settings-panel]').textContent()),
      'obsolete manual Apply and unsaved-draft message are absent');
    check(await page.locator('[data-settings-save-status]').getAttribute('data-save-state') !== 'failed', 'fresh installation does not falsely report a save failure');
    await screenshot('homepage');
    for (const side of ['left', 'right']) await page.locator(`[data-live-recruitment="${side}"]`).uncheck();
    await page.locator('[data-live-ai]').uncheck(); await act('clear-all').click();
    for (const target of [50, 100]) {
      await page.locator(`[data-playback-controls] [data-speed="${target}"]`).click(); await pause(false);
      check((await state()).customization.speed === target && (await sample(target)).advancing, `${target}x shortcut executes real simulation`);
      check((await state()).customization.timing.stepHz === 30 && (await state()).config.frameRate === 30, `${target}x keeps 30 Hz original logic steps`);
    }
    await playback('speed-number').fill('999999999999999999999'); await playback('speed-number').press('Enter');
    check((await state()).customization.speed === 100 && await playback('speed-number').inputValue() === '100', 'numeric speed overflow clamps to 100');
    await playback('speed-range').focus(); await playback('speed-range').press('Home');
    await until(async () => (await state()).customization.speed === 0, 'real slider Home selects zero');
    check((await sample(0)).frozen, 'zero slider endpoint freezes actual logic');
    await playback('speed-range').press('End');
    await until(async () => (await state()).customization.speed === 100, 'real slider End selects 100');
    await pause(); check((await sample(0)).frozen, 'pause at 100x freezes actual logic');
    await pause(false); check((await state()).customization.speed === 100 && (await sample(100)).advancing, 'resume restores the previous 100x selection');
    await speed(1); await pause();

    await act('tab-difficulties').click(); await page.locator('[data-entry-select="difficulties"]').selectOption('1');
    await page.locator('[data-ai-category]').selectOption('thresholds');
    const aiPath = 'config.difficulties.1.ai.forceOverlordMoneyThreshold';
    await edit(aiPath, 0, 'Tab'); await edit('config.difficulties.1.ai.forcedUnitId', 7);
    check((await model()).applied.config.difficulties[1].ai.forceOverlordMoneyThreshold === 0, 'AI threshold confirms automatically without an Apply button');
    await act('tab-sandbox').click(); await page.locator('[data-live-selected-unit="right"]').selectOption('0');
    check((await model()).battle.right.selectedUnit === 0, 'AI observation starts from a genuinely different selected unit');
    await page.locator('[data-live-ai]').check(); await speed(100); await pause(false);
    await until(async () => (await model()).battle.right.selectedUnit === 7, 'configured forced AI choice occurs in actual battle');
    await pause(); await page.locator('[data-live-ai]').uncheck();
    check((await model()).battle.right.selectedUnit === 7, 'AI changes reach live selection, not just the settings display');
    await speed(1); await pause(); await spawn('left'); await spawn('right');
    await act('tab-units').click(); await page.locator('[data-entry-select="units"]').selectOption('0');
    await edit(unitPath('range'), 1200); await edit(unitPath('hp'), 350, 'Tab');
    await verifyLeftUnit(350, 1200, 'Enter range and blur HP edits update an existing living soldier immediately');
    check((await model()).draft.config.sides.left.units[0].hp === 350 && (await model()).next.config.sides.left.units[0].hp === 350,
      'confirmed values are saved and queued for future matches without a separate draft');
    await screenshot('automatic-unit-edit');
    await act('tab-starting').click(); const beforeOpening = compact(await state());
    await edit('config.sides.left.initial.money', 4321);
    check(same(compact(await state()), beforeOpening) && (await model()).next.config.sides.left.initial.money === 4321
      && (await model()).pendingNext.includes('config.sides.left.initial.money'),
      'starting-money confirmation preserves this paused match and automatically queues the next one');
    // Keep subsequent native-menu/restart balance checks deterministic through
    // ordinary saved opening controls, not by rewriting the loaded profile.
    for (const side of ['left', 'right']) { await field(`rules.${side}Recruitment`).uncheck(); await saved(); }
    await act('tab-presets').click(); await page.locator('[data-preset-name]').fill('Automatic settings acceptance'); await act('save-preset').click();
    await until(async () => (await model()).presets.length === 1, 'named preset stored'); await saved();
    const presetId = (await model()).presets[0].id, profile = (await model()).next;
    const exportFile = path.join(root, '.local', `${options.screenshotPrefix}-export.json`);
    await app.evaluate(registerNativeExport, exportFile); await act('export').click();
    const download = await bounded(app.evaluate(async () => { try { return await globalThis.__SETTINGS_VERIFY_DOWNLOAD__; }
      finally { delete globalThis.__SETTINGS_VERIFY_DOWNLOAD__; } }), 'actual native JSON export', 20000);
    check(completedNativeExport(download, fs.statSync(exportFile).size), 'export produces a complete JSON file through the actual UI download');
    const exported = JSON.parse(fs.readFileSync(exportFile, 'utf8'));
    check(same(exported.profile, profile), 'export is a copy of the already applied/queued configuration');

    const beforeReset = await state(), original = (await model()).defaults;
    const survivingUids = beforeReset.customization.unitDetails.left.map(unit => unit.uid);
    await act('reset').click(); await saved();
    const resetState = await state(), reset = resetState.customization.editor;
    await verifyLeftUnit(original.config.sides.left.units[0].hp, original.config.sides.left.units[0].range,
      'Restore original defaults actually restores live soldier HP and range');
    check(same(reset.next, original) && reset.applied.config.difficulties[1].ai.forceOverlordMoneyThreshold === original.config.difficulties[1].ai.forceOverlordMoneyThreshold,
      'reset restores all panel defaults including AI and future opening values');
    check(['frame', 'round', 'money', 'income', 'population', 'alive'].every(key => same(beforeReset[key], resetState[key]))
      && same(survivingUids, resetState.customization.unitDetails.left.map(unit => unit.uid)) && reset.presets.some(item => item.id === presetId),
      'reset neither restarts combat, deletes soldiers, refunds resources nor deletes named presets');
    check(reset.template === 'startup', 'default reset preserves the explicitly retained hit/lifetime improvement template');
    await act('undo').click(); await saved();
    await verifyLeftUnit(350, 1200, 'Undo last setting immediately restores pre-reset live HP and range');
    check(same((await model()).next, profile), 'undo restores the complete previous future profile as well');
    await act('reset').click(); await saved();
    await page.locator('[data-preset-select]').selectOption(presetId); await act('load-preset').click(); await saved();
    await verifyLeftUnit(350, 1200, 'Load and apply preset changes existing soldiers without a second action');
    const imported = structuredClone(exported); imported.name = 'Imported automatic settings';
    imported.profile.config.sides.left.units[0].hp = 411; imported.profile.config.sides.left.units[0].range = 1300;
    await page.locator('[data-preset-file]').setInputFiles({ name: 'automatic-settings.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(imported)) });
    await until(async () => (await model()).applied.config.sides.left.units[0].hp === 411, 'import automatically applies'); await saved();
    await verifyLeftUnit(411, 1300, 'JSON import immediately applies live rules');
    check((await model()).presets.length === 1, 'import does not silently add or overwrite a named preset');
    await page.locator('[data-preset-name]').fill('Imported named copy'); await act('save-preset').click();
    await until(async () => (await model()).presets.length === 2, 'explicit named copy saved'); await saved();
    check((await model()).presets.length === 2, 'Save as new preset creates a separate named copy'); await screenshot('presets');
    await act('tab-sandbox').click(); await act('return-original').click();
    await until(async () => (await state()).phase === 'title', 'return to title ends only the match');
    check((await model()).next.config.sides.left.units[0].hp === 411 && (await model()).presets.length === 2,
      'Return to main menu is clearly not a defaults reset and preserves all saved settings');
    await startNative();
    check((await state()).money.left === 4321, 'next native-menu match uses automatically queued opening money');
    await saved(); const durableProfile = (await model()).next;
    const storageFile = path.join(directory, 'userdata/custom-settings.json');
    const storage = JSON.parse(fs.readFileSync(storageFile, 'utf8'));
    const savedEntry = JSON.parse(storage.entries['miragine-custom-draft-v1']);
    check(savedEntry.schemaVersion === 2 && same(savedEntry.profile, durableProfile), 'automatic schema-2 settings really reached the portable profile on disk');
    await closeOwned(); await launch(2);
    const restored = await model();
    check(restored.restoredSettings && restored.settingsSaved && same(restored.next, durableProfile) && same(restored.applied, durableProfile)
      && restored.presets.length === 2, 'second real EXE launch automatically restores saved effective settings and both presets');
    await startNative();
    check((await state()).money.left === 4321, 'restarted EXE uses saved opening money without clicking Apply');
    await act('tab-sandbox').click();
    for (const side of ['left', 'right']) await page.locator(`[data-live-recruitment="${side}"]`).uncheck();
    await act('clear-all').click(); await spawn('left');
    await verifyLeftUnit(411, 1300, 'soldier spawned after EXE restart uses saved HP and range automatically');
    await act('tab-units').click(); await screenshot('restored-second-launch');
    check(await act('apply-current').count() === 0 && !/草稿未保存/.test(await page.locator('[data-settings-panel]').textContent()),
      'restarted UI still requires no manual Apply or draft workflow');
    for (const file of editable) file.after = hash(path.join(directory, file.name));
    check(editable.every(file => file.before === file.after), 'external editable config and graphics helper were not rewritten', editable);
    check(report.errors.length === 0 && !(await state()).error && (await state()).muted, 'both real-input launches remain muted with no renderer/runtime errors');
    report.final = compact(await state()); report.status = 'passed';
  } catch (error) {
    report.status = 'failed'; report.failure = { name: error.name, message: error.message };
    if (page && !page.isClosed()) { try { report.failureState = compact(await state()); } catch {} try { await screenshot('failure'); } catch {} }
  } finally {
    try { await closeOwned(); } catch (error) { report.status = 'failed'; report.cleanup.error = error.message; }
    report.cleanup.ownedApplicationsClosed = report.runs.length > 0 && report.runs.every(item => item.closed);
    report.finishedAt = new Date().toISOString(); save('finished');
  }
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parseAutoOptions(process.argv.slice(2)), report = await verifySettingsAuto(options);
    console.log(JSON.stringify({ status: report.status, checks: report.checks.length, report: options.out,
      cleanup: report.cleanup, ...(report.failure ? { failure: report.failure } : {}) }, null, 2));
    if (report.status !== 'passed') process.exitCode = 1;
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
