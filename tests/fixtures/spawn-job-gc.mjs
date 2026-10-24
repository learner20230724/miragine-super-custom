import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { GameController } from '../../src/app/controller.mjs';
import { MiragineSimulation, seededRandom } from '../../src/core/index.mjs';
import { createCustomization } from '../../src/customization/index.mjs';

const defaults = JSON.parse(readFileSync(new URL('../../config/defaults.generated.json', import.meta.url), 'utf8'));
export const lifecycleCases = ['completed', 'manual-cancel', 'battle-changed', 'failed', 'completed-cancel'];

function armyState(sim) {
  return {
    frame: sim.frame,
    left: sim.friendList.map(unit => unit.uid),
    right: sim.enemyList.map(unit => unit.uid),
    scene: sim.scene.children.map(unit => unit.uid),
    resources: [sim.leftMoney, sim.leftIncome, sim.leftPopulation,
      sim.rightMoney, sim.rightIncome, sim.rightPopulation],
  };
}

/** Real editor/controller APIs, with a tiny deterministic scheduler and army. */
export function exerciseLifecycle(kind) {
  assert.ok(lifecycleCases.includes(kind));
  const queue = new Map(), notifications = [];
  let handle = 0;
  const controller = new GameController(defaults, {
    storage: { getItem: () => 'true' },
    createSimulation: options => new MiragineSimulation({ ...options, rng: seededRandom(13) }),
  });
  const custom = createCustomization({ controller, defaults,
    schedule: callback => { queue.set(++handle, callback); return handle; },
    cancelSchedule: id => queue.delete(id), workNow: () => 0, spawnBatchSize: 2,
    onChange: event => notifications.push(event),
  });
  controller.startMatch(true, 1);
  const oldSimulation = controller.simulation;
  const weak = new WeakRef(oldSimulation);
  const oldResources = armyState(oldSimulation).resources;
  const runBatch = () => {
    const entry = queue.entries().next().value;
    assert.ok(entry, 'a batch must be scheduled');
    queue.delete(entry[0]); entry[1]();
  };
  const completed = kind === 'completed' || kind === 'completed-cancel';
  const requested = completed ? 3 : 5;
  const first = custom.startSpawn({ side: 'left', unitId: 0, count: requested });
  assert.equal(first.status, 'running');
  runBatch();
  assert.equal(custom.getSpawnJob().completed, 2);
  assert.equal(oldSimulation.friendList.length, 3);

  if (completed) {
    runBatch();
    if (kind === 'completed-cancel') {
      const before = custom.getSpawnJob(), army = armyState(oldSimulation);
      assert.equal(custom.cancelSpawn(), false, 'cancel on a completed receipt is a no-op');
      assert.deepEqual(custom.getSpawnJob(), before);
      assert.deepEqual(armyState(oldSimulation), army);
    }
  } else if (kind === 'manual-cancel') {
    const before = armyState(oldSimulation);
    assert.equal(custom.cancelSpawn(), true);
    assert.deepEqual(armyState(oldSimulation), before, 'cancellation does not clear existing troops');
  } else if (kind === 'battle-changed') {
    const before = armyState(oldSimulation);
    controller.startMatch(true, 3);
    assert.deepEqual(armyState(oldSimulation), before, 'replacement does not spawn into or clear the abandoned army');
  } else {
    const before = armyState(oldSimulation);
    oldSimulation.createUnit = () => { throw new Error('injected factory failure'); };
    runBatch();
    assert.deepEqual(armyState(oldSimulation), before, 'failure preserves completed soldiers and refunds temporary resources');
  }

  const receipt = custom.getSpawnJob();
  assert.equal(receipt.id, first.id);
  assert.equal(receipt.status, completed ? 'completed' : kind === 'failed' ? 'failed' : 'cancelled');
  assert.equal(receipt.side, 'left');
  assert.equal(receipt.unitId, 0);
  assert.equal(receipt.requested, requested);
  assert.equal(receipt.completed, completed ? 3 : 2);
  assert.equal(receipt.remaining, requested - receipt.completed);
  assert.equal(Object.hasOwn(receipt, 'simulation'), false);
  assert.deepEqual(custom.getState().spawnJob, receipt);
  assert.equal(oldSimulation.friendList.length, receipt.completed + 1);
  assert.equal(oldSimulation.enemyList.length, 1);
  assert.deepEqual(armyState(oldSimulation).resources, oldResources);
  assert.equal(queue.size, 0, 'terminal jobs leave no queued callback');
  if (kind === 'manual-cancel') assert.equal(receipt.reason, 'user');
  if (kind === 'battle-changed') assert.equal(receipt.reason, 'battle-changed');
  if (kind === 'failed') assert.match(receipt.error, /生成中断/);
  for (const event of notifications) {
    assert.equal(Object.hasOwn(event.report ?? {}, 'simulation'), false);
  }

  if (kind !== 'battle-changed') {
    // Isolate the terminal-job release from createSimulation's separate
    // cancel-on-replacement cleanup. The editor/controller stay strongly live,
    // but the host drops its old world without invoking another editor action.
    controller.simulation = new MiragineSimulation({ config: controller.config, rng: seededRandom(13) });
  }
  assert.notEqual(controller.simulation, oldSimulation);
  assert.deepEqual(custom.getSpawnJob(), receipt, 'receipt remains readable after world replacement');
  const currentArmy = armyState(controller.simulation);
  assert.equal(currentArmy.left.length, 1);
  assert.equal(currentArmy.right.length, 1);
  return { controller, custom, queue, notifications, weak, receipt, currentArmy };
}

export function verifyRetainedState(env) {
  assert.deepEqual(env.custom.getSpawnJob(), env.receipt);
  assert.deepEqual(env.custom.getState().spawnJob, env.receipt);
  assert.deepEqual(armyState(env.controller.simulation), env.currentArmy);
  assert.equal(env.queue.size, 0);
  assert.equal(env.custom.getBattleState().left.units, 0);
  assert.equal(env.custom.getBattleState().right.units, 0);
}

async function verifyCollection(kind) {
  assert.equal(typeof globalThis.gc, 'function', 'fixture requires --expose-gc');
  const env = exerciseLifecycle(kind);
  let collected = false;
  for (let attempt = 0; attempt < 16; attempt++) {
    // A WeakRef's constructor/deref keeps its target live until the current
    // JS job ends. Yield BEFORE each GC, never deref immediately before GC.
    await nextTurn();
    globalThis.gc();
    collected = env.weak.deref() === undefined;
    if (collected) break;
  }
  assert.ok(collected, `${kind}: old simulation retained while its editor and receipt stay alive`);
  verifyRetainedState(env);
  process.stdout.write(JSON.stringify({ kind, collected, status: env.receipt.status,
    completed: env.receipt.completed, remaining: env.receipt.remaining,
    liveEditor: env.custom.getState().isBattle, currentArmyUnchanged: true }) + '\n');
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  await verifyCollection(process.argv[2]);
}
