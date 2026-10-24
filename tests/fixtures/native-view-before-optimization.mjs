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

const NUMBER_FIELDS = Object.freeze(['time', 'leftMoney', 'leftIncome', 'leftPopulation',
  'rightMoney', 'rightIncome', 'rightPopulation']);

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
    this.tooltipLayouts = new Map();
    this.hotspots = [];
    this.hovered = null;
    this.pointer = null;
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
      ...Object.values(this.numberLayers).map(slot => slot.canvas)];
    // Release GPU/CPU pixel buffers immediately when leaving a screen or
    // resizing. Retaining old 4K menu/results canvases wastes tens of MB each.
    for (const canvas of layers) { canvas.width = 0; canvas.height = 0; }
    this.cache.clear();
    this.barLayers = Object.create(null); this.numberLayers = Object.create(null);
    this.layerInfo = new WeakMap();
  }

  getRenderStats() {
    const layers = [...this.cache.values(), ...Object.values(this.barLayers).map(slot => slot.canvas),
      ...Object.values(this.numberLayers).map(slot => slot.canvas)];
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
    // Align to actual device pixels, not whole logical pixels. Composite with
    // the inverse density so cached pixels map 1:1 onto the visible target.
    const left = Math.floor((bounds.xMin - padding) * this.scaleX);
    const top = Math.floor((bounds.yMin - padding) * this.scaleY);
    const right = Math.ceil((bounds.xMax + padding) * this.scaleX);
    const bottom = Math.ceil((bounds.yMax + padding) * this.scaleY);
    canvas.width = Math.max(1, right - left);
    canvas.height = Math.max(1, bottom - top);
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

  title(controller) {
    const difficulty = controller.panel === 'difficulty';
    const title = this.root('title', 'unit_title');
    this.cached(`title-background:${controller.muted}`, ctx => {
      this.draw(title.symbol, { filter: ({ symbol }) => {
        if (symbol === 'button29') return false; // MainTimeline.frame11 hides bn_loading.
        if (symbol === 'sprite74' || symbol === 'sprite55') return false;
        if (symbol === 'sprite25') return { frame: controller.muted ? 1 : 0 };
      } }, ctx);
    });
    const buttons = this.instance(75, 'bn_btns');
    const p = this.origin(buttons);
    const now = performance.now(), target = difficulty ? -43 : 212;
    const current = menuSlidePosition(this.menuFrom, this.menuTarget, now - this.menuStarted);
    if (target !== this.menuTarget) {
      this.menuFrom = current;
      this.menuTarget = target;
      this.menuStarted = now;
    }
    const offsetX = menuSlidePosition(this.menuFrom, this.menuTarget, now - this.menuStarted);
    // The mask geometry comes from shape32, not a guessed button-panel rectangle.
    const clip = this.sprite(75).placements.find(x => x.symbol === 'shape32').bounds;
    const strip = this.cachedLayer('title-button-strip', ctx => this.draw('sprite55', {}, ctx),
      { xMin: -12, yMin: -12, xMax: 495, yMax: 252 });
    this.ctx.save();
    this.ctx.beginPath();
    this.ctx.rect(clip.xMin, clip.yMin, clip.xMax - clip.xMin, clip.yMax - clip.yMin);
    this.ctx.clip();
    this.compositeLayer(strip, offsetX, p.y);
    this.ctx.restore();
    if (controller.overlay === 'credits') {
      const credit = this.instance(75, 'credit');
      this.drawInstance(credit);
      const p = this.origin(credit);
      this.hotspot('credits-back', this.instance(74, 'back'), { offsetX: p.x, offsetY: p.y });
      return;
    }
    for (const [name, action] of [['bn_sp', 'single'], ['bn_mp', 'dual'], ['bn_creadit', 'credits']]) {
      this.hotspot(action, this.instance(55, name), { offsetX, offsetY: p.y, clip });
    }
    for (const [name, value] of [['bn_easy', 0], ['bn_normal', 1], ['bn_hard', 2], ['bn_abyss', 3]]) {
      this.hotspot('difficulty', this.instance(55, name), { offsetX, offsetY: p.y, value, clip });
    }
    this.hotspot('back', this.instance(55, 'bn_back'), { offsetX, offsetY: p.y, clip });
    const music = this.sprite(75).placements.find(x => x.symbol === 'sprite25');
    this.hotspot('music', music);
  }

  hud(controller, renderer) {
    const sim = controller.simulation;
    this.lastStats = renderer.render(sim.renderSnapshot, sim.renderCamera);
    // All recovered visible static HUD pixels are in these two strips. Do
    // not blit or retain the transparent 304px-high battlefield gap at 4K.
    for (const region of HUD_REGIONS) this.cached(region.key, ctx => {
      this.draw('sprite210', { filter: ({ symbol }) => {
        if (/^text(187|188|189|190|191|192|193)$/.test(symbol)) return false;
        if (['sprite209', 'sprite134', 'sprite135'].includes(symbol)) return false;
      } }, ctx);
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
      this.ctx.save();
      this.ctx.globalAlpha *= pulse.alpha;
      this.draw('sprite209', { x: p.x, y: p.y, scaleX: pulse.scale, scaleY: pulse.scale, frame: 0, time: sim.frame });
      this.ctx.restore();
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
    if (controller.singlePlay) {
      const text = ['简单的难度', '普通的难度', '困难的难度', '不可战胜的难度'][controller.difficulty];
      const field = this.root('game', 'tt');
      // tt is a root TextField, not a sprite210 child. Its placement matrix
      // gives the registration point; the RECT and glyph baseline add their
      // own offsets. Flash's 2px text gutter is inside the right-aligned RECT
      // (FFDec's static text export instead places this edge 4px too far right).
      const x = field.bounds.xMax - 2;
      const y = field.localMatrix[5] + field.text.exportedBaseline;
      this.label(text, x, y, field.text.fontSize, '#fff', 'right', true);
    }
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
