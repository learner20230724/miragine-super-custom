import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { OriginalGameView } from '../src/app/view.mjs';
import { GameController } from '../src/app/controller.mjs';

const root = new URL('../', import.meta.url);
const defaults = JSON.parse(await readFile(new URL('config/defaults.generated.json', root), 'utf8'));
const layout = JSON.parse(await readFile(new URL('generated/ui/layout.generated.json', root), 'utf8'));

function harness(options = {}) {
  const calls = [], canvases = [];
  function canvas(id) {
    const result = { id, width: 640, height: 480 };
    const stack = [];
    const ctx = { canvas: result, font: '', globalAlpha: 1, globalCompositeOperation: 'source-over',
      save() { stack.push({ globalAlpha: this.globalAlpha, globalCompositeOperation: this.globalCompositeOperation }); },
      restore() { Object.assign(this, stack.pop()); },
      setTransform(...args) { calls.push({ type: 'transform', canvas: id, args }); },
      translate(...args) { calls.push({ type: 'translate', canvas: id, args }); },
      scale(...args) { calls.push({ type: 'scale', canvas: id, args }); },
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
    drawText(text, ctx, options) { calls.push({ type: 'number', text, canvas: ctx.canvas.id, options,
      shadow: { color: ctx.shadowColor, blur: ctx.shadowBlur, x: ctx.shadowOffsetX, y: ctx.shadowOffsetY } }); },
  };
  const config = structuredClone(defaults);
  const controller = new GameController(config);
  const view = new OriginalGameView(main, graphics, layout, config, { canvasFactory() {
    const target = canvas(`cache-${canvases.length}`);
    canvases.push(target);
    return target;
  }, ...options });
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
  for (const target of h.canvases) assert.ok(target.width <= 640 && target.height <= 96, 'HUD caches are cropped instead of stage-sized');
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
  assert.deepEqual([...h.view.cache.keys()].sort(), ['game-controls', 'hud-bottom', 'hud-top']);
  assert.throws(() => h.view.barLayer('another-bar', 1, () => {}), /Unknown health-bar/);
});

test('crisp text mode omits only the original help and quit sprites and their canvas hit areas', () => {
  const h = harness({ crispTextControls: true });
  h.controller.action('dual'); h.controller.action('tutorial-okay');
  for (let frame = 0; frame < 20; frame++) h.paint();
  assert.equal(h.view.cache.has('game-controls'), false);
  assert.equal(h.count(call => call.type === 'symbol' && ['button215', 'button230'].includes(call.symbol)), 0);
  assert.equal(h.view.hotspots.filter(hotspot => ['tutorial', 'quit'].includes(hotspot.action)).length, 0);
  assert.equal(h.view.hotspots.filter(hotspot => hotspot.action === 'unit').length, 32);
  for (const action of ['minimap', 'music']) assert.equal(h.view.hotspots.filter(hotspot => hotspot.action === action).length, 1);
  assert.ok(h.count(call => call.type === 'symbol' && call.symbol === 'sprite25') > 0);
  assert.equal(h.view.tooltipLayouts.size, 0);
  assert.ok(h.canvases.every(canvas => canvas.width <= 640 && canvas.height <= 96), 'crisp controls preserve tightly cropped native-density HUD targets');
});

test('custom health displays stay finite and bounded at extreme values without changing underlying HP', () => {
  const h = harness();
  h.controller.action('dual'); h.controller.action('tutorial-okay');
  h.config.customization = {};
  const boss = h.controller.simulation.redBoss;
  for (const [current, maximum, expected] of [
    [Number.MAX_VALUE, Number.MIN_VALUE, 1],
    [Number.MAX_VALUE, Number.MAX_VALUE, 1],
    [Number.MAX_VALUE / 2, Number.MAX_VALUE, .5],
    [Number.MIN_VALUE, Number.MAX_VALUE, 0],
    [20, 10, 1], [-1, 10, 0], [0, 0, 0],
  ]) {
    boss.nowHP = current; boss.maxHP = maximum;
    h.paint();
    assert.equal(h.view.barLayers.leftBar.ratio, expected);
    assert.equal(boss.nowHP, current); assert.equal(boss.maxHP, maximum);
    const bar = h.calls.findLast(call => call.type === 'bar-filter' && call.canvas === h.view.barLayers.leftBar.canvas.id);
    assert.ok(bar.matrix.every(Number.isFinite));
    assert.ok(bar.matrix[0] >= 0 && bar.matrix[0] <= 1);
  }
  delete h.config.customization;
  boss.nowHP = 20; boss.maxHP = 10; h.paint();
  assert.equal(h.view.barLayers.leftBar.ratio, 2, 'the noncustom baseline retains its original finite overheal display');
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

test('seven numeric HUD slots reuse unchanged glyphs and apply changed values without adding canvases', () => {
  const h = harness();
  h.controller.action('dual'); h.controller.action('tutorial-okay');
  h.paint();
  const names = ['time', 'leftMoney', 'leftIncome', 'leftPopulation', 'rightMoney', 'rightIncome', 'rightPopulation'];
  const count = h.canvases.length;
  const moneyCanvas = h.view.numberLayers.leftMoney.canvas;
  assert.deepEqual(Object.keys(h.view.numberLayers), names);
  assert.equal(h.count(call => call.type === 'number'), 7);
  for (let frame = 0; frame < 100; frame++) h.paint();
  assert.equal(h.count(call => call.type === 'number'), 7);
  h.controller.simulation.leftMoney = 999;
  h.paint();
  assert.equal(h.count(call => call.type === 'number'), 8);
  assert.equal(h.calls.findLast(call => call.type === 'number').text, '999');
  assert.equal(h.view.numberLayers.leftMoney.canvas, moneyCanvas);
  assert.equal(h.count(call => call.type === 'clear' && call.canvas === moneyCanvas.id), 2);
  for (let value = 1000; value < 1200; value++) { h.controller.simulation.leftMoney = value; h.paint(); }
  assert.equal(h.canvases.length, count);
  assert.deepEqual(Object.keys(h.view.numberLayers), names);
  assert.deepEqual([...h.view.cache.keys()].sort(), ['game-controls', 'hud-bottom', 'hud-top']);
  assert.throws(() => h.view.numeric('unknown', 1, 11, 'left'), /Unknown numeric HUD field/);
  assert.throws(() => h.view.numberLayer('unknown', '1', () => {}), /Unknown numeric HUD field/);
});

test('numeric revisions include original typography, alignment and fractional baseline', () => {
  const h = harness();
  h.view.layout = structuredClone(layout);
  h.view.numeric('time', 12, 22, 'center');
  const canvas = h.view.numberLayers.time.canvas;
  const first = h.calls.findLast(call => call.type === 'number');
  assert.equal(first.options.size, 21, 'keep the recovered font size, not the historical unused argument');
  assert.equal(first.options.font, 'font17');
  assert.equal(first.options.y, 28.45);
  assert.deepEqual(first.shadow, { color: '#000', blur: 3, x: 1, y: 1 });
  h.view.numeric('time', 12, 22, 'center');
  assert.equal(h.count(call => call.type === 'number'), 1);
  h.view.numeric('time', 12, 22, 'right');
  assert.equal(h.count(call => call.type === 'number'), 2);
  h.view.instance(210, 'time').text.fontSize = 20;
  h.view.instance(210, 'time').localMatrix[5] += .25;
  h.view.numeric('time', 12, 22, 'right');
  const last = h.calls.findLast(call => call.type === 'number');
  assert.equal(last.options.size, 20);
  assert.equal(last.options.y, 28.7);
  assert.equal(h.view.numberLayers.time.canvas, canvas);
  assert.equal(h.count(call => call.type === 'clear' && call.canvas === canvas.id), 3);
});

test('maximum safe integer HUD values fit each recovered field using finite horizontal-only scaling', () => {
  const h = harness();
  const text = String(Number.MAX_SAFE_INTEGER);
  let scaledFields = 0;
  for (const name of ['time', 'leftMoney', 'leftIncome', 'leftPopulation', 'rightMoney', 'rightIncome', 'rightPopulation']) {
    const align = name === 'time' ? 'center' : name.startsWith('right') ? 'right' : 'left';
    h.view.numeric(name, Number.MAX_SAFE_INTEGER, 11, align);
    const target = h.view.numberLayers[name].canvas.id;
    const scale = h.calls.findLast(call => call.type === 'scale' && call.canvas === target);
    const moves = h.calls.filter(call => call.type === 'translate' && call.canvas === target);
    const number = h.calls.findLast(call => call.type === 'number' && call.canvas === target);
    const field = h.view.instance(210, name), width = field.bounds.xMax - field.bounds.xMin - 4;
    const estimatedWidth = text.length * field.text.fontSize * .62;
    const expectedScale = Math.min(1, width / estimatedWidth);
    assert.equal(number.text, text, 'large balances must not silently switch to inaccurate or truncated notation');
    assert.ok(estimatedWidth * expectedScale <= width + 1e-10);
    if (expectedScale < 1) {
      scaledFields++;
      assert.ok(scale.args.every(Number.isFinite));
      assert.equal(scale.args[0], expectedScale);
      assert.equal(scale.args[1], 1, 'only width changes, not glyph height or recovered baseline');
      assert.deepEqual(moves.map(call => call.args), [[number.options.x, 0], [-number.options.x, 0]]);
    } else {
      assert.equal(scale, undefined, 'wide original fields keep their native glyph width when the full integer already fits');
      assert.deepEqual(moves, []);
    }
    assert.equal(number.options.y, field.localMatrix[5] + field.text.exportedBaseline);
    assert.equal(number.options.font, field.text.font);
    assert.equal(number.options.size, field.text.fontSize);
    assert.ok(h.view.numberLayers[name].canvas.width <= 140 && h.view.numberLayers[name].canvas.height <= 46, 'counter cache is cropped with shadow padding');
  }
  const renders = h.count(call => call.type === 'number');
  h.view.numeric('leftMoney', Number.MAX_SAFE_INTEGER, 11, 'left');
  assert.equal(h.count(call => call.type === 'number'), renders, 'large balances still reuse the fixed numeric cache');
  h.view.numeric('leftMoney', 1, 11, 'left');
  assert.equal(h.count(call => call.type === 'number'), renders + 1);
  assert.ok(scaledFields > 0, 'the recovered timer field exercises the long-value fit path');
  assert.equal(h.count(call => call.type === 'scale'), scaledFields, 'normal-sized values retain unscaled original glyphs');
});

test('numeric cached layers composite at the original position between health bars and animated cursors', () => {
  const h = harness();
  h.controller.action('dual'); h.controller.action('tutorial-okay');
  h.paint();
  const numbers = Object.values(h.view.numberLayers).map(slot => slot.canvas.id);
  const mainNumbers = h.calls.filter(call => call.type === 'composite' && call.canvas === 'main' && numbers.includes(call.source));
  assert.deepEqual(mainNumbers.map(call => call.source), numbers);
  for (const [index, slot] of Object.values(h.view.numberLayers).entries()) {
    const { left, top } = h.view.layerInfo.get(slot.canvas);
    assert.deepEqual(mainNumbers[index].args, [left, top, slot.canvas.width, slot.canvas.height]);
  }
  const bar = h.calls.findIndex(call => call.type === 'composite' && call.source === h.view.barLayers.rightBar.canvas.id);
  const first = h.calls.indexOf(mainNumbers[0]), last = h.calls.indexOf(mainNumbers.at(-1));
  const cursor = h.calls.findIndex(call => call.type === 'symbol' && call.symbol === 'sprite209');
  assert.ok(bar < first && last < cursor);
  for (const slot of Object.values(h.view.numberLayers)) assert.ok(slot.canvas.width <= 140 && slot.canvas.height <= 46);
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
  assert.equal(h.view.cache.size, 9); // Background, three title components, three visible buttons, two results.
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

test('side-specific tooltips read independent definitions and reuse at most 32 side/unit slots', () => {
  const h = harness();
  h.config.customization = { sides: { left: { units: structuredClone(h.config.units) }, right: { units: structuredClone(h.config.units) } } };
  h.config.customization.sides.left.units[0].hp = 123;
  h.config.customization.sides.right.units[0].hp = 456;
  for (const [side, prefix, expected] of [['left', 'a', 'HP:123'], ['right', 'b', 'HP:456']]) {
    const card = layout.sprites['210'].instances[`${prefix}0`];
    h.view.hotspots = []; h.view.hotspot('unit', card, { side, id: 0 });
    h.view.pointer = { x: (card.bounds.xMin + card.bounds.xMax) / 2, y: (card.bounds.yMin + card.bounds.yMax) / 2 };
    const start = h.calls.length;
    h.view.tooltip(h.controller);
    assert.ok(h.calls.slice(start).some(call => call.type === 'native-text' && call.text === expected));
  }
  assert.deepEqual([...h.view.tooltipLayouts.keys()], ['left:0', 'right:0']);
  for (let iteration = 0; iteration < 20; iteration++) for (const side of ['left', 'right']) for (let id = 0; id < 16; id++) {
    const unit = h.config.customization.sides[side].units[id];
    unit.hp += 1;
    h.view.tooltipLayout(id, unit, h.main.ctx, side);
  }
  assert.equal(h.view.tooltipLayouts.size, 32);
  assert.equal(h.config.units[0].hp, defaults.units[0].hp, 'per-side tooltip edits must not mutate the shared default unit');
  for (const side of ['left', 'right']) for (let id = 0; id < 16; id++) {
    const unit = h.config.customization.sides[side].units[id];
    h.view.tooltipLayout(id, unit, h.main.ctx, side);
    const measured = h.count(call => call.type === 'measure');
    h.view.tooltipLayout(id, unit, h.main.ctx, side);
    assert.equal(h.count(call => call.type === 'measure'), measured);
  }
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
