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

const enumerable = (value, key) => Object.prototype.propertyIsEnumerable.call(value, key);
const sameKeys = (left, right) => left.length === right.length && left.every((key, i) => key === right[i]);

/** Copy the same own enumerable fields as object spread, removing stale fields. */
function copyRecord(output, value) {
  // The real adapter emits one stable plain-record shape. Keep its fast native
  // Object.assign path; per-field Reflect/descriptor checks cost more than the
  // old allocating spread when every displayed frame has a new simulation tick.
  const keys = Object.keys(value), oldKeys = Object.keys(output);
  const symbols = Object.getOwnPropertySymbols(value).filter(key => enumerable(value, key));
  const oldSymbols = Object.getOwnPropertySymbols(output);
  if (!sameKeys(keys, oldKeys) || !sameKeys(symbols, oldSymbols)) {
    for (const key of oldKeys) delete output[key];
    for (const key of oldSymbols) delete output[key];
  }
  // Assignment to __proto__ is not object-spread semantics on a plain object.
  if (Object.hasOwn(value, '__proto__') && enumerable(value, '__proto__')) {
    for (const key of keys) {
      if (key === '__proto__') Object.defineProperty(output, key,
        { value: value[key], writable: true, enumerable: true, configurable: true });
      else output[key] = value[key];
    }
    for (const key of symbols) output[key] = value[key];
  } else {
    Object.assign(output, value);
  }
  return output;
}

function continuousPair(before, current) {
  if (!before || aliveState(before) !== aliveState(current)) return false;
  for (const key of CONTINUITY_FIELDS) if (!Object.is(before[key], current[key])) return false;
  return Number.isFinite(before.px) && Number.isFinite(current.px)
    && Number.isFinite(before.py) && Number.isFinite(current.py)
    && Number.isFinite(before.pz) && Number.isFinite(current.pz);
}

/**
 * Allocation-light presentation adapter for immutable consecutive snapshots.
 *
 * Unlike the pure functions above, interpolate() returns BORROWED records:
 * the result, snapshot array, entity records and camera are reused and may be
 * overwritten by the next interpolate() call. Consume synchronously, do not
 * mutate them, and copy if retaining history. Nested metadata is still borrowed
 * read-only from current. reset(), simulation steps and edits do NOT overwrite
 * the last result; this lets input use the last actually presented camera.
 *
 * Snapshot/camera identity denotes an immutable version. New arrays/records
 * rebuild matching/continuity only once; reset() also invalidates those caches
 * for explicit refreshes or new simulation epochs. No input is ever written.
 */
export class RenderInterpolationBuffer {
  #output = { snapshot: [], camera: null };
  #camera = {};
  #beforeByUid = new Map();
  #duplicates = new Set();
  #currentCounts = new Map();
  #before = [];
  #previousSnapshot;
  #currentSnapshot;
  #previousCamera;
  #currentCamera;
  #cameraCut;
  #snapshotReady = false;
  #cameraReady = false;
  #cameraContinuous = false;

  reset() {
    this.#snapshotReady = this.#cameraReady = false;
    this.#previousSnapshot = this.#currentSnapshot = undefined;
    this.#previousCamera = this.#currentCamera = undefined;
    this.#beforeByUid.clear(); this.#duplicates.clear(); this.#currentCounts.clear();
    this.#before.length = 0;
    return this;
  }

  #prepareSnapshots(previous, current) {
    if (previous != null && !Array.isArray(previous)) throw new TypeError('previous snapshot must be an array or null');
    if (!Array.isArray(current)) throw new TypeError('current snapshot must be an array');
    const byUid = this.#beforeByUid, duplicates = this.#duplicates, counts = this.#currentCounts;
    byUid.clear(); duplicates.clear(); counts.clear();
    for (const value of previous ?? []) {
      record(value, 'previous entity');
      if (!usableUid(value.uid)) continue;
      if (byUid.has(value.uid)) duplicates.add(value.uid);
      byUid.set(value.uid, value);
    }
    for (const value of current) {
      record(value, 'current entity');
      counts.set(value.uid, (counts.get(value.uid) ?? 0) + 1);
    }
    const snapshot = this.#output.snapshot;
    for (let i = 0; i < current.length; i++) {
      const value = current[i];
      snapshot[i] = snapshot[i] ? copyRecord(snapshot[i], value) : { ...value };
      const before = usableUid(value.uid) && !duplicates.has(value.uid)
        && counts.get(value.uid) === 1 ? byUid.get(value.uid) : null;
      this.#before[i] = continuousPair(before, value) ? before : null;
    }
    // Do not retain a peak-sized pool or records from removed entities.
    snapshot.length = this.#before.length = current.length;
    this.#previousSnapshot = previous; this.#currentSnapshot = current;
    this.#snapshotReady = true;
  }

  #prepareCamera(previous, current, cut) {
    this.#cameraContinuous = false;
    if (current == null) this.#output.camera = current;
    else {
      record(current, 'current camera');
      if (previous != null && !cut) record(previous, 'previous camera');
      this.#output.camera = copyRecord(this.#camera, current);
      this.#cameraContinuous = previous != null && !cut
        && previous.width === current.width && previous.height === current.height
        && ['x', 'y'].every(key => Number.isFinite(previous[key]) && Number.isFinite(current[key]));
    }
    this.#previousCamera = previous; this.#currentCamera = current; this.#cameraCut = cut;
    this.#cameraReady = true;
  }

  interpolate(previous, current, alpha, { previousCamera, currentCamera, cameraCut = false } = {}) {
    const amount = fraction(alpha);
    if (!this.#snapshotReady || previous !== this.#previousSnapshot || current !== this.#currentSnapshot) {
      this.#prepareSnapshots(previous, current);
    }
    if (!this.#cameraReady || previousCamera !== this.#previousCamera || currentCamera !== this.#currentCamera
      || cameraCut !== this.#cameraCut) this.#prepareCamera(previousCamera, currentCamera, cameraCut);
    const snapshot = this.#output.snapshot;
    for (let i = 0; i < snapshot.length; i++) {
      const before = this.#before[i];
      if (!before) continue;
      const output = snapshot[i], after = current[i];
      output.px = lerp(before.px, after.px, amount);
      output.py = lerp(before.py, after.py, amount);
      output.pz = lerp(before.pz, after.pz, amount);
    }
    if (this.#cameraContinuous) {
      this.#camera.x = lerp(previousCamera.x, currentCamera.x, amount);
      this.#camera.y = lerp(previousCamera.y, currentCamera.y, amount);
    }
    return this.#output;
  }
}
