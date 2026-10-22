/** Compare instrumented recovered-AS3 observations with the independent port. */
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MiragineSimulation } from '../../src/core/index.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const input = resolve(root, process.argv[2] || '.local/oracle/original-trace.json');
const trace = JSON.parse((await readFile(input, 'utf8')).replace(/^\uFEFF/, ''));
if (!Array.isArray(trace) || !trace.length) throw new Error('No original trace records');
const config = JSON.parse(await readFile(resolve(root, 'config/defaults.generated.json'), 'utf8'));
const simulation = new MiragineSimulation({config, rng: () => 0.5, autoStart:false,
  singlePlay: trace[0].singlePlay, difficulty: trace[0].difficulty});
const scalar = ['frame','round','leftMoney','leftIncome','leftPopulation','rightMoney','rightIncome',
  'rightPopulation','gameOverTime'];
const report = {runtime:'Ruffle 0.7.1', fixtureRandom:'constant 0.5', observedFrames:trace.length,
  equalFrames:0, firstMismatch:null, mismatches:[], tolerance:1e-7,
  comparisonCore:'production MiragineSimulation',
  scope:'Source-recompiled DragonForce observer test copy; not unmodified-original or Adobe parity proof'};
function difference(expected, actual, path='') {
  if (typeof expected === 'number' && typeof actual === 'number') {
    return Math.abs(expected-actual) <= report.tolerance || Object.is(expected,actual)
      ? null : {path,expected,actual};
  }
  if (expected && typeof expected === 'object') {
    if (!actual || typeof actual !== 'object') return {path,expected,actual};
    if (Array.isArray(expected) && expected.length !== actual.length)
      return {path:path+'.length',expected:expected.length,actual:actual.length};
    for (const [key,value] of Object.entries(expected)) {
      const result = difference(value,actual[key],path ? `${path}.${key}` : key);
      if (result) return result;
    }
    return null;
  }
  return expected === actual ? null : {path,expected,actual};
}
function originalShape() {
  const state = Object.fromEntries(scalar.map(key => [key,simulation[key]]));
  state.stopTimer=simulation.stopTimer; state.singlePlay=simulation.singlePlay;
  state.difficulty=simulation.difficulty; state.p1=simulation.p1;state.p2=simulation.p2;
  state.camera=simulation.camera;
  state.children=simulation.scene.children.map(child=> {
    const row={kind:child.kind,side:child.side,px:child.px,py:child.py,pz:child.pz,
      sx:child.sx,sy:child.sy,currentFrame:child.currentFrame,action:child.action};
    if(child.kind==='attack') Object.assign(row,{delay:child.delay,life:child.life,visible:child.visible});
    else Object.assign(row,{id:child.id,nowHP:child.nowHP,maxHP:child.maxHP});
    return row;
  });
  return state;
}
for (const record of trace) {
  simulation.stopTimer=record.stopTimer;
  simulation.step();
  // AS3 JSON.stringify encodes NaN/Infinity as null and omits undefined.
  // Normalize the independent JS observation to the same trace representation.
  const mismatch=difference(record,JSON.parse(JSON.stringify(originalShape())));
  if (!mismatch) report.equalFrames++;
  else {
    report.firstMismatch??={frame:record.frame,...mismatch};
    if(report.mismatches.length<20) report.mismatches.push({frame:record.frame,...mismatch});
  }
  simulation.drainEvents();
}
report.framesContainingAttack=trace.filter(frame=>frame.children.some(child=>child.kind==='attack')).length;
report.maxObservedChildren=Math.max(...trace.map(frame=>frame.children.length));
report.matching=report.equalFrames===report.observedFrames;
await writeFile(resolve(root,'.local/oracle/comparison.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
