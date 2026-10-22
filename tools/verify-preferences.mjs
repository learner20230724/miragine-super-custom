/**
 * Two real portable-EXE launches verify the tutorial SharedObject replacement.
 * Usage: node tools/verify-preferences.mjs --exe <isolated-custom-EXE> --report <proof.json>
 *
 * Requires the caller's isolated cost=7 / hp=99 / startingIncome=777 fixture.
 * Never run this on the default release. No fixture reset, localStorage write,
 * preload-bridge invocation, simulation mutation, or forced result is used.
 * Only clicking the actual tutorial-never hotspot persists the preference.
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
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));

export function parseOptions(args) {
  const result = {};
  for (let index = 0; index < args.length; index += 1) {
    const option = args[index];
    if (option === '--help' || option === '-h') { result.help = true; continue; }
    if (option !== '--exe' && option !== '--report') throw new Error(`Unknown option: ${option}`);
    const value = args[++index];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${option}`);
    const key = option.slice(2);
    if (result[key]) throw new Error(`${option} may be supplied only once`);
    result[key] = value;
  }
  if (!result.help && (!result.exe || !result.report)) throw new Error('--exe and --report are required');
  return result;
}

async function until(probe, description, timeout = 12000) {
  const deadline = Date.now() + timeout;
  do {
    const value = await bounded(Promise.resolve().then(probe), description, Math.min(10000, timeout));
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
    launcher.kill('SIGKILL');
    return 'owned-launcher-handle';
  }
  if (Number.isInteger(verifiedPid) && verifiedPid > 0 && verifiedPid !== process.pid) {
    process.kill(verifiedPid, 'SIGKILL');
    return 'verified-owned-application-pid';
  }
  throw new Error('No live owned launcher or verified app PID is available for cleanup');
}

export async function verifyPreferences({ exe, report: destination }) {
  const executable = path.resolve(exe);
  const directory = path.dirname(executable);
  const reportFile = path.resolve(destination);
  const reportRelative = path.relative(directory, reportFile);
  if (!path.isAbsolute(reportRelative) && reportRelative !== '..' && !reportRelative.startsWith(`..${path.sep}`)) {
    throw new Error('The proof report must be outside the portable fixture directory');
  }
  const customFile = path.join(directory, 'config', 'custom.json');
  const helperFile = path.join(directory, 'ui-helper', 'original-graphics.js');
  const preferenceFile = path.join(directory, 'userdata', 'preferences.json');
  let username = '';
  try { username = os.userInfo().username; } catch { /* Optional OS metadata. */ }
  const privateValues = [directory, executable, reportFile, root, os.homedir(), username];
  const proof = {
    schemaVersion: 1, status: 'running', startedAt: new Date().toISOString(), checks: [], runs: [],
    scope: 'Two separate packaged EXE processes; private loopback ports may differ between launches',
    inputPolicy: 'Only actual mapped pointer hotspots; read-only inspection; no direct preference IPC or state mutation',
  };
  fs.mkdirSync(path.dirname(reportFile), { recursive: true });
  const save = stage => {
    if (stage) proof.progress = { stage, at: new Date().toISOString() };
    fs.writeFileSync(reportFile, `${JSON.stringify(redact(proof, privateValues), null, 2)}\n`);
  };
  const check = (condition, name, details) => {
    proof.checks.push({ name, passed: Boolean(condition), ...(details === undefined ? {} : { details }) });
    save(name);
    if (!condition) throw new Error(`Preference verification failed: ${name}`);
  };
  let configurationHash;
  let helperHash;

  async function launchRound(number) {
    const run = { number, status: 'running', errors: [], actions: [], cleanup: { ownedApplicationClosed: false } };
    proof.runs.push(run);
    let app;
    let page;
    let launcher;
    let verifiedPid;
    const state = () => bounded(page.evaluate(() => window.__MIRAGINE__.getState()), 'read-only game state');
    const hit = async (action, matches = {}) => {
      let previous;
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
      }, `stable hotspot ${action}`);
      const { hotspot, viewport } = target;
      await bounded(page.mouse.click(
        viewport.clientLeft + viewport.left + (hotspot.left + hotspot.right) * 0.5 * viewport.scale,
        viewport.clientTop + viewport.top + (hotspot.top + hotspot.bottom) * 0.5 * viewport.scale,
      ), `actual pointer click ${action}`);
      run.actions.push({ action, ...matches, backend: 'mapped Playwright pointer input' });
      save(`launch ${number}: clicked ${action}`);
      await delay(150);
    };
    try {
      save(`launch ${number}: starting the isolated portable EXE`);
      const env = { ...process.env };
      delete env.ELECTRON_RUN_AS_NODE;
      app = await _electron.launch({ executablePath: executable, args: [], cwd: directory, env, timeout: 60000,
        artifactsDir: path.join(root, '.local', `preferences-automation-${number}`) });
      launcher = app.process();
      run.launcher = { executable: path.basename(launcher.spawnfile) };
      app.on('console', message => {
        if (message.type() === 'error') run.errors.push({ type: 'main-console', message: message.text() });
      });
      const identity = await bounded(app.evaluate(({ app }) => ({
        executable: process.execPath, pid: process.pid, packaged: app.isPackaged,
        asar: /[/\\]app\.asar$/.test(app.getAppPath()), version: app.getVersion(),
      })), 'actual portable application identity');
      check(fs.realpathSync(identity.executable).toLowerCase() === fs.realpathSync(executable).toLowerCase()
        && identity.packaged && identity.asar, `launch ${number}: actual EXE runs packaged app.asar`);
      verifiedPid = identity.pid;
      run.application = { executable: path.basename(executable), packaged: true, archive: 'app.asar', version: identity.version };
      const observed = new WeakSet();
      const attach = candidate => {
        if (observed.has(candidate)) return;
        observed.add(candidate);
        candidate.on('pageerror', error => run.errors.push({ type: 'pageerror', message: error.message }));
        candidate.on('console', message => {
          if (message.type() === 'error') run.errors.push({ type: 'console', message: message.text() });
        });
      };
      app.context().on('page', attach);
      for (const candidate of app.context().pages()) attach(candidate);
      page = await app.firstWindow({ timeout: 60000 });
      attach(page);
      await page.waitForURL(/^http:\/\/127\.0\.0\.1:\d+\//, { timeout: 60000 });
      run.origin = new URL(page.url()).origin;
      await page.waitForFunction(() => window.__MIRAGINE__?.getState().ready, null, { timeout: 60000 });
      let current = await state();
      check(current.ready && current.phase === 'title' && current.panel === 'home', `launch ${number}: original title menu is ready`);
      check(current.config.firstUnitCost === 7 && current.config.firstUnitHp === 99 && current.config.startingIncome === 777,
        `launch ${number}: the isolated custom fixture is actually active`);
      check(await bounded(page.evaluate(() => typeof window.miragineDesktop?.loadPreferences === 'function'
        && typeof window.miragineDesktop?.saveNeverTutorial === 'function'), 'read-only bridge inspection'),
      `launch ${number}: the sandboxed desktop preferences bridge exists`);
      await hit('single');
      await page.waitForFunction(() => window.__MIRAGINE__.getState().panel === 'difficulty', null, { timeout: 10000 });
      await hit('difficulty', { value: 1 });
      await page.waitForFunction(() => window.__MIRAGINE__.getState().phase === 'game', null, { timeout: 10000 });
      current = await state();
      check(current.singlePlay && current.difficulty === 1, `launch ${number}: normal single-player starts through actual UI`);
      if (number === 1) {
        check(current.overlay === 'tutorial' && current.stopTimer, 'first launch: untouched fixture shows the original tutorial');
        await hit('tutorial-never');
        await until(async () => {
          const value = await state();
          return value.phase === 'game' && value.overlay === null && value.stopTimer === false;
        }, 'tutorial-never closes the help panel');
        check(true, 'first launch: tutorial-never closes help and releases the round clock');
        const persisted = await until(() => {
          try {
            const value = readJson(preferenceFile);
            return value.schemaVersion === 1 && value.neverTutorial === true ? value : false;
          } catch { return false; }
        }, 'portable schemaVersion 1 tutorial preference file');
        proof.persistedPreference = { schemaVersion: persisted.schemaVersion, neverTutorial: persisted.neverTutorial,
          location: 'userdata/preferences.json' };
        check(true, 'first launch: the real UI writes schemaVersion 1 / neverTutorial true beside the EXE');
      } else {
        check(current.overlay === null && current.stopTimer === false, 'second launch: persisted preference suppresses the initial tutorial');
        const frame = current.frame;
        await page.waitForFunction(initial => {
          const value = window.__MIRAGINE__.getState();
          return value.frame >= initial + 60;
        }, frame, { timeout: 12000 });
        current = await state();
        check(current.overlay === null && current.stopTimer === false && current.frame >= frame + 60,
          'second launch: tutorial remains absent over 60 natural simulation frames');
      }
      current = await state();
      run.final = { ready: current.ready, phase: current.phase, overlay: current.overlay,
        stopTimer: current.stopTimer, frame: current.frame, config: current.config };
      check(current.ready && !current.error && run.errors.length === 0, `launch ${number}: no runtime errors`);
      run.status = 'passed';
    } catch (error) {
      run.status = 'failed';
      run.failure = { name: error.name, message: error.message };
      throw error;
    } finally {
      if (app) {
        save(`launch ${number}: closing only the owned app`);
        const closing = app.close();
        try {
          await bounded(closing, 'owned application graceful close', 8000);
          run.cleanup.ownedApplicationClosed = true;
        } catch (error) {
          run.status = 'failed';
          run.cleanup.closeError = error.message;
          try {
            run.cleanup.termination = await terminateOwned(launcher, verifiedPid);
            try { await bounded(closing, 'owned application disconnect', 1500); }
            catch { /* Forced cleanup is already a failed gate. */ }
          } catch (terminationError) { run.cleanup.terminationError = terminationError.message; }
        }
      }
      if (run.errors.length > 0) run.status = 'failed';
      save(`launch ${number}: ${run.status}`);
    }
    check(run.status === 'passed' && run.cleanup.ownedApplicationClosed,
      `launch ${number}: owned app closes cleanly before the next independent launch`);
  }

  try {
    save('checking the caller-prepared isolated custom fixture');
    check(fs.statSync(executable).isFile() && fs.statSync(path.join(directory, 'resources', 'app.asar')).isFile(),
      'a real portable EXE and packaged app.asar exist');
    const overrides = readJson(customFile).overrides;
    check(overrides?.units?.['0']?.cost === 7 && overrides?.units?.['0']?.hp === 99
      && overrides?.rules?.startingIncome === 777, 'fixture guard rejects default and non-custom release directories');
    let initial = null;
    if (fs.existsSync(preferenceFile)) initial = readJson(preferenceFile);
    check(initial?.neverTutorial !== true, 'fixture starts without neverTutorial true; no existing preference is reset');
    configurationHash = hash(customFile);
    helperHash = hash(helperFile);
    proof.fixture = { configurationSha256: configurationHash, drawingHelperSha256: helperHash,
      initialPreferencePresent: initial !== null };
    proof.executableSha256 = hash(executable);
    await launchRound(1);
    const afterFirst = readJson(preferenceFile);
    check(afterFirst.schemaVersion === 1 && afterFirst.neverTutorial === true, 'preference survives complete shutdown of the first EXE');
    await launchRound(2);
    check(proof.runs.length === 2 && proof.runs.every(run => run.status === 'passed' && run.cleanup.ownedApplicationClosed),
      'two independent packaged application launches and shutdowns pass');
    proof.portsChanged = proof.runs[0].origin !== proof.runs[1].origin;
    check(hash(customFile) === configurationHash && hash(helperFile) === helperHash,
      'custom game configuration and replaceable drawing helper remain byte-identical');
    proof.status = 'passed';
  } catch (error) {
    proof.status = 'failed';
    proof.failure = { name: error.name, message: error.message };
  } finally {
    proof.finishedAt = new Date().toISOString();
    save(`verification ${proof.status}`);
  }
  const safe = redact(proof, privateValues);
  console.log(JSON.stringify({ status: safe.status, launches: safe.runs.length, checks: safe.checks.length,
    report: redact(path.basename(reportFile), privateValues), ...(safe.failure ? { failure: safe.failure } : {}) }, null, 2));
  if (safe.status !== 'passed') process.exitCode = 1;
  return safe;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parseOptions(process.argv.slice(2));
    if (options.help) console.log('Usage: node tools/verify-preferences.mjs --exe <isolated-custom-EXE> --report <proof.json>');
    else await verifyPreferences(options);
  } catch (error) {
    let username = '';
    try { username = os.userInfo().username; } catch { /* Optional OS metadata. */ }
    console.error(redact(error.message, [root, os.homedir(), username]));
    process.exitCode = 1;
  }
}
