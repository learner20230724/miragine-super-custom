/** Read-only, bounded-memory comparison of recovered-AS3 fixture observations. */
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, relative, sep } from 'node:path';
import { MiragineSimulation } from '../../src/core/index.mjs';

const TOLERANCE = 1e-7;
const SAMPLE_LIMIT = 20;
const SCALARS = ['frame', 'round', 'leftMoney', 'leftIncome', 'leftPopulation',
  'rightMoney', 'rightIncome', 'rightPopulation', 'gameOverTime'];
const plain = value => JSON.parse(JSON.stringify(value));
const sha256 = value => createHash('sha256').update(value).digest('hex');

function difference(expected, actual, path = '') {
  const mismatch = () => ({ path, expected,
    actual: actual === undefined ? { missing: true } : actual });
  if (typeof expected === 'number' && typeof actual === 'number') {
    return Object.is(expected, actual) || Math.abs(expected - actual) <= TOLERANCE
      ? null : mismatch();
  }
  if (expected !== null && typeof expected === 'object') {
    if (actual === null || typeof actual !== 'object' || Array.isArray(expected) !== Array.isArray(actual)) {
      return mismatch();
    }
    if (Array.isArray(expected) && expected.length !== actual.length) {
      return { path: `${path}.length`, expected: expected.length, actual: actual.length };
    }
    // The fixture defines the comparison contract; extra core fields are ignored.
    for (const [key, value] of Object.entries(expected)) {
      const result = difference(value, actual[key], path ? `${path}.${key}` : key);
      if (result) return result;
    }
    return null;
  }
  return expected === actual ? null : mismatch();
}

function observation(simulation) {
  const state = Object.fromEntries(SCALARS.map(key => [key, simulation[key]]));
  Object.assign(state, {
    stopTimer: simulation.stopTimer, singlePlay: simulation.singlePlay,
    difficulty: simulation.difficulty, p1: simulation.p1, p2: simulation.p2,
    camera: simulation.camera, redBossHP: simulation.redBoss.nowHP,
    blueBossHP: simulation.blueBoss.nowHP,
    terminal: simulation.gameOverTime === 0 &&
      (simulation.redBoss.nowHP === 0 || simulation.blueBoss.nowHP === 0),
  });
  state.children = simulation.scene.children.map(child => {
    const row = { kind: child.kind, side: child.side, px: child.px, py: child.py,
      pz: child.pz, sx: child.sx, sy: child.sy, currentFrame: child.currentFrame,
      action: child.action };
    if (child.kind === 'attack') {
      Object.assign(row, { delay: child.delay, life: child.life, visible: child.visible });
    } else {
      Object.assign(row, { id: child.id, nowHP: child.nowHP, maxHP: child.maxHP });
    }
    return row;
  });
  // AS3 JSON.stringify represents nonfinite numbers as null and omits undefined.
  return plain(state);
}

function coreProvenance(root) {
  const files = {};
  function visit(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile() && entry.name.endsWith('.mjs')) {
        files[relative(root, path).split(sep).join('/')] = sha256(readFileSync(path));
      }
    }
  }
  visit(resolve(root, 'src/core'));
  return { files, combinedSha256: sha256(JSON.stringify(files)) };
}

// Metadata is informational, never executable. Do not leak local user paths in
// a report that may later be published together with the reconstruction.
function safeMetadata(value) {
  if (typeof value === 'string') {
    return /[a-z]:[\\/]|(?:^|[\s"'(])\/(?!\/)/i.test(value) ? '[local path redacted]' : value;
  }
  if (Array.isArray(value)) return value.map(safeMetadata);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [
      /[a-z]:[\\/]|^\//i.test(key) ? '[local path redacted]' : key, safeMetadata(item),
    ]));
  }
  return value;
}

/**
 * Create one deterministic comparator per streamed match. The caller owns all
 * persistence and supplies parsed source records in original order. No source
 * records or snapshots are retained, apart from the first 20 mismatch samples.
 */
export function createTraceComparator({ root, sessionId, fixtureMetadata = {} } = {}) {
  if (typeof root !== 'string' || !root) throw new TypeError('root must be a project directory');
  const configBytes = readFileSync(resolve(root, 'config/defaults.generated.json'));
  const config = JSON.parse(configBytes.toString('utf8').replace(/^\uFEFF/, ''));
  const core = coreProvenance(root);
  const sourceHash = createHash('sha256');
  const state = {
    sessionId: safeMetadata(sessionId ?? null), processedFrames: 0, equalFrames: 0,
    firstMismatch: null, mismatches: [], framesContainingAttack: 0,
    maxObservedChildren: 0, maxCoreChildren: 0, terminal: null,
  };
  let simulation = null;

  function accept(record) {
    if (!record || typeof record !== 'object' || Array.isArray(record) ||
        !Number.isFinite(record.frame) || !Array.isArray(record.children)) {
      throw new TypeError('Expected a source frame record with frame and children');
    }
    if (!simulation) {
      if (typeof record.singlePlay !== 'boolean' || !Number.isInteger(record.difficulty)) {
        throw new TypeError('First source frame must supply singlePlay and difficulty');
      }
      simulation = new MiragineSimulation({ config, rng: () => 0.5, autoStart: false,
        singlePlay: record.singlePlay, difficulty: record.difficulty });
    }
    simulation.stopTimer = record.stopTimer;
    simulation.step();
    const actual = observation(simulation);
    const mismatch = difference(record, actual);
    sourceHash.update(JSON.stringify(record) + '\n');
    state.processedFrames++;
    if (!mismatch) state.equalFrames++;
    else {
      const sample = plain({ frame: record.frame, ...mismatch });
      state.firstMismatch ??= sample;
      if (state.mismatches.length < SAMPLE_LIMIT) state.mismatches.push(sample);
    }
    if (record.children.some(child => child.kind === 'attack')) state.framesContainingAttack++;
    state.maxObservedChildren = Math.max(state.maxObservedChildren, record.children.length);
    state.maxCoreChildren = Math.max(state.maxCoreChildren, actual.children.length);
    if (!state.terminal && record.gameOverTime === 0 &&
        (record.redBossHP === 0 || record.blueBossHP === 0)) {
      state.terminal = { frame: record.frame, winner: record.redBossHP === 0 ? 'right' : 'left',
        redHP: record.redBossHP, blueHP: record.blueBossHP };
    }
    simulation.drainEvents();
    return { frame: record.frame, equal: !mismatch, mismatch: mismatch ? plain(mismatch) : null };
  }

  function report() {
    return plain({ ...state, matching: state.processedFrames > 0 && state.equalFrames === state.processedFrames,
      tolerance: TOLERANCE, mismatchSampleLimit: SAMPLE_LIMIT,
      sourceJsonlSha256: sourceHash.copy().digest('hex'),
      sourceJsonlEncoding: "UTF-8 JSON.stringify(record) + LF, in accepted order",
      fixtureRandom: 'constant 0.5', comparisonCore: 'production MiragineSimulation',
      scope: 'Source-recompiled DragonForce observer fixture; not unmodified-original or Adobe parity proof',
      provenance: { fixture: safeMetadata(fixtureMetadata),
        config: { path: 'config/defaults.generated.json', sha256: sha256(configBytes) },
        core },
    });
  }
  return { accept, report };
}
