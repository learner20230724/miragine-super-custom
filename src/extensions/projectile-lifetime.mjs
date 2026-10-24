import { clampInteger, safeAdd, safeMultiply } from '../customization/numeric.mjs';

const installed = new WeakSet();

function policyFor(simulation) {
  const policy = simulation.config.casterProjectileLifetime;
  if (policy === undefined) return null;
  if (!policy || Array.isArray(policy) || typeof policy !== 'object'
      || !Number.isFinite(policy.mapWidths) || policy.mapWidths <= 0
      || !Array.isArray(policy.unitIds) || !policy.unitIds.length
      || new Set(policy.unitIds).size !== policy.unitIds.length
      || policy.unitIds.some(id => !Number.isInteger(id) || id < 0 || id > 15)) {
    throw new TypeError('casterProjectileLifetime requires positive mapWidths and distinct unitIds (0–15)');
  }
  if (policy.baseLifeFrames !== undefined
      && (!Number.isSafeInteger(policy.baseLifeFrames) || policy.baseLifeFrames <= 0)) {
    throw new TypeError('casterProjectileLifetime.baseLifeFrames must be a positive safe integer');
  }
  if (!Number.isFinite(simulation.mapWidth) || simulation.mapWidth <= 0
      || !Number.isFinite(simulation.rules.projectileSpeed) || simulation.rules.projectileSpeed === 0) {
    throw new RangeError('Caster projectile lifetime requires positive mapWidth and finite nonzero projectileSpeed');
  }
  return policy;
}

/** Convert travel distance to a lifetime without changing movement/removal order. */
export function casterProjectileLifeFrames(mapWidth, mapWidths, speed, delay) {
  if (![mapWidth, mapWidths, speed].every(Number.isFinite) || mapWidth <= 0 || mapWidths <= 0 || speed === 0) {
    throw new RangeError('Projectile travel requires positive width/multiplier and finite nonzero speed');
  }
  const distance = safeMultiply(mapWidth, mapWidths);
  const steps = distance / Math.abs(speed), nearest = Math.round(steps);
  // Decimal JSON factors such as 1.1 can put an exact whole step a few ULPs
  // above its integer (6000 * 1.1 / 30). Do not add a spurious extra step.
  const rounded = Math.abs(steps - nearest) <= 2 * Number.EPSILON * Math.abs(steps) ? nearest : steps;
  const flightSteps = clampInteger(Math.ceil(rounded), { min: 1 });
  // Delay consumes life too. Budget enough retained movement steps, not the
  // final extra movement that is immediately removed by the recovered code.
  return safeAdd(clampInteger(delay), flightSteps);
}

/** Opt-in, per-match extension; never patch recovered classes or generated data. */
export function installCasterProjectileLifetime(simulation) {
  if (!policyFor(simulation) || installed.has(simulation)) return simulation;
  const original = simulation.onEntityAttack;
  simulation.onEntityAttack = function (entity, attack, ...args) {
    const policy = policyFor(this);
    if (policy && entity.kind === 'unit' && policy.unitIds.includes(entity.id)) {
      // Both original/custom attack factories call this after assigning vx.
      // Read the current configuration so live edits retain their own delay.
      attack.life = casterProjectileLifeFrames(this.mapWidth, policy.mapWidths, attack.vx, attack.delay);
    } else if (policy && entity.kind === 'base' && policy.baseLifeFrames !== undefined) {
      // Crystal lifetime is an explicit total step budget, independent of the
      // caster distance policy. It does not alter range, speed, or firing delay.
      attack.life = policy.baseLifeFrames;
    }
    return original.call(this, entity, attack, ...args);
  };
  installed.add(simulation);
  return simulation;
}
