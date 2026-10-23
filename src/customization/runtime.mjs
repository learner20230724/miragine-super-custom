import { MiragineSimulation } from '../core/simulation.mjs';
import { IsometricEntity, IsometricAttack } from '../core/entity.mjs';
import { CoreSymbol } from '../core/scene.mjs';
import { MAX_INTEGER, clampInteger, safeAdd, safeSubtract, safeMultiply,
  finiteAdd, finiteSubtract, scaleRatio } from './numeric.mjs';

const installed = Symbol('customRuntime');
const sideName = side => {
  if (side === 'left' || side === 1) return 'left';
  if (side === 'right' || side === -1) return 'right';
  throw new TypeError('side must be left/right or 1/-1');
};
const refresh = sim => {
  sim.renderSnapshot = sim.scene.children.map(child => child.visualState());
  sim.renderCamera = { ...sim.camera };
};
const copyMethods = (object, prototype, names) => {
  for (const name of names) Object.defineProperty(object, name, {
    value: prototype[name], configurable: true, writable: true,
  });
};

/** Resolved per-side values; the original difficulty-specific blue values win. */
export function customSideConfiguration(sim, side) {
  side = sideName(side);
  const config = sim.config, rules = sim.rules, difficulty = config.difficulties[sim.difficulty];
  const extension = config.customization, sideConfig = extension?.sides?.[side];
  const diff = extension?.difficulties?.[sim.difficulty];
  return {
    units: sideConfig?.units ?? config.units,
    base: {
      hp: rules.baseHp, range: rules.baseRange,
      damage: side === 'left' ? rules.baseDamage : difficulty.blueBaseDamage,
      weaponSpeedFrames: side === 'left' ? rules.baseWeaponSpeedFrames : difficulty.blueBaseWeaponSpeedFrames,
      ...sideConfig?.base, ...(side === 'right' ? diff?.rightBase : {}),
    },
    initial: {
      money: rules.initialMoney,
      income: side === 'left' ? rules.startingIncome : difficulty.rightStartingIncome,
      population: side === 'left' ? (rules.leftStartingPopulation ?? rules.populationLimit) : difficulty.rightStartingPopulation,
      ...sideConfig?.initial, ...(side === 'right' ? diff?.rightInitial : {}),
    },
  };
}

/** Apply live attributes without advancing time, resetting cooldowns or RNG. */
export function applyCustomEntityStats(entity, health = 'ratio', { initialize = false } = {}) {
  const sim = entity.simulation, side = customSideConfiguration(sim, entity.side);
  const settings = entity.kind === 'base' ? side.base : side.units[entity.id];
  const previous = entity.spawnHP || entity.maxHP;
  if (initialize) entity.nowHP = settings.hp;
  else if (entity.nowHP > 0 && health === 'ratio' && previous !== settings.hp) {
    entity.nowHP = scaleRatio(entity.nowHP, previous, settings.hp);
  }
  entity.spawnHP = settings.hp;
  if (entity.kind === 'base') {
    entity.maxHP = settings.hp; entity.range = settings.range;
    entity.damage = settings.damage; entity.weaponSpeed = settings.weaponSpeedFrames;
  } else {
    entity.armorTypeID = settings.armorTypeID; entity.armor = settings.armor;
    entity.damage = settings.damage;
    entity.moveSpeed = safeMultiply(settings.moveSpeed, sim.rules.movementMultiplier);
    entity.range = safeMultiply(settings.range, sim.rules.rangeMultiplier);
    // This derived value becomes a decrementing integer frame counter. Keep
    // ordinary fractional values until attack(), but saturate its exact range.
    entity.weaponSpeed = Math.min(MAX_INTEGER, safeMultiply(settings.weaponSpeed, sim.rules.weaponSpeedMultiplier));
    entity.delayAttack = clampInteger(settings.delayAttack);
  }
  return entity;
}

/** Safe-number counterpart of the recovered projectile, preserving display-list order. */
class CustomAttack extends IsometricAttack {
  constructor(simulation, father, target, delay = 0) {
    super(simulation, father, target, delay);
    this.delay = clampInteger(delay); this.life = clampInteger(simulation.rules.projectileLifeFrames);
  }
  step() {
    CoreSymbol.prototype.step.call(this);
    if (this.delay === 0) {
      this.visible = true; this.px = finiteAdd(this.px, this.vx);
      if ((this.direction > 0 && this.px > this.target.px) || (this.direction < 0 && this.px < this.target.px)) {
        this.px = this.target.px;
        const hit = Math.abs(this.py - this.target.py) <= this.simulation.rules.projectileVerticalTolerance;
        if (hit) this.target.minusHP(this.father.damage);
        this.simulation.emit('impact', { attackUid: this.uid, targetUid: this.target.uid, hit });
        this.parent.removeChild(this);
      }
    } else this.delay--;
    // The original removes on impact before checking life. Avoid a second remove
    // only when this custom projectile already left its display list this tick.
    if (this.life === 0) { if (this.parent) this.parent.removeChild(this); }
    else this.life--;
    this.sx = this.direction * this.opposite;
  }
}

class CustomEntity extends IsometricEntity {
  move(vector) {
    const square = vector.x * vector.x + vector.y * vector.y;
    if (Number.isFinite(square)) return super.move(vector);
    if (this.t === 0 || this.pz > 0) {
      const divisor = Math.max(Math.abs(vector.x), Math.abs(vector.y));
      const x = vector.x / divisor, y = vector.y / divisor, length = Math.hypot(x, y);
      this.vx = safeMultiply(x / length, this.moveSpeed); this.vy = safeMultiply(y / length, this.moveSpeed);
      this.direction = this.vx > 0 ? 1 : -1;
    }
  }
  moveTo(position) {
    const dx = finiteSubtract(position.x, this.px), dy = finiteSubtract(position.y, this.py);
    const square = dx * dx + dy * dy, speedSquare = this.moveSpeed * this.moveSpeed;
    if (Number.isFinite(square) && Number.isFinite(speedSquare) && square !== 0) return super.moveTo(position);
    if (this.t === 0 || this.pz > 0) {
      const distance = Math.hypot(dx, dy);
      if (distance < this.moveSpeed || distance === 0) {
        this.px = position.x; this.py = position.y;
        if (distance === 0) this.vx = this.vy = 0;
      } else {
        const divisor = Math.max(Math.abs(dx), Math.abs(dy)), x = dx / divisor, y = dy / divisor;
        const length = Math.hypot(x, y);
        this.vx = safeMultiply(x / length, this.moveSpeed); this.vy = safeMultiply(y / length, this.moveSpeed);
      }
      this.direction = this.vx > 0 ? 1 : -1;
    }
  }
  approachTarget() {
    const x = finiteAdd(this.target.px, this.target.px - this.px > 0 ? -this.range : this.range);
    if (Math.abs(this.target.px - this.px) <= this.range && Math.abs(this.target.py - this.py) <= this.simulation.rules.attackVerticalTolerance) {
      this.direction = this.target.px - this.px > 0 ? 1 : -1; this.attack();
    } else this.moveTo({ x, y: this.target.py });
  }
  findTarget() {
    // Keep normal comparisons bit-for-bit identical. For enormous coordinates,
    // compare scaled squared distances instead of allowing every score to be Infinity.
    const weight = this.simulation.rules.targetVerticalWeight;
    this.target = null;
    let nearest = Number.MAX_VALUE, overflow = false;
    for (const entity of this.targetList) {
      if (entity.nowHP === 0) continue;
      const dx = entity.px - this.px, dy = entity.py - this.py;
      const score = dx * dx + weight * (dy * dy);
      if (!Number.isFinite(score)) overflow = true;
      if (score < nearest) { nearest = score; this.target = entity; }
    }
    if (!overflow || this.target) return;
    this.target = null;
    let scale = Math.max(Math.abs(this.px), Math.abs(this.py), 1);
    for (const entity of this.targetList) if (entity.nowHP !== 0) scale = Math.max(scale, Math.abs(entity.px), Math.abs(entity.py));
    nearest = Infinity;
    for (const entity of this.targetList) {
      if (entity.nowHP === 0) continue;
      const dx = entity.px / scale - this.px / scale, dy = entity.py / scale - this.py / scale;
      const score = dx * dx + weight * dy * dy;
      if (score < nearest) { nearest = score; this.target = entity; }
    }
  }
  attack() {
    if (this.t !== 0) return;
    this.t = clampInteger(this.weaponSpeed); this.gotoAndPlay('attack');
    const attack = new CustomAttack(this.simulation, this, this.target, this.delayAttack);
    attack.spriteSheet = this.weaponSpriteSheet; attack.weaponSheet = this.weaponSheet;
    if (this.weaponSpriteSheet) attack.gotoAndPlay('idle');
    attack.pz = this.simulation.rules.projectileSpawnHeight;
    attack.vx = this.simulation.rules.projectileSpeed * this.direction;
    this.parent.addChild(attack); this.simulation.onEntityAttack(this, attack);
  }
  minusHP(damage) {
    if (this.nowHP > 0) {
      const amount = finiteSubtract(damage[this.armorTypeID], this.armor);
      this.nowHP = finiteSubtract(this.nowHP, amount);
      this.simulation.emit('damage', { uid: this.uid, amount, nowHP: this.nowHP });
      if (this.nowHP <= 0) { this.nowHP = 0; this.dead(); }
    }
  }
  step() {
    CoreSymbol.prototype.step.call(this); this.ai();
    if (this.t === 0) {
      this.px = finiteAdd(this.px, this.vx); this.py = finiteAdd(this.py, this.vy);
      this.gotoAndPlay(this.pz === 0 && this.vx === 0 && this.vy === 0 ? 'idle' : 'run');
    } else {
      if (this.pz > 0) { this.px = finiteAdd(this.px, this.vx); this.py = finiteAdd(this.py, this.vy); }
      this.t--;
    }
    if (this.pz > 0) {
      this.vz = finiteAdd(this.vz, this.gravity); this.pz = finiteAdd(this.pz, this.vz);
      if (this.pz <= 0) { this.pz = this.vx = this.vy = this.vz = 0; this.jumpTimes = 2; }
    } else this.vx = this.vy = this.vz = 0;
    if (this.deadTime > 0) { this.deadTime--; if (this.deadTime === 1) this.parent.removeChild(this); }
    this.sx = this.direction * this.opposite;
  }
}

const ENTITY_METHODS = ['move', 'moveTo', 'approachTarget', 'findTarget', 'attack', 'minusHP', 'step'];
function upgradeEntity(entity) { copyMethods(entity, CustomEntity.prototype, ENTITY_METHODS); return entity; }

/** Explicit custom extension. The recovered source and its global prototypes stay intact. */
export class CustomMiragineSimulation extends MiragineSimulation {
  constructor(options = {}) {
    super({ ...options, autoStart: false });
    installCustomRuntime(this, options.config, { initialize: true });
    if (options.autoStart !== false) this.step();
  }
  get timeSeconds() { return Math.trunc(this.round / this.rules.frameRate); }
  createBase(side) {
    const base = super.createBase(side); upgradeEntity(base);
    return applyCustomEntityStats(base, 'absolute', { initialize: true });
  }
  applyDifficulty() {
    const side = customSideConfiguration(this, 'right');
    this.blueBoss.damage = side.base.damage; this.blueBoss.weaponSpeed = side.base.weaponSpeedFrames;
    this.rightIncome = clampInteger(side.initial.income); this.rightPopulation = clampInteger(side.initial.population);
  }
  createUnit(side, id = 0) {
    side = sideName(side);
    if (!Number.isInteger(id) || id < 0 || id > 15) throw new RangeError('Unit id must be 0..15');
    const unit = customSideConfiguration(this, side).units[id];
    const money = `${side}Money`, income = `${side}Income`, population = `${side}Population`;
    if (this[money] < unit.cost || this[population] < unit.population) return null;
    this[money] = safeSubtract(this[money], unit.cost);
    this[income] = safeAdd(this[income], unit.income, this.incomeLimit);
    this[population] = safeSubtract(this[population], unit.population);
    const entity = new CustomEntity(this);
    entity.data = entity.side = side; entity.id = id;
    entity.targetList = side === 'left' ? this.enemyList : this.friendList;
    entity.spriteIndex = unit.ss; entity.spriteSheet = this.unitAnimation(side, unit.ss);
    if (unit.wss != null) { entity.weaponSheet = unit.wss; entity.weaponSpriteSheet = this.effectAnimation(unit.wss); }
    applyCustomEntityStats(entity, 'absolute', { initialize: true });
    entity.gotoAndPlay('idle');
    entity.px = side === 'left' ? this.rules.baseSpawnInset : this.mapWidth - this.rules.baseSpawnInset;
    entity.py = this.mapHeight / 2 + (this.rules.spawnJitterY - 2 * this.rules.spawnJitterY * this.rng());
    (side === 'left' ? this.friendList : this.enemyList).push(entity); this.scene.addChild(entity);
    this.emit('recruit', { side, id, uid: entity.uid }); return entity;
  }
  ai() {
    const difficulty = this.config.difficulties[this.difficulty];
    const ai = this.config.customization?.difficulties?.[this.difficulty]?.ai ?? difficulty.ai ?? this.config.ai;
    const list = (key, countKey) => ai[key] ?? Array.from({ length: ai[countKey] }, (_, i) => i);
    const choose = values => values[Math.trunc(this.rng() * values.length)];
    let selected = 0, strongestCount = 0;
    const counter = difficulty.counterSelectionProbability > this.rng();
    if (counter) {
      const counts = new Map();
      for (let index = this.friendList.length - 1; index >= 0; index--) {
        const id = this.friendList[index].id; counts.set(id, (counts.get(id) ?? 0) + 1);
        if (ai.eliteUnitIds.includes(id)) strongestCount++;
      }
      let maxCount = (ai.counterMinimumCount ?? 2) - 1, majorityId = -1;
      for (const id of this.dictionaryKeys(counts)) {
        // Crystals have no unit id. The original minimum of two hid their
        // one-item count; lowering the editable threshold must not turn a
        // crystal into unit zero through AS3's undefined-to-int conversion.
        if (!Number.isInteger(Number(id)) || Number(id) < 0 || Number(id) > 15) continue;
        if (counts.get(id) > maxCount) { maxCount = counts.get(id); majorityId = Number(id) >> 0; }
      }
      if (majorityId === 0) selected = this.rightIncome < ai.newbieIncomeThreshold ? ai.newbieBelowThresholdChoice : ai.newbieAtOrAboveThresholdChoice;
      else if (ai.counterChoices[majorityId]?.length) selected = choose(ai.counterChoices[majorityId]);
      else selected = this.rightIncome > ai.counterFallbackIncomeThreshold
        ? choose(list('counterFallbackChoices', 'counterFallbackRandomUnitCount')) : ai.counterFallbackLowIncomeChoice;
    } else selected = choose(this.rightIncome > ai.randomIncomeThreshold
      ? list('randomHighIncomeChoices', 'randomHighIncomeUnitCount') : list('randomLowIncomeChoices', 'randomLowIncomeUnitCount'));
    if (!counter && ai.eliteCountOnlyCounterBranch === false) {
      for (const entity of this.friendList) if (ai.eliteUnitIds.includes(entity.id)) strongestCount++;
    }
    if ((ai.forceMoneyEnabled !== false && this.rightMoney > ai.forceOverlordMoneyThreshold)
      || (ai.forceEliteEnabled !== false && strongestCount > ai.forceOverlordEliteCountThreshold)) selected = ai.forcedUnitId;
    this.p2[0] = selected % 8; this.p2[1] = Math.trunc(selected / 8);
    this.emit('aiSelection', { id: selected }); return selected;
  }
  stepFrame() {
    this.frame = safeAdd(this.frame, 1);
    this.scene.step(); this.scene.applyOriginalRenderOrder();
    refresh(this);
    const front = this.separate(this.friendList, true);
    if (this.cameraTime <= 0 && front) {
      if (this.singlePlay) this.setCamera(this.camera.x + (front.px - this.camera.x) * this.rules.cameraFollowFactor,
        this.camera.y + (front.py - this.camera.y) * this.rules.cameraFollowFactor);
    } else this.cameraTime--;
    this.separate(this.enemyList);
    if (this.redBoss.nowHP <= 0 || this.blueBoss.nowHP <= 0) {
      if (this.gameOverTime > 0) {
        this.gameOverTime--;
        if (this.gameOverTime === 0) {
          this.winner = this.redBoss.nowHP === 0 ? 'right' : 'left'; this.emit('win', { winner: this.winner }); this.running = false;
        }
      }
    }
    if (this.round > 0 && !this.stopTimer) {
      this.round--;
      if ([5, 4, 3, 2, 1].some(second => this.round === second * this.rules.frameRate)) this.sound('SD_Timer');
      if (this.round === 0) {
        this.leftPopulation = this.rightPopulation = this.populationLimit;
        this.leftMoney = safeAdd(this.leftMoney, this.leftIncome); this.rightMoney = safeAdd(this.rightMoney, this.rightIncome);
        this.round = clampInteger(this.rules.roundFrames); this.sound('SD_cheer');
        this.emit('income', { left: this.leftIncome, right: this.rightIncome });
        if (this.singlePlay) this.ai();
      }
      if (this.round % this.rules.recruitEveryFrames === 0) {
        if (this.p1[2] === 1) this.createUnit('left', this.p1[0] + this.p1[1] * 8);
        if (this.p2[2] === 1) this.createUnit('right', this.p2[0] + this.p2[1] * 8);
      }
    }
  }
}

/** Upgrade only this battle, never a recovered class prototype or other match. */
export function installCustomRuntime(sim, configuration = sim.config, { initialize = false, health = 'ratio' } = {}) {
  sim.config = configuration; sim.rules = configuration.rules;
  copyMethods(sim, CustomMiragineSimulation.prototype, ['createBase', 'applyDifficulty', 'createUnit', 'ai', 'stepFrame']);
  Object.defineProperty(sim, 'timeSeconds', { configurable: true, get() { return Math.trunc(this.round / this.rules.frameRate); } });
  sim.incomeLimit = clampInteger(sim.rules.incomeLimit); sim.populationLimit = clampInteger(sim.rules.populationLimit);
  for (const entity of sim.scene.children) {
    if (entity.kind === 'attack') {
      copyMethods(entity, CustomAttack.prototype, ['step']);
      entity.delay = clampInteger(entity.delay); entity.life = clampInteger(entity.life);
    } else { upgradeEntity(entity); applyCustomEntityStats(entity, health, { initialize }); }
  }
  if (initialize) {
    for (const side of ['left', 'right']) {
      const values = customSideConfiguration(sim, side).initial;
      sim[`${side}Money`] = clampInteger(values.money); sim[`${side}Income`] = clampInteger(values.income);
      sim[`${side}Population`] = clampInteger(values.population);
    }
    sim.round = clampInteger(sim.rules.initialRoundFrames); sim.gameOverTime = clampInteger(sim.rules.gameOverDelayFrames ?? 30);
  }
  sim[installed] = true; refresh(sim); return sim;
}

export const hasCustomRuntime = sim => Boolean(sim?.[installed]);
export { MAX_INTEGER };
