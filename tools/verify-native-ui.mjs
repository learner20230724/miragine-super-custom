/** Independent native UI pixel oracle, NOT production gameplay or a benchmark.
 * Compare a supplied pre-optimization native view module against the current
 * view, using one isolated controller, frozen time, original exported graphics,
 * and the same synthetic background. No main module, audio or stored settings.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createDevServer } from './dev-server.mjs';
import { bounded, redact } from './verify-desktop.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

export function parseOptions(args) {
  const result = { channel: 'msedge', report: '.local/native-ui-verification.json',
    output: 'output/playwright/native-ui', maxChannelDifference: 0 };
  const seen = new Set();
  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    if (key === '--help' || key === '-h') { result.help = true; continue; }
    if (['--diagnostic', '--software-canvas', '--reverse'].includes(key)) {
      if (seen.has(key)) throw new Error(`Duplicate option: ${key}`);
      seen.add(key); result[key === '--software-canvas' ? 'softwareCanvas' : key.slice(2)] = true; continue;
    }
    if (!['--reference', '--channel', '--report', '--output', '--max-channel-difference'].includes(key)) throw new Error(`Unknown option: ${key}`);
    if (seen.has(key)) throw new Error(`Duplicate option: ${key}`);
    seen.add(key); const value = args[++i];
    if (!value || value.startsWith('--')) throw new Error(`Missing value: ${key}`);
    if (key === '--max-channel-difference') {
      if (!['0', '1'].includes(value)) throw new Error('Channel tolerance must be explicitly 0 or 1');
      result.maxChannelDifference = Number(value);
    } else result[key.slice(2)] = value;
  }
  if (!result.reference && !result.help) throw new Error('--reference is required (read-only pre-optimization native view module)');
  for (const [key, prefix] of [['report', '.local/'], ['output', 'output/playwright/']]) {
    const value = result[key].replaceAll('\\', '/');
    if (!value.startsWith(prefix) || value.length <= prefix.length || value.includes(':')
      || value.split('/').some(part => !part || part === '.' || part === '..')) throw new Error(`${key} must remain inside ${prefix}`);
    result[key] = value;
  }
  return result;
}

/** Never hides differing pixels: bounded rounding is separate from equality. */
export function compareUiPixels({ width, height, before, after, maxChannelDifference = 0 }) {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1
    || !before || !after || before.length !== width * height * 4 || after.length !== before.length
    || ![0, 1].includes(maxChannelDifference)) throw new TypeError('Expected equal RGBA buffers and an explicit tolerance of 0 or 1');
  let changedPixels = 0, changedChannels = 0, alphaChangedPixels = 0, absoluteDifference = 0;
  const maximaRGBA = [0, 0, 0, 0], firstDifferences = [];
  const bounds = { left: width, top: height, right: -1, bottom: -1 };
  let worstDifference = null, worst = 0;
  for (let offset = 0; offset < before.length; offset += 4) {
    let changed = false;
    for (let channel = 0; channel < 4; channel++) {
      const diff = Math.abs(before[offset + channel] - after[offset + channel]);
      if (diff) { changed = true; changedChannels++; }
      maximaRGBA[channel] = Math.max(maximaRGBA[channel], diff); absoluteDifference += diff;
      if (diff > worst) {
        worst = diff;
        worstDifference = { x: offset / 4 % width, y: Math.floor(offset / 4 / width), channel,
          before: Array.from(before.slice(offset, offset + 4)), after: Array.from(after.slice(offset, offset + 4)) };
      }
    }
    if (before[offset + 3] !== after[offset + 3]) alphaChangedPixels++;
    if (changed) {
      changedPixels++;
      const x = offset / 4 % width, y = Math.floor(offset / 4 / width);
      bounds.left = Math.min(bounds.left, x); bounds.top = Math.min(bounds.top, y);
      bounds.right = Math.max(bounds.right, x); bounds.bottom = Math.max(bounds.bottom, y);
      if (firstDifferences.length < 5) firstDifferences.push({ x: offset / 4 % width, y: Math.floor(offset / 4 / width),
        before: Array.from(before.slice(offset, offset + 4)), after: Array.from(after.slice(offset, offset + 4)) });
    }
  }
  return { changedPixels, changedChannels, changedFraction: changedPixels / (width * height),
    differenceBounds: changedPixels ? bounds : null, alphaChangedPixels, maximaRGBA, maxChannelDifference: worst,
    meanAbsoluteChannelDifference: absoluteDifference / before.length, firstDifferences, worstDifference,
    strictRgbaEquality: changedPixels === 0,
    withinBoundedRounding: worst <= 1 && alphaChangedPixels === 0,
    withinConfiguredTolerance: worst <= maxChannelDifference && alphaChangedPixels === 0 };
}

export async function verifyNativeUi(options, { extraChecks } = {}) {
  const { reference, channel, report, output, maxChannelDifference, diagnostic = false, softwareCanvas = false, reverse = false } = options;
  const referencePath = path.resolve(root, reference), reportPath = path.join(root, report), outputPath = path.join(root, output);
  if (fs.existsSync(reportPath) || fs.existsSync(outputPath)) throw new Error('Use fresh evidence names; existing reports and screenshots are never overwritten');
  const referenceBytes = fs.readFileSync(referencePath);
  if (!referenceBytes.includes('setRenderSize')) throw new Error('Reference must already implement native-resolution rendering');
  fs.mkdirSync(path.dirname(reportPath), { recursive: true }); fs.mkdirSync(outputPath, { recursive: true });
  let username = ''; try { username = os.userInfo().username; } catch { /* optional */ }
  const privateValues = [referencePath, root, os.homedir(), username];
  const proof = { schemaVersion: 1, status: 'running', startedAt: new Date().toISOString(),
    scope: 'Standalone synthetic UI fixtures, not production state injection, audio, performance or full-match acceptance',
    reference: { label: 'supplied pre-optimization native view', sha256: sha256(referenceBytes), bytes: referenceBytes.length },
    canvasContext: { alpha: false, allCanvasWillReadFrequently: softwareCanvas, reverseDrawOrder: reverse },
    rasterizationNote: softwareCanvas
      ? 'Every 2D context requests willReadFrequently:true; this controls the hint, not an externally certified internal browser backend.'
      : 'Default browser rasterization backend; individual draw commands or readbacks may choose GPU or software internally.',
    allowedMaxChannelDifference: maxChannelDifference,
    comparison: maxChannelDifference === 0 ? 'Strict RGBA equality' : 'Explicit RGB rounding <= 1/255; alpha, hotspots and simulation frame remain exact',
    errors: [], cases: [], screenshots: [], cleanup: {} };
  const save = progress => { proof.progress = progress; fs.writeFileSync(reportPath, `${JSON.stringify(redact(proof, privateValues), null, 2)}\n`); };
  let server, browserServer, browser;
  try {
    const files = ['src/app/view.mjs', 'src/app/controller.mjs', 'src/config/index.mjs',
      'generated/ui/original-graphics.js', 'generated/ui/layout.generated.json', 'config/defaults.generated.json', 'config/custom.json'];
    proof.sources = Object.fromEntries(files.map(file => [file, sha256(fs.readFileSync(path.join(root, file)))]));
    save('starting owned silent standalone fixture');
    server = createDevServer(root);
    await bounded(new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); }), 'UI fixture server');
    const origin = `http://127.0.0.1:${server.address().port}`;
    browserServer = await chromium.launchServer({ channel, headless: true, args: ['--mute-audio'], timeout: 60000 });
    browser = await chromium.connect(browserServer.wsEndpoint(), { timeout: 60000 });
    proof.browser = { channel, version: browser.version() };
    const context = await browser.newContext({ viewport: { width: 1280, height: 960 }, deviceScaleFactor: 1 });
    if (softwareCanvas) await context.addInitScript(() => {
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (type, attributes) {
        return original.call(this, type, type === '2d' ? { ...attributes, willReadFrequently: true } : attributes);
      };
    });
    const page = await context.newPage();
    page.on('pageerror', error => proof.errors.push({ type: 'pageerror', message: error.message }));
    page.on('console', msg => { if (msg.type() === 'error') proof.errors.push({ type: 'console', message: msg.text() }); });
    await page.route(`${origin}/__reference_native_view__.mjs`, route => route.fulfill({ contentType: 'text/javascript', body: referenceBytes }));
    await page.route(`${origin}/__native_ui_harness__.html`, route => route.fulfill({ contentType: 'text/html', body:
      '<!doctype html><meta charset="utf-8"><title>Silent standalone UI fixture</title><link rel="icon" href="data:,"><link rel="stylesheet" href="/src/style.css"><script src="/generated/ui/original-graphics.js"></script>' }));
    await page.goto(`${origin}/__native_ui_harness__.html`, { waitUntil: 'load' });
    proof.servedSources = await page.evaluate(async files => Object.fromEntries(await Promise.all(files.map(async file => {
      const response = await fetch(`/${file}`, { cache: 'no-store' }); if (!response.ok) throw new Error(`Source fetch failed: ${file}`);
      const hash = await crypto.subtle.digest('SHA-256', await response.arrayBuffer());
      return [file, Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join('')];
    }))), [...files, '__reference_native_view__.mjs']);
    for (const file of files) if (proof.servedSources[file] !== proof.sources[file]) throw new Error(`Served source mismatch: ${file}`);
    if (proof.servedSources['__reference_native_view__.mjs'] !== proof.reference.sha256) throw new Error('Reference source mismatch');
    proof.sourceBytesVerified = true;
    await page.addScriptTag({ content: `window.compareUiPixels = ${compareUiPixels.toString()};` });
    await page.evaluate(async () => {
      const [{ OriginalGameView: Before }, { OriginalGameView: After }, { GameController }, { loadConfiguration }] = await Promise.all([
        import('/__reference_native_view__.mjs'), import('/src/app/view.mjs'), import('/src/app/controller.mjs'), import('/src/config/index.mjs')]);
      const config = await loadConfiguration({ defaultsUrl: '/config/defaults.generated.json', customUrl: '/config/custom.json' });
      const layout = await (await fetch('/generated/ui/layout.generated.json')).json();
      await window.OriginalGraphics.ready; await document.fonts.load('12px OriginalYahei'); await document.fonts.ready;
      window.fixtureNow = 10000;
      Object.defineProperty(performance, 'now', { configurable: true, value: () => window.fixtureNow });
      window.uiFixture = { Before, After, GameController, config, layout };
    });
    if (extraChecks) proof.additionalFixtures = await extraChecks(page);
    for (const [width, height, full] of (diagnostic ? [[640, 480, false]] : [[640, 480, true], [1920, 1440, false]])) {
      save(`comparing native UI at ${width}x${height}`);
      const batch = await bounded(page.evaluate(({ width, height, full, tolerance, diagnostic, reverse }) => {
        const { Before, After, GameController, config, layout } = window.uiFixture;
        const views = [Before, After].map(View => { const c = document.createElement('canvas'); c.width = width; c.height = height;
          c.getContext('2d', { alpha: false }); // Same opaque display context as production main.
          return new View(c, window.OriginalGraphics, layout, config); });
        const controller = new GameController(config, { storage: null });
        controller.startMatch(true, 1); controller.action('tutorial-okay');
        const sim = controller.simulation;
        for (const view of views) {
          const minimap = view.minimap;
          view.minimap = function (...args) {
            const ctx = this.ctx, m = ctx.getTransform();
            this.fixtureMinimapState = { matrix: [m.a, m.b, m.c, m.d, m.e, m.f],
              alpha: ctx.globalAlpha, composite: ctx.globalCompositeOperation, shadowBlur: ctx.shadowBlur,
              shadowOffsetX: ctx.shadowOffsetX, shadowOffsetY: ctx.shadowOffsetY, filter: ctx.filter,
              lineWidth: ctx.lineWidth, smoothing: ctx.imageSmoothingEnabled, smoothingQuality: ctx.imageSmoothingQuality };
            return minimap.apply(this, args);
          };
        }
        // UI-only oracle: a shared deterministic backdrop makes transparent
        // composite errors visible without adding GPU terrain nondeterminism.
        const renderers = views.map(view => ({ render(snapshot, camera) {
          if (snapshot !== sim.renderSnapshot || camera !== sim.renderCamera) throw new Error('Unexpected fixture snapshot');
          const ctx = view.ctx; const gradient = ctx.createLinearGradient(0, 0, 640, 400);
          gradient.addColorStop(0, '#28547b'); gradient.addColorStop(.5, '#65862c'); gradient.addColorStop(1, '#976d36');
          ctx.fillStyle = gradient; ctx.fillRect(0, 0, 640, 400);
          ctx.fillStyle = 'rgba(255,0,80,.4)'; ctx.fillRect(55, 120, 530, 145);
          return { fixture: 'shared synthetic backdrop' };
        } }));
        const cases = [], images = [];
        function stable() { for (const v of views) { v.previousPhase = controller.phase; v.transitionStarted = -1e9;
          v.menuFrom = v.menuTarget = controller.panel === 'difficulty' ? -43 : 212; v.menuStarted = -1e9; } }
        function game() { controller.phase = 'game'; controller.panel = 'home'; controller.overlay = controller.underOverlay = null; controller.muted = false; }
        function pair(name, setup = () => {}, capture = false, stabilize = true) {
          setup(); if (stabilize) stable(); const frame = sim.frame;
          for (const v of views) v.fixtureMinimapState = null;
          for (const index of reverse ? [1, 0] : [0, 1]) views[index].render(controller, renderers[index]);
          const before = views[0].ctx.getImageData(0, 0, width, height).data;
          const after = views[1].ctx.getImageData(0, 0, width, height).data;
          const diff = window.compareUiPixels({ width, height, before, after, maxChannelDifference: tolerance });
          const hotspotsEqual = JSON.stringify(views[0].hotspots) === JSON.stringify(views[1].hotspots);
          const frameUnchanged = frame === sim.frame;
          const result = { name, width, height, ...diff, hotspotsEqual, frameUnchanged,
            pass: diff.withinConfiguredTolerance && hotspotsEqual && frameUnchanged,
            minimapContextStates: views.map(v => v.fixtureMinimapState),
            renderStats: views.map(v => v.getRenderStats()) };
          cases.push(result);
          if (capture || (!result.pass && images.length < 6)) images.push({ name,
            before: views[0].canvas.toDataURL('image/png').split(',')[1], after: views[1].canvas.toDataURL('image/png').split(',')[1] });
        }
        try {
          pair('title-home-cold', () => { controller.phase = 'title'; controller.panel = 'home'; }, true);
          if (full) {
            pair('title-home-warm'); pair('title-music-off', () => { controller.muted = true; });
            pair('title-difficulty', () => { controller.panel = 'difficulty'; }); pair('title-difficulty-warm');
            pair('title-menu-mid-slide', () => { stable(); for (const v of views) { v.menuFrom = 212; v.menuTarget = -43; v.menuStarted = window.fixtureNow - 173; } }, false, false);
            pair('title-credits', () => { controller.overlay = 'credits'; });
          }
          pair('hud-cold', () => { game(); for (const v of views) v.releaseRasterCaches(); }, true);
          if (full) {
            pair('hud-warm');
            pair('hud-numbers', () => { sim.leftMoney = 123456; sim.rightMoney = Number.MAX_SAFE_INTEGER; sim.leftIncome = 7890; sim.rightPopulation = 12345; });
            pair('hud-hp-half-quarter', () => { sim.redBoss.nowHP = sim.redBoss.maxHP / 2; sim.blueBoss.nowHP = sim.blueBoss.maxHP / 4; });
            pair('hud-hp-zero', () => { sim.redBoss.nowHP = sim.blueBoss.nowHP = 0; });
            pair('hud-hp-overheal', () => { sim.redBoss.nowHP = sim.redBoss.maxHP * 1.75; sim.blueBoss.nowHP = sim.blueBoss.maxHP * 2; });
            for (let frame = 0; frame < 10; frame++) pair(`cursor-frame-${frame}`, () => { sim.frame = frame; });
            for (let index = 0; index <= 8; index++) pair(`cursor-continuous-${index}`, () => {
              sim.frame = index + 10;
              controller.cursorPresentation = { left: { scale: 1.4 - index * .051, alpha: 1 - index * .037 },
                right: { scale: 1.013 + index * .043, alpha: .703 + index * .031 } };
            });
            pair('hud-music-off', () => { controller.muted = true; });
            pair('hud-tutorial', () => { controller.overlay = 'tutorial'; });
          }
          pair('hud-fractional-cursor-and-transparency', () => {
            game(); sim.frame = 7; controller.cursorPresentation = { left: { scale: 1.137, alpha: .831 }, right: { scale: 1.293, alpha: .917 } };
            controller.overlay = 'quit'; controller.underOverlay = 'tutorial';
          }, true);
          if (full) pair('hud-quit-only', () => { controller.underOverlay = null; });
          if (diagnostic) {
            const originalMethods = views.map(v => Object.fromEntries(['draw', 'cached', 'minimap'].map(name => [name, v[name]])));
            const isolate = (name, disabled) => {
              game(); controller.cursorPresentation = { left: { scale: 1, alpha: 1 }, right: { scale: 1, alpha: 1 } };
              views.forEach((v, index) => {
                v.releaseRasterCaches(); const original = originalMethods[index];
                v.draw = function (symbol, ...args) { if (disabled.includes('cursor') && symbol === 'sprite209') return; return original.draw.call(this, symbol, ...args); };
                v.cached = function (key, ...args) {
                  if ((disabled.includes('static') && key.startsWith('hud-')) || (disabled.includes('controls') && key === 'game-controls')) return;
                  return original.cached.call(this, key, ...args);
                };
                v.minimap = disabled.includes('minimap') ? () => {} : original.minimap;
              });
              pair(name, () => {}, true);
            };
            isolate('diagnostic-no-cursor', ['cursor']);
            isolate('diagnostic-no-minimap', ['minimap']);
            isolate('diagnostic-no-static', ['static']);
            isolate('diagnostic-no-controls', ['controls']);
            isolate('diagnostic-no-static-cursor', ['static', 'cursor']);
            isolate('diagnostic-no-static-cursor-minimap', ['static', 'cursor', 'minimap']);
            for (const target of ['sprite12', 'sprite25', 'text31']) {
              views.forEach((v, index) => {
                Object.assign(v, originalMethods[index]); v.releaseRasterCaches(); const original = originalMethods[index].draw;
                v.draw = function (symbol, options = {}, ctx) {
                  if (symbol === 'shape16' || symbol === 'sprite55') return;
                  const filter = options.filter;
                  return original.call(this, symbol, { ...options, filter: info => {
                    if (['shape16', 'sprite12', 'sprite25', 'button29', 'text31', 'shape32', 'sprite55', 'sprite74'].includes(info.symbol) && info.symbol !== target) return false;
                    return filter?.(info);
                  } }, ctx);
                };
              });
              pair(`diagnostic-title-${target}`, () => { controller.phase = 'title'; controller.panel = 'home'; }, true);
            }
          }
          return { cases, images };
        } finally { sim.stop(); for (const v of views) v.releaseRasterCaches(); }
      }, { width, height, full, tolerance: maxChannelDifference, diagnostic, reverse }), `UI pixel cases ${width}x${height}`, 600000);
      proof.cases.push(...batch.cases);
      for (const image of batch.images) for (const side of ['before', 'after']) {
        const relative = `${output}/${width}x${height}-${image.name}-${side}.png`;
        const bytes = Buffer.from(image[side], 'base64'); fs.writeFileSync(path.join(root, relative), bytes);
        proof.screenshots.push({ file: relative, sha256: sha256(bytes), bytes: bytes.length });
      }
      save(`completed ${width}x${height}`);
    }
    proof.comparisons = proof.cases.length; proof.passed = proof.cases.filter(c => c.pass).length;
    proof.worstChannelDifference = Math.max(...proof.cases.map(c => c.maxChannelDifference));
    proof.strictRgbaEquality = proof.cases.every(c => c.strictRgbaEquality);
    proof.status = proof.comparisons > 0 && proof.passed === proof.comparisons && !proof.errors.length
      && (!extraChecks || proof.additionalFixtures?.passed === true) ? 'passed' : 'failed';
  } catch (error) { proof.status = 'failed'; proof.failure = { name: error.name, message: error.message }; }
  finally {
    if (browser) try { await bounded(browser.close(), 'owned UI browser close', 8000); proof.cleanup.browserClosed = true; }
    catch (e) { proof.cleanup.browserError = e.message; proof.status = 'failed'; }
    if (browserServer) try { await bounded(browserServer.close(), 'owned UI browser server close', 8000); proof.cleanup.browserServerClosed = true; }
    catch (e) { proof.cleanup.browserServerError = e.message; proof.status = 'failed'; await browserServer.kill().catch(() => {}); }
    if (server) { server.closeAllConnections?.(); await bounded(new Promise(resolve => server.close(resolve)), 'owned UI source close'); proof.cleanup.sourceServerClosed = true; }
    proof.finishedAt = new Date().toISOString(); save(`verification ${proof.status}`);
  }
  console.log(JSON.stringify({ status: proof.status, comparisons: proof.comparisons, passed: proof.passed,
    worstChannelDifference: proof.worstChannelDifference, report, failure: redact(proof.failure, privateValues) }, null, 2));
  if (proof.status !== 'passed') process.exitCode = 1;
  return proof;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parseOptions(process.argv.slice(2));
    if (options.help) console.log('Usage: node tools/verify-native-ui.mjs --reference <pre-optimization native view.mjs> [--channel msedge] [--max-channel-difference 0|1] [--report .local/fresh.json] [--output output/playwright/fresh]');
    else await verifyNativeUi(options);
  } catch (e) { console.error(redact(e.message, [root, os.homedir()])); process.exitCode = 1; }
}
