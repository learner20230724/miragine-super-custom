const POSITION_FIELDS = Object.freeze(['px', 'py', 'pz']);
const CONTINUITY_FIELDS = Object.freeze(['kind', 'side', 'id', 'spriteIndex', 'weaponSheet', 'action', 'visible', 'sx', 'sy']);

function fraction(alpha) {
  if (!Number.isFinite(alpha)) throw new TypeError('alpha must be finite');
  return Math.max(0, Math.min(1, alpha));
}

function record(value, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be a snapshot record`);
  }
  return value;
}

function usableUid(uid) { return typeof uid === 'string' || (typeof uid === 'number' && Number.isFinite(uid)); }
function aliveState(value) { return typeof value.nowHP === 'number' ? value.nowHP > 0 : null; }
function lerp(before, after, alpha) {
  if (alpha === 0) return before;
  if (alpha === 1 || Object.is(before, after)) return after;
  const value = before + (after - before) * alpha;
  // Finite endpoints of opposite large magnitude can overflow the subtraction.
  return Number.isFinite(value) ? value : before * (1 - alpha) + after * alpha;
}

/**
 * Presentation-only interpolation of the adapter's consecutive render snapshots.
 * Output follows current order and keeps all current discrete data (including
 * pose/HP/visibility). Removed entities do not reappear. State discontinuities
 * snap to current rather than blending unrelated actions, births or death starts.
 * Returned records are new shallow copies; opaque nested metadata is borrowed
 * read-only. This function never sorts, changes either input, or calls game code.
 */
export function interpolateSnapshots(previous, current, alpha) {
  const amount = fraction(alpha);
  if (previous != null && !Array.isArray(previous)) throw new TypeError('previous snapshot must be an array or null');
  if (!Array.isArray(current)) throw new TypeError('current snapshot must be an array');
  const byUid = new Map(), duplicates = new Set(), currentCounts = new Map();
  for (const value of previous ?? []) {
    record(value, 'previous entity');
    if (!usableUid(value.uid)) continue;
    if (byUid.has(value.uid)) duplicates.add(value.uid);
    byUid.set(value.uid, value);
  }
  for (const value of current) {
    record(value, 'current entity');
    currentCounts.set(value.uid, (currentCounts.get(value.uid) ?? 0) + 1);
  }
  return current.map(value => {
    const output = { ...value };
    const before = usableUid(value.uid) && !duplicates.has(value.uid)
      && currentCounts.get(value.uid) === 1 ? byUid.get(value.uid) : null;
    const continuous = before && CONTINUITY_FIELDS.every(key => Object.is(before[key], value[key]))
      && aliveState(before) === aliveState(value)
      && POSITION_FIELDS.every(key => Number.isFinite(before[key]) && Number.isFinite(value[key]));
    if (continuous) for (const key of POSITION_FIELDS) output[key] = lerp(before[key], value[key], amount);
    return output;
  });
}

/** Camera interpolation has no effect on the simulation's camera or map bounds. */
export function interpolateCamera(previous, current, alpha, { cut = false } = {}) {
  const amount = fraction(alpha);
  if (current == null) return current;
  record(current, 'current camera');
  const output = { ...current };
  if (previous == null || cut) return output;
  record(previous, 'previous camera');
  if (previous.width !== current.width || previous.height !== current.height) return output;
  if (['x', 'y'].every(key => Number.isFinite(previous[key]) && Number.isFinite(current[key]))) {
    output.x = lerp(previous.x, current.x, amount);
    output.y = lerp(previous.y, current.y, amount);
  }
  return output;
}

export function interpolateRenderState(previousSnapshot, currentSnapshot, alpha,
  { previousCamera, currentCamera, cameraCut = false } = {}) {
  return {
    snapshot: interpolateSnapshots(previousSnapshot, currentSnapshot, alpha),
    camera: interpolateCamera(previousCamera, currentCamera, alpha, { cut: cameraCut }),
  };
}
