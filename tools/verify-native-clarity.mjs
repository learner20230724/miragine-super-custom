/**
 * Independent, frozen rendering fixtures. This does not load the production
 * main module, run a match, write preferences, or claim displayed FPS/Flash
 * pixel parity. Compare the SAME original PNG and projection through the old
 * 640x400 intermediate target and a native 3180x1988 target. Unit-only crops
 * replay the actual renderer drawImage command (including its transform), so
 * terrain changes cannot inflate the descriptive image-detail measurements.
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
  const result = { channel: 'msedge', report: '.local/native-clarity-verification.json',
    output: 'output/playwright/native-clarity' };
  const used = new Set();
  for (let index = 0; index < args.length; index++) {
    const option = args[index];
    if (option === '--help' || option === '-h') { result.help = true; continue; }
    if (!['--channel', '--report', '--output'].includes(option)) throw new Error(`Unknown option: ${option}`);
    if (used.has(option)) throw new Error(`Duplicate option: ${option}`);
    used.add(option);
    const value = args[++index];
    if (!value || value.startsWith('--')) throw new Error(`Missing value: ${option}`);
    result[option.slice(2)] = value;
  }
  for (const [key, prefix] of [['report', '.local/'], ['output', 'output/playwright/']]) {
    const value = result[key].replaceAll('\\', '/');
    if (path.posix.isAbsolute(value) || value.split('/').some(part => part === '..' || part === '.')
      || !value.startsWith(prefix) || value.length <= prefix.length || value.includes(':')) {
      throw new Error(`${key} must remain inside ${prefix}`);
    }
    result[key] = value;
  }
  return result;
}

/** Descriptive only: more edge energy is not by itself a quality assertion. */
export function compareClarityPixels({ width, height, before, after }) {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1
    || !before || !after || before.length !== width * height * 4 || after.length !== before.length) {
    throw new TypeError('Expected equal, nonempty RGBA pixel arrays and positive integer dimensions');
  }
  const luminance = (pixels, offset) => (pixels[offset] * .2126 + pixels[offset + 1] * .7152
    + pixels[offset + 2] * .0722) * pixels[offset + 3] / 255;
  let changedPixels = 0, maxChannelDifference = 0, absoluteChannelDifference = 0;
  let beforeEdgeEnergy = 0, afterEdgeEnergy = 0, edges = 0;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const offset = (y * width + x) * 4;
    let changed = false;
    for (let channel = 0; channel < 4; channel++) {
      const difference = Math.abs(before[offset + channel] - after[offset + channel]);
      if (difference) changed = true;
      maxChannelDifference = Math.max(maxChannelDifference, difference);
      absoluteChannelDifference += difference;
    }
    if (changed) changedPixels++;
    for (const next of [x + 1 < width ? offset + 4 : -1, y + 1 < height ? offset + width * 4 : -1]) {
      if (next < 0) continue;
      beforeEdgeEnergy += Math.abs(luminance(before, offset) - luminance(before, next));
      afterEdgeEnergy += Math.abs(luminance(after, offset) - luminance(after, next));
      edges++;
    }
  }
  return { pixels: width * height, changedPixels, changedFraction: changedPixels / (width * height),
    maxChannelDifference, meanAbsoluteChannelDifference: absoluteChannelDifference / before.length,
    meanAdjacentPremultipliedLuminanceDifference: {
      before: edges ? beforeEdgeEnergy / edges : 0, after: edges ? afterEdgeEnergy / edges : 0,
    } };
}

/** Canvas may round each transform operation to float32 before getTransform. */
export function canvasTransformClose(actual, expected) {
  return Number.isFinite(actual) && Number.isFinite(expected)
    && Math.abs(actual - expected) <= Math.max(1e-6, Math.abs(actual) * 2 ** -22, Math.abs(expected) * 2 ** -22);
}

export function makeClarityFixtures(manifest) {
  const camera = { x: 2250, y: 400, width: 640, height: 400 };
  const units = [['A', 0, 'idle'], ['B', 3, 'attack'], ['A', 14, 'run']].map(([team, id, action], index) => {
    const key = `${team}${id}_${action}`, frame = manifest.sprites[key]?.frames?.[0];
    if (!frame) throw new Error(`Missing clarity fixture: ${key}`);
    return { name: key, original: { file: frame.file, width: frame.width, height: frame.height },
      entity: { uid: index + 1, kind: 'unit', side: team === 'A' ? 'left' : 'right', spriteIndex: id,
        action, displayFrame: frame.index, px: camera.x, py: camera.y, pz: 0,
        sx: team === 'A' ? 1 : -1, sy: 1, visible: true } };
  });
  return { camera, width: 3180, height: 1988, units,
    views: [['overview', .1525338745], ['normal', 1], ['close', 2]].map(([name, zoom]) => ({ name,
      view: { kind: 'observation-view', mode: 'manual', centerX: camera.x, centerY: camera.y,
        zoom, width: 640, height: 400, offsetX: 0, offsetY: 0, nearPlane: 24 } })) };
}

export async function verifyNativeClarity(options = {}) {
  const { channel, report, output } = parseOptions(Object.entries(options).flatMap(([key, value]) => [`--${key}`, String(value)]));
  const reportPath = path.join(root, report), outputPath = path.join(root, output);
  if (fs.existsSync(reportPath) || fs.existsSync(outputPath)) throw new Error('Use fresh report/output names; existing evidence is never overwritten');
  fs.mkdirSync(path.dirname(reportPath), { recursive: true }); fs.mkdirSync(outputPath, { recursive: true });
  let username = ''; try { username = os.userInfo().username; } catch { /* optional */ }
  const privateValues = [root, os.homedir(), username];
  const proof = { schemaVersion: 1, status: 'running', startedAt: new Date().toISOString(),
    scope: 'Frozen isolated renderer fixtures, not live gameplay, FPS, invented detail, or Flash pixel parity',
    errors: [], screenshots: [], cleanup: {} };
  const save = progress => {
    proof.progress = progress;
    fs.writeFileSync(reportPath, `${JSON.stringify(redact(proof, privateValues), null, 2)}\n`);
  };
  let server, browserServer, browser, page;
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'generated/asset-manifest.json'), 'utf8'));
    const fixtures = makeClarityFixtures(manifest);
    const files = ['src/render/battlefield.mjs', 'src/render/sprite-source.mjs', 'src/render/source-effects.mjs',
      'src/render/view-camera.mjs', 'src/render/projection.mjs', 'src/render/ground-webgl.mjs',
      'src/render/ground-layer-cache.mjs', 'src/render/overview-ground.mjs', 'generated/asset-manifest.json',
      ...fixtures.units.map(unit => unit.original.file)];
    proof.sources = Object.fromEntries(files.map(file => [file, sha256(fs.readFileSync(path.join(root, file)))]));
    save('starting owned loopback server and isolated renderer browser');
    server = createDevServer(root);
    await bounded(new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); }), 'clarity server');
    const origin = `http://127.0.0.1:${server.address().port}`;
    browserServer = await chromium.launchServer({ channel, headless: true, timeout: 60000 });
    browser = await chromium.connect(browserServer.wsEndpoint(), { timeout: 60000 });
    const context = await browser.newContext({ viewport: { width: 1920, height: 1200 }, deviceScaleFactor: 1 });
    page = await context.newPage();
    page.on('pageerror', error => proof.errors.push({ type: 'pageerror', message: error.message }));
    page.on('console', message => { if (message.type() === 'error') proof.errors.push({ type: 'console', message: message.text() }); });
    const harness = `${origin}/__native_clarity_harness__.html`;
    await page.route(harness, route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><meta charset="utf-8"><title>Isolated native clarity comparison</title><link rel="icon" href="data:,"><style>html,body{margin:0;background:#202630}canvas{display:block}</style>' }));
    await page.goto(harness, { waitUntil: 'load', timeout: 60000 });
    // The browser executes this local, tested pure metric, not externally supplied code.
    await page.addScriptTag({ content: `window.__compareClarityPixels = ${compareClarityPixels.toString()};\nwindow.__canvasTransformClose = ${canvasTransformClose.toString()};` });
    proof.browser = { channel, version: browser.version(), deviceScaleFactor: 1 };
    proof.servedSources = await page.evaluate(async names => Object.fromEntries(await Promise.all(names.map(async file => {
      const response = await fetch(`/${file}`, { cache: 'no-store' });
      if (!response.ok) throw new Error(`Fixture resource failed: ${file}`);
      const digest = await crypto.subtle.digest('SHA-256', await response.arrayBuffer());
      return [file, Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')];
    }))), files);
    for (const file of files) if (proof.sources[file] !== proof.servedSources[file]) throw new Error(`Browser/local bytes differ: ${file}`);
    proof.sourceBytesVerified = true;
    save('comparing frozen original-image draw commands and final pixels');
    proof.result = await bounded(page.evaluate(async fixtures => {
      const [{ BattlefieldRenderer }, { spriteSourcePlacement }, { projectViewSymbol }] = await Promise.all([
        import('/src/render/battlefield.mjs'), import('/src/render/sprite-source.mjs'), import('/src/render/view-camera.mjs'),
      ]);
      const manifest = await (await fetch('/generated/asset-manifest.json', { cache: 'no-store' })).json();
      const expect = (value, message) => { if (!value) throw new Error(message); };
      const near = window.__canvasTransformClose;
      const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
      freeze(fixtures); const inputBefore = JSON.stringify(fixtures);
      const makeCanvas = (width, height) => {
        const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
        // A pixel-readback fixture, never a performance benchmark. Pin all 2D
        // targets to the same readback policy instead of letting Chrome switch
        // only some canvases from GPU to CPU after repeated getImageData calls.
        canvas.getContext('2d', { willReadFrequently: true });
        return canvas;
      };
      const scaleX = fixtures.width / 640, scaleY = fixtures.height / 400;
      const loaded = new Map(), records = {}, canvases = {}, shadows = {}, renderers = {}, results = [], boards = new Map();
      let activeFile = null;
      const imageLoader = (url, record) => {
        if (!loaded.has(record.file)) loaded.set(record.file, new Promise((resolve, reject) => {
          const image = new Image(); image.onload = () => resolve(image);
          image.onerror = () => reject(new Error(`Original image failed: ${record.file}`)); image.src = url;
        }));
        return loaded.get(record.file);
      };
      const cropPixels = (canvas, rect) => canvas.getContext('2d').getImageData(rect.x, rect.y, rect.width, rect.height).data;
      const compare = (a, b, rect) => window.__compareClarityPixels({ width: rect.width, height: rect.height,
        before: cropPixels(a, rect), after: cropPixels(b, rect) });
      try {
        for (const mode of ['intermediate', 'native']) {
          const width = mode === 'native' ? fixtures.width : 640, height = mode === 'native' ? fixtures.height : 400;
          const canvas = makeCanvas(width, height), shadow = makeCanvas(width, height);
          canvases[mode] = canvas; shadows[mode] = shadow; records[mode] = [];
          const ctx = canvas.getContext('2d'), shadowCtx = shadow.getContext('2d'), drawImage = ctx.drawImage;
          // Replay the actual transform operations, not getTransform() through
          // another setTransform(): that setter can introduce a second float32
          // rounding of a composed matrix and change a few edge-alpha pixels.
          for (const method of ['save', 'restore', 'setTransform', 'resetTransform', 'translate', 'scale', 'rotate', 'transform']) {
            const originalMethod = ctx[method];
            ctx[method] = function(...args) { shadowCtx[method](...args); return originalMethod.apply(this, args); };
          }
          ctx.drawImage = function(image, ...args) {
            if (activeFile && image === renderers[mode]?.images.get(activeFile)) {
              const transform = this.getTransform();
              records[mode].push({ source: activeFile, imageType: image.constructor.name,
                originalWidth: image.naturalWidth, originalHeight: image.naturalHeight,
                arguments: args, transform: ['a', 'b', 'c', 'd', 'e', 'f'].map(key => transform[key]),
                smoothing: this.imageSmoothingEnabled, alpha: this.globalAlpha, composition: this.globalCompositeOperation });
              shadowCtx.imageSmoothingEnabled = this.imageSmoothingEnabled;
              shadowCtx.globalAlpha = this.globalAlpha; shadowCtx.globalCompositeOperation = this.globalCompositeOperation;
              shadowCtx.drawImage(image, ...args);
            }
            return drawImage.call(this, image, ...args);
          };
          if (mode === 'native') ctx.setTransform(scaleX, 0, 0, scaleY, 0, 0);
          renderers[mode] = new BattlefieldRenderer(canvas, manifest, { imageLoader, spriteRasterMode: 'source' });
          if (mode === 'native') renderers[mode].setRenderScale(scaleX, scaleY);
        }
        await Promise.all(Object.values(renderers).map(renderer => renderer.load()));
        // Reuse readback/reference targets: nine fixtures must not retain nine
        // sets of full-resolution canvases merely to keep small evidence crops.
        const legacyUnit = makeCanvas(fixtures.width, fixtures.height), legacyFrame = makeCanvas(fixtures.width, fixtures.height);
        const reference = makeCanvas(fixtures.width, fixtures.height), referenceCtx = reference.getContext('2d');
        const referenceComposite = makeCanvas(fixtures.width, fixtures.height), compositeCtx = referenceComposite.getContext('2d');
        for (const fixture of fixtures.units) for (const { name: viewName, view } of fixtures.views) {
          const name = `${fixture.name}-${viewName}`, sprite = manifest.sprites[fixture.name];
          const frame = sprite.frames.find(frame => frame.index === fixture.entity.displayFrame);
          const original = renderers.native.images.get(frame.file), placement = spriteSourcePlacement(sprite, frame);
          const projected = projectViewSymbol(fixture.entity, view);
          expect(original.naturalWidth === frame.width && original.naturalHeight === frame.height, `${name}: original PNG dimensions changed`);
          activeFile = frame.file;
          const boundsX = [placement.x, placement.x + placement.width].map(x => (projected.x + x * projected.scaleX) * scaleX);
          const boundsY = [placement.y, placement.y + placement.height].map(y => (projected.y + y * projected.scaleY) * scaleY);
          const rect = { x: Math.floor(Math.min(...boundsX)) - 8, y: Math.floor(Math.min(...boundsY)) - 8,
            width: Math.ceil(Math.max(...boundsX)) - Math.floor(Math.min(...boundsX)) + 16,
            height: Math.ceil(Math.max(...boundsY)) - Math.floor(Math.min(...boundsY)) + 16 };
          expect(rect.x >= 0 && rect.y >= 0 && rect.x + rect.width <= fixtures.width && rect.y + rect.height <= fixtures.height,
            `${name}: comparison must stay inside the same final viewport`);
          const stats = {};
          for (const mode of ['intermediate', 'native']) {
            if (mode === 'native') {
              // Keep the actual renderer's fixed background, then independently
              // add the original PNG to it for an actual final-canvas assertion.
              renderers.native.render([], fixtures.camera, { displayView: view });
              compositeCtx.setTransform(1, 0, 0, 1, 0, 0); compositeCtx.clearRect(0, 0, fixtures.width, fixtures.height);
              compositeCtx.drawImage(canvases.native, 0, 0);
            }
            records[mode] = [];
            shadows[mode].getContext('2d').clearRect(0, 0, shadows[mode].width, shadows[mode].height);
            stats[mode] = renderers[mode].render([fixture.entity], fixtures.camera, { displayView: view });
            expect(stats[mode].sourceSpritesDrawn === 1 && stats[mode].spriteSurfaces === 0 && records[mode].length === 1,
              `${name}: expected exactly one unchanged-PNG draw, no sprite-raster intermediate`);
            expect(!stats[mode].missingSprites.length && !stats[mode].unsupportedCoordinates, `${name}: incomplete draw`);
            const command = records[mode][0], sx = mode === 'native' ? scaleX : 1, sy = mode === 'native' ? scaleY : 1;
            const expected = [projected.scaleX * sx, 0, 0, projected.scaleY * sy, projected.x * sx, projected.y * sy];
            expect(command.imageType === 'HTMLImageElement' && command.arguments.length === 8
              && command.alpha === 1 && command.composition === 'source-over'
              && command.transform.every((value, index) => near(value, expected[index])),
            `${name}/${mode}: source image/transform was not direct: ${JSON.stringify({ command, expected })}`);
            const sourceArgs = [placement.sourceX, placement.sourceY, placement.sourceWidth, placement.sourceHeight,
              placement.x, placement.y, placement.width, placement.height];
            expect(command.arguments.every((value, index) => near(value, sourceArgs[index])), `${name}: source crop/foot anchor changed`);
          }
          for (const [target, source] of [[legacyUnit, shadows.intermediate], [legacyFrame, canvases.intermediate]]) {
            const ctx = target.getContext('2d'); ctx.clearRect(0, 0, fixtures.width, fixtures.height);
            ctx.imageSmoothingEnabled = true; ctx.drawImage(source, 0, 0, fixtures.width, fixtures.height);
          }
          referenceCtx.setTransform(1, 0, 0, 1, 0, 0); referenceCtx.clearRect(0, 0, fixtures.width, fixtures.height);
          for (const ctx of [referenceCtx, compositeCtx]) {
            ctx.setTransform(scaleX, 0, 0, scaleY, 0, 0); ctx.translate(projected.x, projected.y);
            ctx.scale(projected.scaleX, projected.scaleY); ctx.imageSmoothingEnabled = true;
            ctx.drawImage(original, placement.sourceX, placement.sourceY, placement.sourceWidth, placement.sourceHeight,
              placement.x, placement.y, placement.width, placement.height);
          }
          const directReferenceDifference = compare(reference, shadows.native, rect);
          const finalCanvasReferenceDifference = compare(referenceComposite, canvases.native, rect);
          const finalFrameDifference = compare(legacyFrame, canvases.native, rect);
          const unitDifference = compare(legacyUnit, shadows.native, rect);
          // The actual final canvas is the acceptance target. Transparent
          // shadow replay is auxiliary: canvas backend/premultiplied-alpha
          // differences may occur even when the actual final pixels match.
          expect(finalCanvasReferenceDifference.changedPixels === 0,
            `${name}: actual final canvas pixels differ from direct-PNG/background reference: ${JSON.stringify(finalCanvasReferenceDifference)}`);
          expect(finalFrameDifference.changedPixels > 0, `${name}: intermediate and direct final frames unexpectedly have identical pixels`);
          const columnWidth = Math.max(rect.width, 300), board = makeCanvas(columnWidth * 3, rect.height + 82), boardCtx = board.getContext('2d');
          board.id = name; boardCtx.fillStyle = '#202630'; boardCtx.fillRect(0, 0, board.width, board.height);
          boardCtx.fillStyle = '#eee'; boardCtx.font = '16px sans-serif';
          boardCtx.fillText(`${name} | PNG ${frame.width}x${frame.height} | same final pixel scale; no artwork edits`, 12, 24);
          for (const [index, [label, image]] of [['Direct PNG / same background', referenceComposite], ['640x400 then enlarged', legacyFrame], ['Native actual final canvas', canvases.native]].entries()) {
            boardCtx.fillText(label, index * columnWidth + 12, 52);
            boardCtx.drawImage(image, rect.x, rect.y, rect.width, rect.height,
              index * columnWidth + Math.floor((columnWidth - rect.width) / 2), 70, rect.width, rect.height);
          }
          boards.set(name, board);
          if (fixture.name === 'A0_idle' && viewName === 'overview') {
            canvases.native.id = 'native-overview-full'; legacyFrame.id = 'intermediate-overview-full';
            boards.set(canvases.native.id, makeCanvas(fixtures.width, fixtures.height));
            boards.get(canvases.native.id).getContext('2d').drawImage(canvases.native, 0, 0);
            boards.get(canvases.native.id).id = canvases.native.id;
            boards.set(legacyFrame.id, makeCanvas(fixtures.width, fixtures.height));
            boards.get(legacyFrame.id).getContext('2d').drawImage(legacyFrame, 0, 0);
            boards.get(legacyFrame.id).id = legacyFrame.id;
          }
          results.push({ name, original: fixture.original, zoom: view.zoom, crop: rect,
            projectedSourceHeight: { intermediatePixels: placement.height * Math.abs(projected.scaleY),
              finalPixels: placement.height * Math.abs(projected.scaleY) * scaleY },
            actualDrawCommands: { intermediate: records.intermediate[0], native: records.native[0] },
            backingTargets: { intermediate: stats.intermediate.renderTarget, native: stats.native.renderTarget },
            finalCanvasReferenceDifference, finalFrameDifference,
            auxiliaryTransparentReplay: { directReferenceDifference, unitDifference,
              limitation: 'Descriptive only, not a zero-difference acceptance gate; transparent replay can use different backend/alpha sampling than the actual final canvas' },
            metricScope: 'Final-canvas comparison includes the unchanged background; auxiliary unit-only transparent replay excludes terrain. Edge energy is descriptive, not a quality score' });
        }
        expect(inputBefore === JSON.stringify(fixtures), 'Renderer mutated frozen fixture snapshot/camera/view');
        window.__nativeClarity = { show(name) { document.querySelectorAll('canvas').forEach(canvas => canvas.remove()); document.body.append(boards.get(name)); },
          dispose() { Object.values(renderers).forEach(renderer => renderer.dispose()); } };
        return { pass: true, originalAssetsUsedDirectly: true, snapshotAndCameraUnchanged: true,
          productionMainLoaded: false, productionPreferencesAccessed: false,
          logicalSize: { width: 640, height: 400 }, finalSize: { width: fixtures.width, height: fixtures.height },
          canvas2DPolicy: 'willReadFrequently:true from creation on every comparison target; isolated pixel fixture, not performance evidence',
          transformTolerance: { absolute: 1e-6, relative: 2 ** -22,
            reason: 'Canvas transform operations may round to float32; pixel identity still requires exactly zero differences' },
          results, screenshotNames: [...boards.keys()],
          interpretation: 'Native pixels exactly match independent one-pass original-PNG reference; source bitmap detail is finite and no new detail is generated' };
      } catch (error) { Object.values(renderers).forEach(renderer => renderer.dispose()); throw error; }
    }, fixtures), 'native-resolution isolated pixel comparison', 180000);
    save('capturing same-size original-reference/intermediate/native comparisons');
    for (const name of proof.result.screenshotNames) {
      await page.evaluate(name => window.__nativeClarity.show(name), name);
      const file = `${output}/${name}.png`;
      await page.locator(`#${name}`).screenshot({ path: path.join(root, file), timeout: 30000 });
      proof.screenshots.push({ file, sha256: sha256(fs.readFileSync(path.join(root, file))) });
    }
    for (const [file, digest] of Object.entries(proof.sources)) {
      if (sha256(fs.readFileSync(path.join(root, file))) !== digest) throw new Error(`Source changed during verification: ${file}`);
    }
    proof.sourceBytesStableThroughout = true;
    proof.status = proof.result.pass && !proof.errors.length && proof.screenshots.length === 11 ? 'passed' : 'failed';
  } catch (error) { proof.status = 'failed'; proof.failure = { name: error.name, message: error.message }; }
  finally {
    if (page) {
      try { await bounded(page.evaluate(() => { window.__nativeClarity?.dispose(); delete window.__nativeClarity; }), 'clarity renderer dispose', 5000); }
      catch (error) { proof.cleanup.rendererError = error.message; proof.status = 'failed'; }
    }
    if (browser) {
      try { await bounded(browser.close(), 'owned clarity browser close', 8000); proof.cleanup.browserClosed = true; }
      catch (error) { proof.cleanup.browserError = error.message; proof.status = 'failed'; }
    }
    if (browserServer) {
      try { await bounded(browserServer.close(), 'owned clarity browser server close', 8000); proof.cleanup.browserServerClosed = true; }
      catch (error) {
        proof.cleanup.browserServerError = error.message; proof.status = 'failed';
        try { await bounded(browserServer.kill(), 'owned clarity browser termination', 5000); proof.cleanup.ownedBrowserTerminated = true; }
        catch (terminationError) { proof.cleanup.terminationError = terminationError.message; }
      }
    }
    if (server) {
      try { server.closeAllConnections?.(); await bounded(new Promise(resolve => server.close(resolve)), 'clarity server close'); proof.cleanup.sourceServerClosed = true; }
      catch (error) { proof.cleanup.sourceServerError = error.message; proof.status = 'failed'; }
    }
    proof.finishedAt = new Date().toISOString(); save(`verification ${proof.status}`);
  }
  const safe = redact(proof, privateValues);
  console.log(JSON.stringify({ status: safe.status, report, cases: safe.result?.results.length,
    screenshots: safe.screenshots.map(item => item.file), errors: safe.errors, failure: safe.failure, cleanup: safe.cleanup }, null, 2));
  if (safe.status !== 'passed') process.exitCode = 1;
  return safe;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parseOptions(process.argv.slice(2));
    if (options.help) console.log('Usage: node tools/verify-native-clarity.mjs [--channel msedge] [--report .local/native-clarity-unique.json] [--output output/playwright/native-clarity-unique]');
    else await verifyNativeClarity(options);
  } catch (error) { console.error(redact(error.message, [root, os.homedir()])); process.exitCode = 1; }
}
