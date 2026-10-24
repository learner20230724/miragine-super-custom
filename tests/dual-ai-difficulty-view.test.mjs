import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { OriginalGameView } from '../src/app/view.mjs';

const layout = JSON.parse(readFileSync(new URL('../generated/ui/layout.generated.json', import.meta.url), 'utf8'));
const texts = ['简单的难度', '普通的难度', '困难的难度', '不可战胜的难度'];

function harness({ scaleX = 1, scaleY = scaleX, field = layout.rootFrames.game.instances.tt } = {}) {
  const calls = [], stack = [];
  const ctx = { matrix: [scaleX, 0, 0, scaleY, 0, 0], globalAlpha: 1,
    save() { stack.push({ matrix: [...this.matrix], font: this.font, textAlign: this.textAlign, textBaseline: this.textBaseline,
      fillStyle: this.fillStyle, shadowColor: this.shadowColor, shadowBlur: this.shadowBlur, shadowOffsetX: this.shadowOffsetX, shadowOffsetY: this.shadowOffsetY,
      globalAlpha: this.globalAlpha, globalCompositeOperation: this.globalCompositeOperation }); },
    restore() { Object.assign(this, stack.pop()); },
    setTransform(...matrix) { this.matrix = matrix; }, clearRect() {}, fillRect() {},
    fillText(text, x, y) { calls.push({ text, x, y, matrix: [...this.matrix], font: this.font, align: this.textAlign, baseline: this.textBaseline,
      color: this.fillStyle, shadow: [this.shadowColor, this.shadowBlur, this.shadowOffsetX, this.shadowOffsetY] }); },
  };
  const view = Object.create(OriginalGameView.prototype);
  Object.assign(view, { ctx, scaleX, scaleY, layout, config: {}, previousPhase: 'game', transitionStarted: 0,
    root(label, name) { return label === 'game' && name === 'tt' ? field : layout.rootFrames[label].instances[name]; },
    // Leave drawing of every difficulty label real; unrelated bitmap layers are
    // no-op adapters so this test exercises the actual hud/render call order.
    cached() {}, barLayer() {}, compositeLayer() {}, numeric() {}, cursorLayer() {}, minimap() {},
    drawInstance() {}, hotspot() {}, tooltip() {}, releaseRasterCaches() {}, crispTextControls: true,
  });
  return { view, calls, ctx };
}
function controller({ singlePlay = false, matchMode = 'dual', difficulty = 1, leftDifficulty = 0, rightDifficulty = 3, applyDifficultyStats = true } = {}) {
  const options = { leftDifficulty, rightDifficulty, applyDifficultyStats };
  return { phase: 'game', singlePlay, matchMode, difficulty, overlay: null, muted: true,
    dualAIOptions: options, cursorPresentation: { left: { scale: 1, alpha: 1 }, right: { scale: 1, alpha: 1 } },
    simulation: { renderSnapshot: [], renderCamera: { x: 1500, y: 400, width: 640, height: 300 },
      redBoss: { nowHP: 5000, maxHP: 5000 }, blueBoss: { nowHP: 5000, maxHP: 5000 }, p1: [0, 0, 1], p2: [0, 0, 1],
      frame: 1, winner: null, dualAI: matchMode === 'ai-vs-ai' ? { options } : undefined } };
}
const renderer = { render() { return {}; } };
function expected(text, x, align, scaleX = 1, scaleY = scaleX, fontSize = 12, y = 105.7) {
  return { text, x, y, align, matrix: [scaleX, 0, 0, scaleY, 0, 0],
    font: `${fontSize}px OriginalYahei, 'Microsoft YaHei', sans-serif`, baseline: 'alphabetic', color: '#fff',
    shadow: ['#000', 3 * Math.max(scaleX, scaleY), scaleX, scaleY] };
}

test('every original single-player difficulty retains its exact phrase, HUD position, typography and shadow', () => {
  for (let difficulty = 0; difficulty < 4; difficulty++) {
    const h = harness(); h.view.render(controller({ singlePlay: true, matchMode: 'single', difficulty }), renderer);
    assert.deepEqual(h.calls, [expected(texts[difficulty], 628, 'right')]);
  }
});

test('original two-player matches do not acquire either difficulty label', () => {
  const h = harness(); h.view.render(controller(), renderer); assert.deepEqual(h.calls, []);
});

test('all sixteen mirrored AI difficulty combinations show only the two original phrases, regardless of stat-bonus mode', () => {
  for (const applyDifficultyStats of [true, false]) for (let leftDifficulty = 0; leftDifficulty < 4; leftDifficulty++) for (let rightDifficulty = 0; rightDifficulty < 4; rightDifficulty++) {
    const h = harness();
    h.view.render(controller({ matchMode: 'ai-vs-ai', leftDifficulty, rightDifficulty, applyDifficultyStats }), renderer);
    assert.deepEqual(h.calls, [expected(texts[leftDifficulty], 12, 'left'), expected(texts[rightDifficulty], 628, 'right')]);
    for (const call of h.calls) assert.doesNotMatch(call.text, /AI|红方|蓝方|出兵/);
  }
});

test('AI HUD follows the active simulation options, not a stale title-menu selection', () => {
  const h = harness(), c = controller({ matchMode: 'ai-vs-ai', leftDifficulty: 2, rightDifficulty: 0 });
  c.dualAIOptions = { leftDifficulty: 1, rightDifficulty: 3, applyDifficultyStats: true };
  h.view.render(c, renderer);
  assert.deepEqual(h.calls.map(call => call.text), [texts[2], texts[0]]);
});

test('left labels mirror the recovered right field rather than guessing a fixed text registration point', () => {
  const field = structuredClone(layout.rootFrames.game.instances.tt);
  field.bounds.xMax = 617.25; field.localMatrix[5] = 88.5; field.text.exportedBaseline = 11.2; field.text.fontSize = 14;
  const h = harness({ field }); h.view.render(controller({ matchMode: 'ai-vs-ai' }), renderer);
  assert.deepEqual(h.calls, [expected(texts[0], 24.75, 'left', 1, 1, 14, 99.7), expected(texts[3], 615.25, 'right', 1, 1, 14, 99.7)]);
  assert.equal(h.calls[0].x + h.calls[1].x, 640);
});

test('viewport density scales both labels and their shadows identically without scaling logical HUD anchors', () => {
  for (const [scaleX, scaleY] of [[.5, .5], [1, 1], [1.75, 1.7501], [2, 2], [4, 4]]) {
    const h = harness({ scaleX, scaleY }); h.view.render(controller({ matchMode: 'ai-vs-ai', leftDifficulty: 1, rightDifficulty: 2 }), renderer);
    assert.deepEqual(h.calls, [expected(texts[1], 12, 'left', scaleX, scaleY), expected(texts[2], 628, 'right', scaleX, scaleY)]);
    assert.equal(h.ctx.matrix[0], scaleX); assert.equal(h.ctx.matrix[3], scaleY);
  }
});

test('camera zoom, panning and full-map observation never move the difficulty HUD or alter either camera', () => {
  const c = controller({ matchMode: 'ai-vs-ai' }), h = harness({ scaleX: 2 });
  for (const [mode, zoom, centerX, centerY] of [['follow', 1, 1500, 400], ['free', .2, 2300, 500], ['free', 3, 100, 90], ['overview', .1, 4000, 800]]) {
    const observation = Object.freeze({ mode, zoom, centerX, centerY });
    const camera = Object.freeze({ x: centerX, y: centerY, width: 640 / zoom, height: 300 / zoom });
    c.simulation.renderCamera = camera; h.view.observation = observation; h.calls.length = 0;
    h.view.render(c, renderer);
    assert.deepEqual(h.calls, [expected(texts[0], 12, 'left', 2), expected(texts[3], 628, 'right', 2)]);
    assert.equal(h.view.observation, observation); assert.equal(c.simulation.renderCamera, camera);
  }
});
