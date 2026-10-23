/**
 * Real-browser pixel oracle for UI caching, NOT a performance benchmark.
 * Runs isolated test controllers/canvases; production main.mjs is never loaded.
 * Usage: node tools/verify-ui-cache.mjs [--url <loopback-origin>] [--channel msedge]
 *   [--max-channel-difference 0|1|2]
 * Default: temporarily serve current source on an ephemeral loopback port.
 * Strict integer RGBA equality by default. Explicit 1 permits bounded RGB
 * rounding; explicit 2 is custom numeric compositing tolerance, NOT <=1 parity.
 * Alpha, hotspots and simulation frame must remain exact under either policy.
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
const reportFile = path.join(root, '.local', 'ui-cache-pixels.json');

export function parseOptions(args) {
  const options = { channel: 'msedge', maxChannelDifference: 0 };
  for (let index = 0; index < args.length; index++) {
    const key = args[index];
    if (key === '--help' || key === '-h') { options.help = true; continue; }
    if (!['--url', '--channel', '--max-channel-difference'].includes(key)) throw new Error(`Unknown option: ${key}`);
    const value = args[++index];
    if (!value || value.startsWith('--')) throw new Error(`Missing value: ${key}`);
    if (key === '--max-channel-difference') {
      if (!['0', '1', '2'].includes(value)) throw new Error('--max-channel-difference must be exactly 0, 1 or 2');
      options.maxChannelDifference = Number(value);
    } else options[key.slice(2)] = value;
  }
  if (options.url) {
    const url = new URL(options.url);
    if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(url.hostname)
      || url.username || url.password) throw new Error('--url must be an unauthenticated HTTP loopback origin');
    options.url = url.origin;
  }
  return options;
}

export function comparisonDescription(maxChannelDifference) {
  if (![0, 1, 2].includes(maxChannelDifference)) throw new Error('maxChannelDifference must be 0, 1 or 2');
  if (maxChannelDifference === 0) return 'Strict RGBA equality';
  if (maxChannelDifference === 1) return 'Explicit bounded RGB rounding at most 1/255; exact alpha, hotspots and simulation frame required';
  return 'custom numeric compositing tolerance: RGB difference at most 2/255; exact alpha, hotspots and simulation frame required; not strict RGBA identity or <=1 bounded rounding';
}

export async function verifyUiCache({ url, channel = 'msedge', maxChannelDifference = 0 } = {}) {
  const comparison = comparisonDescription(maxChannelDifference);
  fs.mkdirSync(path.dirname(reportFile), { recursive: true });
  let username = '';
  try { username = os.userInfo().username; } catch { /* Optional OS metadata. */ }
  const privateValues = [root, os.homedir(), username];
  const proof = { schemaVersion: 1, status: 'running', startedAt: new Date().toISOString(),
    command: ['node', 'tools/verify-ui-cache.mjs', ...(url ? ['--url', url] : []), '--channel', channel,
      '--max-channel-difference', String(maxChannelDifference)],
    allowedMaxChannelDifference: maxChannelDifference,
    comparison,
    scope: 'Independent pixel-only run, not benchmark timing or full-match victory proof', errors: [], cleanup: {} };
  const save = stage => {
    if (stage) proof.progress = stage;
    fs.writeFileSync(reportFile, `${JSON.stringify(redact(proof, privateValues), null, 2)}\n`);
  };
  let server;
  let browserServer;
  let browser;
  try {
    save('starting isolated same-origin pixel harness');
    if (!url) {
      server = createDevServer(root);
      await bounded(new Promise((resolve, reject) => {
        server.once('error', reject); server.listen(0, '127.0.0.1', resolve);
      }), 'source harness server');
      url = `http://127.0.0.1:${server.address().port}`;
    }
    proof.origin = url;
    proof.sources = Object.fromEntries(['src/app/view.mjs', 'src/app/controller.mjs',
      'src/render/battlefield.mjs', 'src/render/view-camera.mjs', 'src/render/projection.mjs',
      'src/render/ground-webgl.mjs', 'src/render/ground-layer-cache.mjs', 'src/render/overview-ground.mjs',
      'generated/ui/original-graphics.js', 'generated/ui/layout.generated.json', 'config/defaults.generated.json']
      .map(file => [file, createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex')]));
    browserServer = await chromium.launchServer({ channel, headless: true, timeout: 60000 });
    browser = await chromium.connect(browserServer.wsEndpoint(), { timeout: 60000 });
    proof.browser = { channel, version: browser.version() };
    const context = await browser.newContext({ viewport: { width: 640, height: 480 }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    page.on('pageerror', error => proof.errors.push({ type: 'pageerror', message: error.message }));
    page.on('console', message => {
      if (message.type() === 'error') proof.errors.push({ type: 'console', message: message.text() });
    });
    const harness = `${url}/__ui_cache_harness__.html`;
    await page.route(harness, route => route.fulfill({ contentType: 'text/html', body: `<!doctype html>
<meta charset="utf-8"><title>Isolated UI pixel oracle</title>
<link rel="stylesheet" href="/src/style.css"><script src="/generated/ui/original-graphics.js"></script>` }));
    await page.goto(harness, { waitUntil: 'load', timeout: 60000 });
    // --url must not attribute an old loopback server's output to new local
    // source hashes. Fetch through the same fresh browser origin, not a second
    // unrelated HTTP client, and reject any mismatched source before drawing.
    proof.servedSources = await bounded(page.evaluate(async files => {
      const entries = await Promise.all(files.map(async file => {
        const response = await fetch(`/${file}`, { cache: 'no-store' });
        if (!response.ok) throw new Error(`Source verification request failed: ${file}`);
        const hash = await crypto.subtle.digest('SHA-256', await response.arrayBuffer());
        return [file, Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('')];
      }));
      return Object.fromEntries(entries);
    }, Object.keys(proof.sources)), 'browser-served source byte verification', 30000);
    for (const [file, hash] of Object.entries(proof.sources)) {
      if (proof.servedSources[file] !== hash) throw new Error(`Browser-served source differs from local evidence: ${file}`);
    }
    proof.sourceBytesVerified = true;
    save('drawing paired controlled scenarios; pixel reads occur only after each completed pair');
    proof.result = await bounded(page.evaluate(async ({ allowedMaxChannelDifference }) => {
      const [{ OriginalGameView }, { GameController }, { loadConfiguration }, { BattlefieldRenderer }] = await Promise.all([
        import('/src/app/view.mjs'), import('/src/app/controller.mjs'),
        import('/src/config/index.mjs'), import('/src/render/battlefield.mjs'),
      ]);
      const json = async file => {
        const response = await fetch(file, { cache: 'no-store' });
        if (!response.ok) throw new Error(`Pixel fixture resource failed: ${file}`);
        return response.json();
      };
      const [config, layout, manifest] = await Promise.all([
        loadConfiguration({ defaultsUrl: '/config/defaults.generated.json', customUrl: '/config/custom.json' }),
        json('/generated/ui/layout.generated.json'), json('/generated/asset-manifest.json'),
      ]);
      await window.OriginalGraphics.ready;
      await document.fonts.load('12px OriginalYahei');
      await document.fonts.ready;
      const canvases = [0, 1].map(() => {
        const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 480; return canvas;
      });
      const [cached, direct] = canvases.map(canvas => new OriginalGameView(canvas, window.OriginalGraphics, layout, config));
      function makeDirect(view) {
        const originalCached = view.cached.bind(view);
        view.cached = function (key, draw) {
          // These two caches and the clipped title strip predate this optimization.
          if (key === 'hud' || key.startsWith('title-background:')) return originalCached(key, draw);
          return draw(this.ctx);
        };
        // Bar/number layers return a canvas and their callers drawImage it.
        // Draw each callback directly once, then suppress ONLY its marker:
        // never redraw the whole stage or compare two equally cached counters.
        const layerMarker = Object.freeze({ testOnlyAlreadyDrawnLayer: true });
        view.testDirectDraws = { bars: 0, numbers: 0 };
        const nativeDrawImage = view.ctx.drawImage.bind(view.ctx);
        view.ctx.drawImage = function (image, ...args) {
          if (image === layerMarker) return;
          return nativeDrawImage(image, ...args);
        };
        view.barLayer = function (_name, _ratio, draw) {
          this.testDirectDraws.bars++; draw(this.ctx); return layerMarker;
        };
        view.numberLayer = function (_name, _revision, draw) {
          this.testDirectDraws.numbers++; draw(this.ctx); return layerMarker;
        };
        const originalTooltipLayout = view.tooltipLayout.bind(view);
        view.tooltipLayout = function (id, unit, ctx) {
          this.tooltipLayouts.delete(id);
          return originalTooltipLayout(id, unit, ctx);
        };
      }
      makeDirect(direct);
      const loadedImages = new Map();
      const imageLoader = (url, record) => {
        if (!loadedImages.has(url)) loadedImages.set(url, new Promise((resolve, reject) => {
          const image = new Image(); image.onload = () => resolve(image);
          image.onerror = () => reject(new Error(`Original pixel fixture image failed: ${record.file}`)); image.src = url;
        }));
        return loadedImages.get(url);
      };
      const renderers = [cached, direct].map(view => new BattlefieldRenderer(view.ctx, manifest, { imageLoader }));
      await Promise.all(renderers.map(renderer => renderer.load()));
      // This is a separate test controller, never the production page controller.
      const controller = new GameController(config, { storage: null });
      controller.startMatch(true, 1); controller.action('tutorial-okay');
      for (let index = 0; index < 180; index++) controller.tick(index * 1000 / 30);
      const sim = controller.simulation;
      const originalHp = [sim.redBoss.nowHP, sim.blueBoss.nowHP];
      const cases = [];
      const stable = view => {
        view.previousPhase = controller.phase;
        view.transitionStarted = -1e9; // Disable only external transition tint.
        view.menuFrom = view.menuTarget = controller.panel === 'difficulty' ? -43 : 212;
        view.menuStarted = -1e9;
      };
      const resetGame = () => {
        controller.phase = 'game'; controller.panel = 'home'; controller.overlay = null; controller.underOverlay = null;
        controller.singlePlay = true; controller.muted = false; sim.winner = null;
        cached.pointer = direct.pointer = null;
      };
      const pointer = (side, id) => {
        const bounds = cached.instance(210, `${side === 'left' ? 'a' : 'b'}${id}`).bounds;
        cached.pointer = direct.pointer = { x: (bounds.xMin + bounds.xMax) / 2, y: (bounds.yMin + bounds.yMax) / 2 };
      };
      function compare(name, setup = () => {}) {
        setup(); const beforeFrame = sim.frame;
        const views = [cached, direct];
        for (let index = 0; index < 2; index++) { stable(views[index]); views[index].render(controller, renderers[index]); }
        // No readback inside animation/performance benchmarks: this standalone
        // oracle reads completed paired outputs only, after both draws finish.
        const actual = cached.ctx.getImageData(0, 0, 640, 480).data;
        const reference = direct.ctx.getImageData(0, 0, 640, 480).data;
        let changedPixels = 0, changedChannels = 0, alphaChangedPixels = 0, maxChannelDifference = 0;
        const maxima = [0, 0, 0, 0], firstDifferences = [];
        let worstDifference = null;
        for (let offset = 0; offset < actual.length; offset += 4) {
          let changed = false;
          for (let channel = 0; channel < 4; channel++) {
            const difference = Math.abs(actual[offset + channel] - reference[offset + channel]);
            if (difference) { changed = true; changedChannels++; }
            maxima[channel] = Math.max(maxima[channel], difference);
            if (difference > maxChannelDifference) {
              maxChannelDifference = difference;
              worstDifference = { x: offset / 4 % 640, y: Math.floor(offset / 4 / 640), channel,
                cached: Array.from(actual.slice(offset, offset + 4)), direct: Array.from(reference.slice(offset, offset + 4)) };
            }
          }
          if (actual[offset + 3] !== reference[offset + 3]) alphaChangedPixels++;
          if (changed) {
            changedPixels++;
            if (firstDifferences.length < 5) firstDifferences.push({ x: offset / 4 % 640, y: Math.floor(offset / 4 / 640),
              cached: Array.from(actual.slice(offset, offset + 4)), direct: Array.from(reference.slice(offset, offset + 4)) });
          }
        }
        const hotspotsEqual = JSON.stringify(cached.hotspots) === JSON.stringify(direct.hotspots);
        const frameUnchanged = beforeFrame === sim.frame;
        const exactInvariants = alphaChangedPixels === 0 && hotspotsEqual && frameUnchanged;
        const strictRgbaEquality = changedPixels === 0;
        const withinBoundedRounding = maxChannelDifference <= 1 && exactInvariants;
        const withinConfiguredTolerance = maxChannelDifference <= allowedMaxChannelDifference && exactInvariants;
        cases.push({ name, changedPixels, changedChannels, alphaChangedPixels, maxChannelDifference,
          maximaRGBA: maxima, firstDifferences, worstDifference, hotspotsEqual, frameUnchanged,
          strictRgbaEquality, withinBoundedRounding, withinConfiguredTolerance,
          contextStates: views.map(view => ({ alpha: view.ctx.globalAlpha, composite: view.ctx.globalCompositeOperation,
            matrix: [view.ctx.getTransform().a, view.ctx.getTransform().b, view.ctx.getTransform().c,
              view.ctx.getTransform().d, view.ctx.getTransform().e, view.ctx.getTransform().f] })),
          pass: withinConfiguredTolerance });
      }
      try {
        resetGame(); compare('HUD static cold'); compare('HUD static warm');
        compare('HUD health changed', () => { sim.redBoss.nowHP = sim.redBoss.maxHP * .5; sim.blueBoss.nowHP = sim.blueBoss.maxHP * .25; });
        compare('HUD health unchanged cached');
        compare('HUD health zero', () => { sim.redBoss.nowHP = sim.blueBoss.nowHP = 0; });
        compare('HUD above-max original healing quirk', () => { sim.redBoss.nowHP = sim.redBoss.maxHP * 1.75; sim.blueBoss.nowHP = sim.blueBoss.maxHP * 2; });
        compare('HUD health restored', () => { [sim.redBoss.nowHP, sim.blueBoss.nowHP] = originalHp; });
        compare('HUD tutorial cold', () => { controller.overlay = 'tutorial'; }); compare('HUD tutorial warm');
        compare('HUD quit above tutorial', () => { controller.overlay = 'quit'; controller.underOverlay = 'tutorial'; });
        compare('HUD quit only', () => { controller.underOverlay = null; });
        compare('HUD local dual and muted', () => { resetGame(); controller.singlePlay = false; controller.muted = true; });
        compare('HUD hover left tooltip cold', () => { resetGame(); pointer('left', 0); });
        compare('HUD hover left tooltip warm');
        compare('HUD hover right wrapped tooltip', () => pointer('right', 15));
        compare('HUD hover another left tooltip', () => pointer('left', 12));
        compare('title credits cold', () => { controller.phase = 'title'; controller.overlay = 'credits'; cached.pointer = direct.pointer = null; });
        compare('title credits warm');
        compare('results left cold', () => { controller.phase = 'over'; controller.overlay = null; sim.winner = 'left'; });
        compare('results left warm');
        compare('results right cold', () => { sim.winner = 'right'; }); compare('results right warm');
        compare('results left cache revisited', () => { sim.winner = 'left'; });
        return { width: 640, height: 480, cases, comparisons: cases.length,
          passed: cases.filter(value => value.pass).length,
          strictRgbaEquality: cases.every(value => value.strictRgbaEquality),
          allStrictlyEqual: cases.every(value => value.strictRgbaEquality && value.hotspotsEqual && value.frameUnchanged),
          allWithinBoundedRounding: cases.every(value => value.withinBoundedRounding),
          allWithinConfiguredTolerance: cases.every(value => value.withinConfiguredTolerance),
          alphaUnchanged: cases.every(value => value.alphaChangedPixels === 0),
          hotspotsEqual: cases.every(value => value.hotspotsEqual),
          frameUnchanged: cases.every(value => value.frameUnchanged),
          worstChannelDifference: Math.max(...cases.map(value => value.maxChannelDifference)),
          cacheSizes: { static: cached.cache.size, bars: Object.keys(cached.barLayers).length,
            numbers: Object.keys(cached.numberLayers).length, tooltips: cached.tooltipLayouts.size },
          directReference: { callbackDraws: direct.testDirectDraws,
            numberCacheSlots: Object.keys(direct.numberLayers).length, barCacheSlots: Object.keys(direct.barLayers).length },
          baseline: 'New UI caches bypassed; pre-existing HUD/title-background/clipped-strip caches retained; direct bar and numeric vector/shadow callbacks each execute exactly once without a cached-layer composite',
          fixtures: 'Isolated UI state fixtures, including synthetic results/HP values; not proof of an organically won match' };
      } finally { for (const renderer of renderers) renderer.dispose(); }
    }, { allowedMaxChannelDifference: maxChannelDifference }), 'paired browser UI pixel comparisons', 180000);
    proof.strictRgbaEquality = proof.result.strictRgbaEquality;
    proof.status = proof.result.comparisons === 23 && proof.result.passed === 23 && proof.errors.length === 0 ? 'passed' : 'failed';
  } catch (error) {
    proof.status = 'failed'; proof.failure = { name: error.name, message: error.message };
  } finally {
    if (browser) {
      try { await bounded(browser.close(), 'owned pixel-test browser close', 8000); proof.cleanup.browserClosed = true; }
      catch (error) { proof.cleanup.browserError = error.message; proof.status = 'failed'; }
    }
    if (browserServer) {
      try { await bounded(browserServer.close(), 'owned browser server close', 8000); proof.cleanup.browserServerClosed = true; }
      catch (error) {
        proof.cleanup.browserServerError = error.message; proof.status = 'failed';
        try { await bounded(browserServer.kill(), 'owned browser server termination', 5000); proof.cleanup.ownedBrowserTerminated = true; }
        catch (terminationError) { proof.cleanup.terminationError = terminationError.message; }
      }
    }
    if (server) { server.closeAllConnections?.(); await bounded(new Promise(resolve => server.close(resolve)), 'own source server close'); proof.cleanup.sourceServerClosed = true; }
    proof.finishedAt = new Date().toISOString(); save(`verification ${proof.status}`);
  }
  const safe = redact(proof, privateValues);
  console.log(JSON.stringify({ status: safe.status, comparisons: safe.result?.comparisons,
    passed: safe.result?.passed, allowedMaxChannelDifference: safe.allowedMaxChannelDifference,
    strictRgbaEquality: safe.strictRgbaEquality, allWithinBoundedRounding: safe.result?.allWithinBoundedRounding,
    allWithinConfiguredTolerance: safe.result?.allWithinConfiguredTolerance,
    worstChannelDifference: safe.result?.worstChannelDifference,
    report: '.local/ui-cache-pixels.json', ...(safe.failure ? { failure: safe.failure } : {}) }, null, 2));
  if (safe.status !== 'passed') process.exitCode = 1;
  return safe;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parseOptions(process.argv.slice(2));
    if (options.help) console.log('Usage: node tools/verify-ui-cache.mjs [--url <loopback-origin>] [--channel msedge] [--max-channel-difference 0|1|2] (default: strict 0; explicit 2: custom numeric compositing tolerance)');
    else await verifyUiCache(options);
  } catch (error) {
    console.error(redact(error.message, [root, os.homedir()])); process.exitCode = 1;
  }
}
