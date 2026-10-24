import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { OriginalGameView } from '../src/app/view.mjs';
import { dualAIMenuItems } from '../src/app/dual-ai-controls.mjs';

const layout = JSON.parse(readFileSync(new URL('../generated/ui/layout.generated.json', import.meta.url), 'utf8'));

function harness(width = 640, height = 480) {
  const calls = [], canvases = [];
  function canvas(id, width = 1, height = 1) {
    const element = { id, width, height }, stack = [];
    const ctx = { canvas: element, globalAlpha: 1,
      save() { stack.push({ globalAlpha: this.globalAlpha }); },
      restore() { Object.assign(this, stack.pop()); },
      setTransform() {}, clearRect() {}, beginPath() {}, rect() {}, clip() {}, fillRect() {},
      getImageData() { return { data: new Uint8ClampedArray([255, 128, 32, 255, 0, 255, 0, 128, 24, 66, 88, 0]) }; },
      putImageData(pixels, x, y) { calls.push({ type: 'pixels', id, pixels, x, y }); },
      drawImage(source, ...args) { calls.push({ type: 'image', id, source, args }); },
      fillText(text, x, y) { calls.push({ type: 'text', id, text, x, y, font: this.font, color: this.fillStyle,
        shadow: [this.shadowBlur, this.shadowOffsetX, this.shadowOffsetY] }); },
    };
    element.ctx = ctx; return element;
  }
  const graphics = { attach: element => element.ctx,
    draw(symbol, ctx, options) { calls.push({ type: 'symbol', symbol, id: ctx.canvas.id, options }); } };
  const view = new OriginalGameView(canvas('stage', width, height), graphics, layout, {}, {
    canvasFactory: () => { const element = canvas(`cache-${canvases.length}`); canvases.push(element); return element; },
  });
  const controller = { panel: 'dual-ai', muted: true, overlay: null,
    dualAIOptions: { leftDifficulty: 0, rightDifficulty: 3, applyDifficultyStats: true } };
  view.dualMenuStarted = 1000;
  return { view, controller, calls, canvases };
}

test('homepage replaces only the original credits slot, preserving the other two buttons and leaving no fourth entry', () => {
  const h = harness(); h.controller.panel = 'home'; h.view.title(h.controller);
  const menu = h.view.hotspots.filter(hit => hit.action !== 'music').sort((a, b) => a.top - b.top);
  assert.deepEqual(menu.map(hit => hit.action), ['single', 'dual', 'dual-ai']);
  assert.deepEqual(menu.map(hit => [hit.left, hit.top, hit.right, hit.bottom]), [
    [212, 216, 439, 262], [212, 272, 439, 318], [212, 328, 439, 374],
  ]);
  assert.equal(h.view.hit({ x: 325, y: 400 }), null, 'no fourth row is introduced');
  assert.ok(!h.view.hotspots.some(hit => hit.action === 'credits'));
  assert.ok(!h.view.cache.has('title-button:button50'), 'original credits text is never drawn below the replacement');
  assert.ok(h.calls.some(call => call.type === 'text' && call.text === '双 AI 对战'));
  assert.ok(h.calls.some(call => call.symbol === 'button50'), 'new wording reuses the same original slot button symbol');
});

test('AI setup draws all four original difficulty button symbols and preserves their unchanged text/filter children', () => {
  const h = harness(); h.view.dualAIMenu(h.controller, 1500);
  for (const symbol of ['button44', 'button46', 'button48', 'button54']) {
    const calls = h.calls.filter(call => call.type === 'symbol' && call.symbol === symbol);
    assert.ok(calls.length >= 1 && calls.length <= 2, `${symbol} uses at most its normal and selected caches`);
    for (const call of calls) {
      assert.equal(call.options.filter({ symbol: 'shape34' }), false, 'the state background is composed separately');
      for (const text of ['text43', 'text45', 'text47', 'text53']) {
        assert.equal(call.options.filter({ symbol: text }), undefined, 'recovered difficulty glyphs and original parent filter remain untouched');
      }
    }
  }
  const captions = h.calls.filter(call => call.type === 'text').map(call => call.text);
  assert.deepEqual(captions, ['红方 AI', '蓝方 AI', '开始对战', '数值加成：开启', '使用各自难度数值']);
  assert.ok(!captions.some(text => /简单|困难|不可战胜/.test(text)), 'difficulty text is not replaced by native font rendering');
  const parent = h.calls.find(call => call.symbol === 'sprite55');
  assert.ok(parent, 'Back retains its recovered parent shadow');
  for (const placement of layout.sprites['55'].placements) {
    assert.equal(parent.options.filter({ symbol: placement.symbol }), placement.symbol === 'button52' ? undefined : false,
      'the parent retains only the original Back child, never an underlying original menu');
  }
  const colors = h.calls.filter(call => call.type === 'pixels');
  assert.equal(colors.length, 6, 'four normal difficulty states plus two selected states use the recovered gray matrix');
  for (const { pixels } of colors) assert.deepEqual([...pixels.data], [159, 159, 159, 255, 155, 155, 155, 128, 55, 55, 55, 0]);
});

test('menu up, hover/selected and pressed states reuse the three existing original bitmap shapes', () => {
  const h = harness(), item = dualAIMenuItems({ panel: 'dual-ai', options: h.controller.dualAIOptions })
    .find(item => item.action === 'dual-ai-left' && item.value === 1);
  const backgrounds = () => h.calls.filter(call => ['shape34', 'shape37', 'shape39'].includes(call.symbol)).map(call => call.symbol);
  h.view.originalMenuButton(item); assert.deepEqual(backgrounds(), ['shape34']);
  h.view.pointer = { x: (item.left + item.right) / 2, y: (item.top + item.bottom) / 2 };
  h.view.originalMenuButton(item); assert.deepEqual(backgrounds(), ['shape34', 'shape37']);
  h.view.pressed = { action: item.action, value: item.value };
  h.view.originalMenuButton(item); assert.deepEqual(backgrounds(), ['shape34', 'shape37', 'shape39']);
  h.view.pointer = null; h.view.pressed = null;
  h.view.originalMenuButton({ ...item, selected: true });
  assert.deepEqual(backgrounds(), ['shape34', 'shape37', 'shape39'], 'selected reuses existing hover artwork without allocating a second skin');
  for (let frame = 0; frame < 100; frame++) h.view.originalMenuButton(item);
  assert.equal(h.canvases.length, 3, 'state caches are bounded, not allocated per rendered frame');
});

test('new menu wording uses original button artwork, 18px bold Yahei baseline and a padded native-density shadow', () => {
  for (const density of [.5, 1, 2.5, 4]) {
    const h = harness(640 * density, 480 * density), [item] = dualAIMenuItems({ panel: 'home' });
    h.view.originalMenuButton(item);
    const symbol = h.calls.find(call => call.symbol === 'button50');
    assert.equal(symbol.options.filter({ symbol: 'text49' }), false);
    assert.ok(h.calls.some(call => call.symbol === 'shape34'));
    const text = h.calls.find(call => call.type === 'text');
    assert.equal(text.text, '双 AI 对战'); assert.equal(text.font, "700 18px OriginalYahei, 'Microsoft YaHei', sans-serif");
    assert.deepEqual([text.x, text.y], [113.5, 30.7]);
    assert.deepEqual(text.shadow, [5 * density, density, density]);
    const layer = h.canvases[0], info = h.view.layerInfo.get(layer);
    assert.ok(info.left <= -16 && info.top <= -16, 'padding covers original filters even below native density');
    assert.ok(layer.width > 227 * density && layer.height > 46 * density);
    const composite = h.calls.find(call => call.type === 'image');
    assert.equal(composite.args[0], item.left + info.left / density);
    assert.equal(composite.args[1], item.top + info.top / density);
    assert.equal(composite.args[2] * density, layer.width);
    assert.equal(composite.args[3] * density, layer.height);
  }
});

test('AI setup waits for the original half-second eased split before exposing only its visible canvas targets', () => {
  const h = harness();
  for (const now of [1000, 1125, 1250, 1499]) {
    h.view.hotspots = []; h.view.dualAIMenu(h.controller, now);
    assert.equal(h.view.hotspots.length, 0, 'moving or overlapping columns cannot dispatch an accidental difficulty');
  }
  h.view.dualAIMenu(h.controller, 1500);
  assert.equal(h.view.hotspots.length, 11);
  const expected = dualAIMenuItems({ panel: 'dual-ai', options: h.controller.dualAIOptions });
  for (const item of expected) {
    const hit = h.view.hit({ x: (item.left + item.right) / 2, y: (item.top + item.bottom) / 2 });
    assert.equal(hit.action, item.action); assert.equal(hit.value, item.value); assert.equal(hit.side, item.side);
  }
});

test('home replacement button hit region stays inside the original animated menu mask, including when completely hidden', () => {
  const h = harness(); h.controller.panel = 'home';
  const clip = layout.sprites['75'].placements.find(part => part.symbol === 'shape32').bounds;
  for (const offset of [-255, -120, -30, 0, 200]) {
    h.view.hotspots = []; h.view.dualAIMenu(h.controller, 1500, offset);
    for (const hit of h.view.hotspots) {
      assert.ok(hit.left >= clip.xMin && hit.right <= clip.xMax);
      assert.ok(hit.top >= clip.yMin && hit.bottom <= clip.yMax);
    }
    if (offset === -255) assert.equal(h.view.hotspots.length, 0, 'invisible home entry cannot intercept other controls');
  }
});

test('native resolution and stat-toggle captions do not alter logical button positions or create battle HUD controls', () => {
  let expected;
  for (const [width, height] of [[320, 240], [640, 480], [1920, 1440], [3180, 2385]]) {
    const h = harness(width, height); h.controller.dualAIOptions.applyDifficultyStats = false;
    h.view.dualAIMenu(h.controller, 1500);
    if (!expected) expected = h.view.hotspots;
    else assert.deepEqual(h.view.hotspots, expected);
    const captions = h.calls.filter(call => call.type === 'text').map(call => call.text);
    assert.ok(captions.includes('数值加成：关闭')); assert.ok(captions.includes('双方使用当前普通档'));
    assert.ok(h.view.hotspots.every(item => !/recruit|pause/.test(item.action)));
  }
});
