import { CoreSymbol } from '../core/scene.mjs';
import { clampInteger, finiteAdd, finiteSubtract, safeAdd, safeMultiply } from '../customization/numeric.mjs';
import { visitProjectileCandidates } from '../performance/simulation-spatial.mjs';

const installed = new WeakSet(), attacks = new WeakMap();
const projectileSheets = new Set(['fb', 'tb', 'storm']);

function policyFor(simulation) {
  const policy = simulation.config.combatHitRules;
  if (policy === undefined) return null;
  if (!policy || policy.projectiles !== 'swept-first-enemy' || policy.ordinaryAttacks !== 'delayed-target'
      || !['unitRadius', 'baseRadius', 'projectileRadius'].every(key => Number.isFinite(policy[key]) && policy[key] >= 0)) {
    throw new TypeError('combatHitRules requires swept-first-enemy, delayed-target and nonnegative finite collision radii');
  }
  return policy;
}

/** Earliest contact fraction of a segment and a closed circle, or null.
 * Normalize first to avoid squaring enormous custom coordinates. This is a
 * world-space hurt volume, not pixel/animation/camera dependent collision.
 */
export function segmentCircleContact(x0, y0, x1, y1, cx, cy, radius) {
  if (![x0, y0, x1, y1, cx, cy, radius].every(Number.isFinite) || radius < 0) return null;
  let dx = x1 - x0, dy = y1 - y0, rx = cx - x0, ry = cy - y0;
  if (![dx, dy, rx, ry].every(Number.isFinite)) {
    // Opposite near-MAX_VALUE coordinates can overflow even though each input
    // is finite. Scale endpoints first only in this exceptional case.
    const coordinateScale = Math.max(Math.abs(x0), Math.abs(y0), Math.abs(x1), Math.abs(y1), Math.abs(cx), Math.abs(cy), radius);
    dx = x1 / coordinateScale - x0 / coordinateScale; dy = y1 / coordinateScale - y0 / coordinateScale;
    rx = cx / coordinateScale - x0 / coordinateScale; ry = cy / coordinateScale - y0 / coordinateScale;
    radius /= coordinateScale;
  }
  const scale = Math.max(Math.abs(dx), Math.abs(dy), Math.abs(rx), Math.abs(ry), radius);
  if (scale === 0) return 0;
  const x = dx / scale, y = dy / scale, a = rx / scale, b = ry / scale, r = radius / scale;
  if (Math.hypot(a, b) <= r) return 0;
  const length = Math.hypot(x, y);
  if (length === 0) return null;
  const ux = x / length, uy = y / length;
  const along = a * ux + b * uy, perpendicular = Math.abs(a * uy - b * ux);
  if (perpendicular > r) return null;
  const entry = along - Math.sqrt(Math.max(0, (r - perpendicular) * (r + perpendicular)));
  if (entry < 0 || entry > length) return null;
  return entry / length;
}

function livingEnemy(attack, target) {
  return target && target !== attack.father && target.side !== attack.side
    && (target.kind === 'unit' || target.kind === 'base')
    && target.nowHP > 0 && target.parent === attack.simulation.scene;
}

function remove(attack) { if (attack.parent) attack.parent.removeChild(attack); }

function impact(attack, target) {
  target.minusHP(attack.father.damage);
  attack.simulation.emit('impact', { attackUid: attack.uid, targetUid: target.uid, hit: true });
  remove(attack);
}

function aimOnce(attack, state) {
  if (state.aimed) return;
  state.aimed = true;
  const target = attack.target;
  const speed = Math.hypot(attack.vx, attack.vy);
  if (!target || !Number.isFinite(speed) || speed === 0) return;
  const dx = finiteSubtract(target.px, attack.px), dy = finiteSubtract(target.py, attack.py);
  const scale = Math.max(Math.abs(dx), Math.abs(dy));
  if (!Number.isFinite(scale) || scale === 0) return;
  const x = dx / scale, y = dy / scale, length = Math.hypot(x, y);
  attack.vx = safeMultiply(speed, x / length); attack.vy = safeMultiply(speed, y / length);
  if (attack.vx !== 0) attack.direction = Math.sign(attack.vx);
}

function firstContact(attack, state, x1, y1) {
  const { policy } = state;
  const radius = finiteAdd(Math.max(policy.unitRadius, policy.baseRadius), policy.projectileRadius);
  const bounds = {
    minX: finiteSubtract(Math.min(attack.px, x1), radius), maxX: finiteAdd(Math.max(attack.px, x1), radius),
    minY: finiteSubtract(Math.min(attack.py, y1), radius), maxY: finiteAdd(Math.max(attack.py, y1), radius),
  };
  let target = null, fraction = Infinity;
  visitProjectileCandidates(attack.simulation, attack.side, bounds, candidate => {
    if (!livingEnemy(attack, candidate)) return;
    const r = finiteAdd(candidate.kind === 'base' ? policy.baseRadius : policy.unitRadius, policy.projectileRadius);
    const contact = segmentCircleContact(attack.px, attack.py, x1, y1, candidate.px, candidate.py, r);
    if (contact !== null && (contact < fraction || (contact === fraction && candidate.uid < target.uid))) {
      target = candidate; fraction = contact;
    }
  });
  return target ? { target, fraction } : null;
}

function combatStep() {
  if (!this.parent) return;
  const state = attacks.get(this);
  CoreSymbol.prototype.step.call(this);
  if (state.mode === 'direct') {
    // An ordinary attack is committed at attack initiation. Preserve its delay,
    // not the old invisible projectile's travel time or 30-unit miss gate.
    if (this.delay > 0) { this.delay--; if (this.life > 0) this.life--; }
    else if (livingEnemy(this, this.target)) impact(this, this.target);
    else remove(this);
    return;
  }
  if (this.delay > 0) this.delay--;
  else {
    this.visible = true;
    aimOnce(this, state);
    const x1 = finiteAdd(this.px, this.vx), y1 = finiteAdd(this.py, this.vy);
    const contact = firstContact(this, state, x1, y1);
    if (contact) {
      this.px = finiteAdd(safeMultiply(this.px, 1 - contact.fraction), safeMultiply(x1, contact.fraction));
      this.py = finiteAdd(safeMultiply(this.py, 1 - contact.fraction), safeMultiply(y1, contact.fraction));
      impact(this, contact.target);
    } else { this.px = x1; this.py = y1; }
  }
  // Preserve delay-inclusive life and move-before-expiry order, but never
  // remove twice if collision and expiry happen in the same processing step.
  if (this.parent) {
    if (this.life === 0) remove(this);
    else this.life--;
  }
  this.sx = this.direction * this.opposite;
}

function attach(attack, policy) {
  if (!attacks.has(attack)) {
    const mode = projectileSheets.has(attack.weaponSheet) ? 'projectile' : 'direct';
    attacks.set(attack, { mode, aimed: Boolean(attack.visible), policy: { ...policy } });
    if (mode === 'direct') {
      attack.visible = false;
      attack.life = safeAdd(clampInteger(attack.delay), 1);
    }
  }
  Object.defineProperty(attack, 'step', { value: combatStep, configurable: true, writable: true });
}

/** Restore only this installed extension after live custom-runtime upgrades.
 * Existing trajectories, delay, remaining life and hit policy are not reset.
 */
export function refreshCombatAttackSteps(simulation) {
  if (!installed.has(simulation)) return simulation;
  const policy = policyFor(simulation);
  if (policy) for (const attack of simulation.scene.children) if (attack.kind === 'attack') attach(attack, policy);
  return simulation;
}

/** Explicit custom rules; faithful classes, generated data and prototypes stay intact. */
export function installCombatHitRules(simulation) {
  if (!policyFor(simulation)) return simulation;
  if (!installed.has(simulation)) {
    const original = simulation.onEntityAttack;
    simulation.onEntityAttack = function (entity, attack, ...args) {
      // Let the existing lifetime/event/audio hooks run exactly once first.
      const result = original.call(this, entity, attack, ...args);
      const policy = policyFor(this);
      if (policy) attach(attack, policy);
      return result;
    };
    installed.add(simulation);
  }
  return refreshCombatAttackSteps(simulation);
}
