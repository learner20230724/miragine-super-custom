import { loadConfiguration } from '../config/index.mjs';
import { validateCoreConfiguration, CORE_PARITY_GATES } from '../core/index.mjs';
import { fitViewport, clientToGame } from '../platform/viewport.mjs';
import { BattlefieldRenderer } from '../render/battlefield.mjs';
import { GameController } from './controller.mjs';
import { OriginalGameView } from './view.mjs';
import { GameAudio } from './audio.mjs';
import { OriginalKeyboard } from './input.mjs';
import { createPreferenceStorage } from './preferences.mjs';

const canvas = document.querySelector('#game');
const stage = document.querySelector('#game-stage');
const display = canvas.getContext('2d', { alpha: false });
const logical = document.createElement('canvas');
logical.width = 640;
logical.height = 480;
let fit = null;
let controller = null;
let view = null;
let renderer = null;
let audio = null;
let keyboard = null;
let ready = false;
let failure = null;
let mapDrag = false;
let pressed = null;

function cloneFrozen(value) {
  if (Array.isArray(value)) return Object.freeze(value.map(cloneFrozen));
  if (value !== null && typeof value === 'object') {
    return Object.freeze(Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, cloneFrozen(entry)])));
  }
  return value;
}

// Read-only inspection only: no simulation, settings or private filesystem handles escape.
Object.defineProperty(globalThis, '__MIRAGINE__', {
  configurable: false, writable: false,
  value: Object.freeze({
    getState: () => cloneFrozen({
      ready, error: failure?.message ?? null,
      implementation: 'native-javascript-canvas',
      ...controller?.snapshot(), viewport: fit,
      rendering: view?.lastStats ?? null,
      config: controller ? {
        profile: controller.config.profile,
        firstUnitCost: controller.config.units[0].cost,
        firstUnitHp: controller.config.units[0].hp,
        startingIncome: controller.config.rules.startingIncome,
        frameRate: controller.config.rules.frameRate,
      } : null,
      parityGates: CORE_PARITY_GATES,
    }),
    getHotspots: () => cloneFrozen(view?.hotspots ?? []),
  }),
});

function resize() {
  const rect = stage.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return;
  fit = fitViewport(rect.width, rect.height, {
    devicePixelRatio: window.devicePixelRatio || 1,
    clientLeft: rect.left, clientTop: rect.top,
  });
  canvas.style.left = `${fit.left}px`;
  canvas.style.top = `${fit.top}px`;
  canvas.style.width = `${fit.width}px`;
  canvas.style.height = `${fit.height}px`;
  if (canvas.width !== fit.backingWidth) canvas.width = fit.backingWidth;
  if (canvas.height !== fit.backingHeight) canvas.height = fit.backingHeight;
  present();
}

function present() {
  if (!fit) return;
  display.setTransform(1, 0, 0, 1, 0, 0);
  display.imageSmoothingEnabled = true;
  display.drawImage(logical, 0, 0, canvas.width, canvas.height);
}

function message(title, detail = '') {
  const ctx = logical.getContext('2d');
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#0e0e0e'; ctx.fillRect(0, 0, 640, 480);
  ctx.textAlign = 'center'; ctx.font = '20px sans-serif'; ctx.fillStyle = '#fff';
  ctx.fillText(title, 320, 226);
  if (detail) { ctx.font = '12px sans-serif'; ctx.fillText(detail.slice(0, 85), 320, 253); }
  present();
}

async function json(url) {
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return response.json();
}

function point(event) { return fit ? clientToGame(event.clientX, event.clientY, fit) : null; }
function sameHotspot(a, b) { return a && b && a.action === b.action && a.value === b.value && a.side === b.side && a.id === b.id; }

function moveMap(p) {
  if (!p || controller?.phase !== 'game') return;
  const map = view.hotspots.find(h => h.action === 'minimap');
  if (map) controller.simulation.pointCamera((p.x - map.left) / map.scale, (p.y - map.top) / map.scale);
}

canvas.addEventListener('pointerdown', event => {
  if (!ready || event.button !== 0) return;
  event.preventDefault();
  audio.unlock();
  canvas.focus({ preventScroll: true });
  const p = point(event);
  pressed = view.hit(p);
  if (pressed?.action === 'minimap') { mapDrag = true; moveMap(p); }
  canvas.setPointerCapture(event.pointerId);
});

canvas.addEventListener('pointermove', event => {
  if (!ready) return;
  const p = point(event);
  view.pointer = p;
  if (mapDrag) moveMap(p);
  const h = view.hit(p);
  canvas.style.cursor = h && h.action !== 'blocked'
    && (h.action !== 'unit' || h.side !== 'right' || !controller.singlePlay) ? 'pointer' : 'default';
});

canvas.addEventListener('pointerup', event => {
  if (!ready) return;
  const h = view.hit(point(event));
  if (!mapDrag && sameHotspot(h, pressed)) {
    if (h.action === 'unit') controller.select(h.side, h.id);
    else controller.action(h.action, h.value);
    audio.setMuted(controller.muted);
    audio.consume(controller.drainEvents());
  }
  mapDrag = false;
  pressed = null;
  if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
});
canvas.addEventListener('pointercancel', () => { mapDrag = false; pressed = null; });
canvas.addEventListener('pointerleave', () => { if (view && !mapDrag) view.pointer = null; });
canvas.addEventListener('contextmenu', event => event.preventDefault());

const inputCodes = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  'Space', 'Enter', 'Escape', 'KeyI', 'KeyJ', 'KeyK', 'KeyL', 'Equal', 'Minus', 'NumpadAdd', 'NumpadSubtract']);
window.addEventListener('keydown', event => {
  if (event.code === 'F11') {
    event.preventDefault();
    const operation = document.fullscreenElement ? document.exitFullscreen() : stage.requestFullscreen();
    operation.catch(() => {});
    return;
  }
  if (!ready || !inputCodes.has(event.code)) return;
  event.preventDefault();
  audio.unlock();
  if (event.code === 'Escape') controller.key(event.code);
  else keyboard.keyDown(event.code);
});
window.addEventListener('keyup', event => keyboard?.keyUp(event.code));
window.addEventListener('blur', () => { keyboard?.clear(); mapDrag = false; pressed = null; });
new ResizeObserver(resize).observe(stage);
window.addEventListener('resize', resize);
document.addEventListener('fullscreenchange', resize);
resize();
message('超级米拉奇战记', '正在载入原版素材……');

try {
  const [config, manifest, layout] = await Promise.all([
    loadConfiguration({ defaultsUrl: './config/defaults.generated.json', customUrl: './config/custom.json', validateEffective: validateCoreConfiguration }),
    json('./generated/asset-manifest.json'),
    json('./generated/ui/layout.generated.json'),
  ]);
  if (!globalThis.OriginalGraphics) throw new Error('Original graphics export did not load');
  await globalThis.OriginalGraphics.ready;
  await document.fonts.load('12px OriginalYahei');
  const storage = await createPreferenceStorage();
  controller = new GameController(config, { storage });
  keyboard = new OriginalKeyboard(controller);
  view = new OriginalGameView(logical, globalThis.OriginalGraphics, layout, config);
  renderer = new BattlefieldRenderer(view.ctx, manifest);
  await renderer.load();
  audio = new GameAudio(manifest);
  audio.playMusic('mainLoop');
  ready = true;
  canvas.focus({ preventScroll: true });
  let previous = performance.now(), accumulator = 0;
  const frameMs = 1000 / config.rules.frameRate;
  function animate(now) {
    try {
    // A suspended browser tab does not replay minutes of combat when reopened.
    const delta = document.hidden ? 0 : Math.min(now - previous, 250);
    previous = now;
    accumulator += delta;
    while (accumulator >= frameMs) {
      keyboard.step();
      controller.tick(now);
      accumulator -= frameMs;
    }
    audio.consume(controller.drainEvents());
    view.render(controller, renderer);
    present();
    requestAnimationFrame(animate);
    } catch (error) {
      failure = error;
      ready = false;
      audio.music?.pause();
      console.error(error);
      message('运行中断', error.message);
    }
  }
  requestAnimationFrame(animate);
} catch (error) {
  failure = error;
  console.error(error);
  message('载入失败', error.message);
}
