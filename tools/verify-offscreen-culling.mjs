/**
 * Headless, silent original-PNG renderer fixtures. No production main module,
 * game simulation, preferences or audio are loaded. Pixel readback is a
 * fidelity check, not a claim about live game FPS or Flash pixel parity.
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
const sha256 = data => createHash('sha256').update(data).digest('hex');

export function parseOptions(args) {
  const options = { channel: 'msedge', report: '.local/offscreen-culling-verification.json' };
  const seen = new Set();
  for (let i = 0; i < args.length; i++) {
    const name = args[i];
    if (name === '--help' || name === '-h') { options.help = true; continue; }
    if (!['--channel', '--report'].includes(name) || seen.has(name)) throw new Error(`Unknown or repeated option: ${name}`);
    seen.add(name);
    const value = args[++i];
    if (!value || value.startsWith('--')) throw new Error(`Missing value: ${name}`);
    options[name.slice(2)] = value;
  }
  options.report = options.report.replaceAll('\\', '/');
  if (!options.report.startsWith('.local/') || !options.report.endsWith('.json') || options.report.includes(':')
    || options.report.split('/').some(part => !part || part === '..' || part === '.')) {
    throw new Error('report must be a JSON file inside .local/');
  }
  return options;
}

/** Self-contained local fixture, also callable by an existing owned browser. */
export async function cullingBrowserFixture() {
  const [{ BattlefieldRenderer }, { spriteSourcePlacement }] = await Promise.all([
    import('/src/render/battlefield.mjs'), import('/src/render/sprite-source.mjs'),
  ]);
  const manifest = await (await fetch('/generated/asset-manifest.json')).json();
  const effects = await (await fetch('/generated/source-effects.json')).json();
  const camera = Object.freeze({ x: 2250, y: 400, width: 640, height: 400 });
  const expect = (condition, message) => { if (!condition) throw new Error(message); };
  const hash = async bytes => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
  const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
  const canvasFactory = (width, height) => {
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
    canvas.getContext('2d', { willReadFrequently: true }); return canvas;
  };
  const images = new Map();
  const imageLoader = (url, record) => {
    if (!images.has(record.file)) images.set(record.file, new Promise((resolve, reject) => {
      const image = new Image(); image.onload = () => resolve(image);
      image.onerror = () => reject(new Error(`Fixture image failed: ${record.file}`)); image.src = url;
    }));
    return images.get(record.file);
  };
  const originalSpriteFiles = new Set([
    ...Object.values(manifest.sprites).flatMap(sprite => sprite.frames.map(frame => frame.file)),
    ...Object.values(effects.sprites).flatMap(frames => Object.values(frames).map(frame => frame.file).filter(Boolean)),
  ]);
  const holders = [], cases = [], benchmarks = [];
  const makeRenderer = mode => {
    const canvas = canvasFactory(640, 400), ctx = canvas.getContext('2d');
    const ground = canvasFactory(640, 400);
    const backend = { setRenderScale(x, y) {
      ground.width = Math.ceil(640 * x); ground.height = Math.ceil(400 * y);
      const context = ground.getContext('2d'); context.fillStyle = '#304027'; context.fillRect(0, 0, ground.width, ground.height);
    }, draw: () => ground };
    const renderer = new BattlefieldRenderer(canvas, manifest, { imageLoader, canvasFactory,
      groundRenderer: backend, groundTiles: [], spriteRasterMode: mode, sourceFrames: effects.sprites });
    const holder = { canvas, ctx, renderer, commands: [], tracing: true };
    const drawImage = ctx.drawImage;
    ctx.drawImage = function(image, ...args) {
      if (holder.tracing) {
        let file = image instanceof HTMLImageElement ? new URL(image.src).pathname.slice(1) : null;
        if (!file) for (const [key, surface] of renderer.surfaces) if (surface.surface === image) { file = `legacy:${key}`; break; }
        if (file && (file.startsWith('legacy:') || originalSpriteFiles.has(file))) {
          const matrix = this.getTransform();
          holder.commands.push({ file, args, transform: [matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f],
            smoothing: this.imageSmoothingEnabled });
        }
      }
      return drawImage.call(this, image, ...args);
    };
    holders.push(holder); return holder;
  };
  const unit = (x, y, zoom, extra = {}) => ({ uid: `${x}/${y}`, kind: 'unit', side: 'left', spriteIndex: 0,
    action: 'idle', displayFrame: 1, visible: true, px: camera.x + (x - 320) / zoom,
    py: camera.y, pz: (200 - y) / zoom, sx: 1, sy: 1, ...extra });
  const bounds = (key, mode) => {
    const sprite = manifest.sprites[key];
    if (mode === 'source') return spriteSourcePlacement(sprite, sprite.frames[0]);
    return { x: sprite.rasterized.offX, y: sprite.rasterized.offY, width: sprite.rasterized.width, height: sprite.rasterized.height };
  };
  const snapshotFor = (mode, zoom, scene) => {
    const box = bounds('A0_idle', mode);
    const partialLeft = -box.x * zoom - box.width * zoom / 2;
    const partialRightMirrored = 640 + box.x * zoom + box.width * zoom / 2;
    const partialTop = -box.y * zoom - box.height * zoom / 2;
    const partialBottom = 400 + box.y * zoom + box.height * zoom / 2;
    if (scene === 'edges') return freeze([
      unit(320, 200, zoom), unit(320, 200, zoom, { side: 'right', spriteIndex: 3, action: 'attack', sx: -1 }),
      unit(partialLeft, 200, zoom), unit(partialRightMirrored, 200, zoom, { sx: -1 }),
      unit(320, partialTop, zoom), unit(320, partialBottom, zoom, { sy: -1 }),
      unit(-10000, 200, zoom), unit(10000, 200, zoom), unit(320, -10000, zoom), unit(320, 10000, zoom),
      unit(-Number.MAX_SAFE_INTEGER, 200, zoom), unit(Number.MAX_SAFE_INTEGER, 200, zoom),
    ]);
    return freeze([
      unit(-10000, 200, zoom, { kind: 'attack', weaponSheet: 'storm' }),
      unit(1000, 200, zoom, { kind: 'attack', weaponSheet: 'storm', sx: -30 / zoom, sy: 10 / zoom }),
      unit(-20, 200, zoom, { kind: 'attack', weaponSheet: 'tb', sx: 2 / zoom, sy: -2 / zoom }),
      unit(700, 200, zoom, { kind: 'attack', weaponSheet: 'tb', sx: -4 / zoom, sy: 2 / zoom }),
      unit(320, 200, zoom, { kind: 'attack', weaponSheet: 'storm', displayFrame: 10 }),
      unit(10000, 200, zoom, { kind: 'attack', weaponSheet: 'tb' }),
    ]);
  };
  const render = (holder, snapshot, view, enabled) => {
    holder.commands.length = 0;
    const stats = holder.renderer.render(snapshot, camera, { displayView: view, cullOffscreen: enabled });
    return { stats, commands: holder.commands.map(command => JSON.stringify(command)),
      pixels: holder.ctx.getImageData(0, 0, holder.canvas.width, holder.canvas.height).data };
  };
  try {
    for (const mode of ['source', 'legacy']) {
      const before = makeRenderer(mode), after = makeRenderer(mode);
      await Promise.all([before.renderer.load(), after.renderer.load()]);
      for (const scale of [1, 2.5]) {
        for (const holder of [before, after]) {
          holder.canvas.width = 640 * scale; holder.canvas.height = 400 * scale;
          holder.ctx.setTransform(scale, 0, 0, scale, 0, 0); holder.renderer.setRenderScale(scale);
        }
        for (const [viewName, zoom] of [['follow', 1], ['overview', .15], ['close', 4]]) {
          const view = viewName === 'follow' ? null : freeze({ kind: 'observation-view', mode: 'manual',
            width: 640, height: 400, centerX: camera.x, centerY: camera.y, zoom, offsetX: 0, offsetY: 0, nearPlane: 24 });
          for (const scene of ['edges', 'effects']) {
            const name = `${mode}/${scale}/${viewName}/${scene}`, snapshot = snapshotFor(mode, zoom, scene);
            const input = JSON.stringify({ snapshot, camera, view });
            const baseline = render(before, snapshot, view, false), optimized = render(after, snapshot, view, true);
            let changedBytes = 0;
            for (let i = 0; i < baseline.pixels.length; i++) if (baseline.pixels[i] !== optimized.pixels[i]) changedBytes++;
            expect(changedBytes === 0, `${name}: ${changedBytes} RGBA bytes differ`);
            expect(input === JSON.stringify({ snapshot, camera, view }), `${name}: fixture changed`);
            let index = 0;
            for (const command of optimized.commands) {
              while (index < baseline.commands.length && command !== baseline.commands[index]) index++;
              expect(index < baseline.commands.length, `${name}: surviving draw command/order changed`); index++;
            }
            expect(optimized.stats.culledSprites > 0, `${name}: no wholly offscreen submission was removed`);
            cases.push({ name, width: after.canvas.width, height: after.canvas.height, changedBytes,
              originalDraws: baseline.commands.length, optimizedDraws: optimized.commands.length,
              culledSprites: optimized.stats.culledSprites, emptySourceEffects: optimized.stats.emptySourceEffects,
              survivingCommandOrderIdentical: true, rgbaSha256: await hash(optimized.pixels),
              originalCommandSha256: await hash(new TextEncoder().encode(JSON.stringify(baseline.commands))),
              optimizedCommandSha256: await hash(new TextEncoder().encode(JSON.stringify(optimized.commands))) });
          }
        }
      }
      // Short submission-only microbenchmark, same 1,600 offscreen entities.
      // No readback in timings; it excludes simulation and GPU completion.
      const snapshot = freeze(Array.from({ length: 1600 }, (_, i) => unit(-10000 - i, 200, 1)));
      before.tracing = after.tracing = false;
      for (let warm = 0; warm < 5; warm++) for (const [holder, enabled] of [[before, false], [after, true]]) {
        holder.renderer.render(snapshot, camera, { cullOffscreen: enabled });
      }
      const times = { baseline: [], optimized: [] };
      for (let sample = 0; sample < 30; sample++) {
        const order = sample % 2 ? [[after, true, 'optimized'], [before, false, 'baseline']]
          : [[before, false, 'baseline'], [after, true, 'optimized']];
        for (const [holder, enabled, key] of order) {
          const start = performance.now(); holder.renderer.render(snapshot, camera, { cullOffscreen: enabled });
          times[key].push(performance.now() - start);
        }
      }
      const summary = data => { const sorted = [...data].sort((a, b) => a - b); return {
        medianMs: (sorted[14] + sorted[15]) / 2, minMs: sorted[0], maxMs: sorted.at(-1), samples: data.length }; };
      benchmarks.push({ mode, entities: snapshot.length, baseline: summary(times.baseline), optimized: summary(times.optimized),
        baselineDraws: before.renderer.lastRenderStats.spritesDrawn, optimizedDraws: after.renderer.lastRenderStats.spritesDrawn,
        culledSprites: after.renderer.lastRenderStats.culledSprites,
        scope: 'CPU render submission only, alternating 30 samples, same native 1600x1000 target; no simulation, readback, GPU-completion or game-FPS claim' });
    }
    return { pass: true, cases, benchmarks, productionMainLoaded: false, simulationLoaded: false, audioLoaded: false,
      productionPreferencesAccessed: false, fixtureGround: 'Same neutral opaque backing in both cases; original PNGs and effects rendered by production BattlefieldRenderer',
      canvasPolicy: 'willReadFrequently:true from creation on every target; exact final RGBA and ordered surviving draw commands compared' };
  } finally { holders.forEach(holder => holder.renderer.dispose()); }
}

export async function verifyOffscreenCulling(options = {}) {
  const { channel, report } = parseOptions(Object.entries(options).flatMap(([key, value]) => [`--${key}`, String(value)]));
  const destination = path.join(root, report);
  if (fs.existsSync(destination)) throw new Error('Use a fresh report path; existing evidence is never overwritten');
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const proof = { schemaVersion: 1, status: 'running', startedAt: new Date().toISOString(), errors: [], cleanup: {} };
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'generated/asset-manifest.json'), 'utf8'));
  const effects = JSON.parse(fs.readFileSync(path.join(root, 'generated/source-effects.json'), 'utf8'));
  const files = [...new Set(['tools/verify-offscreen-culling.mjs',
    'src/render/battlefield.mjs', 'src/render/sprite-culling.mjs', 'src/render/source-effects.mjs',
    'src/render/sprite-source.mjs', 'src/render/projection.mjs', 'src/render/view-camera.mjs',
    'src/render/ground-layer-cache.mjs', 'src/render/overview-ground.mjs',
    'generated/asset-manifest.json', 'generated/source-effects.json',
    ...Object.values(manifest.images).map(image => image.file),
    ...Object.values(manifest.sprites).flatMap(sprite => sprite.frames.map(frame => frame.file)),
    ...Object.values(effects.sprites).flatMap(frames => Object.values(frames).map(frame => frame.file).filter(Boolean))])];
  proof.sources = Object.fromEntries(files.map(file => [file, sha256(fs.readFileSync(path.join(root, file)))]));
  let server, browserServer, browser;
  try {
    server = createDevServer(root);
    await bounded(new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); }), 'culling fixture server');
    const origin = `http://127.0.0.1:${server.address().port}`;
    browserServer = await chromium.launchServer({ channel, headless: true, args: ['--mute-audio'], timeout: 60000 });
    browser = await chromium.connect(browserServer.wsEndpoint(), { timeout: 60000 });
    const page = await browser.newPage();
    page.on('pageerror', error => proof.errors.push(error.message));
    const harness = `${origin}/__offscreen_culling_harness__.html`;
    await page.route(harness, route => route.fulfill({ contentType: 'text/html',
      body: '<!doctype html><meta charset="utf-8"><title>Silent isolated culling fixture</title><link rel="icon" href="data:,">' }));
    await page.goto(harness, { waitUntil: 'load' });
    proof.browser = { channel, version: browser.version(), headless: true };
    proof.result = await bounded(page.evaluate(cullingBrowserFixture), 'offscreen renderer pixel comparison', 180000);
    for (const [file, digest] of Object.entries(proof.sources)) {
      if (sha256(fs.readFileSync(path.join(root, file))) !== digest) throw new Error(`Source changed during verification: ${file}`);
    }
    proof.sourceBytesStableThroughout = true;
    proof.status = proof.result.pass && !proof.errors.length ? 'passed' : 'failed';
  } catch (error) { proof.status = 'failed'; proof.failure = { name: error.name, message: error.message }; }
  finally {
    if (browser) try { await bounded(browser.close(), 'culling browser close', 8000); proof.cleanup.browserClosed = true; }
    catch (error) { proof.cleanup.browserError = error.message; proof.status = 'failed'; }
    if (browserServer) try { await bounded(browserServer.close(), 'culling browser process close', 8000); proof.cleanup.browserServerClosed = true; }
    catch (error) { proof.cleanup.browserServerError = error.message; proof.status = 'failed'; await browserServer.kill(); }
    if (server) {
      server.closeAllConnections?.(); await bounded(new Promise(resolve => server.close(resolve)), 'culling source server close');
      proof.cleanup.sourceServerClosed = true;
    }
    proof.finishedAt = new Date().toISOString();
    fs.writeFileSync(destination, `${JSON.stringify(redact(proof, [root, os.homedir()]), null, 2)}\n`);
  }
  console.log(JSON.stringify({ status: proof.status, report, cases: proof.result?.cases.length,
    benchmarks: proof.result?.benchmarks, errors: proof.errors, failure: redact(proof.failure, [root, os.homedir()]), cleanup: proof.cleanup }, null, 2));
  if (proof.status !== 'passed') process.exitCode = 1;
  return proof;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parseOptions(process.argv.slice(2));
    if (options.help) console.log('Usage: node tools/verify-offscreen-culling.mjs [--channel msedge] [--report .local/offscreen-culling-unique.json]');
    else await verifyOffscreenCulling(options);
  } catch (error) { console.error(redact(error.message, [root, os.homedir()])); process.exitCode = 1; }
}
