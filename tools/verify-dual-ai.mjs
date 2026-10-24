/** Independent, real-input acceptance of the optional mirrored-AI match mode. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { bounded, redact } from './verify-desktop.mjs';
import { visibleHotspotCenter } from './verify-settings-v4.mjs';
import { reportPath } from './verify-settings.mjs';
import { withHeldKeys } from './verify-settings-auto.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const expect = (condition, message) => { if (!condition) throw new Error(message); };
const hash = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const SIDES = ['left', 'right'];

export function parseDualAIOptions(args) {
  const options = { out: '.local/dual-ai-clean-hud-qa.json', screenshotPrefix: 'dual-ai-clean-hud' };
  const names = { '--dir': 'dir', '--archive': 'archive', '--version': 'version', '--commit': 'commit',
    '--out': 'out', '--screenshot-prefix': 'screenshotPrefix' };
  const seen = new Set();
  for (let index = 0; index < args.length; index += 2) {
    const key = names[args[index]], value = args[index + 1];
    expect(key && typeof value === 'string' && value && !value.startsWith('--'), 'Expected explicit --dir/--archive/--version/--commit and optional --out/--screenshot-prefix pairs');
    expect(!seen.has(key), `Duplicate option ${args[index]}`); seen.add(key); options[key] = value;
  }
  expect(options.dir && options.archive && /^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(options.version ?? '')
    && /^[a-f0-9]{40}$/.test(options.commit ?? ''), 'Supply an isolated QA extraction, exact release archive, version and source commit');
  expect(/^dual-ai(?:-[a-z0-9]+)*$/.test(options.screenshotPrefix), 'Use a safe dual-ai screenshot prefix');
  reportPath(options.out); return options;
}

/** Validate archive inventory before trusting its relative paths or digests. */
export function dualAIInventoryRows(inventory) {
  expect(inventory?.archiveRoot === 'MiragineSuper/' && Array.isArray(inventory.files)
    && inventory.files.length > 0 && inventory.fileCount === inventory.files.length, 'Invalid portable archive inventory');
  const seen = new Set();
  return inventory.files.map(row => {
    expect(typeof row?.path === 'string' && row.path.startsWith('MiragineSuper/')
      && !/[\\:\r\n\0]/.test(row.path), 'Unsafe inventory path');
    const parts = row.path.split('/');
    expect(parts.length > 1 && parts.every(part => part && part !== '.' && part !== '..'
      && !['userdata', '.tmp'].includes(part.toLowerCase())), 'Unsafe or personal inventory entry');
    const name = parts.slice(1).join('/');
    expect(!seen.has(name.toLowerCase()), 'Case-colliding inventory entry'); seen.add(name.toLowerCase());
    expect(Number.isSafeInteger(row.bytes) && row.bytes >= 0 && /^[a-f0-9]{64}$/.test(row.sha256 ?? ''), 'Invalid inventory digest/size');
    return { name, bytes: row.bytes, sha256: row.sha256 };
  });
}

/** Read-only identity summary; decision records are evidence, not injected choices. */
export function summarizeDualAI(state) {
  const ai = state?.dualAI;
  expect(state?.matchMode === 'ai-vs-ai' && ai && SIDES.every(side => Number.isInteger(ai[`${side}Difficulty`])
    && Number.isInteger(ai.decisions?.[side]?.count) && ai.decisions[side].count >= 0
    && Array.isArray(state.selection?.[side]) && state.selection[side].length === 3), 'Missing dual AI inspection state');
  return { frame: state.frame, round: state.round, mode: state.matchMode,
    difficulty: Object.fromEntries(SIDES.map(side => [side, ai[`${side}Difficulty`]])),
    applyDifficultyStats: ai.applyDifficultyStats, statsDifficulties: { ...ai.statsDifficulties },
    decisions: Object.fromEntries(SIDES.map(side => [side, { ...ai.decisions[side] }])),
    selection: Object.fromEntries(SIDES.map(side => [side, [...state.selection[side]]])),
    recruitment: Object.fromEntries(SIDES.map(side => [side, state.selection[side][2] === 1])),
    alive: { ...state.alive }, income: { ...state.income }, population: { ...state.population },
    money: { ...state.money }, paused: state.customization?.paused, speed: state.customization?.speed };
}

/** Original-style difficulty buttons are clicked via their read-only hotspots. */
export async function chooseDifficultyByHotspot({ hit, side, value }) {
  expect(SIDES.includes(side) && Number.isInteger(value) && value >= 0 && value <= 3, 'Difficulty must be left/right and 0..3');
  expect(typeof hit === 'function', 'A genuine mapped-hotspot click helper is required');
  await hit(`dual-ai-${side}`, { value });
}

export function recruitmentKey(side) {
  expect(SIDES.includes(side), 'Recruitment side must be left or right');
  return side === 'left' ? 'Space' : 'Enter';
}

export async function verifyDualAI(options) {
  parseDualAIOptions(['--dir', options.dir, '--archive', options.archive, '--version', options.version,
    '--commit', options.commit, '--out', options.out, '--screenshot-prefix', options.screenshotPrefix]);
  const directory = fs.realpathSync(path.resolve(root, options.dir)), relative = path.relative(root, directory);
  expect(relative && !relative.startsWith('..') && !path.isAbsolute(relative)
    && /(?:^|[\\/])dual-ai-qa-[^\\/]+[\\/]MiragineSuper$/.test(relative),
  'Use a fresh dist/dual-ai-qa-<unique>/MiragineSuper extraction, never a build/player install');
  expect(!fs.existsSync(path.join(directory, 'userdata')) && !fs.existsSync(path.join(directory, '.tmp')), 'Fresh extraction must not contain user data or prior runtime files');
  const archive = fs.realpathSync(path.resolve(root, options.archive)), archiveRelative = path.relative(root, archive);
  expect(!archiveRelative.startsWith('..') && !path.isAbsolute(archiveRelative) && /\.zip$/.test(archive), 'Use a release ZIP inside this checkout');
  const inventory = JSON.parse(fs.readFileSync(archive + '.inventory.json', 'utf8')), rows = dualAIInventoryRows(inventory);
  expect(hash(archive) === inventory.sha256 && inventory.version === options.version
    && inventory.sourceCommit === options.commit, 'Release ZIP provenance/hash mismatch');
  const build = JSON.parse(fs.readFileSync(path.join(directory, 'build-info.json'), 'utf8'));
  expect(build.version === options.version && build.sourceCommit === options.commit, 'EXE build provenance mismatch');
  const actual = [];
  const walk = (dir, prefix = '') => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name), name = prefix + entry.name;
      expect(!fs.lstatSync(file).isSymbolicLink(), 'QA extraction must contain no symlinks');
      if (entry.isDirectory()) walk(file, name + '/'); else { expect(entry.isFile(), 'Unexpected extraction entry'); actual.push(name); }
    }
  };
  walk(directory);
  expect(same(actual.sort(), rows.map(row => row.name).sort()), 'QA extraction does not exactly match the clean ZIP inventory');
  for (const row of rows) {
    const file = path.join(directory, ...row.name.split('/'));
    expect(fs.statSync(file).size === row.bytes && hash(file) === row.sha256, `Extracted ZIP file mismatch: ${row.name}`);
  }
  const destination = reportPath(options.out), executable = path.join(directory, 'MiragineSuper.exe');
  fs.mkdirSync(path.dirname(destination), { recursive: true }); fs.mkdirSync(path.join(root, 'output/playwright'), { recursive: true });
  const report = { schemaVersion: 1, suite: 'dual-ai-clean-hud-real-exe', status: 'running', build,
    archive: { sha256: inventory.sha256, fileCount: rows.length, everyExtractedFileHash: 'matched' },
    startedAt: new Date().toISOString(), checks: [], screenshots: [], runs: [], errors: [], observations: [],
    policy: 'Fresh isolated release-ZIP EXE only. First game interaction turns music off. Original-style menu and unit buttons use read-only mapped hotspots and real mouse clicks. Recruitment uses real Space/Enter keydown/up. No injected game state, configuration, RNG, clocks, storage, selections or decisions. Only this owned QA process is controlled and closed.',
    limits: ['AI choice is random where the recovered rules are random; exact unit IDs are observed, not predetermined.',
      'Three difficulty/stat combinations are exercised in the EXE; exhaustive combinations are a separate source-test gate.',
      'Physical Semicolon is exercised without changing the system input method; Chinese-key fallback and OS-repeat events have separate source tests.',
      'This suite observes income-point decisions and recruitment, not a full-match outcome or maximum-population benchmark.'],
    cleanup: { ownedApplicationsClosed: false } };
  const privateValues = [root, directory, archive, os.homedir(), os.userInfo().username];
  let app, page, run;
  const save = progress => { report.progress = progress; fs.writeFileSync(destination, JSON.stringify(redact(report, privateValues), null, 2) + '\n'); };
  const check = (condition, id, details) => {
    report.checks.push({ id, ok: Boolean(condition), ...(details === undefined ? {} : { details }) }); save(id); expect(condition, id);
  };
  const state = () => bounded(page.evaluate(() => window.__MIRAGINE__.getState()), 'read-only dual AI state');
  const settingsAction = name => page.locator(`[data-settings-action="${name}"]`);
  async function until(probe, name, milliseconds = 20000) {
    const deadline = Date.now() + milliseconds;
    do {
      expect(report.errors.length === 0, 'Unexpected renderer/native-dialog error');
      const value = await bounded(Promise.resolve().then(probe), name, 20000); if (value) return value;
      await delay(50);
    } while (Date.now() < deadline);
    throw new Error(`Timed out: ${name}`);
  }
  async function screenshot(name) {
    const relative = `output/playwright/${options.screenshotPrefix}-${name}.png`;
    await page.screenshot({ path: path.join(root, relative), scale: 'css', timeout: 15000 }); report.screenshots.push(relative); save(name);
  }
  async function hit(name, matches = {}) {
    let previous = '', stableSince = 0;
    const target = await until(async () => {
      const value = await page.evaluate(({ name, matches }) => ({
        hotspot: window.__MIRAGINE__.getHotspots().find(item => item.action === name
          && Object.entries(matches).every(([key, value]) => item[key] === value)),
        fit: window.__MIRAGINE__.getState().viewport,
      }), { name, matches });
      if (!value.hotspot) return false;
      const signature = JSON.stringify(value);
      if (signature !== previous) { previous = signature; stableSince = Date.now(); return false; }
      return Date.now() - stableSince >= 500 ? value : false;
    }, `mapped ${name} hotspot`);
    const p = visibleHotspotCenter(target.hotspot), f = target.fit;
    await page.mouse.click(f.clientLeft + f.left + p.x * f.scale, f.clientTop + f.top + p.y * f.scale);
  }
  async function drawer(open) {
    if ((await state()).customization.settingsOpen !== open) await page.keyboard.press('F2');
    await until(async () => (await state()).customization.settingsOpen === open, `settings drawer ${open}`);
  }
  async function pause(paused = true) {
    await drawer(false);
    if ((await state()).customization.paused !== paused) await page.locator('[data-game-action="pause"]').click();
    await until(async () => (await state()).customization.paused === paused, `global pause ${paused}`);
  }
  async function speed(value) {
    await drawer(true); await page.locator(`[data-playback-controls] [data-speed="${value}"]`).click();
    await until(async () => (await state()).customization.speed === value, `speed ${value}`); await drawer(false);
  }
  async function recruit(side, enabled) {
    if ((await state()).selection[side][2] !== Number(enabled)) {
      await canvasFocus(); await page.keyboard.press(recruitmentKey(side));
    }
    await until(async () => (await state()).selection[side][2] === Number(enabled), `${side} recruitment ${enabled}`);
  }
  async function canvasFocus() {
    const fit = (await state()).viewport;
    await page.mouse.click(fit.clientLeft + fit.left + 320 * fit.scale, fit.clientTop + fit.top + 250 * fit.scale);
    expect(await page.locator('#game').evaluate(node => node.ownerDocument.hasFocus() && node.ownerDocument.activeElement === node),
      'A genuine battlefield click must own game keyboard input');
  }
  async function recruitment() {
    const s = await state(); return Object.fromEntries(SIDES.map(side => [side, s.selection[side][2]]));
  }
  async function finishTutorial() {
    if ((await state()).overlay === 'tutorial') await hit('tutorial-never');
    await until(async () => (await state()).phase === 'game' && !(await state()).overlay, 'playable battle');
  }
  async function start(left, right, stats) {
    await drawer(false); await hit('dual-ai');
    await until(async () => (await state()).panel === 'dual-ai', 'dual AI setup panel');
    await chooseDifficultyByHotspot({ hit, side: 'left', value: left });
    await chooseDifficultyByHotspot({ hit, side: 'right', value: right });
    if ((await state()).dualAIOptions.applyDifficultyStats !== stats) await hit('dual-ai-stats', { value: stats });
    check(same((await state()).dualAIOptions, { leftDifficulty: left, rightDifficulty: right, applyDifficultyStats: stats }),
      `setup-${left}-${right}-${stats}-real-controls`);
    await screenshot(`setup-${left}-${right}-${stats ? 'stats' : 'strategy'}`);
    await hit('dual-ai-start'); await finishTutorial(); await pause();
    const s = await state(), ai = summarizeDualAI(s), battle = s.customization.editor.battle;
    report.observations.push({ stage: `opening-${left}-${right}-${stats}`, ...ai, battle });
    check(s.singlePlay === false && s.matchMode === 'ai-vs-ai' && same(ai.difficulty, { left, right }), `opening-${left}-${right}-${stats}-mode`);
    check(same(ai.statsDifficulties, { left: stats ? left : 1, right: stats ? right : 1 }) && ai.applyDifficultyStats === stats,
      `opening-${left}-${right}-${stats}-stat-mapping`, ai);
    for (const side of SIDES) {
      const d = stats ? (side === 'left' ? left : right) : 1, impossible = d === 3;
      check(s.income[side] === (impossible ? 600 : 500) && s.population[side] === (impossible ? 100 : 80)
        && same(battle[side].baseDamage, impossible ? [110, 110] : [100, 100])
        && battle[side].baseWeaponSpeedFrames === (impossible ? 25 : 30), `opening-${left}-${right}-${stats}-${side}-actual-stats`, battle[side]);
    }
    check(ai.decisions.left.count === 0 && ai.decisions.right.count === 0, `opening-${left}-${right}-${stats}-no-premature-ai`);
    check(await page.locator('[data-dual-ai-controls], [data-dual-ai-side], [data-dual-ai-status], [data-dual-ai-action^="dual-ai-recruit-"]').count() === 0,
      `opening-${left}-${right}-${stats}-no-obstructive-dom-hud`);
  }
  async function home() {
    await drawer(false); await page.locator('[data-game-action="quit"]').click(); await hit('quit-confirm');
    await until(async () => (await state()).phase === 'title' && (await state()).panel === 'home', 'original quit returns home');
    await until(() => page.evaluate(() => window.__MIRAGINE__.getHotspots().some(item => item.action === 'dual-ai')), 'original-style homepage dual AI button');
  }
  async function nextDecision(label) {
    const before = summarizeDualAI(await state());
    await speed(20); await pause(false);
    await until(async () => { const s = await state(); return SIDES.every(side => s.dualAI.decisions[side].count > before.decisions[side].count); }, `${label} actual income decisions`, 30000);
    await pause();
    const after = summarizeDualAI(await state()); report.observations.push({ stage: label, before, after });
    check(SIDES.every(side => after.decisions[side].count > before.decisions[side].count)
      && after.decisions.left.count === after.decisions.right.count
      && after.decisions.left.lastFrame === after.decisions.right.lastFrame, `${label}-both-ai-decide-at-income`, { before, after });
    check(SIDES.every(side => after.selection[side][0] + 8 * after.selection[side][1] === after.decisions[side].selectedUnit),
      `${label}-ai-choice-reaches-live-cards`, after);
    check(SIDES.every(side => after.selection[side][2] === before.selection[side][2]), `${label}-ai-preserves-recruitment-flags`, after.selection);
    return after;
  }
  async function pausedKeyboardAcceptance() {
    await pause(); await canvasFocus();
    const frozenFrame = (await state()).frame;
    for (const side of SIDES) {
      const before = await recruitment(), other = side === 'left' ? 'right' : 'left';
      await withHeldKeys({ keyboard: page.keyboard, keys: [recruitmentKey(side)], during: async () => {
        const first = await recruitment();
        check(first[side] === 1 - before[side] && first[other] === before[other], `${side}-paused-key-immediately-toggles-only-own-recruitment`, { before, first });
        const samples = [];
        for (let index = 0; index < 6; index++) { await delay(125); samples.push(await recruitment()); }
        check(samples.every(sample => same(sample, first)) && (await state()).frame === frozenFrame,
          `${side}-paused-held-key-toggles-once-without-stepping`, samples);
      } });
      await page.keyboard.press(recruitmentKey(side));
      check(same(await recruitment(), before), `${side}-release-then-fresh-press-restores-recruitment`);
    }
    await drawer(true); await settingsAction('tab-presets').click();
    const name = page.locator('[data-preset-name]'), flags = await recruitment();
    await name.click(); await page.keyboard.press('Control+A'); await page.keyboard.type('keyboard');
    await page.keyboard.press('Space');
    check(await name.inputValue() === 'keyboard ' && same(await recruitment(), flags), 'space-edits-text-without-toggling-red-recruitment');
    await page.keyboard.press('Enter');
    check(same(await recruitment(), flags), 'enter-in-editor-does-not-toggle-blue-recruitment');
    const cameraBefore = (await state()).customization.displayCamera;
    await page.keyboard.type('p;');
    check(await name.inputValue() === 'keyboard p;' && same((await state()).customization.displayCamera, cameraBefore),
      'p-and-semicolon-remain-editor-text-not-camera-shortcuts');
    for (const key of ['Space', 'Enter']) {
      const profile = (await state()).customization.editor.next;
      await settingsAction('reset').click(); const dialog = page.locator('[data-settings-confirm]');
      await dialog.waitFor({ state: 'visible' });
      expect(await page.locator('[data-settings-confirm-cancel]').evaluate(node => node.ownerDocument.activeElement === node),
        'Confirmation must initially focus its safe Cancel button');
      await page.keyboard.press(key); await dialog.waitFor({ state: 'hidden' });
      check(same(await recruitment(), flags) && same((await state()).customization.editor.next, profile),
        `${key.toLowerCase()}-confirmation-cancels-without-recruitment-or-settings-leak`);
    }
    await drawer(false); await page.locator('[data-game-action="tutorial"]').click();
    await until(async () => (await state()).overlay === 'tutorial', 'real help overlay');
    await page.keyboard.press('Space'); await page.keyboard.press('Enter');
    check(same(await recruitment(), flags), 'tutorial-overlay-blocks-both-recruitment-shortcuts');
    await hit('tutorial-okay'); await canvasFocus();
    check((await state()).frame === frozenFrame, 'keyboard-focus-and-overlay-checks-never-advance-paused-logic');
  }
  async function fastKeyboardAcceptance() {
    for (const side of SIDES) await recruit(side, false);
    await speed(100); await pause(false); await canvasFocus();
    const before = await state();
    await withHeldKeys({ keyboard: page.keyboard, keys: ['Space', 'Enter'], during: async () => {
      const first = await recruitment(), samples = [];
      for (let index = 0; index < 6; index++) { await delay(100); samples.push(await recruitment()); }
      check(same(first, { left: 1, right: 1 }) && samples.every(sample => same(sample, first)),
        'hundred-speed-held-space-enter-toggle-each-side-once', samples);
    } });
    const after = await state();
    check(after.frame > before.frame && after.customization.speed === 100 && after.customization.timing.stepHz === 30,
      'recruitment-key-repeat-is-independent-of-hundred-speed-30hz-logic', { before: before.frame, after: after.frame });
    await pause();
    for (const side of SIDES) await recruit(side, false);
    check(same(await recruitment(), { left: 0, right: 0 }), 'fresh-space-enter-after-fast-hold-can-pause-both-sides');
  }
  async function cameraKeyboardAcceptance() {
    await pause(); await canvasFocus(); const frame = (await state()).frame;
    await page.keyboard.press('p');
    check((await state()).customization.displayCamera.mode === 'overview', 'physical-p-fits-entire-battlefield');
    await page.keyboard.press(';');
    check((await state()).customization.displayCamera.mode === 'follow', 'physical-semicolon-restores-follow-camera');
    const followed = (await state()).customization.displayCamera;
    await withHeldKeys({ keyboard: page.keyboard, keys: ['j'], during: () => delay(250) });
    const manual = (await state()).customization.displayCamera;
    check(manual.mode === 'manual' && (manual.centerX !== followed.centerX || manual.centerY !== followed.centerY),
      'held-j-camera-pan-leaves-follow-for-free-observation', { followed, manual });
    await page.keyboard.press(';');
    expect((await state()).customization.displayCamera.mode === 'follow', 'Follow shortcut must re-arm before dragging');
    const fit = (await state()).viewport, x = fit.clientLeft + fit.left + 320 * fit.scale, y = fit.clientTop + fit.top + 250 * fit.scale;
    await page.mouse.move(x, y); await page.mouse.down({ button: 'right' });
    try { await page.mouse.move(x + 60 * fit.scale, y + 12 * fit.scale, { steps: 8 }); }
    finally { await page.mouse.up({ button: 'right' }); }
    check((await state()).customization.displayCamera.mode === 'manual', 'real-right-mouse-drag-leaves-follow-for-free-observation');
    await page.keyboard.press('p');
    check((await state()).customization.displayCamera.mode === 'overview' && (await state()).frame === frame,
      'camera-shortcuts-and-manual-motion-work-with-paused-logic');
  }
  async function closeOwned() {
    if (!app) return;
    await bounded(app.close(), 'close only owned dual AI QA EXE', 15000); if (run) run.closed = true; app = null; page = null;
  }
  try {
    check(true, 'fresh-zip-every-file-hash', report.archive);
    const { extractFile } = await import('@electron/asar');
    for (const name of ['src/app/main.mjs', 'src/app/input.mjs', 'src/app/controller.mjs', 'src/app/dual-ai-controls.mjs', 'src/app/view.mjs',
      'src/app/camera-keyboard.mjs', 'src/app/camera-shortcuts.mjs', 'src/app/settings-panel.mjs', 'src/extensions/dual-ai.mjs',
      'src/customization/index.mjs', 'src/customization/runtime.mjs', 'src/runtime/game-clock.mjs']) {
      check(extractFile(path.join(directory, 'resources/app.asar'), name.split('/').join(path.sep)).equals(fs.readFileSync(path.join(root, name))),
        `packaged-source-${name}`);
    }
    const { _electron } = await import('playwright'), env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
    app = await _electron.launch({ executablePath: executable, cwd: directory, args: [], env, timeout: 60000 });
    const identity = await app.evaluate(({ app }) => ({ executable: process.execPath, pid: process.pid, version: app.getVersion() }));
    run = { round: 1, pid: identity.pid, closed: false }; report.runs.push(run);
    check(fs.realpathSync(identity.executable).toLowerCase() === fs.realpathSync(executable).toLowerCase()
      && identity.version === options.version, 'actual-owned-portable-exe', { pid: identity.pid, version: identity.version });
    page = await app.firstWindow({ timeout: 60000 }); page.setDefaultTimeout(10000);
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.setAudioMuted(true));
    page.on('pageerror', error => report.errors.push({ type: 'pageerror', message: error.message }));
    page.on('console', message => { if (message.type() === 'error') report.errors.push({ type: 'console', message: message.text() }); });
    page.on('dialog', async dialog => { report.errors.push({ type: 'native-dialog', message: dialog.message() }); try { await dialog.dismiss(); } catch {} });
    await page.waitForURL(/^http:\/\/127\.0\.0\.1:\d+\//, { timeout: 60000 });
    await page.waitForFunction(() => window.__MIRAGINE__?.getState().ready, null, { timeout: 60000 });
    expect((await state()).muted === false, 'Fresh install unexpectedly already muted'); await hit('music');
    check((await state()).muted === true, 'first-game-input-music-off');
    await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.webContents.setAudioMuted(false); w.maximize(); w.show(); w.focus(); });
    const homeButtons = await page.evaluate(() => window.__MIRAGINE__.getHotspots().filter(item => ['single', 'dual', 'dual-ai', 'credits'].includes(item.action)).map(item => item.action));
    check(same(homeButtons.slice().sort(), ['dual', 'dual-ai', 'single']), 'homepage-replaces-credits-with-third-original-style-dual-ai-button', homeButtons);
    check(await page.locator('[data-dual-ai-controls], [data-dual-ai-panel], [data-dual-ai-difficulty]').count() === 0,
      'homepage-and-setup-have-no-modern-dom-panel-or-dropdowns');
    await screenshot('homepage');
    await hit('dual-ai'); await until(async () => (await state()).panel === 'dual-ai', 'original-style dual AI setup');
    check((await state()).dualAIOptions.applyDifficultyStats, 'homepage-default-includes-difficulty-stats');
    for (const side of SIDES) for (let value = 0; value < 4; value++) {
      const other = side === 'left' ? 'right' : 'left', before = (await state()).dualAIOptions;
      await chooseDifficultyByHotspot({ hit, side, value }); const after = (await state()).dualAIOptions;
      check(after[`${side}Difficulty`] === value && after[`${other}Difficulty`] === before[`${other}Difficulty`],
        `${side}-original-style-difficulty-${value}-is-independent`, { before, after });
    }
    await hit('dual-ai-back');
    check((await state()).phase === 'title' && (await state()).panel === 'home' && !(await state()).running, 'setup-back-does-not-start-battle');
    await start(0, 3, true);
    await pausedKeyboardAcceptance();
    for (const side of SIDES) await recruit(side, false);
    const initial = summarizeDualAI(await state()); await delay(300);
    check((await state()).frame === initial.frame && SIDES.every(side => initial.recruitment[side] === false), 'global-pause-and-independent-keyboard-recruitment-controls');
    const fit = (await state()).viewport;
    await page.mouse.click(fit.clientLeft + fit.left + 320 * fit.scale, fit.clientTop + fit.top + 250 * fit.scale);
    const zoomBefore = (await state()).customization.displayCamera.zoom;
    await withHeldKeys({ keyboard: page.keyboard, keys: ['u'], during: () => delay(400) });
    const zoomUp = (await state()).customization.displayCamera.zoom;
    await withHeldKeys({ keyboard: page.keyboard, keys: ['o'], during: () => delay(250) });
    check(zoomUp > zoomBefore && (await state()).customization.displayCamera.zoom < zoomUp && (await state()).frame === initial.frame,
      'paused-dual-ai-smooth-uo-does-not-step-logic');
    await cameraKeyboardAcceptance();
    for (const [side, id] of [['left', 14], ['right', 15]]) await hit('unit', { side, id });
    const manual = summarizeDualAI(await state());
    check(manual.selection.left[0] + manual.selection.left[1] * 8 === 14
      && manual.selection.right[0] + manual.selection.right[1] * 8 === 15, 'both-real-cards-clickable-during-global-pause', manual.selection);
    await speed(1); await pause(false); await delay(350); await pause();
    const beforeIncome = summarizeDualAI(await state());
    check(SIDES.every(side => beforeIncome.decisions[side].count === 0 && same(beforeIncome.selection[side], manual.selection[side])),
      'manual-choices-remain-until-income-not-overwritten-every-frame', beforeIncome);
    await nextDecision('first-income');
    check(SIDES.every(side => (initial.alive[side] === 1 && (beforeIncome.alive[side] === 1))), 'no-starting-troops-were-injected');
    const blocked = summarizeDualAI(await state());
    check(SIDES.every(side => blocked.selection[side][2] === 0 && blocked.alive[side] === 1 && blocked.money[side] > 0),
      'both-paused-recruitment-still-receive-income-without-spawns', blocked);
    await screenshot('paused-recruitment-after-income');

    // With real income available, enable one side at a time and observe actual
    // new soldiers. No sandbox spawn, profile edits or synthetic events.
    for (const active of ['right', 'left']) {
      const blockedSide = active === 'right' ? 'left' : 'right';
      await recruit(blockedSide, false); await recruit(active, true); await hit('unit', { side: active, id: 0 });
      const before = summarizeDualAI(await state()); await speed(1); await pause(false);
      await until(async () => (await state()).alive[active] > before.alive[active], `${active} real recruitment`, 10000); await pause();
      const after = summarizeDualAI(await state()); report.observations.push({ stage: `${active}-only-recruitment`, before, after });
      check(after.alive[active] > before.alive[active] && after.alive[blockedSide] === before.alive[blockedSide]
        && after.selection[active][2] === 1 && after.selection[blockedSide][2] === 0, `${active}-recruits-while-opponent-paused`, { before, after });
      check(after.money[active] < before.money[active], `${active}-recruitment-spends-real-money`);
      await recruit(active, false);
    }
    await nextDecision('second-income-paused-recruitment');
    const heldFlags = summarizeDualAI(await state());
    check(heldFlags.selection.left[2] === 0 && heldFlags.selection.right[2] === 0
      && heldFlags.decisions.left.count >= 2 && heldFlags.decisions.right.count >= 2, 'later-ai-thinking-cannot-resume-paused-recruitment', heldFlags);
    for (const side of SIDES) await recruit(side, true);
    check((await state()).selection.left[2] === 1 && (await state()).selection.right[2] === 1, 'space-enter-recruitment-resume-keys-both-work');
    await screenshot('independent-recruitment'); await speed(1); await pause(); await home();

    await start(3, 0, true);
    for (const side of SIDES) await recruit(side, false);
    await nextDecision('reverse-difficulties');
    await fastKeyboardAcceptance();
    await screenshot('reverse-difficulties'); await speed(1); await pause(); await home();
    await start(3, 0, false);
    for (const side of SIDES) await recruit(side, false);
    await nextDecision('strategy-only');
    check((await state()).dualAI.leftDifficulty === 3 && (await state()).dualAI.rightDifficulty === 0
      && same((await state()).dualAI.statsDifficulties, { left: 1, right: 1 }), 'strategy-only-retains-independent-ai-difficulties');
    await screenshot('strategy-only'); await speed(1); await pause(); await home();

    await hit('single'); await hit('difficulty', { value: 1 }); await finishTutorial(); await pause();
    const single = await state();
    check(single.matchMode === 'single' && single.singlePlay && single.dualAI === null, 'return-to-original-single-has-no-dual-ai-state');
    check(await page.locator('[data-dual-ai-controls], [data-dual-ai-action^="dual-ai-recruit-"]').count() === 0,
      'original-single-has-no-dual-ai-dom-controls'); await home();
    await hit('dual'); await finishTutorial(); await pause();
    const dual = await state();
    check(dual.matchMode === 'dual' && dual.singlePlay === false && dual.dualAI === null, 'return-to-original-two-player-has-no-dual-ai-state');
    check(await page.locator('[data-dual-ai-controls], [data-dual-ai-action^="dual-ai-recruit-"]').count() === 0,
      'original-two-player-has-no-dual-ai-dom-controls');
    await screenshot('original-mode-regression');
    check((await state()).customization.timing.stepHz === 30 && (await state()).config.frameRate === 30, 'all-modes-retain-original-30hz-logic');
    check(report.errors.length === 0 && !(await state()).error && (await state()).muted, 'owned-qa-remains-muted-without-runtime-errors');
    for (const name of ['config/custom.json', 'ui-helper/original-graphics.js']) {
      check(hash(path.join(directory, name)) === rows.find(row => row.name === name).sha256, `external-file-unchanged-${name}`);
    }
    report.status = 'passed';
  } catch (error) {
    report.status = 'failed'; report.failure = { name: error.name, message: error.message };
    if (page && !page.isClosed()) { try { report.failureState = await state(); } catch {} try { await screenshot('failure'); } catch {} }
  } finally {
    try { await closeOwned(); } catch (error) { report.status = 'failed'; report.cleanup.error = error.message; }
    report.cleanup.ownedApplicationsClosed = report.runs.length > 0 && report.runs.every(item => item.closed);
    report.finishedAt = new Date().toISOString(); save('finished');
  }
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parseDualAIOptions(process.argv.slice(2)), report = await verifyDualAI(options);
    console.log(JSON.stringify({ status: report.status, checks: report.checks.length, report: options.out,
      cleanup: report.cleanup, ...(report.failure ? { failure: report.failure } : {}) }, null, 2));
    if (report.status !== 'passed') process.exitCode = 1;
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
