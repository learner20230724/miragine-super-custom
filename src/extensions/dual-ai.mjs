import { CustomMiragineSimulation, installCustomRuntime } from '../customization/runtime.mjs';

const installed = new WeakSet();
export const DUAL_AI_BASELINE_DIFFICULTY = 1;

/** Match-local options, deliberately separate from saved editor profiles. */
export function normalizeDualAIOptions(options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options)
      || Object.keys(options).some(key => !['leftDifficulty', 'rightDifficulty', 'applyDifficultyStats'].includes(key))) {
    throw new TypeError('Invalid dual AI options');
  }
  const result = { leftDifficulty: 1, rightDifficulty: 1, applyDifficultyStats: true, ...options };
  for (const side of ['left', 'right']) {
    const value = result[`${side}Difficulty`];
    if (!Number.isInteger(value) || value < 0 || value > 3) throw new RangeError('AI difficulty must be 0..3');
  }
  if (typeof result.applyDifficultyStats !== 'boolean') throw new TypeError('applyDifficultyStats must be boolean');
  return Object.freeze(result);
}

function decide(simulation, side) {
  const state = simulation.dualAI, selection = side === 'left' ? simulation.p1 : simulation.p2;
  // Use the actual recovered/custom AI algorithm without mutating the live
  // simulation's side, difficulty, money, or lists. It only writes p2[0..1].
  const receiver = Object.create(simulation);
  Object.assign(receiver, {
    difficulty: state.options[`${side}Difficulty`],
    friendList: side === 'left' ? simulation.enemyList : simulation.friendList,
    rightMoney: simulation[`${side}Money`], rightIncome: simulation[`${side}Income`],
    p2: selection, rng: () => simulation.rng(), dictionaryKeys: map => simulation.dictionaryKeys(map),
    emit: (type, data) => simulation.emit(type, { ...data, side, difficulty: state.options[`${side}Difficulty`] }),
  });
  const id = CustomMiragineSimulation.prototype.ai.call(receiver);
  const record = state.decisions[side];
  record.count++; record.lastFrame = simulation.frame; record.selectedUnit = id;
  return id;
}

/** Opt-in battle extension. Income -> left AI -> right AI -> original recruitment. */
export function installDualAI(simulation, options = {}) {
  const normalized = normalizeDualAIOptions(options);
  if (installed.has(simulation)) {
    if (JSON.stringify(simulation.dualAI.options) !== JSON.stringify(normalized)) {
      throw new Error('Dual AI options cannot change after match initialization');
    }
    return simulation;
  }
  if (simulation.frame !== 0) throw new Error('Install dual AI before the first simulation frame');
  simulation.singlePlay = false;
  simulation.dualAI = { options: normalized, decisions: {
    left: { count: 0, lastFrame: null, selectedUnit: null },
    right: { count: 0, lastFrame: null, selectedUnit: null },
  } };
  // This is an explicitly custom match. Runtime initialization resolves both
  // sides' selected difficulty before any simulation step or random call.
  installCustomRuntime(simulation, simulation.config, { initialize: true });
  const originalEmit = simulation.emit;
  simulation.emit = function (type, data = {}) {
    const result = originalEmit.call(this, type, data);
    if (type === 'income') {
      // Paused recruitment does not disable thinking, alter selection[2], or
      // freeze soldiers already on the field. Manual selection lasts until here.
      decide(this, 'left'); decide(this, 'right');
    }
    return result;
  };
  installed.add(simulation);
  return simulation;
}

export function dualAISnapshot(simulation) {
  if (!simulation?.dualAI) return null;
  return { ...simulation.dualAI.options,
    baselineDifficulty: DUAL_AI_BASELINE_DIFFICULTY,
    statsDifficulties: Object.fromEntries(['left', 'right'].map(side => [side,
      simulation.dualAI.options.applyDifficultyStats ? simulation.dualAI.options[`${side}Difficulty`] : DUAL_AI_BASELINE_DIFFICULTY])),
    decisions: Object.fromEntries(['left', 'right'].map(side => [side, { ...simulation.dualAI.decisions[side] }])),
    recruitment: { left: simulation.p1[2] === 1, right: simulation.p2[2] === 1 },
  };
}
