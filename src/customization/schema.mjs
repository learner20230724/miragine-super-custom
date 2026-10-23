import { validateJsonValue } from '../config/json.mjs';
import { validateCoreConfiguration } from '../core/index.mjs';
import { clampInteger } from './numeric.mjs';

export const CUSTOMIZATION_SCHEMA = 2;
export const MAX_DOCUMENT_BYTES = 256 * 1024;
export const MAX_LIBRARY_BYTES = 2 * 1024 * 1024;
export const MAX_PRESETS = 25;
// Keys remain stable so existing installations migrate their saved profiles.
export const DRAFT_KEY = 'miragine-custom-draft-v1';
export const PRESETS_KEY = 'miragine-custom-presets-v1';
export const MAX_SANDBOX_UNITS = null; // No gameplay entity cap.
export const MAX_INTEGER = Number.MAX_SAFE_INTEGER;
const MAX = Number.MAX_VALUE;
const number = (label, unit, min = 0, max = MAX, integer = false, apply = '立即；已有冷却不重置') =>
  ({ label, unit, min, max, integer, apply, type: 'number' });
const int = (label, unit, min = 0, apply) => number(label, unit, min, MAX_INTEGER, true, apply);
const text = (label, max = 300) => ({ label, maxLength: max, type: 'text', apply: '立即（说明文字）' });
const bool = (label, unit = '', apply = '立即') => ({ label, unit, type: 'boolean', apply });
const ids = (label, allowEmpty = false) => ({ label, unit: '兵种候选集合；按所列顺序等概率抽取', type: 'unit-list', allowEmpty, apply: '下次 AI 选兵' });
export const UNIT_FIELDS = Object.freeze({
  name: text('名称', 80), description: text('说明', 2000),
  cost: int('招募费用', '金币', 0, '下次招募'),
  population: int('人口消耗', '人口', 0, '下次招募；不追溯已用人口'),
  income: int('招募增加收入', '金币 / 轮', 0, '下次招募'),
  hp: number('生命', 'HP', Number.MIN_VALUE, MAX, false, '立即；按所选生命策略'),
  armorTypeID: number('护甲类型', '0 = 轻甲；1 = 重甲', 0, 1, true),
  armor: number('护甲', '减伤；原版允许负净伤害回血'),
  moveSpeed: number('基础移速', '世界距离 / 逻辑步；再乘移动倍率'),
  'damage.0': number('对轻甲伤害', '伤害'), 'damage.1': number('对重甲伤害', '伤害'),
  range: number('基础射程', '世界距离；再乘射程倍率'),
  weaponSpeed: number('基础攻击间隔', '乘攻击间隔倍率后向零取整为帧'),
  delayAttack: int('命中延迟', '逻辑帧，30 帧 = 1 游戏秒', 0, '新投射物'),
});
export const RULE_FIELDS = Object.freeze({
  incomeLimit: int('每轮收入上限', '金币 / 轮', 0, '下次收入增长；不强行扣减已有收入'),
  populationLimit: int('每轮人口额度', '人口', 0, '下次轮次结算；当前剩余人口不变'),
  initialMoney: int('双方开局金币（旧版兼容）', '金币', 0, '下局'),
  startingIncome: int('红方开局收入', '金币 / 轮', 0, '下局'),
  leftStartingPopulation: int('红方首轮人口', '人口', 0, '下局'),
  initialRoundFrames: int('首轮等待', '逻辑帧，30 帧 = 1 游戏秒', 1, '下局'),
  roundFrames: int('后续每轮长度', '逻辑帧；保留当前倒计时', 1, '下次轮次结算'),
  recruitEveryFrames: int('自动招募检测间隔', '倒计时帧数取模；不是固定攻击速度', 1),
  movementMultiplier: number('移动倍率', '基础移速 × 此值'),
  rangeMultiplier: number('射程倍率', '基础射程 × 此值'),
  weaponSpeedMultiplier: number('攻击间隔倍率', '基础间隔 × 此值，再向零取整'),
  baseHp: number('双方水晶生命（旧版兼容）', 'HP', Number.MIN_VALUE, MAX, false, '立即；按所选生命策略'),
  'baseDamage.0': number('红水晶对轻甲伤害', '伤害'), 'baseDamage.1': number('红水晶对重甲伤害', '伤害'),
  baseWeaponSpeedFrames: int('红水晶攻击间隔', '逻辑帧', 1),
  baseRange: number('双方水晶射程（旧版兼容）', '世界距离'),
});
export const DIFFICULTY_FIELDS = Object.freeze({
  counterSelectionProbability: number('AI 克制选兵概率', '0–1', 0, 1, false, '本难度下次 AI 选兵'),
  rightStartingIncome: int('蓝方开局收入', '金币 / 轮', 0, '下局'),
  rightStartingPopulation: int('蓝方首轮人口', '人口；后续由每轮人口额度重置', 0, '下局'),
  'blueBaseDamage.0': number('蓝水晶对轻甲伤害', '伤害'), 'blueBaseDamage.1': number('蓝水晶对重甲伤害', '伤害'),
  blueBaseWeaponSpeedFrames: int('蓝水晶攻击间隔', '逻辑帧', 1),
});
export const AI_FIELDS = Object.freeze({
  counterMinimumCount: int('判定主力的最少数量', '个，达到此数量才参与反制', 1, '下次 AI 选兵'),
  newbieIncomeThreshold: int('对新兵分支的收入阈值', '金币 / 轮；小于此值走低收入选择', 0, '下次 AI 选兵'),
  newbieBelowThresholdChoice: number('对新兵：低收入选兵', '兵种 ID', 0, 15, true, '下次 AI 选兵'),
  newbieAtOrAboveThresholdChoice: number('对新兵：达到阈值选兵', '兵种 ID', 0, 15, true, '下次 AI 选兵'),
  counterFallbackIncomeThreshold: int('无主力时的收入阈值', '金币 / 轮；严格大于', 0, '下次 AI 选兵'),
  counterFallbackChoices: ids('无主力：高收入随机候选'),
  counterFallbackLowIncomeChoice: number('无主力：低收入选兵', '兵种 ID', 0, 15, true, '下次 AI 选兵'),
  randomIncomeThreshold: int('普通随机分支收入阈值', '金币 / 轮；严格大于', 0, '下次 AI 选兵'),
  randomHighIncomeChoices: ids('普通随机：高收入候选'), randomLowIncomeChoices: ids('普通随机：低收入候选'),
  forceMoneyEnabled: bool('启用金币阈值强制选兵', '与精英阈值为或关系', '下次 AI 选兵'),
  forceEliteEnabled: bool('启用精英数量强制选兵', '与金币阈值为或关系', '下次 AI 选兵'),
  eliteCountOnlyCounterBranch: bool('只在反制分支统计精英', '原版开启；关闭后所有分支都统计', '下次 AI 选兵'),
  forceOverlordMoneyThreshold: int('强制选兵的金币阈值', '蓝方余额；严格大于', 0, '下次 AI 选兵'),
  forceOverlordEliteCountThreshold: int('强制选兵的精英数量阈值', '红方数量；严格大于', 0, '下次 AI 选兵'),
  eliteUnitIds: ids('精英统计兵种', true),
  forcedUnitId: number('强制选兵目标', '兵种 ID', 0, 15, true, '下次 AI 选兵'),
  ...Object.fromEntries(Array.from({ length: 16 }, (_, i) => [`counterChoices.${i}`, ids(`对 ${i} 号兵的反制候选${i === 0 ? '（新兵使用专门规则）' : ''}`, true)])),
});
export const BEHAVIOR_FIELDS = Object.freeze({
  leftRecruitment: bool('红方开局自动招募', '首页可独立修改本局开关', '下局'),
  rightRecruitment: bool('蓝方开局自动招募', '首页可独立修改本局开关', '下局'),
  enemyAi: bool('蓝方开局 AI 自动选兵', '只控制单人模式每轮选兵，不冻结兵种战斗 AI', '下局'),
});
const SIDE_BASE_FIELDS = { hp: number('水晶生命上限', 'HP', Number.MIN_VALUE, MAX, false, '立即；按所选生命策略'), range: number('水晶射程', '世界距离') };
const SIDE_INITIAL_FIELDS = { money: int('开局金币', '金币', 0, '下局') };
export const clone = value => JSON.parse(JSON.stringify(value));
export function at(value, path) { return path.split('.').reduce((current, key) => current?.[key], value); }
function put(value, path, next) {
  const parts = path.split('.'); const key = parts.pop(); let parent = value;
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (!Object.hasOwn(parent, part)) parent[part] = /^\d+$/.test(parts[i + 1] ?? key) ? [] : {};
    parent = parent[part];
  }
  parent[key] = next;
}
function objectKeys(input, expected, label) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError(`${label}: expected an object`);
  if (Object.keys(input).length !== expected.length || expected.some(key => !Object.hasOwn(input, key))) throw new TypeError(`${label}: fields must be ${expected.join(', ')}`);
}
function checkField(value, spec, path) {
  if (spec.type === 'number' && (typeof value !== 'number' || !Number.isFinite(value) || value < spec.min || value > spec.max || (spec.integer && !Number.isSafeInteger(value)))) throw new RangeError(`${path}: ${spec.integer ? 'safe integer' : 'finite number'} ${spec.min}–${spec.max} required`);
  if (spec.type === 'boolean' && typeof value !== 'boolean') throw new TypeError(`${path}: boolean required`);
  if (spec.type === 'unit-list' && (!Array.isArray(value) || (!spec.allowEmpty && !value.length) || value.length > 16 || new Set(value).size !== value.length || value.some(id => !Number.isInteger(id) || id < 0 || id > 15))) throw new TypeError(`${path}: distinct unit IDs 0–15 required`);
  if (spec.type === 'text' && (typeof value !== 'string' || value.length > spec.maxLength || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value) || (path.endsWith('.name') && !value.trim()))) throw new TypeError(`${path}: invalid text`);
}
function checkFields(input, fields, prefix) {
  objectKeys(input, [...new Set(Object.keys(fields).map(path => path.split('.')[0]))], prefix);
  for (const key of ['damage', 'baseDamage', 'blueBaseDamage']) if (Object.hasOwn(input, key) && (!Array.isArray(input[key]) || input[key].length !== 2)) throw new TypeError(`${prefix}.${key}: two damage entries required`);
  if (Object.hasOwn(input, 'counterChoices')) objectKeys(input.counterChoices, Array.from({ length: 16 }, (_, i) => String(i)), `${prefix}.counterChoices`);
  for (const [path, spec] of Object.entries(fields)) checkField(at(input, path), spec, `${prefix}.${path}`);
}
export function checkedJSON(value, maxBytes = MAX_DOCUMENT_BYTES) {
  validateJsonValue(value, { maxDepth: 20 });
  if (new TextEncoder().encode(JSON.stringify(value)).length > maxBytes) throw new RangeError('Customization document is too large');
  return clone(value);
}
export function parseJSON(text, maxBytes = MAX_DOCUMENT_BYTES) {
  if (typeof text !== 'string' || text.length > maxBytes || new TextEncoder().encode(text).length > maxBytes) throw new RangeError('Customization JSON is too large');
  return checkedJSON(JSON.parse(text), maxBytes);
}
function extract(source, fields) {
  const result = {}; for (const path of Object.keys(fields)) put(result, path, at(source, path) ?? (fields[path].type === 'text' ? '' : undefined)); return result;
}
export function aiFromConfiguration(ai) {
  return {
    counterMinimumCount: 2,
    newbieIncomeThreshold: ai.newbieIncomeThreshold, newbieBelowThresholdChoice: ai.newbieBelowThresholdChoice, newbieAtOrAboveThresholdChoice: ai.newbieAtOrAboveThresholdChoice,
    counterFallbackIncomeThreshold: ai.counterFallbackIncomeThreshold, counterFallbackLowIncomeChoice: ai.counterFallbackLowIncomeChoice,
    counterFallbackChoices: Array.from({ length: ai.counterFallbackRandomUnitCount }, (_, i) => i),
    randomIncomeThreshold: ai.randomIncomeThreshold,
    randomHighIncomeChoices: Array.from({ length: ai.randomHighIncomeUnitCount }, (_, i) => i), randomLowIncomeChoices: Array.from({ length: ai.randomLowIncomeUnitCount }, (_, i) => i),
    forceMoneyEnabled: true, forceEliteEnabled: true, eliteCountOnlyCounterBranch: true,
    forceOverlordMoneyThreshold: ai.forceOverlordMoneyThreshold, forceOverlordEliteCountThreshold: ai.forceOverlordEliteCountThreshold,
    eliteUnitIds: clone(ai.eliteUnitIds), forcedUnitId: ai.forcedUnitId,
    counterChoices: Object.fromEntries(Array.from({ length: 16 }, (_, i) => [i, clone(ai.counterChoices[i] ?? [])])),
  };
}
// Defaults used only when migrating an old document that never contained AI.
// These are the recovered fixed AI values, not guessed editor parameters.
const RECOVERED_AI = {
  counterChoices: { 1:[1,3,5],2:[4,6,7,8],3:[4,7],4:[1,6,8],5:[3,10],6:[5,6,12],7:[4,8,9],8:[5,6,12],9:[6,8,9,11],10:[11,13,14],11:[8,9],12:[9,10,12,13],13:[8,9,11],14:[9,10,11],15:[9,10,11] },
  newbieIncomeThreshold:200,newbieBelowThresholdChoice:0,newbieAtOrAboveThresholdChoice:3,counterFallbackIncomeThreshold:1000,counterFallbackRandomUnitCount:16,counterFallbackLowIncomeChoice:0,randomIncomeThreshold:450,randomHighIncomeUnitCount:14,randomLowIncomeUnitCount:8,forceOverlordMoneyThreshold:15030,forceOverlordEliteCountThreshold:2,eliteUnitIds:[14,15],forcedUnitId:15,
};
export function validateProfile(input, { configuration = null } = {}) {
  const value = checkedJSON(input);
  objectKeys(value, ['schemaVersion', 'config', 'rules'], 'profile');
  if (value.schemaVersion === 1) {
    objectKeys(value.config, ['units', 'rules', 'difficulties'], 'config');
    const oldRules = Object.fromEntries(Object.entries(RULE_FIELDS).filter(([key]) => key !== 'leftStartingPopulation'));
    checkFields(value.config.rules, oldRules, 'config.rules');
    objectKeys(value.config.units, Array.from({length:16},(_,i)=>String(i)), 'units');
    objectKeys(value.config.difficulties, ['0','1','2','3'], 'difficulties');
    for (let i=0;i<16;i++) checkFields(value.config.units[i],UNIT_FIELDS,`config.units.${i}`);
    for (let i=0;i<4;i++) checkFields(value.config.difficulties[i],DIFFICULTY_FIELDS,`config.difficulties.${i}`);
    value.schemaVersion = CUSTOMIZATION_SCHEMA;
    value.config.rules.leftStartingPopulation = value.config.rules.populationLimit;
    value.config.sides = Object.fromEntries(['left','right'].map(side=>[side,{ units:clone(value.config.units), base:{hp:value.config.rules.baseHp,range:value.config.rules.baseRange}, initial:{money:value.config.rules.initialMoney} }]));
    for (const diff of Object.values(value.config.difficulties)) diff.ai = aiFromConfiguration(configuration?.ai ?? RECOVERED_AI);
  }
  if (value.schemaVersion !== CUSTOMIZATION_SCHEMA) throw new TypeError('Unsupported customization schema');
  objectKeys(value.config, ['units', 'rules', 'difficulties', 'sides'], 'config');
  objectKeys(value.config.units, Array.from({ length: 16 }, (_, i) => String(i)), 'units');
  objectKeys(value.config.difficulties, ['0', '1', '2', '3'], 'difficulties');
  objectKeys(value.config.sides, ['left','right'], 'sides');
  for (let i = 0; i < 16; i++) checkFields(value.config.units[i], UNIT_FIELDS, `config.units.${i}`);
  for (let i = 0; i < 4; i++) {
    const diff = value.config.difficulties[i];
    objectKeys(diff,[...new Set(Object.keys(DIFFICULTY_FIELDS).map(key=>key.split('.')[0])),'ai'],`config.difficulties.${i}`);
    const { ai, ...fields } = diff; checkFields(fields,DIFFICULTY_FIELDS,`config.difficulties.${i}`); checkFields(ai,AI_FIELDS,`config.difficulties.${i}.ai`);
  }
  for (const side of ['left','right']) {
    const part = value.config.sides[side]; objectKeys(part,['units','base','initial'],`sides.${side}`);
    objectKeys(part.units,Array.from({length:16},(_,i)=>String(i)),`sides.${side}.units`);
    for(let i=0;i<16;i++) checkFields(part.units[i],UNIT_FIELDS,`config.sides.${side}.units.${i}`);
    checkFields(part.base,SIDE_BASE_FIELDS,`config.sides.${side}.base`); checkFields(part.initial,SIDE_INITIAL_FIELDS,`config.sides.${side}.initial`);
  }
  checkFields(value.config.rules, RULE_FIELDS, 'config.rules'); checkFields(value.rules, BEHAVIOR_FIELDS, 'rules');
  return value;
}
export function profileFromConfiguration(configuration) {
  validateCoreConfiguration(configuration);
  const rules = extract({ ...configuration.rules, leftStartingPopulation: configuration.rules.leftStartingPopulation ?? configuration.rules.populationLimit }, RULE_FIELDS);
  const units = Object.fromEntries(Array.from({length:16},(_,i)=>[i,extract(configuration.units[i],UNIT_FIELDS)]));
  const difficulties = Object.fromEntries(Array.from({length:4},(_,i)=>[i,{...extract(configuration.difficulties[i],DIFFICULTY_FIELDS),ai:aiFromConfiguration(configuration.ai)}]));
  const sides = Object.fromEntries(['left','right'].map(side=>[side,{units:clone(units),base:{hp:rules.baseHp,range:rules.baseRange},initial:{money:rules.initialMoney}}]));
  const custom = configuration.customization;
  if (custom?.schemaVersion === 2) {
    for(const side of ['left','right']) { sides[side].units=Object.fromEntries(Array.from({length:16},(_,i)=>[i,extract(custom.sides[side].units[i],UNIT_FIELDS)])); sides[side].base={hp:custom.sides[side].base.hp,range:custom.sides[side].base.range}; sides[side].initial.money=custom.sides[side].initial.money; }
    rules.startingIncome=custom.sides.left.initial.income; rules.leftStartingPopulation=custom.sides.left.initial.population;
    rules.baseDamage=clone(custom.sides.left.base.damage); rules.baseWeaponSpeedFrames=custom.sides.left.base.weaponSpeedFrames;
    for(let i=0;i<4;i++) { const d=custom.difficulties[i]; Object.assign(difficulties[i],{rightStartingIncome:d.rightInitial.income,rightStartingPopulation:d.rightInitial.population,blueBaseDamage:clone(d.rightBase.damage),blueBaseWeaponSpeedFrames:d.rightBase.weaponSpeedFrames,ai:clone(d.ai)}); }
  }
  return validateProfile({schemaVersion:2,config:{rules,units,difficulties,sides},rules:{leftRecruitment:true,rightRecruitment:true,enemyAi:true}});
}
const product = (a,b,max=MAX) => a === 0 || b === 0 ? 0 : a > max/b ? max : a*b;
export function configurationFromProfile(defaults, input) {
  const profile = validateProfile(input,{configuration:defaults}), result = clone(defaults);
  result.profile = 'custom';
  if (result.rules.frameRate !== 30) throw new RangeError('Customization requires the original 30 Hz logic');
  for (const section of ['units','difficulties']) for(const [id,fields] of Object.entries(profile.config[section])) Object.assign(result[section][id],fields);
  Object.assign(result.rules,profile.config.rules);
  const enrich = (unit,fields) => { const value={...clone(unit),...clone(fields)},speed=product(value.weaponSpeed,result.rules.weaponSpeedMultiplier,MAX_INTEGER); value.runtime={...value.runtime,moveSpeed:product(value.moveSpeed,result.rules.movementMultiplier),range:product(value.range,result.rules.rangeMultiplier),weaponSpeed:speed,attackCooldownFrames:Math.trunc(speed),attackCooldownSeconds:Math.trunc(speed)/30}; return value; };
  result.units=Object.fromEntries(Object.entries(result.units).map(([id,unit])=>[id,enrich(unit,unit)]));
  const sides = Object.fromEntries(['left','right'].map(side=>[side,{
    units:Object.fromEntries(Array.from({length:16},(_,i)=>[i,enrich(defaults.units[i],profile.config.sides[side].units[i])])),
    base:{...clone(profile.config.sides[side].base),damage:clone(side==='left'?result.rules.baseDamage:result.difficulties[1].blueBaseDamage),weaponSpeedFrames:side==='left'?result.rules.baseWeaponSpeedFrames:result.difficulties[1].blueBaseWeaponSpeedFrames},
    initial:{money:profile.config.sides[side].initial.money,income:side==='left'?result.rules.startingIncome:result.difficulties[1].rightStartingIncome,population:side==='left'?result.rules.leftStartingPopulation:result.difficulties[1].rightStartingPopulation},
  }]));
  result.customization={schemaVersion:2,sides,difficulties:Object.fromEntries(Array.from({length:4},(_,i)=>[i,{ai:clone(profile.config.difficulties[i].ai),rightInitial:{income:result.difficulties[i].rightStartingIncome,population:result.difficulties[i].rightStartingPopulation},rightBase:{damage:clone(result.difficulties[i].blueBaseDamage),weaponSpeedFrames:result.difficulties[i].blueBaseWeaponSpeedFrames}}]))};
  validateCoreConfiguration(result); return freeze(result);
}
export function freeze(value) { if(value&&typeof value==='object'){for(const child of Object.values(value))freeze(child);Object.freeze(value);}return value; }
export function metadata(defaults) {
  const fields=(prefix,specs,extra={})=>Object.entries(specs).map(([key,spec])=>({path:`${prefix}.${key}`,...spec,...extra}));
  const choose=(specs,predicate)=>Object.fromEntries(Object.entries(specs).filter(([key,spec])=>predicate(key,spec)));
  return [
    {id:'units',label:'兵种',entries:Array.from({length:16},(_,i)=>({id:String(i),label:defaults.units[i].name,fields:['left','right'].flatMap(side=>fields(`config.sides.${side}.units.${i}`,UNIT_FIELDS,{side}))}))},
    {id:'basic',label:'基础规则',entries:[{id:'basic',label:'基础规则',fields:fields('config.rules',choose(RULE_FIELDS,(key,spec)=>spec.apply!=='下局'&&!key.startsWith('base')))}]},
    {id:'bases',label:'水晶',entries:['left','right'].map(side=>({id:side,label:side==='left'?'红方水晶':'蓝方水晶',fields:[...fields(`config.sides.${side}.base`,SIDE_BASE_FIELDS,{side}),...(side==='left'?fields('config.rules',choose(RULE_FIELDS,key=>key.startsWith('base')&&!['baseHp','baseRange'].includes(key)),{side}):[])]}))},
    {id:'starting',label:'开局设置',entries:[{id:'start',label:'下局生效',fields:[...['left','right'].flatMap(side=>fields(`config.sides.${side}.initial`,SIDE_INITIAL_FIELDS,{side})),...fields('config.rules',choose(RULE_FIELDS,(key,spec)=>spec.apply==='下局'&&key!=='initialMoney'))]},...Array.from({length:4},(_,i)=>({id:String(i),label:`${defaults.difficulties[i].name}：蓝方开局`,fields:fields(`config.difficulties.${i}`,choose(DIFFICULTY_FIELDS,(_,spec)=>spec.apply==='下局'),{side:'right'})}))]},
    {id:'difficulties',label:'难度与 AI',entries:Array.from({length:4},(_,i)=>({id:String(i),label:defaults.difficulties[i].name,fields:[...fields(`config.difficulties.${i}`,choose(DIFFICULTY_FIELDS,(_,spec)=>spec.apply!=='下局')),...fields(`config.difficulties.${i}.ai`,choose(AI_FIELDS,key=>key!=='counterChoices.0'))]}))},
    {id:'behavior',label:'自动行为',entries:[{id:'behavior',label:'招募与 AI 选兵',fields:fields('rules',BEHAVIOR_FIELDS)}]},
  ];
}
function allSpecs(defaults) {
  return [...metadata(defaults).flatMap(group=>group.entries.flatMap(entry=>entry.fields)),
    ...Object.entries(RULE_FIELDS).map(([key,spec])=>({path:`config.rules.${key}`,...spec})),
    ...Array.from({length:16},(_,i)=>Object.entries(UNIT_FIELDS).map(([key,spec])=>({path:`config.units.${i}.${key}`,...spec}))).flat(),
    ...Array.from({length:4},(_,i)=>({path:`config.difficulties.${i}.ai.counterChoices.0`,...AI_FIELDS['counterChoices.0']}))];
}
export function fieldSpecification(path,defaults){const spec=allSpecs(defaults).find(field=>field.path===path);if(!spec)throw new TypeError('Unknown or immutable customization field');return spec;}
/** Clamp at edit time, not after a confirmation error. JSON imports stay strict. */
export function clampFieldValue(value,spec) {
  if(spec.type!=='number')return value;
  if(typeof value==='string'&&!value.trim())throw new TypeError('A number is required');
  if(spec.integer)return clampInteger(value,{min:spec.min,max:spec.max});
  const n=Number(value);if(Number.isNaN(n))throw new TypeError('A number is required');
  return Math.max(spec.min,Math.min(spec.max,n));
}
export function setProfileField(input,path,value,defaults) {
  const spec=fieldSpecification(path,defaults),next=validateProfile(input,{configuration:defaults});value=clampFieldValue(value,spec);put(next,path,value);
  // Explicit legacy shared paths remain supported for old integrations only.
  const shared=/^config\.units\.(\d+)\.(.+)$/.exec(path);
  if(shared)for(const side of ['left','right'])put(next,`config.sides.${side}.units.${shared[1]}.${shared[2]}`,value);
  const aliases={'config.rules.baseHp':'base.hp','config.rules.baseRange':'base.range','config.rules.initialMoney':'initial.money'};
  if(aliases[path])for(const side of ['left','right'])put(next,`config.sides.${side}.${aliases[path]}`,value);
  return validateProfile(next,{configuration:defaults});
}
