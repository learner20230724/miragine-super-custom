/**
 * Isolated original-asset sampling acceptance harness, not an actual match.
 * No production main module, profile, preferences, AI model or enlarged render
 * target is used. Timings measure JS render-command submission, not displayed
 * FPS, GPU completion, animation smoothness, or Flash pixel equivalence.
 * Usage: node tools/verify-source-rendering.mjs [--channel msedge]
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
const reportName = '.local/source-rendering-verification.json';
const screenshotDirectory = 'output/playwright';

export function parseOptions(args) {
  const options = { channel: 'msedge' };
  for (let index = 0; index < args.length; index++) {
    const key = args[index];
    if (key === '--help' || key === '-h') { options.help = true; continue; }
    if (key !== '--channel') throw new Error(`Unknown option: ${key}`);
    const value = args[++index];
    if (!value || value.startsWith('--')) throw new Error('Missing value: --channel');
    options.channel = value;
  }
  return options;
}

/** Pure report summary; input order and input values are never changed. */
export function summarizeTimings(samples) {
  if (!Array.isArray(samples) || !samples.length || samples.some(value => !Number.isFinite(value) || value < 0)) {
    throw new TypeError('Timings must be a nonempty array of finite nonnegative milliseconds');
  }
  const sorted = [...samples].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return { samples: sorted.length, unit: 'ms/render submission',
    median: sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2,
    p95: sorted[Math.ceil(sorted.length * .95) - 1], minimum: sorted[0], maximum: sorted.at(-1) };
}

/** Pure synthetic fixtures: representative arrangements, not simulated combat. */
export function makeSourceRenderFixtures(manifest) {
  const camera = { x: 2250, y: 400, width: 640, height: 400 };
  const effectNames = { fireball: 'fb', thunderball: 'tb', storm: 'storm' };
  const requireFrame = key => {
    const frame = manifest.sprites[key]?.frames?.[0];
    if (!frame) throw new Error(`Missing fixture sprite: ${key}`);
    return frame.index;
  };
  const scenes = ['idle', 'run', 'attack', 'dead'].map(action => {
    const snapshot = [];
    for (const [team, side] of [['A', 'left'], ['B', 'right']]) for (let id = 0; id < 16; id++) {
      const slot = id + (team === 'B' ? 16 : 0);
      snapshot.push({ uid: slot + 1, kind: 'unit', side, spriteIndex: id, action,
        displayFrame: requireFrame(`${team}${id}_${action}`),
        px: camera.x + (slot % 8 - 3.5) * 65, py: camera.y + (Math.floor(slot / 8) - 1.5) * 125,
        pz: 0, sx: team === 'A' ? 1 : -1, sy: 1, visible: true });
    }
    for (const [index, side] of ['left', 'right'].entries()) snapshot.push({ uid: 33 + index, kind: 'base', side,
      displayFrame: requireFrame(`${index === 0 ? 'A' : 'B'}_crystal`), px: camera.x + (index ? 280 : -280),
      py: camera.y - 240, pz: 0, sx: 1, sy: 1, visible: true });
    for (const [index, [key, weaponSheet]] of Object.entries(effectNames).entries()) snapshot.push({
      uid: 35 + index, kind: 'attack', weaponSheet, displayFrame: requireFrame(key),
      px: camera.x + (index - 1) * 100, py: camera.y + 260, pz: 0, sx: 1, sy: 1, visible: true });
    snapshot.push({ uid: 38, kind: 'attack', weaponSheet: 'storm', displayFrame: 10,
      px: camera.x + 180, py: camera.y + 260, pz: 0, sx: 1, sy: 1, visible: true });
    return { name: action, snapshot };
  });
  return { camera, scenes,
    normalView: { kind: 'observation-view', mode: 'manual', centerX: camera.x, centerY: camera.y,
      zoom: 1, width: 640, height: 400, offsetX: 0, offsetY: 0, nearPlane: 24 },
    closeView: { kind: 'observation-view', mode: 'manual', centerX: camera.x, centerY: camera.y,
      zoom: 2, width: 640, height: 400, offsetX: 0, offsetY: 0, nearPlane: 24 } };
}

export async function verifySourceRendering({ channel = 'msedge' } = {}) {
  fs.mkdirSync(path.join(root, '.local'), { recursive: true });
  fs.mkdirSync(path.join(root, screenshotDirectory), { recursive: true });
  let username = '';
  try { username = os.userInfo().username; } catch { /* Optional OS metadata. */ }
  const privateValues = [root, os.homedir(), username];
  const proof = { schemaVersion: 1, status: 'running', startedAt: new Date().toISOString(),
    scope: 'Synthetic isolated renderer fixtures; not a real match, GPU/FPS benchmark, or Flash pixel-parity claim',
    command: ['node', 'tools/verify-source-rendering.mjs', '--channel', channel], errors: [], cleanup: {}, screenshots: [] };
  const save = progress => {
    proof.progress = progress;
    fs.writeFileSync(path.join(root, reportName), `${JSON.stringify(redact(proof, privateValues), null, 2)}\n`);
  };
  let server, browserServer, browser;
  try {
    save('starting owned loopback source server and isolated browser');
    const files = ['src/render/battlefield.mjs', 'src/render/sprite-source.mjs', 'src/render/source-effects.mjs',
      'src/render/projection.mjs', 'src/render/view-camera.mjs', 'src/render/ground-webgl.mjs',
      'src/render/ground-layer-cache.mjs', 'src/render/overview-ground.mjs',
      'generated/asset-manifest.json', 'generated/source-effects.json'];
    proof.sources = Object.fromEntries(files.map(file => [file,
      createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex')]));
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'generated/asset-manifest.json'), 'utf8'));
    const fixtures = makeSourceRenderFixtures(manifest);
    server = createDevServer(root);
    await bounded(new Promise((resolve, reject) => {
      server.once('error', reject); server.listen(0, '127.0.0.1', resolve);
    }), 'source renderer server');
    const origin = `http://127.0.0.1:${server.address().port}`;
    browserServer = await chromium.launchServer({ channel, headless: true, timeout: 60000 });
    browser = await chromium.connect(browserServer.wsEndpoint(), { timeout: 60000 });
    proof.browser = { channel, version: browser.version(), deviceScaleFactor: 1 };
    const context = await browser.newContext({ viewport: { width: 640, height: 400 }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    page.on('pageerror', error => proof.errors.push({ type: 'pageerror', message: error.message }));
    page.on('console', message => {
      if (message.type() === 'error') proof.errors.push({ type: 'console', message: message.text() });
    });
    const harness = `${origin}/__source_renderer_harness__.html`;
    await page.route(harness, route => route.fulfill({ contentType: 'text/html', body: `<!doctype html>
<meta charset="utf-8"><title>Isolated original-asset renderer test</title><link rel="icon" href="data:,">
<style>html,body{margin:0;background:#111}canvas{display:none;width:640px;height:400px}canvas.active{display:block}</style>` }));
    await page.goto(harness, { waitUntil: 'load', timeout: 60000 });
    proof.servedSources = await bounded(page.evaluate(async names => Object.fromEntries(await Promise.all(names.map(async file => {
      const response = await fetch(`/${file}`, { cache: 'no-store' });
      if (!response.ok) throw new Error(`Source request failed: ${file}`);
      const digest = await crypto.subtle.digest('SHA-256', await response.arrayBuffer());
      return [file, Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')];
    }))), files), 'browser-served source hash verification', 30000);
    for (const file of files) if (proof.sources[file] !== proof.servedSources[file]) {
      throw new Error(`Browser source differs from local source: ${file}`);
    }
    proof.sourceBytesVerified = true;
    save('checking loaded source images, clip/anchor invariants and fixed-view cache stability');
    proof.result = await bounded(page.evaluate(async fixtureData => {
      const [{ BattlefieldRenderer }, { spriteRasterPlacement, spriteSourcePlacement }, { drawSourceEffect }] = await Promise.all([
        import('/src/render/battlefield.mjs'), import('/src/render/sprite-source.mjs'), import('/src/render/source-effects.mjs'),
      ]);
      const json = async file => {
        const response = await fetch(file, { cache: 'no-store' });
        if (!response.ok) throw new Error(`Fixture resource failed: ${file}`);
        return response.json();
      };
      const [manifest, sourceEffects] = await Promise.all([json('/generated/asset-manifest.json'), json('/generated/source-effects.json')]);
      const expect = (condition, message) => { if (!condition) throw new Error(message); };
      const near = (a, b) => Math.abs(a - b) <= 1e-7;
      const freeze = object => {
        if (object && typeof object === 'object') { for (const value of Object.values(object)) freeze(value); Object.freeze(object); }
        return object;
      };
      freeze(fixtureData);
      const inputBefore = JSON.stringify(fixtureData);
      const loaded = new Map();
      const imageLoader = (url, record) => {
        if (!loaded.has(record.file)) loaded.set(record.file, new Promise((resolve, reject) => {
          const image = new Image(); image.onload = () => resolve(image);
          image.onerror = () => reject(new Error(`Source image failed: ${record.file}`)); image.src = url;
        }));
        return loaded.get(record.file);
      };
      const modes = ['legacy', 'source'], canvases = {}, renderers = {}, allocations = {};
      try {
        for (const mode of modes) {
          const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 400; canvas.id = mode;
          document.body.append(canvas); canvases[mode] = canvas; allocations[mode] = [];
          const canvasFactory = (width, height) => {
            allocations[mode].push({ width, height });
            const surface = new OffscreenCanvas(width, height); return surface;
          };
          renderers[mode] = new BattlefieldRenderer(canvas, manifest, { imageLoader, canvasFactory,
            spriteRasterMode: mode, sourceFrames: sourceEffects.sprites });
        }
        await Promise.all(Object.values(renderers).map(renderer => renderer.load()));
        let originalFrames = 0, sourceEffectFrames = 0;
        for (const sprite of Object.values(manifest.sprites)) for (const frame of sprite.frames) {
          const image = renderers.source.images.get(frame.file);
          expect(image?.naturalWidth === frame.width && image.naturalHeight === frame.height, `Original PNG dimensions changed: ${frame.file}`);
          originalFrames++;
        }
        for (const frames of Object.values(sourceEffects.sprites)) for (const frame of Object.values(frames)) {
          if (frame.empty) continue;
          const image = renderers.source.images.get(frame.file);
          expect(image?.naturalWidth === frame.width && image.naturalHeight === frame.height,
            `Source-density bitmap dimensions changed: ${frame.file}`);
          sourceEffectFrames++;
        }
        expect(sourceEffects.sprites.storm?.[10]?.empty === true, 'storm frame 10 must remain an explicit empty symbol');
        for (const scene of fixtureData.scenes) for (const mode of modes) {
          const stats = renderers[mode].render(scene.snapshot, fixtureData.camera);
          expect(!stats.missingSprites.length && !stats.unsupportedCoordinates && !stats.zeroScale,
            `Incomplete ${mode}/${scene.name} fixture`);
          expect(stats.spritesDrawn === scene.snapshot.length, `Unexpected draw count for ${mode}/${scene.name}`);
          if (mode === 'source') expect(stats.sourceEffectsDrawn === 2 && stats.emptySourceEffects === 1
            && stats.spriteSurfaces === 0, `Unexpected original-density effect/empty/cache counts for ${scene.name}`);
        }
        // Exercise every displayed projectile frame, not only gallery frame 1.
        const effectCounts = {};
        for (const [key, weaponSheet] of Object.entries({ fireball: 'fb', thunderball: 'tb', storm: 'storm' })) {
          effectCounts[key] = 0;
          for (const frame of manifest.sprites[key].frames) {
            const entity = { uid: 1, kind: 'attack', weaponSheet, displayFrame: frame.index,
              px: fixtureData.camera.x, py: fixtureData.camera.y, pz: 0, sx: 1, sy: 1, visible: true };
            for (const mode of modes) expect(renderers[mode].render([entity], fixtureData.camera).spritesDrawn === 1,
              `${mode} failed ${key}/${frame.index}`);
            effectCounts[key]++;
          }
        }
        // A separate diagnostic canvas avoids readbacks in the timed renderers.
        const diagnostic = new OffscreenCanvas(640, 400), ctx = diagnostic.getContext('2d', { willReadFrequently: true });
        let checkedFrames = 0, checkedMirrors = 0, nonemptyFrames = 0, emptyFrames = 0;
        for (const [key, sprite] of Object.entries(manifest.sprites)) for (const frame of sprite.frames) {
          const raster = spriteRasterPlacement(sprite, frame), source = spriteSourcePlacement(sprite, frame);
          const replacement = sourceEffects.sprites[key]?.[frame.index];
          ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, 640, 400);
          ctx.drawImage(renderers.source.images.get(frame.file), 0, 0);
          const originalPixels = ctx.getImageData(0, 0, frame.width, frame.height).data;
          let originalVisible = false;
          for (let index = 3; index < originalPixels.length; index += 4) if (originalPixels[index]) { originalVisible = true; break; }
          expect(source && source.sourceWidth > 0 && source.sourceHeight > 0, `Invalid original placement: ${key}/${frame.index}`);
          expect(source.sourceX >= 0 && source.sourceY >= 0 && source.sourceX + source.sourceWidth <= frame.width + 1e-7
            && source.sourceY + source.sourceHeight <= frame.height + 1e-7, `Source crop exceeds PNG: ${key}/${frame.index}`);
          expect(source.x >= raster.offX - 1e-7 && source.y >= raster.offY - 1e-7
            && source.x + source.width <= raster.offX + raster.width + 1e-7
            && source.y + source.height <= raster.offY + raster.height + 1e-7, `Logical clip expanded: ${key}/${frame.index}`);
          expect(near(source.x, raster.offX + raster.x + source.sourceX * sprite.rasterized.scale)
            && near(source.y, raster.offY + raster.y + source.sourceY * sprite.rasterized.scale), `Foot anchor changed: ${key}/${frame.index}`);
          for (const mirror of [1, -1]) {
            ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, 640, 400); ctx.save();
            ctx.translate(160, 220); ctx.scale(mirror, 1); ctx.imageSmoothingEnabled = true;
            if (replacement) drawSourceEffect(ctx, renderers.source.images.get(replacement.file), sprite, replacement);
            else ctx.drawImage(renderers.source.images.get(frame.file), source.sourceX, source.sourceY,
              source.sourceWidth, source.sourceHeight, source.x, source.y, source.width, source.height);
            ctx.restore();
            const left = 160 + Math.min(raster.offX * mirror, (raster.offX + raster.width) * mirror);
            const right = 160 + Math.max(raster.offX * mirror, (raster.offX + raster.width) * mirror);
            const top = 220 + raster.offY, bottom = top + raster.height;
            const readX = Math.floor(left) - 3, readY = Math.floor(top) - 3;
            const width = Math.ceil(right) - readX + 3, height = Math.ceil(bottom) - readY + 3;
            const pixels = ctx.getImageData(readX, readY, width, height).data;
            let alphaPixels = 0, outsidePixels = 0;
            for (let index = 3; index < pixels.length; index += 4) if (pixels[index]) {
              alphaPixels++;
              const x = readX + ((index - 3) / 4 % width), y = readY + Math.floor((index - 3) / 4 / width);
              if (x < Math.floor(left) || x >= Math.ceil(right) || y < Math.floor(top) || y >= Math.ceil(bottom)) outsidePixels++;
            }
            expect(outsidePixels === 0, `Transparent clip leaked outside old raster bounds: ${key}/${frame.index}/${mirror}`);
            if (originalVisible) expect(alphaPixels > 0, `Visible original frame disappeared: ${key}/${frame.index}/${mirror}`);
            if (key === 'storm' && frame.index === 10) expect(!originalVisible && alphaPixels === 0,
              'The original blank storm frame became visible or its original PNG is not blank');
            if (mirror === 1) { if (alphaPixels) nonemptyFrames++; else emptyFrames++; }
            checkedMirrors++;
          }
          checkedFrames++;
        }
        const snapshot = fixtureData.scenes[0].snapshot, displayView = fixtureData.normalView;
        const resourceCounts = mode => ({ surfaces: renderers[mode].surfaces.size,
          placementRecords: renderers[mode].sourcePlacements.size, patterns: renderers[mode].patterns.size,
          loadedImages: renderers[mode].images.size, allocatedCanvases: allocations[mode].length,
          groundCacheAllocated: Boolean(renderers[mode].displayGroundCache) });
        // Warm both modes under the same exact camera before collecting samples.
        for (let index = 0; index < 30; index++) for (const mode of modes) renderers[mode].render(snapshot, fixtureData.camera, { displayView });
        const resourcesBefore = Object.fromEntries(modes.map(mode => [mode, resourceCounts(mode)]));
        const samples = { legacy: [], source: [] }, rounds = [];
        const settle = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        await settle();
        for (let round = 0; round < 12; round++) {
          const order = round % 2 ? ['source', 'legacy'] : ['legacy', 'source'];
          for (const mode of order) for (let frame = 0; frame < 20; frame++) {
            const start = performance.now();
            renderers[mode].render(snapshot, fixtureData.camera, { displayView });
            samples[mode].push(performance.now() - start);
          }
          rounds.push({ round: round + 1, order, submissionsPerMode: 20 });
          await settle();
        }
        const resourcesAfter = Object.fromEntries(modes.map(mode => [mode, resourceCounts(mode)]));
        expect(JSON.stringify(resourcesBefore) === JSON.stringify(resourcesAfter), 'Fixed-camera render submissions grew canvas or coordinate caches');
        expect(resourcesAfter.source.surfaces === 0, 'Source mode allocated sprite raster surfaces');
        expect(allocations.source.every(size => size.width <= 640 && size.height <= 400), 'Source mode enlarged a render target');
        expect(inputBefore === JSON.stringify(fixtureData), 'Renderer changed snapshot, camera, or observation descriptors');
        const compare = () => {
          const a = canvases.legacy.getContext('2d').getImageData(0, 0, 640, 400).data;
          const b = canvases.source.getContext('2d').getImageData(0, 0, 640, 400).data;
          let changedPixels = 0, maxChannelDifference = 0;
          for (let index = 0; index < a.length; index += 4) {
            let changed = false;
            for (let channel = 0; channel < 4; channel++) {
              const difference = Math.abs(a[index + channel] - b[index + channel]);
              if (difference) changed = true; maxChannelDifference = Math.max(maxChannelDifference, difference);
            }
            if (changed) changedPixels++;
          }
          return { changedPixels, maxChannelDifference, policy: 'Differences are expected from one-pass sampling; not a pixel-equivalence assertion' };
        };
        // Only now read the timed output; readbacks are excluded from samples.
        const normalDifference = compare();
        for (const mode of modes) renderers[mode].render(snapshot, fixtureData.camera, { displayView: fixtureData.closeView });
        const closeDifference = compare();
        // Retain ONLY owned renderers until screenshots finish; outer finally
        // disposes them before closing the isolated browser.
        window.__sourceVerification = { canvases, renderers, fixtureData,
          show(mode, view) {
            for (const [key, canvas] of Object.entries(canvases)) canvas.className = key === mode ? 'active' : '';
            renderers[mode].render(fixtureData.scenes[0].snapshot, fixtureData.camera,
              { displayView: view === 'close' ? fixtureData.closeView : fixtureData.normalView });
          }, dispose() { for (const renderer of Object.values(renderers)) renderer.dispose(); } };
        return { pass: true, logicalSize: { width: 640, height: 400 }, originalFrames, sourceEffectFrames,
          fixtureScenes: fixtureData.scenes.map(scene => ({ name: scene.name, entities: scene.snapshot.length,
            units: scene.snapshot.filter(entity => entity.kind === 'unit').length })), effectCounts,
          geometry: { checkedFrames, checkedMirrors, nonemptyFrames, emptyFrames,
            clipsRetained: true, footAnchorsRetained: true, blankStorm10Retained: true },
          snapshotAndCameraUnchanged: true, resourcesBefore, resourcesAfter, allocations,
          microbenchmark: { description: 'JS render-command submission only, not FPS, GPU completion/scanout, real-match performance or sustained 240 FPS',
            warmupSubmissionsPerMode: 30, measuredSubmissionsPerMode: 240, alternatingRounds: rounds, rawSamplesMs: samples },
          pixelDifferences: { normal: normalDifference, close: closeDifference },
          productionMainLoaded: false, productionPreferencesAccessed: false };
      } catch (error) { for (const renderer of Object.values(renderers)) renderer.dispose(); throw error; }
    }, fixtures), 'isolated source-rendering acceptance and submission timings', 180000);
    for (const mode of ['legacy', 'source']) {
      const samples = proof.result.microbenchmark.rawSamplesMs[mode];
      proof.result.microbenchmark[mode] = summarizeTimings(samples);
      proof.result.microbenchmark.roundSummaries ??= {};
      proof.result.microbenchmark.roundSummaries[mode] = Array.from({ length: 12 }, (_, index) =>
        ({ round: index + 1, ...summarizeTimings(samples.slice(index * 20, (index + 1) * 20)) }));
    }
    save('capturing same-scene 640x400 normal/close legacy/source views');
    try {
      for (const view of ['normal', 'close']) for (const mode of ['legacy', 'source']) {
        await page.evaluate(({ mode, view }) => window.__sourceVerification.show(mode, view), { mode, view });
        const file = `${screenshotDirectory}/source-${mode}-${view}.png`;
        await page.locator(`#${mode}`).screenshot({ path: path.join(root, file), timeout: 30000 });
        proof.screenshots.push(file);
      }
    } finally {
      await page.evaluate(() => { window.__sourceVerification?.dispose(); delete window.__sourceVerification; });
    }
    proof.status = proof.result.pass && proof.errors.length === 0 && proof.screenshots.length === 4 ? 'passed' : 'failed';
  } catch (error) {
    proof.status = 'failed'; proof.failure = { name: error.name, message: error.message };
  } finally {
    if (browser) {
      try { await bounded(browser.close(), 'owned source-test browser close', 8000); proof.cleanup.browserClosed = true; }
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
    if (server) {
      try {
        server.closeAllConnections?.(); await bounded(new Promise(resolve => server.close(resolve)), 'owned source server close');
        proof.cleanup.sourceServerClosed = true;
      } catch (error) { proof.cleanup.sourceServerError = error.message; proof.status = 'failed'; }
    }
    proof.finishedAt = new Date().toISOString(); save(`verification ${proof.status}`);
  }
  const safe = redact(proof, privateValues);
  console.log(JSON.stringify({ status: safe.status, report: reportName,
    geometry: safe.result?.geometry, resources: safe.result?.resourcesAfter,
    submissionTimings: safe.result?.microbenchmark && { legacy: safe.result.microbenchmark.legacy, source: safe.result.microbenchmark.source },
    screenshots: safe.screenshots, ...(safe.failure ? { failure: safe.failure } : {}), errors: safe.errors }, null, 2));
  if (safe.status !== 'passed') process.exitCode = 1;
  return safe;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parseOptions(process.argv.slice(2));
    if (options.help) console.log('Usage: node tools/verify-source-rendering.mjs [--channel msedge] (isolated synthetic fixtures; not actual FPS)');
    else await verifySourceRendering(options);
  } catch (error) { console.error(redact(error.message, [root, os.homedir()])); process.exitCode = 1; }
}
