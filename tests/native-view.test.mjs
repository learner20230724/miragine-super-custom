import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { OriginalGameView } from '../src/app/view.mjs';
import { GameController } from '../src/app/controller.mjs';

const defaults = JSON.parse(await readFile(new URL('../config/defaults.generated.json', import.meta.url), 'utf8'));
const layout = JSON.parse(await readFile(new URL('../generated/ui/layout.generated.json', import.meta.url), 'utf8'));

function harness(width = 640, height = 480) {
  const calls = [], canvases = [];
  function makeCanvas(id, width = 640, height = 480) {
    const canvas = { id, width, height }, stack = [];
    const ctx = { canvas, matrix: [1, 0, 0, 1, 0, 0], globalAlpha: 1, globalCompositeOperation: 'source-over',
      save() { stack.push({ matrix: [...this.matrix], globalAlpha: this.globalAlpha, globalCompositeOperation: this.globalCompositeOperation }); },
      restore() { Object.assign(this, stack.pop()); },
      setTransform(...matrix) { this.matrix = matrix; calls.push({ type: 'transform', id, matrix }); },
      clearRect(...args) { calls.push({ type: 'clear', id, args, matrix: [...this.matrix] }); },
      drawImage(source, ...args) { calls.push({ type: 'composite', id, source, args, matrix: [...this.matrix] }); },
      fillText(text, ...args) { calls.push({ type: 'text', id, text, args, matrix: [...this.matrix] }); },
      fillRect() {}, beginPath() {}, rect() {}, clip() {}, arc() {}, fill() {}, strokeRect() {},
      translate() {}, scale() {}, measureText: text => ({ width: text.length * 7 }),
    };
    canvas.ctx = ctx; canvas.getContext = () => ctx;
    return canvas;
  }
  const canvas = makeCanvas('main', width, height);
  const graphics = {
    attach: canvas => canvas.ctx,
    draw(symbol, ctx, options) { calls.push({ type: 'draw', symbol, id: ctx.canvas.id, options, matrix: [...ctx.matrix], alpha: ctx.globalAlpha }); },
    drawText(text, ctx, options) { calls.push({ type: 'number', text, id: ctx.canvas.id, options, matrix: [...ctx.matrix],
      shadow: [ctx.shadowBlur, ctx.shadowOffsetX, ctx.shadowOffsetY] }); },
  };
  const config = structuredClone(defaults), controller = new GameController(config);
  const view = new OriginalGameView(canvas, graphics, layout, config, { crispTextControls: true,
    canvasFactory: () => { const canvas = makeCanvas(`cache-${canvases.length}`); canvases.push(canvas); return canvas; } });
  const renderer = { render() { return {}; } };
  function game() { controller.action('dual'); controller.action('tutorial-okay'); view.render(controller, renderer); }
  return { canvas, calls, canvases, config, controller, view, renderer, game };
}

function close(actual, expected) { assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`); }

test('native view uses exact backing-to-logical scales, including fractional-density dimensions', () => {
  const h = harness(3180, 2385);
  assert.deepEqual(h.view.getRenderStats(), { width: 3180, height: 2385,
    scaleX: 3180 / 640, scaleY: 2385 / 480, cachedPixels: 0, cacheCount: 0 });
  h.game();
  assert.ok(h.calls.filter(call => call.type === 'composite' && call.id === 'main').length > 0);
  for (const call of h.calls.filter(call => call.type === 'composite' && call.id === 'main')) {
    assert.deepEqual(call.matrix, [3180 / 640, 0, 0, 2385 / 480, 0, 0]);
    close(call.args[2] * h.view.scaleX, call.source.width);
    close(call.args[3] * h.view.scaleY, call.source.height);
    close(call.args[0] * h.view.scaleX, Math.round(call.args[0] * h.view.scaleX));
    close(call.args[1] * h.view.scaleY, Math.round(call.args[1] * h.view.scaleY));
  }
  const top = h.view.cache.get('hud-top'), bottom = h.view.cache.get('hud-bottom');
  assert.equal(top.width, 3180); assert.equal(top.height, 477);
  assert.equal(bottom.width, 3180); assert.equal(bottom.height, 398);
  assert.ok(h.view.getRenderStats().cachedPixels < 3180 * 2385 * .6,
    'all HUD caches together use less than 60% of one full-stage image, not eleven full-stage images');
});

test('native counter glyphs draw at final density with pixel-scaled shadows and exact logical baseline', () => {
  const h = harness(2560, 1920);
  h.view.numeric('time', 12, 22, 'center');
  const call = h.calls.findLast(call => call.type === 'number');
  const slot = h.view.numberLayers.time.canvas, info = h.view.layerInfo.get(slot);
  assert.deepEqual(call.matrix, [4, 0, 0, 4, -info.left, -info.top]);
  assert.deepEqual(call.shadow, [12, 4, 4]);
  assert.equal(call.options.y, 28.45);
  assert.ok(slot.width < 220 && slot.height < 185, 'counter includes its own bounds and shadow padding, not the whole stage');
  const clear = h.calls.find(call => call.type === 'clear' && call.id === slot.id);
  assert.deepEqual(clear.matrix, [1, 0, 0, 1, 0, 0]);
  assert.deepEqual(clear.args, [0, 0, slot.width, slot.height]);
});

test('unchanged native HUD pixels and repeated resize notifications reuse all surfaces', () => {
  const h = harness(1920, 1440); h.game();
  const allocated = h.canvases.length, numbers = h.calls.filter(call => call.type === 'number').length;
  const draws = h.calls.filter(call => call.type === 'draw' && call.id !== 'main').length;
  for (let frame = 0; frame < 100; frame++) {
    assert.equal(h.view.setRenderSize(1920, 1440), false);
    h.view.render(h.controller, h.renderer);
  }
  assert.equal(h.canvases.length, allocated);
  assert.equal(h.calls.filter(call => call.type === 'number').length, numbers);
  assert.equal(h.calls.filter(call => call.type === 'draw' && call.id !== 'main').length, draws);
  const before = h.view.getRenderStats(); before.cachedPixels = -1;
  assert.ok(h.view.getRenderStats().cachedPixels > 0, 'diagnostics are detached from state');
});

test('resize discards old density even when the host changed canvas dimensions first', () => {
  const h = harness(); h.game();
  const oldLayers = [...h.canvases];
  h.canvas.width = 2560; h.canvas.height = 1920;
  assert.equal(h.view.setRenderSize(2560, 1920), true);
  assert.ok(oldLayers.every(canvas => canvas.width === 0 && canvas.height === 0), 'old pixel buffers explicitly released');
  assert.equal(h.view.getRenderStats().cachedPixels, 0);
  h.view.render(h.controller, h.renderer);
  const fresh = h.view.cache.get('hud-top');
  assert.equal(fresh.width, 2560); assert.equal(fresh.height, 384);
  assert.equal(h.view.numberLayers.time.canvas.width, 216);
  assert.deepEqual(h.canvas.ctx.matrix, [4, 0, 0, 4, 0, 0]);
});

test('native menu and results are cached at final density and release on phase change', () => {
  const h = harness(1280, 960);
  h.view.render(h.controller, h.renderer);
  const background = h.view.cache.get('title-background');
  assert.deepEqual([background.width, background.height], [1280, 960]);
  assert.equal(h.view.cache.has('title-button-strip'), false);
  assert.equal([...h.view.cache.keys()].filter(key => key.startsWith('title-button:')).length, 3);
  assert.ok([...h.view.cache].filter(([key]) => key.startsWith('title-button:')).every(([, canvas]) => canvas.width <= 520 && canvas.height <= 157));
  const old = [...h.canvases];
  h.game();
  assert.ok(old.every(canvas => canvas.width === 0 && canvas.height === 0));
  assert.ok(![...h.view.cache.keys()].some(key => key.startsWith('title')));
  h.controller.phase = 'over'; h.controller.simulation.winner = 'left';
  h.view.render(h.controller, h.renderer);
  assert.equal(h.view.cache.size, 1);
  assert.deepEqual([h.view.cache.get('results:left').width, h.view.cache.get('results:left').height], [1280, 960]);
  assert.equal(Object.keys(h.view.numberLayers).length, 0);
});

test('native density changes no logical hotspots or simulation steps', () => {
  const small = harness(), large = harness(3840, 2880);
  small.game(); large.game();
  assert.deepEqual(large.view.hotspots, small.view.hotspots);
  for (const h of [small, large]) {
    const frame = h.controller.simulation.frame;
    for (let i = 0; i < 100; i++) h.view.render(h.controller, h.renderer);
    assert.equal(h.controller.simulation.frame, frame, 'render never advances the 30Hz simulation');
    const card = layout.sprites['210'].instances.a7.bounds;
    assert.equal(h.view.hit({ x: (card.xMin + card.xMax) / 2, y: (card.yMin + card.yMax) / 2 }).id, 7);
  }
});

test('native viewport dimensions reject invalid and unsafe sizes without dropping current caches', () => {
  const h = harness(); h.game(); const original = h.view.getRenderStats();
  for (const size of [0, -1, NaN, Infinity, 12.5, Number.MAX_SAFE_INTEGER + 1, '1280']) {
    assert.throws(() => h.view.setRenderSize(size, 480), /positive safe integers/);
    assert.throws(() => h.view.setRenderSize(640, size), /positive safe integers/);
  }
  assert.deepEqual(h.view.getRenderStats(), original);
});

test('recovered static HUD bounds are contained in native cached strips without hiding any artwork', () => {
  const dynamic = new Set(['sprite134', 'sprite135', 'sprite209', ...Array.from({ length: 7 }, (_, i) => `text${187 + i}`)]);
  for (const placement of layout.sprites['210'].placements) {
    if (placement.symbol === 'shape76' || dynamic.has(placement.symbol)) continue;
    const b = placement.bounds;
    assert.ok(b && (b.yMin >= 0 && b.yMax <= 96 || b.yMin >= 400 && b.yMax <= 480), placement.symbol);
  }
  // shape76's only visible fill starts at logical y=400; its full-stage fill
  // has zero alpha. It is drawn in each clipped strip, without editing art.
});


test('title cold filters use tight native components instead of a full-stage target', () => {
  const h = harness(3180, 2385); h.view.render(h.controller, h.renderer);
  const filtered = h.calls.filter(call => call.type === 'draw' && ['sprite75', 'sprite55'].includes(call.symbol));
  assert.equal(filtered.length, 6, 'logo, music, heading and only three visible menu buttons');
  for (const call of filtered) {
    const canvas = h.canvases.find(canvas => canvas.id === call.id);
    assert.ok(canvas.width * canvas.height < h.canvas.width * h.canvas.height * .07,
      'every original parent filter is restricted to less than 7% of the native stage');
    assert.equal(call.matrix[0], 3180 / 640); assert.equal(call.matrix[3], 2385 / 480);
  }
  assert.equal(h.calls.filter(call => call.type === 'draw' && call.symbol === 'shape16').length, 1);
  assert.equal(h.view.cache.has('title-background:false'), false, 'music is no longer part of the full background key');
});

test('title component selectors retain the original parent effects while excluding all unrelated siblings', () => {
  const h = harness(); h.view.render(h.controller, h.renderer);
  for (const [id, symbols] of [[75, ['sprite12', 'sprite25', 'text31']], [55, ['button40', 'button42', 'button50']]]) {
    const calls = h.calls.filter(call => call.type === 'draw' && call.symbol === `sprite${id}`);
    assert.equal(calls.length, symbols.length);
    for (const [index, call] of calls.entries()) {
      for (const placement of layout.sprites[String(id)].placements) {
        const result = call.options.filter({ symbol: placement.symbol });
        if (placement.symbol !== symbols[index]) assert.equal(result, false);
        else assert.notEqual(result, false);
      }
      assert.notEqual(call.options.filter({ symbol: `sprite${id}` }), false, 'parent executes its original filters');
      assert.notEqual(call.options.filter({ symbol: 'font17' }), false, 'selected component descendants stay available');
    }
  }
});

test('title mute updates only its small music component and does not rebuild the background', () => {
  const h = harness(2560, 1920); h.view.render(h.controller, h.renderer);
  const background = h.view.cache.get('title-background'), count = h.canvases.length;
  const drawCount = h.calls.filter(call => call.type === 'draw').length;
  h.controller.muted = true; h.view.render(h.controller, h.renderer);
  assert.equal(h.canvases.length, count + 1);
  assert.equal(h.view.cache.get('title-background'), background);
  const added = h.calls.filter(call => call.type === 'draw').slice(drawCount);
  assert.equal(added.length, 1); assert.equal(added[0].symbol, 'sprite75');
  assert.deepEqual(added[0].options.filter({ symbol: 'sprite25' }), { frame: 1 });
  h.controller.muted = false; h.view.render(h.controller, h.renderer);
  assert.equal(h.canvases.length, count + 1, 'both small music states are bounded and reused');
});

test('menu slide lazily builds the original difficulty column without changing clipping or hot areas', () => {
  const h = harness(1920, 1440); h.view.render(h.controller, h.renderer);
  assert.deepEqual([...h.view.cache.keys()].filter(key => key.startsWith('title-button:')),
    ['title-button:button40', 'title-button:button42', 'title-button:button50']);
  h.controller.panel = 'difficulty'; h.view.menuFrom = h.view.menuTarget = -43; h.view.menuStarted = 0;
  h.view.render(h.controller, h.renderer);
  assert.equal([...h.view.cache.keys()].filter(key => key.startsWith('title-button:')).length, 8);
  assert.deepEqual(h.view.hotspots.filter(h => h.action === 'difficulty').map(h => h.value), [0, 1, 2, 3]);
  const easy = h.view.hotspots.find(h => h.action === 'difficulty' && h.value === 0);
  assert.equal(easy.left, 213); assert.equal(easy.right, 440);
  const before = h.canvases.length; h.view.render(h.controller, h.renderer);
  assert.equal(h.canvases.length, before);
});

test('title filter padding covers chained glow and shadow support even below 1x density', () => {
  for (const width of [320, 640, 3180]) {
    const h = harness(width, Math.round(width * .75)); h.view.render(h.controller, h.renderer);
    const placement = layout.sprites['75'].placements.find(p => p.symbol === 'text31');
    const layer = h.view.cache.get('title-component:text31'), info = h.view.layerInfo.get(layer);
    assert.ok(placement.bounds.xMin * h.view.scaleX - info.left >= 16);
    assert.ok(placement.bounds.yMin * h.view.scaleY - info.top >= 16);
    assert.ok(info.left + layer.width - placement.bounds.xMax * h.view.scaleX >= 16);
    assert.ok(info.top + layer.height - placement.bounds.yMax * h.view.scaleY >= 16);
  }
});

test('cold HUD bypasses empty numeric parent filters while preserving every static source placement', () => {
  const h = harness(3180, 2385); h.game();
  assert.equal(h.calls.filter(call => call.type === 'draw' && call.symbol === 'sprite210').length, 0);
  const dynamic = new Set(['sprite134', 'sprite135', 'sprite209', ...Array.from({ length: 7 }, (_, i) => `text${187 + i}`)]);
  for (const placement of layout.sprites['210'].placements) {
    if (dynamic.has(placement.symbol)) continue;
    const region = placement.bounds.yMin >= 400 ? 'hud-bottom' : 'hud-top';
    const canvas = h.view.cache.get(region);
    const m = placement.localMatrix;
    const expected = [.05 * m[0], .05 * m[1], .05 * m[2], .05 * m[3], m[4], m[5]];
    assert.ok(h.calls.some(call => call.type === 'draw' && call.symbol === placement.symbol && call.id === canvas.id &&
      call.options.matrix.every((value, index) => value === expected[index])), placement.name ?? placement.symbol);
  }
});


test('native cursor uses its exact continuous pulse, original alpha and complete time in a tight surface', () => {
  const h = harness(3180, 2385);
  const layer = h.view.cursorLayer('left', 21.27, 422.95, { scale: 1.137, alpha: .831 }, 17);
  const call = h.calls.findLast(call => call.type === 'draw'), info = h.view.layerInfo.get(layer);
  assert.notEqual(call.id, 'main'); assert.equal(call.symbol, 'sprite209');
  assert.equal(call.options.time, 17); assert.equal(call.options.frame, 0);
  assert.deepEqual(call.options.matrix, [.05 * 1.137, 0, 0, .05 * 1.137, 21.27, 422.95]);
  assert.equal(call.alpha, .831); assert.equal(h.canvas.ctx.globalAlpha, 1);
  assert.equal(layer.ctx.globalAlpha, 1, 'state is restored after rasterizing the original children');
  assert.deepEqual(call.matrix, [h.view.scaleX, 0, 0, h.view.scaleY, -info.left, -info.top]);
  assert.ok(layer.width < 250 && layer.height < 250, 'no stage-sized pattern target');
  h.view.compositeLayer(layer);
  const composite = h.calls.findLast(call => call.type === 'composite');
  close(composite.args[2] * h.view.scaleX, layer.width);
  close(composite.args[3] * h.view.scaleY, layer.height);
});

test('two fixed cursor slots reuse unchanged periodic frames and clear/redraw changing animations', () => {
  const h = harness(1920, 1440), pulse = { scale: 1, alpha: .8 };
  const left = h.view.cursorLayer('left', 21, 422.95, pulse, 0);
  const right = h.view.cursorLayer('right', 371, 423, pulse, 0);
  assert.equal(h.canvases.length, 2);
  assert.equal(h.view.cursorLayer('left', 21, 422.95, pulse, 10), left);
  assert.equal(h.calls.filter(call => call.type === 'draw').length, 2);
  for (let time = 1; time < 10; time++) {
    assert.equal(h.view.cursorLayer('left', 21, 422.95, pulse, time), left);
  }
  assert.equal(h.calls.filter(call => call.type === 'draw').length, 11);
  assert.equal(h.calls.filter(call => call.type === 'clear' && call.id === left.id).length, 10);
  h.view.cursorLayer('left', 21.27, 422.95, { scale: 1.137, alpha: .831 }, 9);
  assert.equal(h.canvases.length, 2, 'continuous pulse updates reuse the same backing canvas object');
  assert.equal(h.view.cursorLayers.right.canvas, right);
  assert.equal(h.view.getRenderStats().cacheCount, 2);
  assert.throws(() => h.view.cursorLayer('other', 0, 0, pulse, 0), /Unknown cursor side/);
  h.view.setRenderSize(2560, 1920);
  assert.equal(left.width, 0); assert.equal(right.width, 0);
  assert.equal(h.view.getRenderStats().cachedPixels, 0);
});

test('native cursor bounds include every original pixel plus padding across pulse scales and densities', () => {
  const b = layout.sprites['209'].localBounds;
  for (const width of [320, 640, 3180]) {
    const h = harness(width, Math.round(width * .75));
    for (const scale of [1, 1.013, 1.137, 1.293, 1.4]) {
      const x = 21.27, y = 422.95;
      const canvas = h.view.cursorLayer('left', x, y, { scale, alpha: .831 }, 9);
      const info = h.view.layerInfo.get(canvas);
      assert.ok((x + b.xMin * scale) * h.view.scaleX - info.left >= 2);
      assert.ok((y + b.yMin * scale) * h.view.scaleY - info.top >= 2);
      assert.ok(info.left + canvas.width - (x + b.xMax * scale) * h.view.scaleX >= 2);
      assert.ok(info.top + canvas.height - (y + b.yMax * scale) * h.view.scaleY >= 2);
    }
    assert.equal(h.canvases.length, 1);
  }
});

test('all ten original cursor morph frames remain inside the recovered sprite209 bounds', async () => {
  const source = await readFile(new URL('../generated/ui/original-graphics.js', import.meta.url), 'utf8');
  function body(name) { const start = source.indexOf(`function ${name}(`); return source.slice(start, source.indexOf('\nfunction ', start + 10)); }
  const animation = body('sprite205');
  assert.match(animation, /var frame_cnt = 10;/);
  assert.equal([...animation.matchAll(/case [0-9]:/g)].length, 10);
  for (const symbol of ['morphshape203', 'shape204']) {
    const paths = [...body(symbol).matchAll(/var pathData="([^"]+)"/g)].map(match => match[1]);
    assert.ok(paths.length > 0);
    // Morph coordinates interpolate between these endpoint values. Their
    // convex combinations cannot exceed the largest endpoint, 350 twips.
    for (const path of paths) for (const token of path.match(/-?\d+(?:\.\d+)?/g)) assert.ok(Math.abs(Number(token)) / 20 <= 17.5);
  }
  assert.deepEqual(layout.sprites['209'].localBounds, { xMin: -19, yMin: -19, xMax: 20, yMax: 19 });
  assert.match(body('shape207'), /M -380 -380 L 400 -380 400 380 -380 380/);
});


test('title component filters retain the original stage-edge clipping before shadows are computed', () => {
  for (const width of [640, 1920, 3180]) {
    const h = harness(width, Math.round(width * .75)); h.view.render(h.controller, h.renderer);
    const music = h.view.cache.get('title-component:sprite25:false'), info = h.view.layerInfo.get(music);
    assert.equal(info.left + music.width, width, 'off-stage music pixels must not re-enter through a blur kernel');
    assert.equal(info.top, 0);
    const logo = h.view.cache.get('title-component:sprite12'), logoInfo = h.view.layerInfo.get(logo);
    assert.equal(logoInfo.left, 0); assert.equal(logoInfo.top, 0);
    for (const [key, canvas] of h.view.cache) if (key.startsWith('title-component:')) {
      const metadata = h.view.layerInfo.get(canvas);
      assert.ok(metadata.left >= 0 && metadata.top >= 0);
      assert.ok(metadata.left + canvas.width <= width);
      assert.ok(metadata.top + canvas.height <= h.canvas.height);
    }
  }
});
