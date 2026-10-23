import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { OriginalGameView } from '../src/app/view.mjs';
import { GameController } from '../src/app/controller.mjs';

const root = new URL('../', import.meta.url);
const defaults = JSON.parse(await readFile(new URL('config/defaults.generated.json', root), 'utf8'));
const layout = JSON.parse(await readFile(new URL('generated/ui/layout.generated.json', root), 'utf8'));

function harness() {
  const calls = [], canvases = [];
  function canvas(id) {
    const result = { id, width: 640, height: 480 };
    const stack = [];
    const ctx = { canvas: result, font: '', globalAlpha: 1, globalCompositeOperation: 'source-over',
      save() { stack.push({ globalAlpha: this.globalAlpha, globalCompositeOperation: this.globalCompositeOperation }); },
      restore() { Object.assign(this, stack.pop()); },
      setTransform(...args) { calls.push({ type: 'transform', canvas: id, args }); },
      clearRect(...args) { calls.push({ type: 'clear', canvas: id, args }); },
      drawImage(source, ...args) { calls.push({ type: 'composite', canvas: id, source: source.id, args }); },
      fillText(text, ...args) { calls.push({ type: 'native-text', canvas: id, text, args }); },
      measureText(text) { calls.push({ type: 'measure', text }); return { width: [...text].length * 7 }; },
      fillRect(...args) { calls.push({ type: 'fill-rect', canvas: id, args }); },
      roundRect(...args) { calls.push({ type: 'round-rect', canvas: id, args }); },
      beginPath() {}, fill() {}, stroke() {}, rect() {}, clip() {}, arc() {}, strokeRect() {},
    };
    result.getContext = () => ctx;
    result.ctx = ctx;
    return result;
  }
  const main = canvas('main');
  const graphics = {
    attach: target => target.ctx,
    draw(symbol, ctx, options) {
      calls.push({ type: 'symbol', symbol, canvas: ctx.canvas.id, matrix: [...options.matrix],
        frame: options.frame, time: options.time, alpha: ctx.globalAlpha });
      if (symbol === 'sprite134') {
        const result = options.filter({ symbol: 'sprite131', matrix: [1, 0, 0, 1, 120, 0] });
        calls.push({ type: 'bar-filter', canvas: ctx.canvas.id, matrix: result.matrix });
      }
      if (symbol === 'sprite258') for (const symbol of ['sprite247', 'sprite253']) {
        calls.push({ type: 'result-filter', symbol, matrix: options.filter({ symbol, matrix: [1, 0, 0, 1, 0, 0] }).matrix });
      }
    },
    drawText(text, ctx, options) { calls.push({ type: 'number', text, canvas: ctx.canvas.id, options }); },
  };
  const config = structuredClone(defaults);
  const controller = new GameController(config);
  const view = new OriginalGameView(main, graphics, layout, config, { canvasFactory() {
    const target = canvas(`cache-${canvases.length}`);
    canvases.push(target);
    return target;
  } });
  const renderer = { render() { calls.push({ type: 'world' }); return {}; } };
  function paint() { view.hotspots = []; view.hud(controller, renderer); }
  const count = predicate => calls.filter(predicate).length;
  return { calls, canvases, main, view, config, controller, renderer, paint, count };
}

test('static game buttons rasterize once at original coordinates and composite after the minimap', () => {
  const h = harness();
  h.controller.action('dual'); h.controller.action('tutorial-okay');
  const minimap = h.view.minimap.bind(h.view);
  h.view.minimap = sim => { h.calls.push({ type: 'minimap' }); minimap(sim); };
  h.paint();
  const controls = h.view.cache.get('game-controls');
  for (const [name, symbol] of [['tipopen', 'button215'], ['bnquit', 'button230']]) {
    const original = layout.rootFrames.game.instances[name].localMatrix;
    const draw = h.calls.find(call => call.type === 'symbol' && call.symbol === symbol);
    assert.equal(draw.canvas, controls.id);
    assert.deepEqual(draw.matrix, [.05, 0, 0, .05, original[4], original[5]]);
  }
  const mapIndex = h.calls.findIndex(call => call.type === 'minimap');
  const controlsIndex = h.calls.findIndex(call => call.type === 'composite' && call.canvas === 'main' && call.source === controls.id);
  const musicIndex = h.calls.findIndex(call => call.type === 'symbol' && call.canvas === 'main' && call.symbol === 'sprite25');
  assert.ok(mapIndex < controlsIndex && controlsIndex < musicIndex);
  for (let frame = 0; frame < 30; frame++) h.paint();
  assert.equal(h.count(call => call.type === 'symbol' && call.symbol === 'button215'), 1);
  assert.equal(h.count(call => call.type === 'symbol' && call.symbol === 'button230'), 1);
  assert.equal(h.view.hotspots.filter(hotspot => hotspot.action === 'unit').length, 32);
  assert.equal(h.view.hotspots.filter(hotspot => hotspot.action === 'tutorial').length, 1);
  assert.equal(h.view.hotspots.filter(hotspot => hotspot.action === 'quit').length, 1);
  for (const target of h.canvases) assert.deepEqual([target.width, target.height], [640, 480]);
});

test('health bars use two bounded canvases and redraw only when the displayed ratio changes', () => {
  const h = harness();
  h.controller.action('dual'); h.controller.action('tutorial-okay');
  h.paint();
  const left = h.view.barLayers.leftBar.canvas, right = h.view.barLayers.rightBar.canvas;
  const initialCanvasCount = h.canvases.length;
  h.paint();
  assert.equal(h.count(call => call.type === 'symbol' && call.symbol === 'sprite134'), 2);
  h.controller.simulation.redBoss.nowHP /= 2;
  h.paint();
  assert.equal(h.count(call => call.type === 'symbol' && call.symbol === 'sprite134'), 3);
  assert.equal(h.view.barLayers.leftBar.canvas, left);
  assert.equal(h.view.barLayers.rightBar.canvas, right);
  assert.equal(h.count(call => call.type === 'clear' && call.canvas === left.id), 2);
  assert.equal(h.count(call => call.type === 'clear' && call.canvas === right.id), 1);
  // Same ratio with different absolute values produces the same original mask.
  h.controller.simulation.redBoss.nowHP *= 2;
  h.controller.simulation.redBoss.maxHP *= 2;
  h.paint();
  assert.equal(h.count(call => call.type === 'symbol' && call.symbol === 'sprite134'), 3);
  for (let hp = 1; hp <= 200; hp++) { h.controller.simulation.redBoss.nowHP = hp; h.paint(); }
  assert.equal(h.canvases.length, initialCanvasCount);
  assert.deepEqual(Object.keys(h.view.barLayers).sort(), ['leftBar', 'rightBar']);
  assert.deepEqual([...h.view.cache.keys()].sort(), ['game-controls', 'hud']);
  assert.throws(() => h.view.barLayer('another-bar', 1, () => {}), /Unknown health-bar/);
});

test('dynamic numbers and cursor animation remain live while surrounding graphics are cached', () => {
  const h = harness();
  h.controller.action('dual'); h.controller.action('tutorial-okay');
  h.paint();
  h.controller.simulation.leftMoney = 999;
  h.controller.simulation.frame = 17;
  h.controller.cursorPresentation.left = { scale: 1.3, alpha: .95 };
  h.paint();
  assert.ok(h.calls.some(call => call.type === 'number' && call.text === '999'));
  const cursor = h.calls.filter(call => call.type === 'symbol' && call.symbol === 'sprite209');
  assert.equal(cursor.length, 4);
  assert.equal(cursor[2].time, 17);
  assert.equal(cursor[2].alpha, .95);
  assert.equal(cursor[2].matrix[0], .05 * 1.3);
});

test('tutorial/quit overlays keep original direct-context stacking and pointer interception', () => {
  const h = harness();
  h.controller.action('dual');
  for (let frame = 0; frame < 5; frame++) { h.view.hotspots = []; h.view.overlay(h.controller); }
  assert.equal(h.count(call => call.type === 'symbol' && call.symbol === 'sprite228'), 5);
  h.controller.action('quit');
  h.view.hotspots = [];
  const start = h.calls.length;
  h.view.overlay(h.controller);
  const overlays = h.calls.slice(start).filter(call => call.type === 'symbol');
  assert.deepEqual(overlays.map(call => [call.symbol, call.canvas]), [['sprite228', 'main'], ['sprite238', 'main']]);
  assert.equal(h.view.hit({ x: 20, y: 440 }).action, 'blocked');
  for (let frame = 0; frame < 20; frame++) { h.view.hotspots = []; h.view.overlay(h.controller); }
  assert.equal(h.count(call => call.type === 'symbol' && call.symbol === 'sprite238'), 21);
  assert.equal(h.count(call => call.type === 'symbol' && call.symbol === 'sprite228'), 26);
  assert.equal(h.view.cache.size, 0, 'translucent overlays must never be flattened into cache layers');
  assert.equal(h.canvases.length, 0);
  assert.equal(h.view.hotspots.filter(hotspot => hotspot.action === 'quit-cancel').length, 1);
  assert.equal(h.view.hotspots.filter(hotspot => hotspot.action === 'tutorial-okay').length, 1);
});

test('credits stay direct-context while both result layouts have finite caches and original winner positions', () => {
  const h = harness();
  h.controller.action('credits');
  for (let frame = 0; frame < 10; frame++) { h.view.hotspots = []; h.view.title(h.controller); }
  assert.equal(h.count(call => call.type === 'symbol' && call.symbol === 'sprite74'), 10);
  assert.ok(h.calls.filter(call => call.type === 'symbol' && call.symbol === 'sprite74').every(call => call.canvas === 'main'));
  assert.equal(h.view.cache.has('credits'), false);
  h.controller.startMatch(false);
  for (const winner of ['left', 'right', 'left', 'right']) {
    h.controller.simulation.winner = winner;
    h.view.hotspots = [];
    h.view.results(h.controller);
    assert.equal(h.view.hotspots.filter(hotspot => hotspot.action === 'home').length, 1);
    assert.equal(h.view.hotspots.filter(hotspot => hotspot.action === 'replay').length, 1);
  }
  assert.equal(h.count(call => call.type === 'symbol' && call.symbol === 'sprite258'), 2);
  const resultFilters = h.calls.filter(call => call.type === 'result-filter');
  assert.deepEqual(resultFilters.map(call => [call.symbol, call.matrix[4]]), [
    ['sprite247', 159 * 20], ['sprite253', 484 * 20],
    ['sprite247', 484 * 20], ['sprite253', 159 * 20],
  ]);
  assert.equal(h.view.cache.size, 4); // background, sliding strip, two results.
});

test('tooltip layout is reused while pointer placement stays live and config edits invalidate the same slot', () => {
  const h = harness();
  const card = layout.sprites['210'].instances.a0.bounds;
  h.view.hotspot('unit', layout.sprites['210'].instances.a0, { side: 'left', id: 0 });
  h.view.pointer = { x: (card.xMin + card.xMax) / 2, y: (card.yMin + card.yMax) / 2 };
  h.view.tooltip(h.controller);
  const measured = h.count(call => call.type === 'measure');
  const firstPosition = h.calls.findLast(call => call.type === 'round-rect').args;
  assert.ok(measured > 0);
  h.view.pointer.x += 1;
  h.view.tooltip(h.controller);
  assert.equal(h.count(call => call.type === 'measure'), measured);
  assert.equal(h.calls.findLast(call => call.type === 'round-rect').args[0], firstPosition[0] + 1);
  h.config.units[0].hp = 99;
  h.config.units[0].cost = 7;
  h.config.units[0].damage[0] = 123;
  h.view.tooltip(h.controller);
  assert.ok(h.count(call => call.type === 'measure') > measured);
  assert.ok(h.calls.some(call => call.type === 'native-text' && call.text === 'HP:99'));
  assert.ok(h.calls.some(call => call.type === 'native-text' && call.text === '攻击力对轻甲:123'));
  assert.equal(h.view.tooltipLayouts.size, 1);
  for (let id = 0; id < 16; id++) h.view.tooltipLayout(id, h.config.units[id], h.main.ctx);
  for (let hp = 100; hp < 200; hp++) { h.config.units[0].hp = hp; h.view.tooltipLayout(0, h.config.units[0], h.main.ctx); }
  assert.equal(h.view.tooltipLayouts.size, 16);
  assert.throws(() => h.view.tooltipLayout(16, h.config.units[0], h.main.ctx), /Unknown tooltip unit/);
});

test('original button shadows draw on transparent intermediate canvases, never read the existing battlefield', async () => {
  const graphics = await readFile(new URL('generated/ui/original-graphics.js', root), 'utf8');
  for (const symbol of ['button215', 'button230']) {
    const start = graphics.indexOf(`function ${symbol}(`);
    const end = graphics.indexOf('\nfunction ', start + 1);
    const body = graphics.slice(start, end);
    assert.match(body, /createCanvas\(canvas\.width,canvas\.height\)/);
    assert.match(body, /ctx = fctx;[\s\S]*Filters\.dropShadow\(fcanvas,fcanvas\.getContext\("2d"\)/);
    assert.doesNotMatch(body, /getImageData\(/);
    assert.match(body, /ctx = oldctx;[\s\S]*ctx\.drawImage\(fcanvas,0,0\)/);
  }
});
