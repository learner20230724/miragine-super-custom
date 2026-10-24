import { as3int } from '../core/as3.mjs';
import { SpatialIndex, spatialCoordinateSupported } from './spatial-index.mjs';
import { SeparationGrid } from './separation-grid.mjs';

const installed = Symbol('simulationSpatial');
const wrapped = Symbol('spatialOriginalMethod');
// Small lists use the cheaper reference loop; this never caps or skips soldiers.
const MIN_INDEXED_UNITS = 24;
function replace(object, name, make) {
  const original = object[name]?.[wrapped] ?? object[name];
  const replacement = make(original);
  Object.defineProperty(replacement, wrapped, { value: original });
  Object.defineProperty(object, name, { value: replacement, configurable: true, writable: true });
}

/** Per-battle adapter. Recovered prototypes and reference simulations stay intact.
 * enabled:false is an explicit testing/benchmark switch, not a player unit limit.
 */
export function installSpatialOptimization(simulation, { enabled } = {}) {
  let state = simulation[installed];
  if (!state) {
    state = { enabled: true, active: false, left: new SpatialIndex(), right: new SpatialIndex(), separation: new SeparationGrid() };
    Object.defineProperty(simulation, installed, { value: state });
    replace(simulation.scene, 'step', original => function (...args) {
      if (!state.enabled) return original.apply(this, args);
      if (simulation.friendList.length >= MIN_INDEXED_UNITS) state.left.synchronize(simulation.friendList); else state.left.clear();
      if (simulation.enemyList.length >= MIN_INDEXED_UNITS) state.right.synchronize(simulation.enemyList); else state.right.clear();
      state.active = true;
      try { return original.apply(this, args); } finally { state.active = false; }
    });
  }
  if (enabled !== undefined) {
    state.enabled = Boolean(enabled);
    if (!state.enabled) { state.left.clear(); state.right.clear(); state.separation.clear(); }
  }
  const installEntity = entity => {
    if (!entity || entity.kind === 'attack') return entity;
    replace(entity, 'findTarget', original => function (...args) {
      const list = this.targetList;
      const index = list === simulation.friendList ? state.left : list === simulation.enemyList ? state.right : null;
      if (state.enabled && state.active && index && list.length >= MIN_INDEXED_UNITS) {
        const target = index.nearest(this, simulation.rules.targetVerticalWeight);
        if (target !== undefined) { this.target = target; return; }
      }
      return original.apply(this, args);
    });
    replace(entity, 'step', original => function (...args) {
      const result = original.apply(this, args);
      if (state.enabled && state.active) {
        (this.side === 'left' ? state.left : state.right).update(this);
      }
      return result;
    });
    return entity;
  };
  for (const entity of simulation.scene.children) installEntity(entity);
  for (const name of ['createUnit', 'createBase']) replace(simulation, name, original => function (...args) {
    const entity = installEntity(original.apply(this, args));
    // Normal recruitment happens after Scene.step; a synchronous extension which
    // inserts during that loop must not query an incomplete hierarchy.
    if (state.active && entity) { state.left.valid = state.right.valid = false; }
    return entity;
  });
  replace(simulation, 'separate', original => function (list, trackFront = false) {
    const radius = this.rules.unitSeparationDistance;
    if (!state.enabled || list.length < MIN_INDEXED_UNITS || !Number.isFinite(radius) || radius <= 0 || radius > 1e100) {
      state.separation.clear();
      return original.call(this, list, trackFront);
    }
    const index = state.separation;
    if (!index.rebuild(list, radius)) return original.call(this, list, trackFront);
    let front = null, maxX = 0;
    for (let i = list.length - 1; i > 0; i--) {
      const entity = list[i]; let before = i;
      while (before > 0) {
        // Extremely large live edits retain the original numeric behavior.
        if (!spatialCoordinateSupported(entity.px) || !spatialCoordinateSupported(entity.py) || !index.supported(entity.px, entity.py)) {
          for (let j = before - 1; j >= 0; j--) separatePair(entity, list[j], radius);
          break;
        }
        const candidate = index.previousCollision(entity.px, entity.py, before);
        if (candidate < 0) break;
        before = candidate; separatePair(entity, list[candidate], radius);
        // Re-query after EACH push: movement can introduce new lower-j neighbors.
      }
      if (trackFront && entity.px > maxX) { maxX = as3int(entity.px); front = entity; }
      // Higher-i entities are never eligible again. All lower-j coordinates in
      // the index are still unchanged, so no static-neighbor assumption is made.
    }
    return front;
  });
  return simulation;
}

function separatePair(entity, other, radius) {
  if (entity === other) return;
  let dx = entity.px - other.px, dy = entity.py - other.py;
  let distance = dx * dx + dy * dy;
  if (distance < radius * radius) {
    distance = Math.sqrt(distance);
    dx = distance === 0 ? 0 : dx / distance; dy = distance === 0 ? 0 : dy / distance;
    entity.px += dx * (radius - distance); entity.py += dy * (radius - distance);
  }
}

export const hasSpatialOptimization = simulation => Boolean(simulation?.[installed]?.enabled);

/** Clear paused-battle caches after external mutations, without reinstalling methods. */
export function releaseSpatialIndexes(simulation) {
  const state = simulation?.[installed];
  if (!state) return;
  state.left.clear(); state.right.clear(); state.separation.clear();
  state.left.valid = state.right.valid = false;
}
