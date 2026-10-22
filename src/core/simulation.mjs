import { as3int } from './as3.mjs';
import { CoreScene } from './scene.mjs';
import { IsometricEntity } from './entity.mjs';

export const CORE_PARITY_GATES = Object.freeze([
  'Full-match frame-by-frame comparison against original Flash has not yet been completed.',
  'Flash Dictionary enumeration order in tied AI unit counts is runtime-specific; default is insertion order, injectable with dictionaryKeys.',
  'Flash Array.sortOn equal-py tie ordering is unspecified; this port uses the JS stable descending-sort then reverse sequence.',
  'Math.random sequences are not portable between Flash and JavaScript; tests inject a deterministic RNG.',
]);

/** Validate required recovered fields without silently replacing custom data. */
export function validateCoreConfiguration(config) {
  if (config?.schemaVersion !== 1 || !config.rules || !config.units || !config.difficulties) {
    throw new TypeError('Expected recovered schemaVersion 1 configuration with rules, units and difficulties');
  }
  const number = (value, label) => {
    if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError(`${label}: expected a finite number`);
  };
  for (const key of ['frameRate', 'mapWidth', 'mapHeight', 'incomeLimit', 'populationLimit', 'startingIncome',
    'initialRoundFrames', 'roundFrames', 'recruitEveryFrames', 'baseHp', 'baseWeaponSpeedFrames', 'baseRange',
    'baseSpawnInset', 'spawnJitterY']) number(config.rules[key], `rules.${key}`);
  if (config.rules.frameRate <= 0 || config.rules.recruitEveryFrames <= 0) throw new RangeError('Frame rate and recruitment cadence must be positive');
  for (let id = 0; id < 16; id++) {
    const unit = config.units[id];
    if (!unit) throw new TypeError(`units.${id}: missing unit`);
    for (const key of ['cost', 'population', 'income', 'hp', 'armorTypeID', 'armor', 'moveSpeed', 'range',
      'weaponSpeed', 'delayAttack', 'ss']) number(unit[key], `units.${id}.${key}`);
    if (!Array.isArray(unit.damage) || unit.damage.length !== 2) throw new TypeError(`units.${id}.damage: expected two armor damage values`);
    unit.damage.forEach((value, index) => number(value, `units.${id}.damage.${index}`));
  }
  return config;
}

function sideName(side) {
  if (side === 'left' || side === 1) return 'left';
  if (side === 'right' || side === -1) return 'right';
  throw new TypeError('side must be left/right or 1/-1');
}

/**
 * Headless manual port of DragonForce.as and the dragonforce simulation classes.
 * Calling start() mirrors GameEngine.startEngine's immediate first step.
 * autoStart:false omits that immediate step, useful for deterministic tests;
 * manual step() still advances unless explicitly stopped or a match has ended.
 */
export class MiragineSimulation {
  constructor({ config, rng = Math.random, singlePlay = true, difficulty = 1,
    autoStart = true, dictionaryKeys = map => [...map.keys()] } = {}) {
    validateCoreConfiguration(config);
    if (typeof rng !== 'function' || typeof dictionaryKeys !== 'function') throw new TypeError('rng and dictionaryKeys must be functions');
    if (!config.difficulties[difficulty]) throw new RangeError(`Unknown difficulty ${difficulty}`);
    this.config = config; this.rules = config.rules;
    this.rng = rng; this.dictionaryKeys = dictionaryKeys;
    this.singlePlay = Boolean(singlePlay); this.difficulty = as3int(difficulty);
    this.events = []; this.nextUid = 1;
    this.frame = 0; this.running = true; this.winner = null; this.stopTimer = false;
    this.camera = { x: 2000, y: 150, width: 640, height: 400 };
    this.cameraTime = 0; this.scene = new CoreScene();
    this.friendList = []; this.enemyList = [];
    this.round = as3int(this.rules.initialRoundFrames);
    this.gameOverTime = as3int(this.rules.gameOverDelayFrames ?? 30);
    this.mapWidth = as3int(this.rules.mapWidth); this.mapHeight = as3int(this.rules.mapHeight);
    this.incomeLimit = as3int(this.rules.incomeLimit); this.populationLimit = as3int(this.rules.populationLimit);
    this.p1 = [0, 0, 1]; this.p2 = [0, 0, 1];
    this.leftMoney = as3int(this.rules.initialMoney); this.rightMoney = as3int(this.rules.initialMoney);
    this.leftIncome = as3int(this.rules.startingIncome); this.rightIncome = as3int(this.rules.startingIncome);
    this.leftPopulation = this.populationLimit; this.rightPopulation = this.populationLimit;
    this.redBoss = this.createBase('left'); this.blueBoss = this.createBase('right');
    this.applyDifficulty();
    this.renderSnapshot = this.scene.children.map(child => child.visualState());
    this.renderCamera = { ...this.camera };
    if (autoStart) this.step();
  }

  emit(type, data = {}) { this.events.push({ type, frame: this.frame, ...data }); }
  sound(name, volume = 1) { this.emit('sound', { name, volume }); }
  drainEvents() { return this.events.splice(0); }
  get projectiles() { return this.scene.children.filter(child => child.kind === 'attack'); }
  get entities() { return this.scene.children.filter(child => child.kind !== 'attack'); }
  get timeSeconds() { return as3int(this.round / this.rules.frameRate); }

  createBase(side) {
    const base = new IsometricEntity(this);
    base.kind = 'base'; base.side = side;
    base.targetList = side === 'left' ? this.enemyList : this.friendList;
    base.spriteSheet = this.baseAnimation(side);
    base.nowHP = base.maxHP = base.spawnHP = this.rules.baseHp;
    base.weaponSheet = side === 'left' ? 'fb' : 'tb';
    base.weaponSpriteSheet = this.effectAnimation(base.weaponSheet);
    base.damage = this.rules.baseDamage;
    base.weaponSpeed = this.rules.baseWeaponSpeedFrames; base.range = this.rules.baseRange;
    base.px = side === 'left' ? this.rules.baseSpawnInset : this.mapWidth - this.rules.baseSpawnInset;
    base.py = this.mapHeight / 2;
    (side === 'left' ? this.friendList : this.enemyList).push(base);
    this.scene.addChild(base);
    return base;
  }

  baseAnimation(side) {
    const map = this.config.animations[side === 'left' ? 'A_crystal' : 'B_crystal'];
    return Object.fromEntries(['idle', 'run', 'attack', 'dead'].map(action => [action, { ...map }]));
  }

  effectAnimation(name) {
    const symbol = { fb: 'fireball', tb: 'thunderball', storm: 'storm' }[name];
    return symbol ? { idle: this.config.animations[symbol] } : null;
  }

  unitAnimation(side, spriteIndex) {
    const prefix = side === 'left' ? 'A' : 'B';
    return Object.fromEntries(['idle', 'run', 'attack', 'dead'].map(action => [action, {
      ...this.config.animations[`${prefix}${spriteIndex}_${action}`],
      speed: this.rules.animationSpeeds[action], loop: this.rules.animationLoops[action],
    }]));
  }

  applyDifficulty() {
    const difficulty = this.config.difficulties[this.difficulty];
    // Support the emitted field contract; do not apply modifiers in local-two-
    // player mode differently: the original init checks difficulty, not mode.
    this.blueBoss.damage = difficulty.blueBaseDamage;
    this.blueBoss.weaponSpeed = difficulty.blueBaseWeaponSpeedFrames;
    this.rightIncome = as3int(difficulty.rightStartingIncome);
    this.rightPopulation = as3int(difficulty.rightStartingPopulation);
  }

  start() { this.running = true; if (!this.winner) this.step(); }
  stop() { this.running = false; }

  selectUnit(side, id) {
    side = sideName(side);
    if (side === 'right' && this.singlePlay) return false;
    if (!Number.isInteger(id) || id < 0 || id > 15) throw new RangeError('Unit id must be 0..15');
    const selection = side === 'left' ? this.p1 : this.p2;
    selection[0] = id % 8; selection[1] = as3int(id / 8);
    this.sound('SD_btns');
    this.emit('selection', { side, id });
    return true;
  }

  control(side, dx = 0, dy = 0, toggle = 0) {
    side = sideName(side);
    if (side === 'right' && this.singlePlay) return false;
    const selection = side === 'left' ? this.p1 : this.p2;
    selection[0] = Math.max(0, Math.min(selection[0] + as3int(dx), 7));
    selection[1] = Math.max(0, Math.min(selection[1] + as3int(dy), 1));
    if (as3int(toggle) === 1) selection[2] = selection[2] === 0 ? 1 : 0;
    this.sound('SD_btns');
    return true;
  }

  toggleRecruitment(side) { return this.control(side, 0, 0, 1); }

  steer(dx, dy) {
    this.cameraTime = as3int(this.rules.manualCameraHoldFrames);
    this.setCamera(this.camera.x + dx * 4, this.camera.y + dy * 4);
  }

  setCamera(x, y) {
    // Camera.limitInMap takes int arguments, then setters clamp to max-width.
    const maxX = as3int(1.15 * this.mapWidth) - this.camera.width;
    const maxY = as3int(1.5 * this.mapHeight) - this.camera.height;
    this.camera.x = x; this.camera.y = y;
    if (this.camera.x < 0) this.camera.x = 0;
    if (this.camera.x > maxX) this.camera.x = maxX;
    if (this.camera.y < 0) this.camera.y = 0;
    if (this.camera.y > maxY) this.camera.y = maxY;
  }

  pointCamera(x, y) { this.cameraTime = as3int(this.rules.manualCameraHoldFrames); this.setCamera(x, y); }

  createUnit(side, id = 0) {
    side = sideName(side); id = as3int(id);
    const unit = this.config.units[id];
    if (!unit) throw new RangeError(`Unknown unit ${id}`);
    const money = `${side}Money`, income = `${side}Income`, population = `${side}Population`;
    if (this[money] - unit.cost < 0 || this[population] - unit.population < 0) return null;
    this[money] = as3int(this[money] - unit.cost);
    this[income] = as3int(this[income] + unit.income);
    if (this[income] > this.incomeLimit) this[income] = this.incomeLimit;
    this[population] = as3int(this[population] - unit.population);
    const entity = new IsometricEntity(this);
    entity.data = entity.side = side; entity.id = id;
    entity.targetList = side === 'left' ? this.enemyList : this.friendList;
    entity.spriteIndex = unit.ss; entity.spriteSheet = this.unitAnimation(side, unit.ss);
    if (unit.wss != null) {
      entity.weaponSheet = unit.wss; entity.weaponSpriteSheet = this.effectAnimation(unit.wss);
    }
    entity.nowHP = entity.spawnHP = unit.hp; // maxHP intentionally retains original default 100.
    entity.armorTypeID = as3int(unit.armorTypeID); entity.armor = unit.armor;
    entity.moveSpeed = unit.moveSpeed * this.rules.movementMultiplier;
    entity.damage = unit.damage;
    entity.range = unit.range * this.rules.rangeMultiplier;
    entity.weaponSpeed = unit.weaponSpeed * this.rules.weaponSpeedMultiplier;
    entity.delayAttack = as3int(unit.delayAttack);
    entity.gotoAndPlay('idle');
    entity.px = side === 'left' ? this.rules.baseSpawnInset : this.mapWidth - this.rules.baseSpawnInset;
    entity.py = this.mapHeight / 2 + (this.rules.spawnJitterY - 2 * this.rules.spawnJitterY * this.rng());
    (side === 'left' ? this.friendList : this.enemyList).push(entity);
    this.scene.addChild(entity);
    this.emit('recruit', { side, id, uid: entity.uid });
    return entity;
  }

  onEntityDestroy(entity) {
    this.emit('destroy', { uid: entity.uid, side: entity.side, id: entity.id });
    if (entity.kind === 'base') return; // No DragonForce destroy listener is attached to crystals.
    const list = entity.data === 'left' ? this.friendList : this.enemyList;
    const index = list.indexOf(entity);
    if (index !== -1) list.splice(index, 1);
    if (this.rng() > 0.5) this.sound('SD_dead3');
  }

  onEntityAttack(entity, attack) {
    this.emit('attack', { uid: entity.uid, targetUid: entity.target.uid, attackUid: attack.uid });
    if (entity.kind === 'base' || entity.id === 6 || entity.id === 9 || entity.id === 12) return;
    const random = this.rng();
    if (random > 0.9) this.sound('SD_dao', 0.2);
    if (random < 0.1) this.sound('SD_cha', 0.5);
  }

  destroyUnits(amount) {
    const list = amount > 0 ? this.friendList : this.enemyList;
    const base = amount > 0 ? this.redBoss : this.blueBoss;
    for (let index = list.length - 1; index >= 0; index--) if (list[index] !== base) list[index].dead();
  }

  ai() {
    const profile = this.config.difficulties[this.difficulty];
    const ai = this.config.ai;
    let selected = 0, strongestCount = 0;
    if (profile.counterSelectionProbability > this.rng()) {
      const counts = new Map();
      for (let index = this.friendList.length - 1; index >= 0; index--) {
        const id = this.friendList[index].id;
        counts.set(id, (counts.get(id) ?? 0) + 1);
        if (ai.eliteUnitIds.includes(id)) strongestCount++;
      }
      let maxCount = 1, majorityId = -1;
      for (const id of this.dictionaryKeys(counts)) {
        if (counts.get(id) > maxCount) { maxCount = counts.get(id); majorityId = as3int(id); }
      }
      if (majorityId === 0) selected = this.rightIncome < ai.newbieIncomeThreshold ? ai.newbieBelowThresholdChoice : ai.newbieAtOrAboveThresholdChoice;
      else if (ai.counterChoices[majorityId]) {
        const counters = ai.counterChoices[majorityId];
        selected = as3int(counters[as3int(this.rng() * counters.length)]);
      } else selected = this.rightIncome > ai.counterFallbackIncomeThreshold ? as3int(this.rng() * ai.counterFallbackRandomUnitCount) : ai.counterFallbackLowIncomeChoice;
    } else selected = as3int(this.rng() * (this.rightIncome > ai.randomIncomeThreshold ? ai.randomHighIncomeUnitCount : ai.randomLowIncomeUnitCount));
    if (this.rightMoney > ai.forceOverlordMoneyThreshold || strongestCount > ai.forceOverlordEliteCountThreshold) selected = ai.forcedUnitId;
    this.p2[0] = selected % 8; this.p2[1] = as3int(selected / 8);
    this.emit('aiSelection', { id: selected });
    return selected;
  }

  separate(list, trackFront = false) {
    let front = null, maxX = 0;
    if (list.length > 1) {
      for (let i = list.length - 1; i > 0; i--) {
        const entity = list[i];
        for (let j = i - 1; j >= 0; j--) {
          const other = list[j];
          if (entity === other) continue;
          let dx = entity.px - other.px, dy = entity.py - other.py;
          let distance = dx * dx + dy * dy;
          if (distance < this.rules.unitSeparationDistance * this.rules.unitSeparationDistance) {
            distance = Math.sqrt(distance);
            dx = distance === 0 ? 0 : dx / distance;
            dy = distance === 0 ? 0 : dy / distance;
            entity.px += dx * (this.rules.unitSeparationDistance - distance); entity.py += dy * (this.rules.unitSeparationDistance - distance);
          }
        }
        if (trackFront && entity.px > maxX) { maxX = as3int(entity.px); front = entity; }
      }
    } else if (trackFront) front = list[0];
    return front;
  }

  step(frames = 1) {
    if (!Number.isInteger(frames) || frames < 0) throw new RangeError('frames must be a nonnegative integer');
    for (let frame = 0; frame < frames && this.running && !this.winner; frame++) this.stepFrame();
    return this;
  }

  stepFrame() {
    this.frame++;
    this.scene.step();
    this.scene.applyOriginalRenderOrder();
    // Rendering happened here in the Flash engine, before spacing and recruitment.
    this.renderSnapshot = this.scene.children.map(child => child.visualState());
    this.renderCamera = { ...this.camera };
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
          this.winner = this.redBoss.nowHP === 0 ? 'right' : 'left';
          this.emit('win', { winner: this.winner });
          this.running = false;
        }
      }
    }
    // Even the frame which stops the engine executes the timer branch afterward.
    if (this.round > 0 && !this.stopTimer) {
      this.round--;
      if ([5, 4, 3, 2, 1].some(second => this.round === second * this.rules.frameRate)) this.sound('SD_Timer');
      if (this.round === 0) {
        this.leftPopulation = this.rightPopulation = this.populationLimit;
        this.leftMoney = as3int(this.leftMoney + this.leftIncome);
        this.rightMoney = as3int(this.rightMoney + this.rightIncome);
        this.round = as3int(this.rules.roundFrames);
        this.sound('SD_cheer');
        this.emit('income', { left: this.leftIncome, right: this.rightIncome });
        if (this.singlePlay) this.ai();
      }
      if (this.round % this.rules.recruitEveryFrames === 0) {
        if (this.p1[2] === 1) this.createUnit('left', this.p1[0] + this.p1[1] * 8);
        if (this.p2[2] === 1) this.createUnit('right', this.p2[0] + this.p2[1] * 8);
      }
    }
  }

  snapshot() {
    return {
      frame: this.frame, running: this.running, winner: this.winner,
      singlePlay: this.singlePlay, difficulty: this.difficulty, round: this.round,
      timeSeconds: this.timeSeconds, gameOverTime: this.gameOverTime,
      leftMoney: this.leftMoney, leftIncome: this.leftIncome, leftPopulation: this.leftPopulation,
      rightMoney: this.rightMoney, rightIncome: this.rightIncome, rightPopulation: this.rightPopulation,
      p1: [...this.p1], p2: [...this.p2], camera: { ...this.camera },
      redBoss: this.redBoss.visualState(), blueBoss: this.blueBoss.visualState(),
      children: this.scene.children.map(child => child.visualState()),
      renderSnapshot: this.renderSnapshot.map(child => ({ ...child })), renderCamera: { ...this.renderCamera },
    };
  }
}
