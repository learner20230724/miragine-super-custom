import { validateJsonValue } from '../config/json.mjs';
import { validateCoreConfiguration } from '../core/index.mjs';

export const CUSTOMIZATION_SCHEMA = 1;
export const MAX_DOCUMENT_BYTES = 256 * 1024;
export const MAX_LIBRARY_BYTES = 2 * 1024 * 1024;
export const MAX_PRESETS = 25;
export const DRAFT_KEY = 'miragine-custom-draft-v1';
export const PRESETS_KEY = 'miragine-custom-presets-v1';
export const MAX_SANDBOX_UNITS = 500;

const number = (label, unit, min, max, integer = false, apply = '立即；已有冷却不重置') =>
  ({ label, unit, min, max, integer, apply, type: 'number' });
const text = (label, max = 300) => ({ label, maxLength: max, type: 'text', apply: '立即（说明文字）' });
export const UNIT_FIELDS = Object.freeze({
  name: text('名称', 80), description: text('说明', 2000),
  cost: number('招募费用', '金币', 0, 1000000, true, '下次招募'),
  population: number('人口消耗', '人口', 0, 10000, true, '下次招募；不追溯已用人口'),
  income: number('招募增加收入', '金币 / 轮', 0, 1000000, true, '下次招募'),
  hp: number('生命', 'HP', 1, 10000000, false, '立即；按所选生命策略'),
  armorTypeID: number('护甲类型', '0 = 轻甲；1 = 重甲', 0, 1, true),
  armor: number('护甲', '减伤；原版允许负净伤害回血', 0, 1000000),
  moveSpeed: number('基础移速', '世界距离 / 逻辑步；再乘移动倍率', 0, 100),
  'damage.0': number('对轻甲伤害', '伤害', 0, 1000000),
  'damage.1': number('对重甲伤害', '伤害', 0, 1000000),
  range: number('基础射程', '世界距离；再乘射程倍率', 0, 100),
  weaponSpeed: number('基础攻击间隔', '乘攻击间隔倍率后向零取整为帧', 0.05, 1000),
  delayAttack: number('命中延迟', '逻辑帧，30 帧 = 1 游戏秒', 0, 30000, true, '新投射物'),
});
export const RULE_FIELDS = Object.freeze({
  incomeLimit: number('收入上限', '金币 / 轮', 0, 100000000, true, '下次收入增长；不强行扣减已有收入'),
  populationLimit: number('每轮人口上限', '人口', 0, 10000, true, '下次轮次结算；当前剩余人口不变'),
  initialMoney: number('双方开局金币', '金币', 0, 100000000, true, '下局'),
  startingIncome: number('红方开局收入', '金币 / 轮', 0, 100000000, true, '下局'),
  initialRoundFrames: number('首轮等待', '逻辑帧，30 帧 = 1 游戏秒', 1, 1800000, true, '下局'),
  roundFrames: number('后续每轮长度', '逻辑帧；保留当前倒计时', 1, 1800000, true, '下次轮次结算'),
  recruitEveryFrames: number('自动招募检测间隔', '倒计时帧数取模；不是固定攻击速度', 1, 30000, true),
  movementMultiplier: number('移动倍率', '基础移速 × 此值', 0, 20),
  rangeMultiplier: number('射程倍率', '基础射程 × 此值', 0, 1000),
  weaponSpeedMultiplier: number('攻击间隔倍率', '基础间隔 × 此值，再向零取整', 1, 1000),
  baseHp: number('双方水晶生命', 'HP', 1, 10000000, false, '立即；按所选生命策略'),
  'baseDamage.0': number('红水晶对轻甲伤害', '伤害', 0, 1000000),
  'baseDamage.1': number('红水晶对重甲伤害', '伤害', 0, 1000000),
  baseWeaponSpeedFrames: number('红水晶攻击间隔', '逻辑帧', 1, 30000, true),
  baseRange: number('双方水晶射程', '世界距离', 0, 5000),
});
export const DIFFICULTY_FIELDS = Object.freeze({
  counterSelectionProbability: number('AI 克制选兵概率', '0–1', 0, 1, false, '本难度下次 AI 选兵'),
  rightStartingIncome: number('蓝方开局收入', '金币 / 轮', 0, 100000000, true, '下局'),
  rightStartingPopulation: number('蓝方首轮人口', '人口；后续由每轮人口上限重置', 0, 10000, true, '下局'),
  'blueBaseDamage.0': number('蓝水晶对轻甲伤害', '伤害', 0, 1000000),
  'blueBaseDamage.1': number('蓝水晶对重甲伤害', '伤害', 0, 1000000),
  blueBaseWeaponSpeedFrames: number('蓝水晶攻击间隔', '逻辑帧', 1, 30000, true),
});
export const BEHAVIOR_FIELDS = Object.freeze({
  leftRecruitment: { label: '红方自动招募', type: 'boolean', apply: '立即', unit: '与原游戏招募开关同步' },
  rightRecruitment: { label: '蓝方自动招募', type: 'boolean', apply: '立即', unit: '与原游戏招募开关同步' },
  enemyAi: { label: '蓝方 AI 自动选兵', type: 'boolean', apply: '立即', unit: '只控制单人模式每轮选兵，不冻结兵种战斗 AI' },
});
export const clone = value => JSON.parse(JSON.stringify(value));
export function at(value, path) { return path.split('.').reduce((current, key) => current[key], value); }
function put(value, path, next) {
  const parts = path.split('.'); const key = parts.pop();
  let parent = value;
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (!Object.hasOwn(parent, part)) parent[part] = /^\d+$/.test(parts[i + 1] ?? key) ? [] : {};
    parent = parent[part];
  }
  parent[key] = next;
}
function objectKeys(input, expected, label) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError(`${label}: expected an object`);
  if (Object.keys(input).length !== expected.length || expected.some(key => !Object.hasOwn(input, key))) {
    throw new TypeError(`${label}: fields must be ${expected.join(', ')}`);
  }
}
function checkField(value, spec, path) {
  if (spec.type === 'number' && (typeof value !== 'number' || !Number.isFinite(value)
    || value < spec.min || value > spec.max || (spec.integer && !Number.isInteger(value)))) {
    throw new RangeError(`${path}: ${spec.integer ? 'integer' : 'number'} ${spec.min}–${spec.max} required`);
  }
  if (spec.type === 'boolean' && typeof value !== 'boolean') throw new TypeError(`${path}: boolean required`);
  if (spec.type === 'text' && (typeof value !== 'string' || value.length > spec.maxLength
    || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)
    || (path.endsWith('.name') && !value.trim()))) throw new TypeError(`${path}: invalid text`);
}
function checkFields(input, fields, prefix) {
  objectKeys(input, [...new Set(Object.keys(fields).map(path => path.split('.')[0]))], prefix);
  for (const key of ['damage', 'baseDamage', 'blueBaseDamage']) {
    if (Object.hasOwn(input, key) && (!Array.isArray(input[key]) || input[key].length !== 2)) throw new TypeError(`${prefix}.${key}: two damage entries required`);
  }
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
export function validateProfile(input) {
  const value = checkedJSON(input);
  objectKeys(value, ['schemaVersion', 'config', 'rules'], 'profile');
  if (value.schemaVersion !== CUSTOMIZATION_SCHEMA) throw new TypeError('Unsupported customization schema');
  objectKeys(value.config, ['units', 'rules', 'difficulties'], 'config');
  objectKeys(value.config.units, Array.from({ length: 16 }, (_, i) => String(i)), 'units');
  objectKeys(value.config.difficulties, ['0', '1', '2', '3'], 'difficulties');
  for (let i = 0; i < 16; i++) checkFields(value.config.units[i], UNIT_FIELDS, `config.units.${i}`);
  for (let i = 0; i < 4; i++) checkFields(value.config.difficulties[i], DIFFICULTY_FIELDS, `config.difficulties.${i}`);
  checkFields(value.config.rules, RULE_FIELDS, 'config.rules');
  checkFields(value.rules, BEHAVIOR_FIELDS, 'rules');
  return value;
}
export function profileFromConfiguration(configuration) {
  validateCoreConfiguration(configuration);
  const extract = (source, fields) => {
    const result = {}; for (const path of Object.keys(fields)) put(result, path, at(source, path) ?? (fields[path].type === 'text' ? '' : undefined));
    return result;
  };
  return validateProfile({ schemaVersion: 1, config: {
    rules: extract(configuration.rules, RULE_FIELDS),
    units: Object.fromEntries(Array.from({ length: 16 }, (_, i) => [i, extract(configuration.units[i], UNIT_FIELDS)])),
    difficulties: Object.fromEntries(Array.from({ length: 4 }, (_, i) => [i, extract(configuration.difficulties[i], DIFFICULTY_FIELDS)])),
  }, rules: { leftRecruitment: true, rightRecruitment: true, enemyAi: true } });
}
export function configurationFromProfile(defaults, input) {
  const profile = validateProfile(input), result = clone(defaults);
  result.profile = 'custom';
  if (result.rules.frameRate !== 30) throw new RangeError('Customization requires the original 30 Hz logic');
  for (const section of ['units', 'difficulties']) {
    for (const [id, fields] of Object.entries(profile.config[section])) Object.assign(result[section][id], fields);
  }
  Object.assign(result.rules, profile.config.rules);
  for (const unit of Object.values(result.units)) {
    const speed = unit.weaponSpeed * result.rules.weaponSpeedMultiplier;
    unit.runtime = { ...unit.runtime, moveSpeed: unit.moveSpeed * result.rules.movementMultiplier,
      range: unit.range * result.rules.rangeMultiplier, weaponSpeed: speed,
      attackCooldownFrames: Math.trunc(speed), attackCooldownSeconds: Math.trunc(speed) / 30 };
  }
  validateCoreConfiguration(result);
  return freeze(result);
}
export function freeze(value) {
  if (value && typeof value === 'object') { for (const child of Object.values(value)) freeze(child); Object.freeze(value); }
  return value;
}
export function metadata(defaults) {
  const fields = (prefix, specs) => Object.entries(specs).map(([key, spec]) => ({ path: `${prefix}.${key}`, ...spec }));
  return [
    { id: 'units', label: '兵种', entries: Array.from({ length: 16 }, (_, i) => ({ id: String(i), label: defaults.units[i].name, fields: fields(`config.units.${i}`, UNIT_FIELDS) })) },
    { id: 'economy', label: '经济 / 轮次', entries: [{ id: 'rules', label: '双方共用规则', fields: fields('config.rules', Object.fromEntries(Object.entries(RULE_FIELDS).filter(([key]) => !key.startsWith('base')))) }] },
    { id: 'bases', label: '水晶', entries: [{ id: 'bases', label: '双方生命与射程 / 红方攻击', fields: fields('config.rules', Object.fromEntries(Object.entries(RULE_FIELDS).filter(([key]) => key.startsWith('base')))) }] },
    { id: 'difficulties', label: '难度 / 蓝方', entries: Array.from({ length: 4 }, (_, i) => ({ id: String(i), label: defaults.difficulties[i].name, fields: fields(`config.difficulties.${i}`, DIFFICULTY_FIELDS) })) },
    { id: 'behavior', label: '自动行为', entries: [{ id: 'behavior', label: '招募与 AI 选兵', fields: fields('rules', BEHAVIOR_FIELDS) }] },
  ];
}
export function setProfileField(input, path, value, defaults) {
  const allowed = metadata(defaults).flatMap(group => group.entries.flatMap(entry => entry.fields)).some(field => field.path === path);
  if (!allowed) throw new TypeError('Unknown or immutable customization field');
  const next = clone(input); put(next, path, value); return validateProfile(next);
}
