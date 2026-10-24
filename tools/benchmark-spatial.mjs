// Headless CPU-only benchmark. This is NOT a display FPS or portable-app claim.
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { MiragineSimulation, seededRandom } from '../src/core/index.mjs';
import { CustomMiragineSimulation } from '../src/customization/runtime.mjs';
import { installSpatialOptimization } from '../src/performance/simulation-spatial.mjs';

const defaults = JSON.parse(readFileSync(new URL('../config/defaults.generated.json', import.meta.url), 'utf8'));
export function prepareBattle({ count = 1000, dense = false, custom = false, optimized = true } = {}) {
  const Type = custom ? CustomMiragineSimulation : MiragineSimulation;
  const sim = new Type({ config: structuredClone(defaults), rng: seededRandom(725), autoStart: false, spatialOptimization: false });
  if (optimized) installSpatialOptimization(sim, { enabled: true });
  sim.leftMoney = sim.rightMoney = 100000000; sim.leftPopulation = sim.rightPopulation = 100000000;
  for (let i = 0; i < count; i++) {
    const entity = sim.createUnit(i % 2 ? 'left' : 'right', i % 8);
    entity.px = dense ? 2200 + (i % 31) * 3 : 1700 + ((i * 79) % 1000);
    entity.py = dense ? 400 + (i % 11) * 3 : 240 + ((i * 37) % 320);
  }
  sim.p1[2] = sim.p2[2] = 0;
  return sim;
}
export function benchmarkSpatial({ counts = [200, 400, 800, 1000, 1600], steps = 60, repetitions = 3 } = {}) {
  const results = [];
  for (const custom of [false, true]) for (const dense of [false, true]) for (const count of counts) {
    const variants = {};
    for (const optimized of [false, true]) {
      const samples = []; let alive = 0;
      for (let repetition = 0; repetition < repetitions; repetition++) {
        const sim = prepareBattle({ count, dense, custom, optimized });
        sim.step(8); sim.drainEvents(); // equivalent deterministic JIT warm-up/state
        const start = performance.now();
        for (let i = 0; i < steps; i++) { sim.step(); sim.drainEvents(); }
        samples.push(performance.now() - start); alive = sim.friendList.length + sim.enemyList.length;
      }
      samples.sort((a, b) => a - b);
      const ms = samples[Math.floor(samples.length / 2)];
      variants[optimized ? 'indexed' : 'reference'] = { totalMs: ms, msPerStep: ms / steps, stepsPerSecond: steps * 1000 / ms, aliveIncludingCrystals: alive };
    }
    results.push({ custom, dense, count, steps, repetitions, ...variants, speedup: variants.reference.totalMs / variants.indexed.totalMs });
  }
  return { kind: 'headless-spatial-cpu-only', node: process.version, timestamp: new Date().toISOString(),
    warning: 'No renderer, audio, Electron, observer, interpolation or GUI is included; not a wall-clock gameplay/FPS guarantee.', results };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const short = process.argv.includes('--short');
  console.log(JSON.stringify(benchmarkSpatial(short ? { counts: [1000, 1600], steps: 30, repetitions: 3 } : {}), null, 2));
}
