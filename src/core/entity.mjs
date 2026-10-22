import { as3int, Vec2 } from './as3.mjs';
import { CoreSymbol } from './scene.mjs';

/** Direct manual port of Isometric2DAttack; melee also uses this moving hit test. */
export class IsometricAttack extends CoreSymbol {
  constructor(simulation, father, target, delay = 0) {
    super(simulation);
    this.kind = 'attack';
    this.father = father;
    this.target = target;
    this.side = father.side;
    this.delay = as3int(delay);
    this.px = father.px; this.py = father.py; this.pz = father.pz;
    this.direction = father.direction;
    this.vx = this.vy = this.vz = 0;
    this.opposite = -1;
    this.life = as3int(simulation.rules.projectileLifeFrames);
    this.damageType = 'bullet';
    this.visible = false;
  }
  step() {
    super.step();
    if (this.delay === 0) {
      this.visible = true;
      this.px += this.vx;
      if ((this.direction > 0 && this.px > this.target.px) ||
          (this.direction < 0 && this.px < this.target.px)) {
        this.px = this.target.px;
        const hit = Math.abs(this.py - this.target.py) <= this.simulation.rules.projectileVerticalTolerance;
        if (hit) this.target.minusHP(this.father.damage);
        this.simulation.emit('impact', { attackUid: this.uid, targetUid: this.target.uid, hit });
        this.parent.removeChild(this);
      }
    } else this.delay = as3int(this.delay - 1);
    if (this.life === 0) this.parent.removeChild(this);
    else this.life = as3int(this.life - 1);
    this.sx = this.direction * this.opposite;
  }
}

/** Direct manual port of Isometric2DEntity, including original edge cases. */
export class IsometricEntity extends CoreSymbol {
  constructor(simulation) {
    super(simulation);
    this.kind = 'unit';
    this.vx = this.vy = this.vz = 0;
    this.moveSpeed = this.weaponSpeed = this.range = this.armor = 0;
    this.damage = [0, 0]; this.armorTypeID = 0;
    this.nowHP = this.maxHP = 100;
    this.opposite = -1; this.direction = 1;
    this.data = undefined; this.targetList = []; this.target = null;
    this.weaponSpriteSheet = null;
    this.delayAttack = 0;
    this.gravity = simulation.rules.gravity; this.t = 0; this.jumpTimes = 2; this.deadTime = 0;
  }
  move(vector) {
    if (this.t === 0 || this.pz > 0) {
      const unit = vector.getUnit();
      this.vx = unit.x * this.moveSpeed; this.vy = unit.y * this.moveSpeed;
      this.direction = this.vx > 0 ? 1 : -1;
    }
  }
  moveTo(position) {
    if (this.t === 0 || this.pz > 0) {
      const vector = new Vec2(position.x - this.px, position.y - this.py);
      if (vector.x * vector.x + vector.y * vector.y < this.moveSpeed * this.moveSpeed) {
        this.px = position.x; this.py = position.y;
      } else {
        vector.normalize();
        this.vx = vector.x * this.moveSpeed; this.vy = vector.y * this.moveSpeed;
      }
      this.direction = this.vx > 0 ? 1 : -1;
    }
  }
  jump() {
    if (this.pz === 0 && this.t === 0) this.pz = 1;
    if (this.jumpTimes > 0) { this.vz = 10; this.jumpTimes--; }
  }
  hurt() { this.t = 10; this.gotoAndPlay('dead'); }
  dead() {
    this.t = 1000; this.nowHP = 0; this.gotoAndPlay('dead'); this.deadTime = as3int(this.simulation.rules.deathAnimationFrames);
    this.simulation.onEntityDestroy(this);
    this.pz = 1; this.vx = -5 * this.direction; this.vz = 8;
  }
  attack() {
    if (this.t !== 0) return;
    this.t = as3int(this.weaponSpeed);
    this.gotoAndPlay('attack');
    const attack = new IsometricAttack(this.simulation, this, this.target, this.delayAttack);
    attack.spriteSheet = this.weaponSpriteSheet;
    attack.weaponSheet = this.weaponSheet;
    if (this.weaponSpriteSheet) attack.gotoAndPlay('idle');
    attack.pz = this.simulation.rules.projectileSpawnHeight;
    attack.vx = this.simulation.rules.projectileSpeed * this.direction;
    this.parent.addChild(attack);
    this.simulation.onEntityAttack(this, attack);
  }
  minusHP(damage) {
    if (this.nowHP > 0) {
      const amount = damage[this.armorTypeID] - this.armor;
      // No minimum-damage clamp exists in the SWF. Negative damage heals uncapped.
      this.nowHP -= amount;
      this.simulation.emit('damage', { uid: this.uid, amount, nowHP: this.nowHP });
      if (this.nowHP <= 0) { this.nowHP = 0; this.dead(); }
    }
  }
  findTarget() {
    this.target = null;
    let nearest = Number.MAX_VALUE;
    for (const entity of this.targetList) {
      if (entity.nowHP !== 0) {
        const dx = entity.px - this.px, dy = entity.py - this.py;
        const score = dx * dx + this.simulation.rules.targetVerticalWeight * (dy * dy);
        if (score < nearest) { nearest = score; this.target = entity; }
      }
    }
  }
  approachTarget() {
    const position = new Vec2(this.target.px, this.target.py);
    position.x += this.target.px - this.px > 0 ? -this.range : this.range;
    if (Math.abs(this.target.px - this.px) <= this.range && Math.abs(this.target.py - this.py) <= this.simulation.rules.attackVerticalTolerance) {
      this.direction = this.target.px - this.px > 0 ? 1 : -1;
      this.attack();
    } else this.moveTo(position);
  }
  ai() {
    if (this.nowHP > 0) { this.findTarget(); if (this.target !== null) this.approachTarget(); }
  }
  step() {
    super.step();
    this.ai();
    if (this.t === 0) {
      this.px += this.vx; this.py += this.vy;
      this.gotoAndPlay(this.pz === 0 && this.vx === 0 && this.vy === 0 ? 'idle' : 'run');
    } else {
      if (this.pz > 0) { this.px += this.vx; this.py += this.vy; }
      this.t = as3int(this.t - 1);
    }
    if (this.pz > 0) {
      this.vz += this.gravity; this.pz += this.vz;
      if (this.pz <= 0) {
        this.pz = this.vx = this.vy = this.vz = 0; this.jumpTimes = 2;
      }
    } else this.vx = this.vy = this.vz = 0;
    if (this.deadTime > 0) {
      this.deadTime--;
      if (this.deadTime === 1) this.parent.removeChild(this);
    }
    this.sx = this.direction * this.opposite;
  }
}
