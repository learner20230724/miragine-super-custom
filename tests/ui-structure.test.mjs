import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { GameController } from '../src/app/controller.mjs';
import { GameAudio } from '../src/app/audio.mjs';
import { menuSlidePosition, stageTintProgress, OriginalGameView } from '../src/app/view.mjs';
import { OriginalKeyboard } from '../src/app/input.mjs';
import { fitViewport, gameToClient, clientToGame } from '../src/platform/viewport.mjs';

const root = new URL('../', import.meta.url);
const text = path => readFile(new URL(path, root), 'utf8');
const config = JSON.parse(await text('config/defaults.generated.json'));
const layout = JSON.parse(await text('generated/ui/layout.generated.json'));

test('production document contains only the game stage, with no SWF runtime or project chrome', async () => {
  const html = await text('index.html');
  const body = html.match(/<body>([\s\S]*?)<\/body>/)[1];
  assert.match(body, /<canvas id="game"/);
  assert.doesNotMatch(body, /<(?:header|footer|nav|h[1-6]|p|aside|iframe|object|embed)\b/i);
  assert.doesNotMatch(html, /ruffle|\.swf\b|unsafe-eval|eval\(/i);
  assert.match(html, /original-graphics\.js/);
  assert.match(html, /src\/app\/main\.mjs/);
  const app = await text('src/app/main.mjs');
  assert.match(app, /MiragineSimulation|GameController/);
  assert.match(app, /clientToGame/);
  assert.match(app, /fitViewport/);
  assert.doesNotMatch(app, /load(?:Movie|SWF)|RufflePlayer|ruffle/i);
});

test('graphics export is draw-only, closed-registry JavaScript', async () => {
  const graphics = await text('generated/ui/original-graphics.js');
  assert.doesNotMatch(graphics, /\beval\s*\(|\bsetInterval\s*\(|\bsetTimeout\s*\(/);
  assert.doesNotMatch(graphics, /getElementById\(["']myCanvas/);
  assert.match(graphics, /global\.OriginalGraphics = Object\.freeze/);
  for (const name of ['sprite55', 'sprite75', 'sprite210', 'sprite228', 'sprite238', 'sprite258']) {
    assert.match(graphics, new RegExp(`function ${name}\\(`));
  }
});

test('all menu, game and result hotspots have recovered XML positions', () => {
  assert.equal(layout.rootFrames.title.frame, 10);
  assert.equal(layout.rootFrames.game.frame, 19);
  assert.equal(layout.rootFrames.over.frame, 30);
  assert.deepEqual(layout.viewport, { xMin: 0, yMin: 0, xMax: 640, yMax: 480 });
  for (const name of ['bn_sp', 'bn_mp', 'bn_easy', 'bn_normal', 'bn_hard', 'bn_abyss', 'bn_back', 'bn_creadit']) {
    const entry = layout.sprites['55'].instances[name];
    assert.ok(entry.bounds.xMax > entry.bounds.xMin, name);
    assert.ok(entry.bounds.yMax > entry.bounds.yMin, name);
  }
  for (const prefix of ['a', 'b']) for (let id = 0; id < 16; id++) {
    const entry = layout.sprites['210'].instances[prefix + id];
    assert.ok(entry.bounds && entry.bounds.yMax > 400, prefix + id);
  }
  for (const id of ['228', '238']) for (const name of ['okay', 'never']) assert.ok(layout.sprites[id].instances[name].bounds);
  for (const name of ['home', 'replay']) assert.ok(layout.sprites['258'].instances[name].bounds);
});

test('home menu supports all four recovered difficulties and local dual play', () => {
  for (let difficulty = 0; difficulty < 4; difficulty++) {
    const c = new GameController(config);
    assert.equal(c.phase, 'title');
    assert.equal(c.action('single'), true);
    assert.equal(c.panel, 'difficulty');
    assert.equal(c.action('difficulty', difficulty), true);
    assert.equal(c.phase, 'game');
    assert.equal(c.singlePlay, true);
    assert.equal(c.simulation.difficulty, difficulty);
  }
  const dual = new GameController(config);
  dual.action('dual');
  assert.equal(dual.singlePlay, false);
  assert.equal(dual.simulation.singlePlay, false);
  dual.action('tutorial-okay');
  dual.key('ArrowRight');
  assert.equal(dual.simulation.p2[0], 1);
});

test('first tutorial stops round time, not combat, and remembers never-show preference', () => {
  const saved = new Map();
  const storage = { getItem: key => saved.get(key), setItem: (key, value) => saved.set(key, value) };
  const c = new GameController(config, { storage });
  c.action('dual');
  assert.equal(c.overlay, 'tutorial');
  assert.equal(c.simulation.stopTimer, true);
  const before = c.simulation.frame, round = c.simulation.round;
  c.tick(1);
  assert.equal(c.simulation.frame, before + 1);
  assert.equal(c.simulation.round, round);
  c.action('tutorial-never');
  assert.equal(c.simulation.stopTimer, false);
  c.home();
  c.action('dual');
  assert.equal(c.overlay, null);
});

test('manual help and quit confirmation preserve original continuing engine semantics', () => {
  const c = new GameController(config);
  c.action('dual'); c.action('tutorial-okay');
  c.action('tutorial');
  assert.equal(c.simulation.stopTimer, false);
  c.action('tutorial-okay');
  c.key('Escape');
  assert.equal(c.overlay, 'quit');
  const frame = c.simulation.frame;
  c.tick(100);
  assert.equal(c.simulation.frame, frame + 1);
  c.action('quit-cancel');
  assert.equal(c.overlay, null);
  c.action('quit'); c.action('quit-confirm');
  assert.equal(c.phase, 'title');
  assert.equal(c.simulation.running, false);
});

test('single-player rejects blue selection and keeps red keyboard selection native', () => {
  const c = new GameController(config);
  c.action('single'); c.action('difficulty', 1); c.action('tutorial-okay');
  assert.equal(c.select('right', 7), false);
  assert.equal(c.key('ArrowRight'), false);
  assert.equal(c.select('left', 15), true);
  assert.deepEqual(c.simulation.p1.slice(0, 2), [7, 1]);
  c.key('KeyA');
  assert.deepEqual(c.simulation.p1.slice(0, 2), [6, 1]);
  c.key('Space');
  assert.equal(c.simulation.p1[2], 0);
});

test('native result state waits original 2.9 seconds and supports replay/home', () => {
  const c = new GameController(config);
  c.action('dual'); c.action('tutorial-okay');
  c.simulation.winner = 'right';
  c.tick(100);
  assert.equal(c.phase, 'game');
  c.tick(2999);
  assert.equal(c.phase, 'game');
  c.tick(3000);
  assert.equal(c.phase, 'over');
  c.action('replay');
  assert.equal(c.phase, 'game');
  assert.equal(c.simulation.winner, null);
  c.action('tutorial-okay');
  c.simulation.winner = 'left';
  c.action('result');
  c.action('home');
  assert.equal(c.phase, 'title');
});

test('recovered menu click remains precise in maximized, portrait and high-DPI viewports', () => {
  const b = layout.sprites['55'].instances.bn_sp.bounds;
  const gamePoint = { x: 212 + (b.xMin + b.xMax) / 2, y: 216 + (b.yMin + b.yMax) / 2 };
  for (const [width, height, devicePixelRatio] of [[1920, 1080, 1], [3840, 2160, 2], [700, 1100, 1.25]]) {
    const viewport = fitViewport(width, height, { devicePixelRatio });
    const client = gameToClient(gamePoint.x, gamePoint.y, viewport);
    const result = clientToGame(client.x, client.y, viewport);
    assert.ok(Math.abs(result.x - gamePoint.x) < 1e-10);
    assert.ok(Math.abs(result.y - gamePoint.y) < 1e-10);
    assert.ok(result.x >= 212 + b.xMin && result.x < 212 + b.xMax);
    assert.ok(result.y >= 216 + b.yMin && result.y < 216 + b.yMax);
  }
});

test('menu slide uses the original half-second TweenLite default ease', () => {
  assert.equal(menuSlidePosition(212, -43, 0), 212);
  assert.equal(menuSlidePosition(212, -43, 250), 20.75);
  assert.equal(menuSlidePosition(212, -43, 500), -43);
  assert.equal(menuSlidePosition(212, -43, 800), -43);
  assert.equal(menuSlidePosition(-43, 212, 500), 212);
});

test('stage tint uses the original .8 second Sine.easeInOut progress', () => {
  assert.equal(stageTintProgress(0), 0);
  assert.ok(Math.abs(stageTintProgress(400) - .5) < 1e-12);
  assert.equal(stageTintProgress(800), 1);
  assert.equal(stageTintProgress(1000), 1);
});

test('battle music preserves original two-second fade-out then two-second fade-in', () => {
  let now = 0;
  let frames = [];
  const tracks = [];
  const audioFactory = url => {
    const track = { url, volume: 1, muted: false, loop: false, paused: false,
      pause() { this.paused = true; }, play() { return Promise.resolve(); }, addEventListener() {} };
    tracks.push(track);
    return track;
  };
  const audio = new GameAudio({ sounds: { mainLoop: { file: 'main.mp3' }, gameLoop: { file: 'battle.mp3' } } }, {
    audioFactory, now: () => now, requestFrame: callback => frames.push(callback),
  });
  audio.playMusic('mainLoop');
  assert.equal(tracks.length, 0);
  audio.unlock();
  assert.equal(tracks.length, 1);
  audio.consume([{ type: 'music', name: 'gameLoop', fadeOutMs: 2000, fadeInMs: 2000 }]);
  const advance = value => { now = value; const pending = frames; frames = []; for (const callback of pending) callback(now); };
  advance(1000);
  assert.equal(tracks[0].volume, .25);
  assert.equal(tracks.length, 1);
  advance(2000);
  assert.equal(tracks[0].paused, true);
  assert.equal(tracks.length, 2);
  assert.equal(tracks[1].volume, 0);
  advance(3000);
  assert.equal(tracks[1].volume, .75);
  advance(4000);
  assert.equal(tracks[1].volume, 1);
});

test('original keyboard samples frames, suppresses OS repeats and prioritizes camera combinations', () => {
  const c = new GameController(config);
  c.action('dual');
  const input = new OriginalKeyboard(c);
  // Even the initial tutorial does not disable the stage's key listeners.
  input.keyDown('KeyD'); input.keyUp('KeyD'); input.step();
  assert.equal(c.simulation.p1[0], 0, 'a key released before the simulation frame is not sampled');
  input.keyDown('KeyD'); input.step(); input.step();
  input.keyDown('KeyD'); input.step();
  assert.equal(c.simulation.p1[0], 1, 'held and OS-repeated keys trigger a nontracking binding once');
  input.keyUp('KeyD'); input.step(); input.keyDown('KeyD'); input.step();
  assert.equal(c.simulation.p1[0], 2);
  const moves = [];
  c.simulation.steer = (x, y) => moves.push([x, y]);
  input.clear();
  input.keyDown('KeyI'); input.keyDown('KeyL'); input.step(); input.step();
  assert.deepEqual(moves, [[5, -5], [5, -5]], 'diagonal combination weakens both single-key bindings');
  c.action('quit');
  input.clear(); input.keyDown('KeyA'); input.step();
  assert.equal(c.simulation.p1[0], 1, 'quit panel does not stop the original keyboard manager');
});

test('tutorial is a bounded display-list panel, quit is full-stage, and ESC preserves the tutorial below quit', () => {
  const c = new GameController(config);
  c.action('dual');
  const view = Object.create(OriginalGameView.prototype);
  view.layout = layout;
  view.hotspots = [];
  view.drawInstance = () => {};
  const card = layout.sprites['210'].instances.a0;
  const point = { x: (card.bounds.xMin + card.bounds.xMax) / 2, y: (card.bounds.yMin + card.bounds.yMax) / 2 };
  view.hotspot('unit', card, { side: 'left', id: 0 });
  view.overlay(c);
  assert.equal(view.hit(point).action, 'unit', 'tutorial does not cover the bottom cards');
  assert.equal(view.hit({ x: 320, y: 150 }).action, 'blocked');
  c.key('Escape');
  assert.equal(c.overlay, 'quit');
  assert.equal(c.underOverlay, 'tutorial');
  view.overlay(c);
  assert.equal(view.hit(point).action, 'blocked', 'quit shape231 covers the complete stage');
  c.action('quit-cancel');
  assert.equal(c.overlay, 'tutorial');
  assert.equal(c.simulation.stopTimer, true);
  c.action('tutorial-okay');
  assert.equal(c.overlay, null);
  assert.equal(c.simulation.stopTimer, false);
});

test('recruitment cursor pulse preserves the original scale/alpha decrements and stops with the engine', () => {
  const c = new GameController(config);
  c.action('dual'); c.action('tutorial-okay');
  c.simulation.events.push({ type: 'recruit', side: 'left' });
  c.tick(1);
  assert.ok(Math.abs(c.cursorPresentation.left.scale - 1.3) < 1e-12);
  assert.equal(c.cursorPresentation.left.alpha, .95);
  c.tick(2); c.tick(3); c.tick(4);
  assert.ok(c.cursorPresentation.left.scale <= 1);
  assert.ok(Math.abs(c.cursorPresentation.left.alpha - .8) < 1e-12);
  c.simulation.stop();
  const before = { ...c.cursorPresentation.left };
  c.tick(5);
  assert.deepEqual(c.cursorPresentation.left, before);
});

test('read-only bounded unit summaries expose naturally recruited configured health, not bases or engine handles', () => {
  const custom = structuredClone(config);
  custom.rules.startingIncome = 777;
  custom.units[0].cost = 7;
  custom.units[0].hp = 99;
  const c = new GameController(custom);
  c.action('dual'); c.action('tutorial-okay');
  for (let frame = 0; frame < 183; frame++) c.tick(frame * 1000 / 30);
  const state = c.snapshot();
  assert.ok(state.units.left.length > 0);
  assert.ok(state.units.left.length <= 16 && state.units.right.length <= 16);
  assert.equal(state.units.left[0].id, 0);
  assert.equal(state.units.left[0].nowHP, 99);
  assert.deepEqual(Object.keys(state.units.left[0]), ['id', 'side', 'nowHP']);
  state.units.left[0].nowHP = 1;
  assert.equal(c.snapshot().units.left[0].nowHP, 99);
});
