import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { OriginalGameView } from '../src/app/view.mjs';

const root = new URL('../', import.meta.url);
const layout = JSON.parse(await readFile(new URL('generated/ui/layout.generated.json', root), 'utf8'));

function harness(sourceLayout = layout) {
  const labels = [];
  const view = Object.create(OriginalGameView.prototype);
  Object.assign(view, {
    layout: sourceLayout,
    ctx: { globalAlpha: 1, save() {}, restore() {}, drawImage() {} },
    cached() {}, barLayer() { return {}; }, numeric() {}, draw() {},
    minimap() {}, hotspot() {}, drawInstance() {}, tooltip() {},
    label(...args) { labels.push(args); },
  });
  const controller = {
    singlePlay: true, difficulty: 1, muted: false, overlay: null,
    cursorPresentation: { left: { alpha: 1, scale: 1 }, right: { alpha: 1, scale: 1 } },
    simulation: {
      renderSnapshot: [], renderCamera: {}, redBoss: { nowHP: 5000, maxHP: 5000 },
      blueBoss: { nowHP: 5000, maxHP: 5000 }, p1: [0, 0], p2: [0, 0],
      timeSeconds: 30, frame: 1, winner: null,
    },
  };
  return { view, controller, labels, paint() { view.hud(controller, { render() { return {}; } }); } };
}

test('difficulty field preserves the original root placement, internal RECT, font and glyph baseline evidence', async () => {
  const field = layout.rootFrames.game.instances.tt;
  assert.equal(layout.rootFrames.game.frame, 19);
  assert.equal(field.characterId, 213);
  assert.equal(field.depth, 147);
  assert.equal(layout.sprites['210'].instances.tt, undefined, 'tt is a root sibling of the HUD');
  assert.deepEqual(field.localMatrix, [1, 0, 0, 1, 467.1, 93]);
  assert.deepEqual(field.localBounds, { xMin: 66.9, yMin: -2, xMax: 162.9, yMax: 20.45 });
  assert.deepEqual(field.bounds, { xMin: 534, yMin: 91, xMax: 630, yMax: 113.45 });
  assert.equal(field.text.align, 1);
  assert.equal(field.text.font, 'font17');
  assert.equal(field.text.fontSize, 12);
  assert.equal(field.text.exportedBaseline, 12.7);

  const xml = await readFile(new URL('recovered/super.xml', root), 'utf8');
  const definition = xml.match(/<item type="DefineEditTextTag"[^>]*characterID="213"[^>]*>[\s\S]*?<\/item>/)[0];
  assert.match(definition, /align="1"/);
  assert.match(definition, /fontHeight="240" fontId="17"/);
  assert.match(definition, /Xmax="3258" Xmin="1338" Ymax="409" Ymin="-40"/);
  const placement = xml.match(/<item type="PlaceObject3Tag" characterId="213"[^>]*>[\s\S]*?<\/surfaceFilterList>\s*<\/item>/)[0];
  assert.match(placement, /name="tt"/);
  assert.match(placement, /translateX="9342" translateY="1860"/);
  // The static export reliably records the baseline. Its horizontal layout
  // must not override the live TextField's internal right-hand text gutter.
  const graphics = await readFile(new URL('generated/ui/original-graphics.js', root), 'utf8');
  const exportedText = graphics.match(/function text213\([^)]*\)\{([\s\S]*?)\n\}/)[1];
  assert.match(exportedText, /ctx\.transform\(0\.01171875,0\.0,0\.0,0\.01171875,2338\.0,254\.0\)/);
  assert.equal(254 / 20, field.text.exportedBaseline);
});

test('all four single-player difficulties use the original right-aligned baseline, not the registration origin', () => {
  const h = harness();
  const texts = ['简单的难度', '普通的难度', '困难的难度', '不可战胜的难度'];
  for (let difficulty = 0; difficulty < texts.length; difficulty++) {
    h.controller.difficulty = difficulty;
    h.paint();
    assert.deepEqual(h.labels.at(-1), [texts[difficulty], 628, 105.7, 12, '#fff', 'right', true]);
  }
  assert.equal(h.labels.length, 4);
  // At 12px each, the five-character normal label starts at x=568, beside
  // the blue resources, instead of the former floating left edge x=467.1.
  assert.equal(h.labels[1][1] - [...texts[1]].length * 12, 568);
  assert.ok(628 - [...texts[3]].length * 12 >= layout.rootFrames.game.instances.tt.bounds.xMin + 2);
});

test('difficulty position and typography follow recovered layout changes instead of hard-coded coordinates', () => {
  const changed = structuredClone(layout);
  const field = changed.rootFrames.game.instances.tt;
  field.bounds.xMax += 7.25;
  field.localMatrix[5] += 3.5;
  field.text.exportedBaseline += .25;
  field.text.fontSize = 13;
  const h = harness(changed);
  h.paint();
  assert.deepEqual(h.labels[0], ['普通的难度', 635.25, 109.45, 13, '#fff', 'right', true]);
});

test('local dual-player games do not draw a difficulty label', () => {
  const h = harness();
  h.controller.singlePlay = false;
  h.paint();
  assert.deepEqual(h.labels, []);
});
