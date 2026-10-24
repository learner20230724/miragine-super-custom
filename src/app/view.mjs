import { dualAIMenuItems, menuButtonState } from './dual-ai-controls.mjs';

/** TweenLite.defaultEase: 1 - (1 - time / duration)^2. homebtns uses .5 seconds. */
export function menuSlidePosition(from, to, elapsedMs) {
  const ratio = Math.max(0, Math.min(1, elapsedMs / 500));
  return from + (to - from) * (1 - (1 - ratio) ** 2);
}

/** MainTimeline's .8 second Sine.easeInOut tint-from transition. */
export function stageTintProgress(elapsedMs) {
  const ratio = Math.max(0, Math.min(1, elapsedMs / 800));
  return (1 - Math.cos(ratio * Math.PI)) / 2;
}

const STAGE_BOUNDS = Object.freeze({ xMin: 0, yMin: 0, xMax: 640, yMax: 480 });
const HUD_REGIONS = Object.freeze([
  { key: 'hud-top', bounds: { xMin: 0, yMin: 0, xMax: 640, yMax: 96 } },
  { key: 'hud-bottom', bounds: { xMin: 0, yMin: 400, xMax: 640, yMax: 480 } },
]);

const HUD_DYNAMIC_SYMBOLS = new Set(['sprite209', 'sprite134', 'sprite135',
  ...Array.from({ length: 7 }, (_, index) => `text${187 + index}`)]);

const NUMBER_FIELDS = Object.freeze(['time', 'leftMoney', 'leftIncome', 'leftPopulation',
  'rightMoney', 'rightIncome', 'rightPopulation']);
const DIFFICULTY_LABELS = Object.freeze(['简单的难度', '普通的难度', '困难的难度', '不可战胜的难度']);

/** The original stage display list, drawn with exported native Canvas graphics. */
export class OriginalGameView {
  constructor(canvas, graphics, layout, config, { canvasFactory = () => document.createElement('canvas'), crispTextControls = false } = {}) {
    this.canvas = canvas;
    this.graphics = graphics;
    this.layout = layout;
    this.config = config;
    this.crispTextControls = crispTextControls;
    this.ctx = graphics.attach(canvas);
    this.cache = new Map();
    this.layerInfo = new WeakMap();
    this.renderWidth = 640;
    this.renderHeight = 480;
    this.scaleX = 1;
    this.scaleY = 1;
    this.canvasFactory = canvasFactory;
    this.barLayers = Object.create(null);
    this.numberLayers = Object.create(null);
    this.cursorLayers = Object.create(null);
    this.tooltipLayouts = new Map();
    this.hotspots = [];
    this.hovered = null;
    this.pointer = null;
    this.pressed = null;
    this.titlePanel = null;
    this.dualMenuStarted = 0;
    this.lastStats = null;
    this.previousPhase = null;
    this.transitionStarted = null;
    this.menuFrom = 212;
    this.menuTarget = 212;
    this.menuStarted = 0;
    this.setRenderSize(canvas.width || 640, canvas.height || 480);
  }

  sprite(id) { return this.layout.sprites[String(id)]; }
  instance(id, name) { return this.sprite(id)?.instances[name]; }
  root(label, name) { return this.layout.rootFrames[label]?.instances[name]; }
  origin(instance) { return { x: instance.localMatrix[4], y: instance.localMatrix[5] }; }

  draw(symbol, { x = 0, y = 0, scaleX = 1, scaleY = 1, frame = 0, time = 0, filter } = {}, ctx = this.ctx) {
    this.graphics.draw(symbol, ctx, { matrix: [.05 * scaleX, 0, 0, .05 * scaleY, x, y], frame, time, filter });
  }

  drawInstance(instance, options = {}, ctx = this.ctx) {
    const { x, y } = this.origin(instance);
    this.draw(instance.symbol, { x, y, ...options }, ctx);
  }

  /** Coordinates stay 640x480; every raster target uses the window's pixels. */
  setRenderSize(width, height) {
    if (![width, height].every(value => Number.isSafeInteger(value) && value > 0)) {
      throw new RangeError('Render dimensions must be positive safe integers');
    }
    const changed = width !== this.renderWidth || height !== this.renderHeight;
    if (this.canvas.width !== width) this.canvas.width = width;
    if (this.canvas.height !== height) this.canvas.height = height;
    if (changed) {
      this.releaseRasterCaches();
      this.renderWidth = width; this.renderHeight = height;
      this.scaleX = width / 640; this.scaleY = height / 480;
    }
    this.ctx.setTransform(this.scaleX, 0, 0, this.scaleY, 0, 0);
    return changed;
  }

  releaseRasterCaches() {
    const layers = [...this.cache.values(), ...Object.values(this.barLayers).map(slot => slot.canvas),
      ...Object.values(this.numberLayers).map(slot => slot.canvas), ...Object.values(this.cursorLayers).map(slot => slot.canvas)];
    // Release GPU/CPU pixel buffers immediately when leaving a screen or
    // resizing. Retaining old 4K menu/results canvases wastes tens of MB each.
    for (const canvas of layers) { canvas.width = 0; canvas.height = 0; }
    this.cache.clear();
    this.barLayers = Object.create(null); this.numberLayers = Object.create(null); this.cursorLayers = Object.create(null);
    this.layerInfo = new WeakMap();
  }

  getRenderStats() {
    const layers = [...this.cache.values(), ...Object.values(this.barLayers).map(slot => slot.canvas),
      ...Object.values(this.numberLayers).map(slot => slot.canvas), ...Object.values(this.cursorLayers).map(slot => slot.canvas)];
    return { width: this.renderWidth, height: this.renderHeight, scaleX: this.scaleX, scaleY: this.scaleY,
      cachedPixels: layers.reduce((total, canvas) => total + canvas.width * canvas.height, 0), cacheCount: layers.length };
  }

  cached(key, draw, bounds = STAGE_BOUNDS) {
    this.compositeLayer(this.cachedLayer(key, draw, bounds));
  }

  cachedLayer(key, draw, bounds = STAGE_BOUNDS) {
    if (!this.cache.has(key)) {
      const canvas = this.createLayer(bounds);
      const ctx = this.prepareLayer(canvas);
      draw(ctx);
      this.cache.set(key, canvas);
    }
    return this.cache.get(key);
  }

  createLayer(bounds = STAGE_BOUNDS, padding = 0) {
    const canvas = this.canvasFactory();
    this.sizeLayer(canvas, bounds, padding);
    return canvas;
  }

  sizeLayer(canvas, bounds, padding = 0) {
    // Align to actual device pixels, not whole logical pixels. Composite with
    // the inverse density so cached pixels map 1:1 onto the visible target.
    const left = Math.floor((bounds.xMin - padding) * this.scaleX);
    const top = Math.floor((bounds.yMin - padding) * this.scaleY);
    const right = Math.ceil((bounds.xMax + padding) * this.scaleX);
    const bottom = Math.ceil((bounds.yMax + padding) * this.scaleY);
    const width = Math.max(1, right - left), height = Math.max(1, bottom - top);
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    this.layerInfo.set(canvas, { left, top, scaleX: this.scaleX, scaleY: this.scaleY });
    return canvas;
  }

  prepareLayer(canvas, ctx = this.graphics.attach(canvas)) {
    const { left, top, scaleX, scaleY } = this.layerInfo.get(canvas);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(scaleX, 0, 0, scaleY, -left, -top);
    return ctx;
  }

  compositeLayer(canvas, offsetX = 0, offsetY = 0) {
    const { left, top, scaleX, scaleY } = this.layerInfo.get(canvas);
    this.ctx.drawImage(canvas, offsetX + left / scaleX, offsetY + top / scaleY,
      canvas.width / scaleX, canvas.height / scaleY);
  }

  /** Two fixed revision slots, cropped to bar height, including overheal. */
  barLayer(name, ratio, draw) {
    if (name !== 'leftBar' && name !== 'rightBar') throw new RangeError('Unknown health-bar layer');
    let slot = this.barLayers[name];
    if (!slot) {
      const b = this.instance(210, name).bounds;
      // The non-custom original permits overheal beyond the bar's width.
      // Preserve every visible stage pixel, but never allocate a stage-height
      // canvas just for an 18px-high bar.
      const canvas = this.createLayer({ xMin: 0, yMin: Math.max(0, b.yMin - 4), xMax: 640, yMax: b.yMax + 4 });
      slot = this.barLayers[name] = { canvas, ctx: this.graphics.attach(canvas), valid: false, ratio: undefined };
    }
    if (!slot.valid || !Object.is(slot.ratio, ratio)) {
      slot.valid = false;
      slot.ctx.save();
      try { this.prepareLayer(slot.canvas, slot.ctx); draw(slot.ctx); }
      finally { slot.ctx.restore(); }
      slot.ratio = ratio;
      slot.valid = true;
    }
    return slot.canvas;
  }

  /** Seven fixed, tightly bounded value/style slots; no per-value canvases. */
  numberLayer(name, revision, draw) {
    if (!NUMBER_FIELDS.includes(name)) throw new RangeError('Unknown numeric HUD field');
    let slot = this.numberLayers[name];
    if (!slot) {
      const canvas = this.createLayer(this.instance(210, name).bounds, 5);
      slot = this.numberLayers[name] = { canvas, ctx: this.graphics.attach(canvas), valid: false, revision: undefined };
    }
    if (!slot.valid || slot.revision !== revision) {
      slot.valid = false;
      slot.ctx.save();
      try { this.prepareLayer(slot.canvas, slot.ctx); draw(slot.ctx); }
      finally { slot.ctx.restore(); }
      slot.revision = revision;
      slot.valid = true;
    }
    return slot.canvas;
  }

  /** Two bounded slots for the original selection cursor. Native-size drawing
   * avoids repeatedly executing its huge clipped pattern fill on the stage.
   */
  cursorLayer(side, x, y, pulse, time) {
    if (side !== 'left' && side !== 'right') throw new RangeError('Unknown cursor side');
    const b = this.sprite(209).localBounds, scale = pulse.scale;
    const bounds = { xMin: x + Math.min(b.xMin * scale, b.xMax * scale),
      xMax: x + Math.max(b.xMin * scale, b.xMax * scale),
      yMin: y + Math.min(b.yMin * scale, b.yMax * scale),
      yMax: y + Math.max(b.yMin * scale, b.yMax * scale) };
    const padding = Math.max(2, 2 / Math.min(this.scaleX, this.scaleY));
    let slot = this.cursorLayers[side];
    if (!slot) {
      const canvas = this.createLayer(bounds, padding);
      slot = this.cursorLayers[side] = { canvas, ctx: this.graphics.attach(canvas), revision: undefined };
    }
    // sprite209 is stopped at frame0; only nested sprite205 cycles over its
    // ten verified morph frames. Keep original time when drawing, reuse the
    // identical periodic image on unchanged presentation frames.
    const revision = `${time % 10}:${scale}:${pulse.alpha}:${x}:${y}`;
    if (revision !== slot.revision) {
      this.sizeLayer(slot.canvas, bounds, padding);
      slot.ctx.save();
      try {
        this.prepareLayer(slot.canvas, slot.ctx);
        // Apply alpha to original child draws, not after flattening the whole
        // cursor: overlapping translucent child pixels must retain their math.
        slot.ctx.globalAlpha = pulse.alpha;
        this.draw('sprite209', { x, y, scaleX: scale, scaleY: scale, frame: 0, time }, slot.ctx);
      } finally { slot.ctx.restore(); }
      slot.revision = revision;
    }
    return slot.canvas;
  }

  hotspot(action, instance, { offsetX = 0, offsetY = 0, value, side, id, clip } = {}) {
    if (!instance?.bounds) return;
    const b = instance.bounds;
    let left = b.xMin + offsetX, top = b.yMin + offsetY;
    let right = b.xMax + offsetX, bottom = b.yMax + offsetY;
    if (clip) {
      left = Math.max(left, clip.xMin); top = Math.max(top, clip.yMin);
      right = Math.min(right, clip.xMax); bottom = Math.min(bottom, clip.yMax);
    }
    if (right > left && bottom > top) this.hotspots.push({ action, value, side, id, left, top, right, bottom });
  }

  hit(point) {
    if (!point) return null;
    return this.hotspots.findLast(h => point.x >= h.left && point.x < h.right && point.y >= h.top && point.y < h.bottom) ?? null;
  }

  /** Keep original parent filters/color transforms, but on a component-sized
   * canvas. Filtering a hidden child does not skip its parent's exported
   * full-canvas filter pass, so never invoke sprite75 on a stage-sized target.
   */
  titleComponent(parentId, placement, key, muted = false) {
    const parent = this.sprite(parentId);
    // Exported blur kernels and shadow movement operate in device pixels.
    // 16px covers the chained glow radius 5 + shadow radius 2 + movement <=5
    // plus antialiasing. Keep that margin even for windows smaller than 640px.
    const padding = Math.max(16, 16 / Math.min(this.scaleX, this.scaleY));
    const b = placement.bounds;
    const bounds = { xMin: b.xMin - padding, yMin: b.yMin - padding,
      xMax: b.xMax + padding, yMax: b.yMax + padding };
    if (parentId === 75) {
      // The original title parent was rasterized inside the stage BEFORE its
      // filters ran. In particular the music extends beyond x=640: do not let
      // that off-stage content cast a newly visible shadow back into the stage.
      bounds.xMin = Math.max(STAGE_BOUNDS.xMin, bounds.xMin);
      bounds.yMin = Math.max(STAGE_BOUNDS.yMin, bounds.yMin);
      bounds.xMax = Math.min(STAGE_BOUNDS.xMax, bounds.xMax);
      bounds.yMax = Math.min(STAGE_BOUNDS.yMax, bounds.yMax);
    }
    return this.cachedLayer(key, ctx => {
      const excluded = new Set(parent.placements.filter(child => child.symbol !== placement.symbol).map(child => child.symbol));
      this.draw(parent.symbol, { filter: ({ symbol }) => {
        if (excluded.has(symbol)) return false;
        if (symbol === 'sprite25') return { frame: muted ? 1 : 0 };
      } }, ctx);
    }, bounds);
  }

  title(controller) {
    const difficulty = controller.panel === 'difficulty';
    const now = performance.now();
    if (controller.panel === 'dual-ai' && this.titlePanel !== 'dual-ai') this.dualMenuStarted = now;
    this.titlePanel = controller.panel;
    const parts = this.sprite(75).placements;
    // This recovered bitmap background has no parent effect. Drawing the
    // whole parent would run four expensive screen-sized shadow/glow passes,
    // including one for the invisible loading button.
    this.cached('title-background', ctx => this.draw('shape16', {}, ctx));
    for (const symbol of ['sprite12', 'sprite25', 'text31']) {
      const placement = parts.find(part => part.symbol === symbol);
      const key = symbol === 'sprite25' ? `title-component:${symbol}:${controller.muted}` : `title-component:${symbol}`;
      this.compositeLayer(this.titleComponent(75, placement, key, controller.muted));
    }
    // The custom setup reuses original button artwork and stage hit areas;
    // no second DOM skin or hidden original menu remains underneath it.
    if (controller.panel === 'dual-ai' && !controller.overlay) {
      this.dualAIMenu(controller, now);
      this.hotspot('music', parts.find(part => part.symbol === 'sprite25'));
      return;
    }
    const buttons = this.instance(75, 'bn_btns');
    const p = this.origin(buttons);
    const target = difficulty ? -43 : 212;
    const current = menuSlidePosition(this.menuFrom, this.menuTarget, now - this.menuStarted);
    if (target !== this.menuTarget) {
      this.menuFrom = current;
      this.menuTarget = target;
      this.menuStarted = now;
    }
    const offsetX = menuSlidePosition(this.menuFrom, this.menuTarget, now - this.menuStarted);
    // The mask geometry comes from shape32, not a guessed button-panel rectangle.
    const clip = this.sprite(75).placements.find(x => x.symbol === 'shape32').bounds;
    this.ctx.save();
    this.ctx.beginPath();
    this.ctx.rect(clip.xMin, clip.yMin, clip.xMax - clip.xMin, clip.yMax - clip.yMin);
    this.ctx.clip();
    for (const placement of this.sprite(55).placements) {
      // The user replaces the original credits slot; do not leave its old
      // words or hit target underneath the new entry, even during a slide.
      if (placement.name === 'bn_creadit') continue;
      const b = placement.bounds;
      const padding = Math.max(16, 16 / Math.min(this.scaleX, this.scaleY));
      if (b.xMax + padding + offsetX <= clip.xMin || b.xMin - padding + offsetX >= clip.xMax ||
          b.yMax + padding + p.y <= clip.yMin || b.yMin - padding + p.y >= clip.yMax) continue;
      // Lazy per-button caches also avoid rasterizing the off-screen difficulty
      // column while the player is on the first menu. Parent sprite55 retains
      // its exact grayscale and shadow effects for these original symbols.
      const layer = this.titleComponent(55, placement, `title-button:${placement.symbol}`);
      this.compositeLayer(layer, offsetX, p.y);
    }
    if (!controller.overlay) this.dualAIMenu({ ...controller, panel: 'home' }, now, offsetX - 212);
    this.ctx.restore();
    if (controller.overlay === 'credits') {
      const credit = this.instance(75, 'credit');
      this.drawInstance(credit);
      const p = this.origin(credit);
      this.hotspot('credits-back', this.instance(74, 'back'), { offsetX: p.x, offsetY: p.y });
      return;
    }
    for (const [name, action] of [['bn_sp', 'single'], ['bn_mp', 'dual']]) {
      this.hotspot(action, this.instance(55, name), { offsetX, offsetY: p.y, clip });
    }
    for (const [name, value] of [['bn_easy', 0], ['bn_normal', 1], ['bn_hard', 2], ['bn_abyss', 3]]) {
      this.hotspot('difficulty', this.instance(55, name), { offsetX, offsetY: p.y, value, clip });
    }
    this.hotspot('back', this.instance(55, 'bn_back'), { offsetX, offsetY: p.y, clip });
    const music = this.sprite(75).placements.find(x => x.symbol === 'sprite25');
    this.hotspot('music', music);
  }

  originalMenuButton(item) {
    const source = this.instance(55, item.source);
    const state = menuButtonState(item, this.pointer, this.pressed);
    if (item.source === 'bn_back') {
      // Back's shadow is on its original parent, not the button itself.
      const layer = this.titleComponent(55, source, `custom-menu:${source.symbol}:${state}`);
      this.compositeLayer(layer, item.left - source.bounds.xMin, item.top - source.bounds.yMin);
      return;
    }
    const sourceBounds = source.localBounds;
    const padding = Math.max(16, 16 / Math.min(this.scaleX, this.scaleY));
    const bounds = { xMin: sourceBounds.xMin - padding, yMin: sourceBounds.yMin - padding,
      xMax: sourceBounds.xMax + padding, yMax: sourceBounds.yMax + padding };
    const key = `custom-menu:${source.symbol}:${item.textOverride ? item.label : ''}:${state}`;
    const layer = this.cachedLayer(key, ctx => {
      // The recovered SimpleButton up/over/down backgrounds are the original
      // shape34/37/39 bitmaps. Its export contains only frame 0, so compose the
      // existing state bitmap with the unchanged original text/filter child.
      if (item.source !== 'bn_back') {
        this.draw(state === 'pressed' ? 'shape39' : state === 'hover' ? 'shape37' : 'shape34', {}, ctx);
      }
      this.draw(source.symbol, { filter: ({ symbol }) => {
        if (symbol === 'shape34' || (item.textOverride && symbol.startsWith('text'))) return false;
      } }, ctx);
      if (item.textOverride) {
        // New wording is the only new artwork: match the recovered 18px bold
        // Yahei menu typography, baseline 30.7 and black text shadow.
        ctx.save();
        ctx.font = "700 18px OriginalYahei, 'Microsoft YaHei', sans-serif";
        ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic'; ctx.fillStyle = '#fff';
        ctx.shadowColor = '#000'; ctx.shadowBlur = 5 * Math.max(this.scaleX, this.scaleY);
        ctx.shadowOffsetX = this.scaleX; ctx.shadowOffsetY = this.scaleY;
        ctx.fillText(item.label, 113.5, 30.7); ctx.restore();
      }
      if (item.side) {
        // sprite55 applies this recovered matrix to every difficulty button.
        // Keep its exact RGB weights (not CSS grayscale's different weights)
        // after replacing only the original up/over/down background. This
        // component-sized operation runs once per cached button state.
        const pixels = ctx.getImageData(0, 0, ctx.canvas.width, ctx.canvas.height);
        for (let i = 0; i < pixels.data.length; i += 4) {
          const gray = .3086 * pixels.data[i] + .6094 * pixels.data[i + 1] + .082 * pixels.data[i + 2];
          pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = gray;
        }
        ctx.putImageData(pixels, 0, 0);
      }
    }, bounds);
    this.compositeLayer(layer, item.left - sourceBounds.xMin, item.top - sourceBounds.yMin);
  }

  dualAIMenu(controller, now, offsetX = 0) {
    const setup = controller.panel === 'dual-ai';
    const progress = setup ? menuSlidePosition(0, 1, now - this.dualMenuStarted) : 1;
    const items = dualAIMenuItems({ panel: controller.panel, options: controller.dualAIOptions, progress });
    if (setup) {
      this.ctx.save(); this.ctx.globalAlpha *= progress;
      this.menuCaption('红方 AI', 157.5, 188, 18, '#fff');
      this.menuCaption('蓝方 AI', 482.5, 188, 18, '#fff');
      this.ctx.restore();
    }
    for (const raw of items) {
      const item = offsetX ? { ...raw, left: raw.left + offsetX, right: raw.right + offsetX } : raw;
      if (item.source) this.originalMenuButton(item);
      else {
        const hover = menuButtonState(item, this.pointer, this.pressed) !== 'normal';
        this.menuCaption(item.label, (item.left + item.right) / 2, 438, 12, hover ? '#fff' : '#f8dd1c');
        this.menuCaption(controller.dualAIOptions?.applyDifficultyStats === false ? '双方使用当前普通档' : '使用各自难度数值',
          (item.left + item.right) / 2, 454, 10, '#fff');
      }
      if (item.interactive) this.hotspot(item.action, { bounds: { xMin: item.left, yMin: item.top, xMax: item.right, yMax: item.bottom } },
        { value: item.value, side: item.side, clip: setup ? STAGE_BOUNDS : this.sprite(75).placements.find(part => part.symbol === 'shape32').bounds });
    }
  }

  menuCaption(text, x, y, size, color) {
    const ctx = this.ctx; ctx.save();
    ctx.font = `700 ${size}px OriginalYahei, 'Microsoft YaHei', sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic'; ctx.fillStyle = color;
    ctx.shadowColor = '#000'; ctx.shadowBlur = 5 * Math.max(this.scaleX, this.scaleY);
    ctx.shadowOffsetX = this.scaleX; ctx.shadowOffsetY = this.scaleY;
    ctx.fillText(text, x, y); ctx.restore();
  }

  hud(controller, renderer) {
    const sim = controller.simulation;
    this.lastStats = renderer.render(sim.renderSnapshot, sim.renderCamera);
    // All recovered visible static HUD pixels are in these two strips. Do
    // not blit or retain the transparent 304px-high battlefield gap at 4K.
    for (const region of HUD_REGIONS) this.cached(region.key, ctx => {
      // sprite210 still executes seven exported dropShadow passes even when
      // its numeric children are filtered out. These static placements have
      // no parent effects/color transforms: draw the same original symbols,
      // in source order and with the complete recovered placement matrix.
      for (const placement of this.sprite(210).placements) {
        if (HUD_DYNAMIC_SYMBOLS.has(placement.symbol)) continue;
        const b = placement.bounds;
        if (b && (b.yMax <= region.bounds.yMin || b.yMin >= region.bounds.yMax)) continue;
        const m = placement.localMatrix;
        this.graphics.draw(placement.symbol, ctx, { matrix: [.05 * m[0], .05 * m[1], .05 * m[2], .05 * m[3], m[4], m[5]],
          frame: 0, time: 0 });
      }
    }, region.bounds);
    for (const [name, hp] of [['leftBar', sim.redBoss], ['rightBar', sim.blueBoss]]) {
      const instance = this.instance(210, name), m = instance.localMatrix;
      const rawRatio = hp.nowHP / hp.maxHP;
      const finiteRatio = Number.isFinite(rawRatio) ? Math.max(0, rawRatio) : rawRatio > 0 ? 1 : 0;
      // Display a bounded bar for expanded custom values without altering HP.
      const ratio = this.config?.customization ? Math.min(1, finiteRatio) : finiteRatio;
      const layer = this.barLayer(name, ratio, ctx => {
        this.draw(instance.symbol, { x: m[4], y: m[5], scaleX: m[0], scaleY: m[3], filter: ({ symbol, matrix }) => {
          if (symbol === 'sprite131') {
            const next = [...matrix]; next[0] *= ratio;
            return { matrix: next };
          }
        } }, ctx);
      });
      this.compositeLayer(layer);
    }
    this.numeric('time', sim.timeSeconds, 22, 'center');
    for (const key of ['leftMoney', 'leftIncome', 'leftPopulation', 'rightMoney', 'rightIncome', 'rightPopulation']) {
      this.numeric(key, sim[key], 11, key.startsWith('right') ? 'right' : 'left');
    }
    for (const [side, selector, prefix] of [['left', sim.p1, 'a'], ['right', sim.p2, 'b']]) {
      const card = this.instance(210, prefix + (selector[0] + selector[1] * 8));
      const p = this.origin(card);
      // cursor_57.frame1 stops at its first frame; recruitment toggles never change that frame.
      const pulse = controller.cursorPresentation[side];
      this.compositeLayer(this.cursorLayer(side, p.x, p.y, pulse, sim.frame));
      for (let id = 0; id < 16; id++) {
        this.hotspot('unit', this.instance(210, prefix + id), { side, id });
      }
    }
    this.minimap(sim);
    // Both original buttons create full-stage shadow/filter intermediates.
    // Their filters read only their own transparent child canvases, not the
    // battlefield. Flatten at the original stage coordinates, then composite
    // here (after the minimap) to preserve layer order and filter extents.
    if (!this.crispTextControls) this.cached('game-controls', ctx => {
      for (const name of ['tipopen', 'bnquit']) this.drawInstance(this.root('game', name), {}, ctx);
    }, { xMin: 0, yMin: 350, xMax: 68, yMax: 405 });
    for (const name of this.crispTextControls ? [] : ['tipopen', 'bnquit']) {
      const instance = this.root('game', name);
      this.hotspot(name === 'tipopen' ? 'tutorial' : 'quit', instance);
    }
    const music = this.layout.rootFrames.game.placements.find(x => x.symbol === 'sprite25');
    if (music) {
      this.drawInstance(music, { frame: controller.muted ? 1 : 0 });
      this.hotspot('music', music);
    }
    this.difficultyLabels(controller);
    if (sim.winner) {
      const result = this.root('game', 'gameover');
      const ratio = Math.max(0, Math.min(1, (performance.now() - controller.winStarted - 300) / 600));
      const eased = 1 - (1 - ratio) ** 2;
      const y = this.origin(result).y + (200 - this.origin(result).y) * eased;
      this.ctx.save();
      this.ctx.globalAlpha *= eased;
      this.drawInstance(result, { y });
      this.ctx.restore();
      const adjusted = { ...result, bounds: { ...result.bounds,
        yMin: result.bounds.yMin + y - this.origin(result).y,
        yMax: result.bounds.yMax + y - this.origin(result).y } };
      this.hotspot('result', adjusted);
    }
    if (controller.overlay) this.overlay(controller);
    this.tooltip(controller);
  }

  difficultyLabels(controller) {
    const dualAI = controller.matchMode === 'ai-vs-ai';
    if (!dualAI && !controller.singlePlay) return;
    const field = this.root('game', 'tt');
    // tt is a root TextField, not a sprite210 child. Its placement matrix
    // gives the registration point; the RECT and glyph baseline add their
    // own offsets. Flash's 2px text gutter is inside the right-aligned RECT
    // (FFDec's static text export instead places this edge 4px too far right).
    const right = field.bounds.xMax - 2;
    const y = field.localMatrix[5] + field.text.exportedBaseline;
    const options = controller.simulation?.dualAI?.options ?? controller.dualAIOptions;
    const labels = dualAI ? [['left', options.leftDifficulty], ['right', options.rightDifficulty]]
      : [['right', controller.difficulty]];
    for (const [side, difficulty] of labels) {
      // Mirror only the left HUD anchor/alignment, never the glyphs. These
      // stage coordinates are independent of the observation camera/zoom.
      const x = side === 'left' ? STAGE_BOUNDS.xMax - right : right;
      this.label(DIFFICULTY_LABELS[difficulty], x, y, field.text.fontSize, '#fff', side, true);
    }
  }

  numeric(name, value, size, align) {
    if (!NUMBER_FIELDS.includes(name)) throw new RangeError('Unknown numeric HUD field');
    const instance = this.instance(210, name);
    const b = instance.bounds;
    const x = align === 'center' ? (b.xMin + b.xMax) / 2 : align === 'right' ? b.xMax - 2 : b.xMin + 2;
    const y = instance.localMatrix[5] + instance.text.exportedBaseline;
    const text = String(value);
    // Safe-integer balances can have sixteen digits. Preserve the original
    // glyphs at normal values; fit long values within their own HUD field.
    const availableWidth = Math.max(1, b.xMax - b.xMin - 4);
    const estimatedWidth = text.length * instance.text.fontSize * .62;
    const textScale = Math.min(1, availableWidth / Math.max(1, estimatedWidth));
    const revision = JSON.stringify([text, instance.text.font, instance.text.fontSize, align, x, y,
      '#fff', '#000', 3, 1, 1, textScale]);
    const layer = this.numberLayer(name, revision, ctx => {
      ctx.save();
      try {
        // Preserve original vector glyphs, individual glyph shadows and the
        // exact fractional stage-space baseline. Do not substitute a font or
        // regroup a whole HUD/overlay into this counter layer.
        ctx.shadowColor = '#000'; ctx.shadowBlur = 3 * Math.max(this.scaleX, this.scaleY);
        ctx.shadowOffsetX = this.scaleX; ctx.shadowOffsetY = this.scaleY;
        if (textScale < 1) { ctx.translate(x, 0); ctx.scale(textScale, 1); ctx.translate(-x, 0); }
        this.graphics.drawText(text, ctx, { font: instance.text.font, size: instance.text.fontSize,
          color: '#fff', x, y, align });
      } finally { ctx.restore(); }
    });
    this.compositeLayer(layer);
  }

  label(text, x, y, size = 12, color = '#fff', align = 'left', shadow = false) {
    const ctx = this.ctx;
    ctx.save();
    ctx.font = `${size}px OriginalYahei, 'Microsoft YaHei', sans-serif`;
    ctx.textAlign = align;
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = color;
    if (shadow) {
      ctx.shadowColor = '#000'; ctx.shadowBlur = 3 * Math.max(this.scaleX, this.scaleY);
      ctx.shadowOffsetX = this.scaleX; ctx.shadowOffsetY = this.scaleY;
    }
    ctx.fillText(text, x, y);
    ctx.restore();
  }

  minimap(sim) {
    const p = this.origin(this.instance(210, 'map'));
    const scale = .06; // DragonForce.step: original minimap scale, world units → game pixels.
    const width = this.config.rules.mapWidth * scale, height = this.config.rules.mapHeight * scale;
    const ctx = this.ctx;
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,.8)'; ctx.fillRect(p.x, p.y, width, height);
    for (const [list, color] of [[sim.friendList, '#f00'], [sim.enemyList, '#00f']]) {
      ctx.fillStyle = color;
      for (const unit of list) { ctx.beginPath(); ctx.arc(p.x + unit.px * scale, p.y + unit.py * scale, 1, 0, Math.PI * 2); ctx.fill(); }
    }
    const camera = sim.renderCamera;
    ctx.strokeStyle = 'rgba(255,255,255,.4)'; ctx.lineWidth = 1;
    if (this.observation && this.observation.mode !== 'follow') {
      // Only the observation frustum changes. Do not steer the simulation's
      // source camera merely to draw the observer's minimap footprint.
      ctx.beginPath(); ctx.rect(p.x, p.y, width, height); ctx.clip();
      const polygon = this.observation.visibleWorldPolygon;
      if (polygon?.length) {
        ctx.beginPath();
        polygon.forEach((point, i) => {
          if (i === 0) ctx.moveTo(p.x + point.x * scale, p.y + point.y * scale);
          else ctx.lineTo(p.x + point.x * scale, p.y + point.y * scale);
        });
        ctx.closePath(); ctx.stroke();
      } else if (this.observation.mapCorners?.every(point => point.visible)) {
        ctx.strokeRect(p.x, p.y, width, height);
      }
    } else {
      ctx.strokeRect(p.x + (camera.x - camera.width / 2) * scale, p.y + (camera.y - camera.height / 2) * scale,
        camera.width * scale, camera.height * scale);
    }
    ctx.restore();
    this.hotspots.push({ action: 'minimap', left: p.x, top: p.y, right: p.x + width, bottom: p.y + height, scale });
  }

  overlay(controller) {
    const layers = [];
    if (controller.overlay === 'tutorial' || controller.underOverlay === 'tutorial') layers.push('tutorial');
    if (controller.overlay === 'quit') layers.push('quit');
    for (const layer of layers) {
      const tutorial = layer === 'tutorial';
      const instance = this.root('game', tutorial ? 'tutorial' : 'quitgame');
      // Keep these translucent layers on the original drawing context: whole-
      // overlay flattening changes stacked tutorial/quit compositing pixels.
      this.drawInstance(instance);
      // Only the original filled area intercepts pointers. The tutorial's
      // 500x290 panel leaves bottom cards/map live, whereas quit.shape231 has
      // a full-stage dark fill. Keyboard listeners are independent of both.
      this.hotspot('blocked', instance);
      const p = this.origin(instance), sprite = tutorial ? 228 : 238;
      this.hotspot(tutorial ? 'tutorial-okay' : 'quit-confirm', this.instance(sprite, 'okay'), { offsetX: p.x, offsetY: p.y });
      this.hotspot(tutorial ? 'tutorial-never' : 'quit-cancel', this.instance(sprite, 'never'), { offsetX: p.x, offsetY: p.y });
    }
  }

  results(controller) {
    const instance = this.root('over', 'unit_over');
    const winner = controller.simulation.winner;
    // The current results artwork is static. Any future verified Flag.as
    // implementation must draw its animated layer separately from this cache.
    this.cached(`results:${winner === 'left' ? 'left' : 'right'}`, ctx => {
      this.drawInstance(instance, { filter: ({ symbol, matrix }) => {
        if (symbol !== 'sprite247' && symbol !== 'sprite253') return;
        const win = symbol === 'sprite247', m = [...matrix];
        m[4] = ((winner === 'left') === win ? 159 : 484) * 20;
        return { matrix: m };
      } }, ctx);
    });
    const p = this.origin(instance);
    for (const name of ['replay', 'home']) this.hotspot(name, this.instance(258, name), { offsetX: p.x, offsetY: p.y });
  }

  tooltipLayout(id, unit, ctx, side = null) {
    if (!Number.isInteger(id) || id < 0 || id > 15) throw new RangeError('Unknown tooltip unit');
    // Text and styles match DragonForce.initUI and WowTips.draw. The original
    // tooltip displays the raw weaponSpeed parameter, NOT a fixed attacks/sec.
    const source = [unit.name, `消耗资源: 金币 ${unit.cost} 人力 ${unit.population}`,
      `收入增加: 金币 ${unit.income} 每个回合`, '', `HP:${unit.hp}`, `护甲值:${unit.armor}`,
      `护甲类型:${unit.armorTypeID === 0 ? '轻甲' : '重甲'}`, `移动速度:${unit.moveSpeed}`, '',
      `攻击力对轻甲:${unit.damage[0]}`, `攻击力对重甲:${unit.damage[1]}`, `攻击距离:${unit.range}`,
      `攻击速度:${unit.weaponSpeed}`];
    const signature = JSON.stringify([ctx.font, ...source]);
    const cacheKey = side ? `${side}:${id}` : id;
    const previous = this.tooltipLayouts.get(cacheKey);
    if (previous?.signature === signature) return previous.layout;
    const lines = [];
    for (let i = 0; i < source.length; i++) {
      let line = '';
      for (const character of String(source[i])) {
        if (line && ctx.measureText(line + character).width > 200) {
          lines.push({ text: line, color: i < 3 ? '#fff' : '#ffd100' });
          line = '';
        }
        line += character;
      }
      lines.push({ text: line, color: i < 3 ? '#fff' : '#ffd100' });
    }
    const textWidth = Math.max(...lines.map(line => ctx.measureText(line.text).width));
    const textHeight = lines.length * 17, width = textWidth + 20, height = textHeight + 20;
    const layout = { lines, textWidth, textHeight, width, height };
    this.tooltipLayouts.set(cacheKey, { signature, layout });
    return layout;
  }

  tooltip(controller) {
    const h = this.hit(this.pointer);
    if (h?.action !== 'unit') return;
    const sideUnits = this.config.customization?.sides?.[h.side]?.units;
    const unit = sideUnits?.[h.id] ?? this.config.units[h.id];
    const ctx = this.ctx;
    ctx.save(); ctx.font = '12px Verdana, OriginalYahei, sans-serif';
    const { lines, textWidth, textHeight, width, height } = this.tooltipLayout(h.id, unit, ctx, sideUnits ? h.side : null);
    const x = this.pointer.x + textWidth + 20 < 640 ? this.pointer.x + 35 : this.pointer.x - (35 + textWidth + 20);
    const y = Math.min(this.pointer.y - 10, 480 - textHeight - 25);
    ctx.fillStyle = 'rgba(14,14,14,.85)'; ctx.strokeStyle = 'rgba(239,239,239,.8)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.roundRect(x, y, width, height, 3); ctx.fill(); ctx.stroke();
    ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
    for (let i = 0; i < lines.length; i++) {
      ctx.fillStyle = lines[i].color;
      ctx.fillText(lines[i].text, x + 8, y + 20 + i * 17);
    }
    ctx.restore();
  }

  render(controller, renderer) {
    const now = performance.now();
    if (controller.phase !== this.previousPhase) {
      this.transitionStarted = now;
      this.releaseRasterCaches();
    }
    if (controller.phase === 'title' && this.previousPhase !== null && this.previousPhase !== 'title') {
      this.menuFrom = this.menuTarget = 212;
      this.menuStarted = 0;
    }
    this.previousPhase = controller.phase;
    this.ctx.setTransform(this.scaleX, 0, 0, this.scaleY, 0, 0);
    this.ctx.clearRect(0, 0, 640, 480);
    this.ctx.fillStyle = '#0e0e0e'; this.ctx.fillRect(0, 0, 640, 480);
    this.hotspots = [];
    if (controller.phase === 'title') this.title(controller);
    else if (controller.phase === 'game') this.hud(controller, renderer);
    else if (controller.phase === 'over') this.results(controller);
    const tint = 1 - stageTintProgress(now - this.transitionStarted);
    if (tint > 0) {
      // Source tint transform is channel * progress + 14 * (1 - progress),
      // preserving alpha; source-atop gray compositing implements that exactly.
      this.ctx.save();
      this.ctx.globalCompositeOperation = 'source-atop';
      this.ctx.fillStyle = `rgba(14,14,14,${tint})`;
      this.ctx.fillRect(0, 0, 640, 480);
      this.ctx.restore();
    }
  }
}
