import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { GameController } from '../src/app/controller.mjs';
import { MiragineSimulation, seededRandom } from '../src/core/index.mjs';
import { createCustomization, profileFromConfiguration, configurationFromProfile, validateProfile, DRAFT_KEY, PRESETS_KEY } from '../src/customization/index.mjs';
import { MAX_INTEGER, clampFieldValue, fieldSpecification } from '../src/customization/schema.mjs';

const defaults = JSON.parse(readFileSync(new URL('../config/defaults.generated.json', import.meta.url),'utf8'));
function storage() { const data=new Map(); return {data,getItem:key=>data.get(key)??null,setItem:(key,value)=>data.set(key,value)}; }
function setup({initial=defaults,store=storage()}={}) {
  const queue=new Map(); let handle=0;
  const controller=new GameController(initial,{storage:{getItem:()=> 'true'},createSimulation:options=>new MiragineSimulation({...options,rng:seededRandom(13)})});
  const custom=createCustomization({controller,defaults,initialConfig:initial,storage:store,schedule:cb=>{queue.set(++handle,cb);return handle;},cancelSchedule:id=>queue.delete(id),workNow:()=>0});
  controller.startMatch(true,1);
  return {controller,custom,store,queue,get sim(){return controller.simulation;},batch(){const entry=queue.entries().next().value;if(!entry)return false;queue.delete(entry[0]);entry[1]();return true;},finish(){let i=0;while(this.batch()){if(++i>1000)throw new Error('Unbounded job');}}};
}
function v1Profile() { const p=profileFromConfiguration(defaults);delete p.config.sides;delete p.config.rules.leftStartingPopulation;for(const d of Object.values(p.config.difficulties))delete d.ai;p.schemaVersion=1;return p; }

test('schema 2 migrates v1 red-blue values independently and retains recovered difficulty differences',()=>{
  const old=v1Profile();old.config.units[0].hp=912;old.config.rules.initialMoney=123;old.config.rules.baseHp=9876;
  const migrated=validateProfile(old);assert.equal(migrated.schemaVersion,2);assert.equal(old.schemaVersion,1);
  for(const side of ['left','right']){assert.equal(migrated.config.sides[side].units[0].hp,912);assert.equal(migrated.config.sides[side].base.hp,9876);assert.equal(migrated.config.sides[side].initial.money,123);}
  const built=configurationFromProfile(defaults,migrated);
  for(let d=0;d<4;d++){assert.equal(built.customization.difficulties[d].rightInitial.income,defaults.difficulties[d].rightStartingIncome);assert.deepEqual(built.customization.difficulties[d].rightBase.damage,defaults.difficulties[d].blueBaseDamage);}
  assert.equal(migrated.config.difficulties[1].ai.forceOverlordEliteCountThreshold,2);
});

test('existing v1 draft and library migrate without applying, dropping records, or replacing external AI',()=>{
  const store=storage(),old=v1Profile();old.config.units[1].cost=1;
  store.setItem(DRAFT_KEY,JSON.stringify({schemaVersion:1,profile:old}));store.setItem(PRESETS_KEY,JSON.stringify({schemaVersion:1,presets:[{id:'preset-old',name:'旧规则',profile:old}]}));
  const initial=structuredClone(defaults);initial.ai.forceOverlordMoneyThreshold=4321;initial.rules.spawnJitterY=12;
  const env=setup({store,initial}),state=env.custom.getState();assert.equal(state.draft.schemaVersion,2);assert.equal(state.draft.config.difficulties[1].ai.forceOverlordMoneyThreshold,4321);
  assert.equal(env.sim.config.units[1].cost,defaults.units[1].cost);assert.equal(state.presets[0].id,'preset-old');
  env.custom.loadPreset('preset-old');env.custom.applyCurrent();assert.equal(env.sim.config.rules.spawnJitterY,12);assert.equal(env.sim.config.customization.sides.left.units[1].cost,1);
});

test('edit-time integer clamping saturates immediately; strict imported documents reject invalid numbers',()=>{
  const {custom}=setup();custom.updateDraft('config.sides.left.units.0.cost','999999999999999999999999999');
  assert.equal(custom.getState().draft.config.sides.left.units[0].cost,MAX_INTEGER);
  custom.updateDraft('config.sides.left.units.0.population',-30);assert.equal(custom.getState().draft.config.sides.left.units[0].population,0);
  custom.updateDraft('config.sides.left.units.0.income',12.9);assert.equal(custom.getState().draft.config.sides.left.units[0].income,12);
  assert.equal(clampFieldValue('1e999',fieldSpecification('config.rules.incomeLimit',defaults)),MAX_INTEGER);
  const bad=custom.getState().draft;bad.config.sides.left.units[0].cost=MAX_INTEGER+1;assert.throws(()=>validateProfile(bad),/safe integer/);
  assert.throws(()=>custom.updateDraft('config.rules.incomeLimit','not a number'));
});

test('current balances accept max safe integer and future round credits saturate without int32 wrap',()=>{
  const {custom,sim}=setup();custom.setResources({side:'left',money:MAX_INTEGER+500,income:5,population:MAX_INTEGER});
  assert.equal(sim.leftMoney,MAX_INTEGER);assert.equal(sim.leftPopulation,MAX_INTEGER);
  custom.setRecruitment('left',false);custom.setRecruitment('right',false);sim.round=1;sim.step();assert.equal(sim.leftMoney,MAX_INTEGER);assert.ok(sim.leftMoney>=0);
  custom.setResources({side:'left',money:3e12,population:4e12});assert.equal(sim.leftMoney,3e12);assert.equal(sim.leftPopulation,4e12);
});

test('live field applies only one chosen red parameter, not other drafts or next-match start settings',()=>{
  const {custom,sim,controller}=setup();custom.updateDraft('config.sides.right.units.0.hp',2000);custom.updateDraft('config.sides.left.initial.money',123456);
  custom.applyLiveField('config.sides.left.units.0.hp',99);
  const state=custom.getState();assert.equal(state.draft.config.sides.right.units[0].hp,2000);assert.equal(state.applied.config.sides.right.units[0].hp,45);
  assert.equal(state.next.config.sides.left.initial.money,0);assert.equal(state.applied.config.sides.left.units[0].hp,99);
  assert.throws(()=>custom.applyLiveField('config.sides.left.initial.money',888),/下局/);
  custom.spawn({side:'left',unitId:0});custom.spawn({side:'right',unitId:0});assert.equal(sim.friendList.at(-1).spawnHP,99);assert.equal(sim.enemyList.at(-1).spawnHP,45);
  controller.startMatch();assert.equal(controller.simulation.leftMoney,0);assert.equal(controller.simulation.config.customization.sides.right.units[0].hp,45);
});

test('red and blue base properties and current HP are independently editable',()=>{
  const {custom,sim}=setup();custom.setBase({side:'left',maxHp:12000,hp:9999,damage:[123,456],range:900,weaponSpeedFrames:99});
  assert.equal(sim.redBoss.maxHP,12000);assert.equal(sim.redBoss.nowHP,9999);assert.deepEqual(sim.redBoss.damage,[123,456]);assert.equal(sim.redBoss.range,900);assert.equal(sim.redBoss.weaponSpeed,99);assert.equal(sim.blueBoss.maxHP,3500);
  custom.setBase({side:'right',maxHp:7000,hp:6000,damage:[888,777],range:1000,weaponSpeedFrames:91});
  assert.equal(sim.blueBoss.maxHP,7000);assert.equal(sim.blueBoss.nowHP,6000);assert.deepEqual(sim.blueBoss.damage,[888,777]);assert.equal(sim.blueBoss.weaponSpeed,91);
  const current=custom.getBattleState();assert.equal(current.right.baseMaxHp,7000);assert.equal(current.left.baseHp,9999);assert.equal(current.right.selectedUnit,0);
});

test('resource edit checks all values before changing any balance',()=>{
  const {custom,sim}=setup(),money=sim.leftMoney;assert.throws(()=>custom.setResources({side:'left',money:987,income:NaN}));assert.equal(sim.leftMoney,money);
  sim.redBoss.nowHP=0;assert.throws(()=>custom.setResources({side:'left',money:987,baseHp:1}),/复活/);assert.equal(sim.leftMoney,money);
});

test('start-page red and blue money, income and population take effect only on next match',()=>{
  const {custom,sim,controller}=setup();custom.updateDraft('config.sides.left.initial.money',3e12);custom.updateDraft('config.sides.right.initial.money',4e12);custom.updateDraft('config.rules.startingIncome',5e12);custom.updateDraft('config.rules.leftStartingPopulation',6e12);custom.updateDraft('config.difficulties.1.rightStartingIncome',7e12);custom.updateDraft('config.difficulties.1.rightStartingPopulation',8e12);custom.applyNext();assert.equal(sim.leftMoney,0);
  controller.startMatch(true,1);assert.equal(controller.simulation.leftMoney,3e12);assert.equal(controller.simulation.rightMoney,4e12);assert.equal(controller.simulation.leftIncome,5e12);assert.equal(controller.simulation.rightIncome,7e12);assert.equal(controller.simulation.leftPopulation,6e12);assert.equal(controller.simulation.rightPopulation,8e12);
});

test('batched spawning crosses both old 100-action and 500-total limits without charges',()=>{
  const env=setup(),{custom,sim}=env;custom.setResources({side:'left',money:123,income:456,population:789});
  const job=custom.startSpawn({side:'left',unitId:0,count:601});assert.equal(job.status,'running');assert.equal(job.completed,0);assert.equal(sim.friendList.length,1);
  env.batch();assert.equal(custom.getSpawnJob().completed,32);assert.equal(sim.friendList.length,33);env.finish();
  assert.equal(custom.getSpawnJob().status,'completed');assert.equal(custom.getSpawnJob().completed,601);assert.equal(sim.friendList.length,602);
  assert.deepEqual([sim.leftMoney,sim.leftIncome,sim.leftPopulation],[123,456,789]);assert.equal(custom.getState().limits.units,null);
  sim.leftMoney=20;sim.leftPopulation=1;assert.ok(sim.createUnit('left',0),'automatic recruitment also no longer has 500 cap');
});

test('maximum-size spawn request remains bounded per turn and can be cancelled immediately',()=>{
  const env=setup(),{custom,sim}=env;const job=custom.startSpawn({side:'right',unitId:0,count:'999999999999999999999'});assert.equal(job.requested,MAX_INTEGER);assert.equal(env.queue.size,1);env.batch();assert.equal(custom.getSpawnJob().completed,32);assert.equal(custom.cancelSpawn(),true);env.finish();assert.equal(sim.enemyList.length,33);assert.equal(custom.getSpawnJob().status,'cancelled');assert.equal(custom.getSpawnJob().remaining,MAX_INTEGER-32);
});

test('new match or clearing the relevant army cancels remaining spawn batches',()=>{
  const env=setup(),{custom,controller}=env;custom.startSpawn({side:'left',unitId:0,count:5000});env.batch();controller.startMatch();assert.equal(custom.getSpawnJob().status,'cancelled');env.finish();assert.equal(controller.simulation.friendList.length,1);
  custom.startSpawn({side:'right',unitId:0,count:5000});env.batch();custom.clearTroops('right');env.finish();assert.equal(controller.simulation.enemyList.length,1);assert.equal(custom.getSpawnJob().reason,'troops-cleared');
});

test('returning home outside model cancels queued job before it can mutate abandoned game',()=>{
  const env=setup();env.custom.startSpawn({side:'left',unitId:0,count:800});const sim=env.sim;env.controller.home();env.finish();assert.equal(sim.friendList.length,1);assert.equal(env.custom.getSpawnJob().status,'cancelled');
});

test('every difficulty exposes independent rich AI candidate tables and configurable force gates',()=>{
  const {custom,sim}=setup();custom.applyLiveField('config.difficulties.1.counterSelectionProbability',0);custom.applyLiveField('config.difficulties.1.ai.randomLowIncomeChoices',[8]);custom.applyLiveField('config.difficulties.1.ai.randomHighIncomeChoices',[8]);custom.applyLiveField('config.difficulties.1.ai.forceMoneyEnabled',false);custom.applyLiveField('config.difficulties.1.ai.forceEliteEnabled',false);sim.rightMoney=MAX_INTEGER;
  assert.equal(sim.ai(),8);custom.applyLiveField('config.difficulties.1.ai.forcedUnitId',4);custom.applyLiveField('config.difficulties.1.ai.forceOverlordMoneyThreshold',10);custom.applyLiveField('config.difficulties.1.ai.forceMoneyEnabled',true);assert.equal(sim.ai(),4);
  assert.equal(custom.getState().applied.config.difficulties[0].ai.forcedUnitId,15);custom.setEnemyAi(false);custom.applyLiveField('config.rules.incomeLimit',MAX_INTEGER);custom.selectUnit({side:'right',unitId:3});assert.equal(sim.ai(),3,'runtime reapply retains disabled AI wrapper');
});

test('metadata separates start-only fields and has parallel side unit definitions with all four AI sections',()=>{
  const {custom}=setup(),groups=custom.getMetadata();assert.equal(groups.find(g=>g.id==='units').entries.length,16);
  const u=groups.find(g=>g.id==='units').entries[0];assert.ok(u.fields.some(f=>f.side==='left'));assert.ok(u.fields.some(f=>f.side==='right'));
  for(const group of groups.filter(g=>!['starting','behavior'].includes(g.id)))for(const entry of group.entries)for(const field of entry.fields)assert.notEqual(field.apply,'下局',field.path);
  const difficulty=groups.find(g=>g.id==='difficulties');assert.equal(difficulty.entries.length,4);assert.ok(difficulty.entries[3].fields.some(f=>f.type==='unit-list'&&f.path.endsWith('counterChoices.15')));
});

test('profile roundtrip preserves separately configured values and external unexposed unit fields',()=>{
  const env=setup({initial:{...structuredClone(defaults),units:{...structuredClone(defaults.units),0:{...defaults.units[0],ss:2}}}});env.custom.updateDraft('config.sides.right.units.0.hp',321);env.custom.applyNext();const p=env.custom.getState().next,c=configurationFromProfile(env.controller.config,p),roundtrip=profileFromConfiguration(c);assert.equal(c.customization.sides.right.units[0].ss,2);assert.equal(roundtrip.config.sides.right.units[0].hp,321);assert.equal(roundtrip.config.sides.left.units[0].hp,45);
});


test('custom external configuration starts with widened safe runtime before its immediate first step',()=>{
  const initial=structuredClone(defaults);initial.rules.initialMoney=MAX_INTEGER;initial.rules.startingIncome=4e12;initial.rules.populationLimit=3e12;initial.rules.initialRoundFrames=8e12;initial.difficulties[1].rightStartingIncome=6e12;initial.difficulties[1].rightStartingPopulation=7e12;
  const {custom,sim}=setup({initial});assert.equal(custom.getMode().current,'custom');assert.equal(sim.leftMoney,MAX_INTEGER);assert.equal(sim.rightMoney,MAX_INTEGER);assert.equal(sim.leftIncome,4e12);assert.equal(sim.rightIncome,6e12);assert.equal(sim.leftPopulation,3e12);assert.equal(sim.rightPopulation,7e12);assert.equal(sim.round,8e12-1);
});

test('base multi-field edits validate requested current HP before changing the maximum or damage',()=>{
  const {custom,sim}=setup(),before=custom.getState().applied;assert.throws(()=>custom.setBase({side:'left',maxHp:500,hp:NaN}));assert.equal(sim.redBoss.maxHP,3500);assert.deepEqual(custom.getState().applied,before);
  sim.redBoss.nowHP=0;assert.throws(()=>custom.setBase({side:'left',maxHp:500,hp:1}));assert.equal(sim.redBoss.maxHP,3500);
});

test('battle identity stays stable within a match and changes across same-difficulty replacement',()=>{
  const {custom,controller}=setup(),first=custom.getBattleState().battleId;custom.setResources({side:'left',money:123});assert.equal(custom.getState().battle.battleId,first);controller.startMatch(true,1);assert.notEqual(custom.getBattleState().battleId,first);
});


test('applying unit drafts preserves live recruitment and AI while staging start-page behaviors',()=>{
  const {custom,sim,controller}=setup();custom.updateDraft('rules.leftRecruitment',false);custom.updateDraft('rules.rightRecruitment',false);custom.updateDraft('rules.enemyAi',false);custom.updateDraft('config.sides.left.units.0.hp',99);const report=custom.applyCurrent();assert.equal(sim.p1[2],1);assert.equal(sim.p2[2],1);assert.equal(custom.getBattleState().enemyAi,true);assert.ok(report.deferred.includes('rules.enemyAi'));assert.equal(custom.getState().applied.rules.enemyAi,true);
  controller.startMatch();assert.equal(controller.simulation.p1[2],0);assert.equal(controller.simulation.p2[2],0);assert.equal(custom.getBattleState().enemyAi,false);
});

test('live field and bulk rules preserve recruitment toggled through the native game controls',()=>{
  const {custom,sim}=setup();sim.p1[2]=0;sim.p2[2]=0;custom.applyLiveField('config.sides.left.units.0.hp',99);assert.equal(sim.p1[2],0);assert.equal(sim.p2[2],0);custom.updateDraft('config.rules.incomeLimit',99999);custom.applyCurrent();assert.equal(sim.p1[2],0);assert.equal(sim.p2[2],0);
});

test('decimal text just below the safe maximum truncates exactly through all editor APIs',()=>{
  const {custom,sim}=setup();custom.updateDraft('config.sides.left.units.0.cost','9007199254740990.9');assert.equal(custom.getState().draft.config.sides.left.units[0].cost,MAX_INTEGER-1);custom.setResources({side:'left',money:'9007199254740990.9'});assert.equal(sim.leftMoney,MAX_INTEGER-1);
});
