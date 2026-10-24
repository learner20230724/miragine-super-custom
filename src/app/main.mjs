import { loadConfiguration } from '../config/index.mjs';
import { MiragineSimulation, validateCoreConfiguration, CORE_PARITY_GATES } from '../core/index.mjs';
import { installCasterProjectileLifetime } from '../extensions/projectile-lifetime.mjs';
import { installCombatHitRules } from '../extensions/combat-hits.mjs';
import { fitViewport, clientToGame } from '../platform/viewport.mjs';
import { MiraginePlayback } from './playback-session.mjs';
import { ViewCamera } from '../render/view-camera.mjs';
import { createCustomControls } from './custom-controls.mjs';
import { createGameTextControls } from './game-text-controls.mjs';
import { createSettingsPanel } from './settings-panel.mjs';
import { createCustomization } from '../customization/index.mjs';
import { createCustomStorage } from './custom-storage.mjs';
import { BattlefieldRenderer } from '../render/battlefield.mjs';
import { GameController } from './controller.mjs';
import { OriginalGameView } from './view.mjs';
import { GameAudio } from './audio.mjs';
import { OriginalKeyboard } from './input.mjs';
import { uiOwnsGameKeyboard, wheelZoomFactor, zoomCameraFromKey } from './camera-keyboard.mjs';
import { beginPointerDrag, advancePointerDrag } from './pointer-drag.mjs';
import { createPreferenceStorage } from './preferences.mjs';

const canvas = document.querySelector('#game');
const stage = document.querySelector('#game-stage');
const shell = document.querySelector('#app-shell');
const settingsRoot = document.querySelector('#settings-root');
const display = canvas.getContext('2d', { alpha: false });
// Logical game coordinates stay 640×480. The visible canvas itself is the
// native-resolution render target; never enlarge a finished low-res stage.
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
let frameClock = null;
let observer = null;
let controls = null;
let gameTextControls = null;
let desktopFullscreen = false;
let settings = null;
let customization = null;
let customStorage = null;
let cameraDrag = null;
let presented = 0;
let renderCpuTotalMs = 0;
let renderCpuLastMs = 0;
let renderCpuMaxMs = 0;
let loadingMessage = null;
let observedSimulation = null;
let presentation = null;
let controlsUpdatedAt = -Infinity;
let measurement = null;
let measured = { simulationHz: null, presentationHz: null, actualSpeed: null };
let previousWallNow = null;
const cameraKeys = new Set();
const toolbarKeys = new Set();

function resetMeasurements(now = performance.now()) {
  measurement = { now, frame: controller?.simulation?.frame ?? 0, presented };
  measured = { simulationHz: null, presentationHz: null, actualSpeed: null };
}

function updateMeasurements(now) {
  if (!measurement) resetMeasurements(now);
  const elapsed = now - measurement.now;
  if (elapsed < 1000) return;
  const frame = controller?.simulation?.frame ?? 0;
  const simulationHz = Math.max(0, frame - measurement.frame) * 1000 / elapsed;
  measured = { simulationHz, presentationHz: (presented - measurement.presented) * 1000 / elapsed,
    actualSpeed: simulationHz / controller.config.rules.frameRate };
  measurement = { now, frame, presented };
}

function updateControls(now = performance.now(), force = false) {
  if (!controls || !fit || !frameClock) return;
  if (!force && now - controlsUpdatedAt < 200) return;
  controlsUpdatedAt = now;
  controls.update({ enabled: ready && controller.phase === 'game' && !controller.overlay && !controller.simulation?.winner,
    available: ready && !controller.overlay, paused: frameClock.paused, settingsOpen: settings?.isOpen ?? false,
    speed: frameClock.speed, mode: observer.mode, renderHz: frameClock.clock.renderHz,
    fullscreen: desktopFullscreen || Boolean(document.fullscreenElement),
    baseSimulationHz: controller.config.rules.frameRate,
    actualSimulationHz: measured.simulationHz, actualDisplayHz: measured.presentationHz });
  gameTextControls?.update({ visible: ready && controller.phase === 'game' && !controller.overlay && !controller.simulation?.winner,
    paused: frameClock.paused, fit });
  settings?.update({ paused: frameClock.paused, speed: frameClock.speed,
    battle: controller.phase === 'game' && !controller.simulation?.winner });
}

// The settings drawer does not own time. Only explicit pause / speed controls do.
function clearGameInput() {
  keyboard?.clear(); cameraKeys.clear(); mapDrag = false; pressed = null; cameraDrag = null;
}

function timingChange(change) {
  clearGameInput();
  change(performance.now());
  // A timestamped rate change may settle a final old-rate tick. Consume its
  // events before silencing effects so none start on the next paused RAF.
  audio?.consume(controller?.drainEvents() ?? []);
  if (frameClock.paused) audio?.pauseEffects?.();
  resetMeasurements();
  updateControls(performance.now(), true);
}

function setEditorOpen(open) {
  clearGameInput();
  settingsRoot.hidden = !open;
  resize();
  if (!open) canvas.focus({ preventScroll: true });
}

function togglePause() {
  if (!ready || controller.phase !== 'game' || controller.overlay || controller.simulation?.winner) return;
  timingChange(now => frameClock.togglePause(now));
}

async function toggleFullscreen() {
  try {
    if (typeof window.miragineDesktop?.toggleFullscreen === 'function') {
      desktopFullscreen = await window.miragineDesktop.toggleFullscreen();
    } else if (document.fullscreenElement) await document.exitFullscreen();
    else await shell.requestFullscreen();
    resize();
  } catch (error) {
    console.warn('无法切换全屏 / Fullscreen unavailable:', error.message);
  }
}

function gameTextAction(action) {
  if (!ready || controller.phase !== 'game' || controller.overlay) return;
  clearGameInput(); audio.unlock(); controller.action(action);
  audio.setMuted(controller.muted); audio.consume(controller.drainEvents());
  frameClock.invalidate(); updateControls(performance.now(), true);
}

function customChanged({ kind } = {}) {
  if (['draft', 'preset-saved', 'preset-deleted'].includes(kind)) return;
  // Incremental spawning must not repeatedly discard input, caches or rate
  // measurements. In particular, a held camera key must survive each batch.
  if (kind?.startsWith('spawn')) {
    frameClock?.refresh();
    updateControls(performance.now(), kind !== 'spawn-progress');
    return;
  }
  if (view && controller) {
    view.config = controller.config;
    view.releaseRasterCaches(); view.tooltipLayouts.clear();
  }
  frameClock?.refresh();
  clearGameInput();
  resetMeasurements();
  updateControls(performance.now(), true);
}

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
      presentationStats: {
        mode: 'native-resolution', logicalWidth: 640, logicalHeight: 480,
        backingWidth: canvas.width, backingHeight: canvas.height,
        renderScaleX: canvas.width / 640, renderScaleY: canvas.height / 480,
        framesPresented: presented, renderCpuTotalMs, renderCpuLastMs, renderCpuMaxMs,
        ui: view?.getRenderStats?.() ?? null,
      },
      config: controller ? {
        profile: controller.config.profile,
        firstUnitCost: controller.config.units[0].cost,
        firstUnitHp: controller.config.units[0].hp,
        startingIncome: controller.config.rules.startingIncome,
        frameRate: controller.config.rules.frameRate,
      } : null,
      parityGates: CORE_PARITY_GATES,
      customization: frameClock ? { speed: frameClock.speed, renderHz: frameClock.clock.renderHz,
        paused: frameClock.paused, pauseReasons: frameClock.pauseReasons, settingsOpen: settings?.isOpen ?? false,
        storageWarning: customStorage?.warning ?? null,
        rulesMode: customization?.getMode() ?? null,
        editor: customization?.getState() ?? null,
        unitDetails: controller.simulation ? Object.fromEntries([['left', controller.simulation.friendList], ['right', controller.simulation.enemyList]]
          .map(([side, list]) => [side, list.filter(unit => unit.kind === 'unit').slice(0, 16).map(unit => ({
            id: unit.id, uid: unit.uid, side: unit.side, nowHP: unit.nowHP, spawnHP: unit.spawnHP,
            armor: unit.armor, damage: [...unit.damage], moveSpeed: unit.moveSpeed, range: unit.range, weaponSpeed: unit.weaponSpeed,
          }))])) : null,
        timing: frameClock.snapshot(), measured,
        displayCamera: controller.simulation ? observer.snapshot(presentation?.camera ?? controller.simulation.renderCamera)
          : { mode: 'follow', zoom: 1, centerX: null, centerY: null, mapCorners: [] } } : null,
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
  view?.setRenderSize(fit.backingWidth, fit.backingHeight);
  renderer?.setRenderScale(fit.pixelScaleX, fit.pixelScaleY);
  // Resizing clears the backing store even when the simulation is paused.
  // Invalidate presentation only; do not step or unpause the 30 Hz clock.
  frameClock?.invalidate();
  if (!ready && loadingMessage) drawMessage();
  updateControls(performance.now(), true);
}

function message(title, detail = '') {
  loadingMessage = { title, detail };
  drawMessage();
}

function drawMessage() {
  if (!fit || !loadingMessage) return;
  const { title, detail } = loadingMessage;
  const ctx = display;
  ctx.setTransform(fit.pixelScaleX, 0, 0, fit.pixelScaleY, 0, 0);
  ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = '#0e0e0e'; ctx.fillRect(0, 0, 640, 480);
  ctx.textAlign = 'center'; ctx.font = '20px sans-serif'; ctx.fillStyle = '#fff';
  ctx.fillText(title, 320, 226);
  if (detail) { ctx.font = '12px sans-serif'; ctx.fillText(detail.slice(0, 85), 320, 253); }
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
  if (map) {
    const camera = presentation?.camera ?? controller.simulation.renderCamera;
    observer.centerOn((p.x - map.left) / map.scale, (p.y - map.top) / map.scale, camera);
    frameClock.invalidate();
    updateControls(performance.now(), true);
  }
}

function battlefieldPoint(p) {
  return p && p.x >= 0 && p.x <= 640 && p.y >= 100 && p.y < 400
    && controller?.phase === 'game' && !controller.overlay && !controller.simulation?.winner
    && !view.hit(p);
}

canvas.addEventListener('pointerdown', event => {
  if (!ready) return;
  const p = point(event);
  if ([0, 1, 2].includes(event.button) && battlefieldPoint(p)) {
    event.preventDefault();
    audio.unlock();
    canvas.focus({ preventScroll: true });
    cameraDrag = beginPointerDrag(event, p);
    canvas.setPointerCapture(event.pointerId);
    return;
  }
  if (event.button !== 0) return;
  event.preventDefault();
  audio.unlock();
  canvas.focus({ preventScroll: true });
  pressed = view.hit(p);
  if (pressed?.action === 'minimap') { mapDrag = true; moveMap(p); }
  canvas.setPointerCapture(event.pointerId);
});

canvas.addEventListener('pointermove', event => {
  if (!ready) return;
  const p = point(event);
  view.pointer = p;
  frameClock?.invalidate();
  const drag = advancePointerDrag(cameraDrag, event, p);
  if (drag) {
    observer.panBy(drag.x, drag.y,
      presentation?.camera ?? controller.simulation.renderCamera, drag.pivot);
    updateControls(performance.now(), true);
  }
  if (mapDrag) moveMap(p);
  const h = view.hit(p);
  canvas.style.cursor = cameraDrag?.active ? 'grabbing' : h && h.action !== 'blocked'
    && (h.action !== 'unit' || h.side !== 'right' || !controller.singlePlay) ? 'pointer' : battlefieldPoint(p) ? 'grab' : 'default';
});

canvas.addEventListener('pointerup', event => {
  if (!ready) return;
  if (cameraDrag?.pointerId === event.pointerId) {
    cameraDrag = null;
    canvas.style.cursor = 'default';
    frameClock.invalidate();
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    return;
  }
  if (event.button !== 0) return;
  const h = view.hit(point(event));
  if (!mapDrag && sameHotspot(h, pressed)) {
    if (h.action === 'unit') { if (!frameClock.paused) controller.select(h.side, h.id); }
    else controller.action(h.action, h.value);
    audio.setMuted(controller.muted);
    audio.consume(controller.drainEvents());
  }
  mapDrag = false;
  pressed = null;
  frameClock?.invalidate();
  updateControls(performance.now(), true);
  if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
});
canvas.addEventListener('pointercancel', () => { mapDrag = false; pressed = null; cameraDrag = null; });
canvas.addEventListener('lostpointercapture', () => { mapDrag = false; pressed = null; cameraDrag = null; });
canvas.addEventListener('pointerleave', () => {
  if (view && !mapDrag) { view.pointer = null; frameClock?.invalidate(); }
});
canvas.addEventListener('contextmenu', event => event.preventDefault());
canvas.addEventListener('wheel', event => {
  const p = point(event);
  if (!ready || !battlefieldPoint(p)) return;
  event.preventDefault();
  observer.zoomAt(wheelZoomFactor(event.deltaY, event.deltaMode), p,
    presentation?.camera ?? controller.simulation.renderCamera);
  frameClock.invalidate();
  updateControls(performance.now(), true);
}, { passive: false });

const inputCodes = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  'Space', 'Enter', 'Escape', 'KeyI', 'KeyJ', 'KeyK', 'KeyL', 'Equal', 'Minus', 'NumpadAdd', 'NumpadSubtract']);
window.addEventListener('keydown', event => {
  // The in-page confirmation owns editing keys before this window-level
  // capture handler sees them. Its document handler handles Escape/Tab;
  // do not close the dock, move the camera, or consume button Enter here.
  if (settings?.isConfirming && event.code !== 'F11') return;
  if (event.code === 'F2' && ready) {
    event.preventDefault();
    event.stopPropagation();
    if (!event.repeat && !controller.overlay) settings?.toggle();
    return;
  }
  if (event.code === 'F11') {
    event.preventDefault();
    event.stopPropagation();
    if (!event.repeat) {
      void toggleFullscreen();
    }
    return;
  }
  if (event.code === 'Escape' && settings?.isOpen && !controller.overlay) {
    event.preventDefault(); event.stopPropagation();
    if (!event.repeat) settings.close();
    return;
  }
  if (uiOwnsGameKeyboard(event.target)) {
    toolbarKeys.add(event.code);
    return; // Native select/button keyboard interaction, not game input.
  }
  if (toolbarKeys.has(event.code)) {
    event.preventDefault();
    return; // Focus may return to canvas before this physical key is released.
  }
  if (zoomCameraFromKey(event, {
    enabled: ready && controller.phase === 'game' && !controller.overlay && !controller.simulation?.winner,
    camera: observer, coreCamera: presentation?.camera ?? controller?.simulation?.renderCamera,
  })) {
    event.preventDefault();
    audio.unlock();
    frameClock.invalidate();
    updateControls(performance.now(), true);
    return;
  }
  if (!ready || !inputCodes.has(event.code)) return;
  event.preventDefault();
  audio.unlock();
  if (['KeyI', 'KeyJ', 'KeyK', 'KeyL'].includes(event.code)) {
    cameraKeys.add(event.code);
    return;
  }
  if (event.code === 'Escape') { controller.key(event.code); frameClock?.invalidate(); }
  else if (controller.phase !== 'game' || !frameClock.paused) {
    if (keyboard.keyDown(event.code, { now: performance.now(), repeat: event.repeat })) frameClock.invalidate();
  }
}, { capture: true });
window.addEventListener('keyup', event => {
  toolbarKeys.delete(event.code); keyboard?.keyUp(event.code); cameraKeys.delete(event.code);
}, { capture: true });
settingsRoot.addEventListener('focusin', clearGameInput);
window.addEventListener('blur', () => {
  keyboard?.clear(); cameraKeys.clear(); toolbarKeys.clear(); mapDrag = false; pressed = null; cameraDrag = null;
});
document.addEventListener('visibilitychange', () => {
  const now = performance.now();
  // Synchronize at BOTH edges, even if the browser suspends all hidden RAFs.
  // No hidden wall time is replayed as accelerated combat on restoration.
  frameClock?.advance(now, { hidden: true });
  frameClock?.invalidate();
  previousWallNow = now;
  keyboard?.clear(); cameraKeys.clear(); toolbarKeys.clear();
  mapDrag = false; pressed = null; cameraDrag = null;
  resetMeasurements(now);
  updateControls(now, true);
});
new ResizeObserver(resize).observe(stage);
window.addEventListener('resize', resize);
document.addEventListener('fullscreenchange', resize);
resize();
message('超级米拉奇战记', '正在载入原版素材……');

try {
  const [config, manifest, layout, defaults, sourceEffects] = await Promise.all([
    loadConfiguration({ defaultsUrl: './config/defaults.generated.json', customUrl: './config/custom.json', validateEffective: validateCoreConfiguration }),
    json('./generated/asset-manifest.json'),
    json('./generated/ui/layout.generated.json'),
    json('./config/defaults.generated.json'),
    json('./generated/source-effects.json'),
  ]);
  if (!globalThis.OriginalGraphics) throw new Error('Original graphics export did not load');
  await globalThis.OriginalGraphics.ready;
  await document.fonts.load('12px OriginalYahei');
  const storage = await createPreferenceStorage();
  customStorage = await createCustomStorage();
  controller = new GameController(config, { storage,
    createSimulation: options => installCombatHitRules(installCasterProjectileLifetime(new MiragineSimulation(options))) });
  customization = createCustomization({ controller, defaults, initialConfig: config, storage: customStorage, autoRestore: true, onChange: customChanged });
  keyboard = new OriginalKeyboard(controller, { repeatSelection: true });
  view = new OriginalGameView(canvas, globalThis.OriginalGraphics, layout, config, { crispTextControls: true });
  view.setRenderSize(fit.backingWidth, fit.backingHeight);
  // Sample unchanged original PNGs directly into native window pixels.
  // Projection, sprite rectangles, input coordinates and 30 Hz logic stay fixed.
  renderer = new BattlefieldRenderer(view.ctx, manifest, {
    spriteRasterMode: 'source', sourceFrames: sourceEffects.sprites,
  });
  renderer.setRenderScale(fit.pixelScaleX, fit.pixelScaleY);
  await renderer.load();
  audio = new GameAudio(manifest);
  observer = new ViewCamera({ mapWidth: config.rules.mapWidth, mapHeight: config.rules.mapHeight,
    baseSpawnInset: config.rules.baseSpawnInset,
    crystalSprites: { left: manifest.sprites.A_crystal.rasterized, right: manifest.sprites.B_crystal.rasterized } });
  frameClock = new MiraginePlayback(controller, { now: performance.now(), inputStep: () => keyboard.step(), renderHz: 240,
    maxWorkMs: 8, maxStepsPerAdvance: 24, workNow: () => performance.now() });
  controls = createCustomControls({ root: stage,
    onSpeed(speed) { timingChange(now => frameClock.setSpeed(speed, now)); },
    onPause: togglePause,
    onFullscreen: toggleFullscreen,
    onFree() { observer.panBy(0, 0, presentation?.camera ?? controller.simulation.renderCamera);
      frameClock.invalidate(); updateControls(performance.now(), true); },
    onOverview() { observer.fitAll(controller.simulation.renderSnapshot); frameClock.invalidate(); updateControls(performance.now(), true); },
    onFollow() { observer.follow(); frameClock.invalidate(); updateControls(performance.now(), true); },
    onRenderRate(rate) { frameClock.setRenderHz(rate); resetMeasurements(); updateControls(performance.now(), true); } });
  settings = createSettingsPanel({ root: settingsRoot, customization, playbackElement: controls.playbackElement,
    onOpenChange: setEditorOpen });
  gameTextControls = createGameTextControls({ root: stage, onPause: togglePause,
    onHelp() { gameTextAction('tutorial'); }, onQuit() { gameTextAction('quit'); } });
  if (typeof window.miragineDesktop?.onFullscreenChanged === 'function') {
    window.miragineDesktop.onFullscreenChanged(value => { desktopFullscreen = value; resize(); });
    desktopFullscreen = await window.miragineDesktop.getFullscreen();
  }
  audio.playMusic('mainLoop');
  ready = true;
  loadingMessage = null;
  canvas.focus({ preventScroll: true });
  const presentationRenderer = { render() {
    return renderer.render(presentation.snapshot, presentation.camera, { displayView: observer.getView(presentation.camera) });
  } };
  function animate(now) {
    try {
    // Moving between monitors can change DPR without changing CSS dimensions.
    if (fit?.devicePixelRatio !== (window.devicePixelRatio || 1)) resize();
    const wallDelta = previousWallNow === null || document.hidden ? 0 : Math.max(0, Math.min(250, now - previousWallNow));
    previousWallNow = now;
    if (observedSimulation !== controller.simulation) {
      observedSimulation = controller.simulation;
      keyboard.clear();
      view.config = controller.config;
      view.releaseRasterCaches(); view.tooltipLayouts.clear();
      const rules = controller.config.rules;
      if (observer.mapWidth !== rules.mapWidth || observer.mapHeight !== rules.mapHeight || observer.baseSpawnInset !== rules.baseSpawnInset) {
        observer = new ViewCamera({ mapWidth: rules.mapWidth, mapHeight: rules.mapHeight, baseSpawnInset: rules.baseSpawnInset,
          crystalSprites: { left: manifest.sprites.A_crystal.rasterized, right: manifest.sprites.B_crystal.rasterized } });
      }
      observer.follow();
      resetMeasurements(now);
    }
    // Selection repeat is wall-time input, once per RAF, never one step per
    // accelerated simulation tick. An open drawer alone does not own keys.
    if (keyboard.advanceSelection(now, { blocked: document.hidden || frameClock.paused || Boolean(controller.overlay)
      || Boolean(settings?.isConfirming) || uiOwnsGameKeyboard(document.activeElement) })) frameClock.invalidate();
    const { render } = frameClock.advance(now, { hidden: document.hidden });
    audio.consume(controller.drainEvents());
    // Cross the crystal-to-crystal span in four real seconds at every zoom/speed.
    if (controller.phase === 'game' && !controller.overlay && cameraKeys.size) {
      const x = Number(cameraKeys.has('KeyL')) - Number(cameraKeys.has('KeyJ'));
      const y = Number(cameraKeys.has('KeyK')) - Number(cameraKeys.has('KeyI'));
      observer.keyboardPan(x, y, wallDelta,
        presentation?.camera ?? controller.simulation.renderCamera);
    }
    if (render) {
      const renderStarted = performance.now();
      presentation = frameClock.presentation();
      view.observation = presentation.camera ? observer.snapshot(presentation.camera) : null;
      view.render(controller, presentationRenderer);
      renderCpuLastMs = performance.now() - renderStarted;
      renderCpuTotalMs += renderCpuLastMs;
      renderCpuMaxMs = Math.max(renderCpuMaxMs, renderCpuLastMs);
      presented++;
    }
    updateMeasurements(now);
    updateControls(now);
    requestAnimationFrame(animate);
    } catch (error) {
      failure = error;
      ready = false;
      controls?.update({ enabled: false });
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
