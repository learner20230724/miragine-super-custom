import { clone, freeze, checkedJSON, parseJSON, validateProfile, profileFromConfiguration, configurationFromProfile,
  metadata, setProfileField, at, DRAFT_KEY, PRESETS_KEY, MAX_LIBRARY_BYTES, MAX_PRESETS, MAX_SANDBOX_UNITS } from './schema.mjs';

export { DRAFT_KEY, PRESETS_KEY, MAX_SANDBOX_UNITS, validateProfile, profileFromConfiguration,
  configurationFromProfile } from './schema.mjs';
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function nameOf(value) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 80 || /[\u0000-\u001f\u007f]/.test(value)) throw new TypeError('预设名称须为 1–80 个可打印字符');
  return value.trim();
}
function strictKeys(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== keys.length
    || keys.some(key => !Object.hasOwn(value, key))) throw new TypeError(`${label}: invalid fields`);
}
function sideOf(side) { if (side !== 'left' && side !== 'right') throw new TypeError('side must be left or right'); return side; }
function integer(value, min, max, name) {
  if (!Number.isInteger(value) || value < min || value > max) throw new RangeError(`${name}: integer ${min}–${max} required`);
  return value;
}
function refresh(sim) {
  sim.renderSnapshot = sim.scene.children.map(child => child.visualState());
  sim.renderCamera = { ...sim.camera };
}
function updateHealth(entity, maximum, policy) {
  const previous = entity.spawnHP || entity.maxHP;
  if (entity.nowHP > 0 && policy === 'ratio' && previous !== maximum) entity.nowHP = entity.nowHP / previous * maximum;
  // Preserve over-healing: the original allows negative net damage to heal
  // above spawn HP. Dead troops are not resurrected by changing their stats.
  entity.spawnHP = maximum;
  if (entity.kind === 'base') entity.maxHP = maximum;
}
function applyToSimulation(sim, configuration, behavior, health) {
  sim.config = configuration; sim.rules = configuration.rules;
  sim.incomeLimit = configuration.rules.incomeLimit; sim.populationLimit = configuration.rules.populationLimit;
  const rules = configuration.rules, difficulty = configuration.difficulties[sim.difficulty];
  for (const entity of sim.entities) {
    if (entity.kind === 'base') {
      updateHealth(entity, rules.baseHp, health);
      entity.range = rules.baseRange;
      entity.damage = entity.side === 'left' ? rules.baseDamage : difficulty.blueBaseDamage;
      entity.weaponSpeed = entity.side === 'left' ? rules.baseWeaponSpeedFrames : difficulty.blueBaseWeaponSpeedFrames;
    } else {
      const unit = configuration.units[entity.id];
      updateHealth(entity, unit.hp, health);
      entity.armorTypeID = unit.armorTypeID; entity.armor = unit.armor;
      entity.damage = unit.damage; entity.moveSpeed = unit.moveSpeed * rules.movementMultiplier;
      entity.range = unit.range * rules.rangeMultiplier;
      entity.weaponSpeed = unit.weaponSpeed * rules.weaponSpeedMultiplier; entity.delayAttack = unit.delayAttack;
    }
  }
  sim.p1[2] = Number(behavior.leftRecruitment); sim.p2[2] = Number(behavior.rightRecruitment);
  refresh(sim);
}

/**
 * Explicit, opt-in editor adapter. No recovered module/prototype is patched.
 * Loading/importing/saving a draft never applies it to a battle or next match.
 * Runtime options are supplied only through actual recovered fields.
 */
export function createCustomization({ controller, defaults, initialConfig = controller?.config,
  storage = null, onChange = () => {} } = {}) {
  if (!controller || typeof controller.createSimulation !== 'function') throw new TypeError('A GameController is required');
  if (typeof onChange !== 'function') throw new TypeError('onChange must be a function');
  const original = profileFromConfiguration(defaults), initial = profileFromConfiguration(initialConfig);
  if (defaults.rules.frameRate !== 30 || initialConfig.rules.frameRate !== 30) throw new RangeError('Logic must remain 30 Hz');
  const baseline = clone(defaults);
  let faithfulConfig = initialConfig, configurationTemplate = initialConfig;
  let draft = clone(initial), applied = clone(initial), next = clone(initial);
  let draftBaseline = clone(initial), undo = [], presets = [], warnings = [], nextIsCustom = false;
  let currentMode = same(defaults, initialConfig) ? 'original' : 'custom', nextMode = currentMode, lastReport = null;
  let presetSequence = 0, lastWriteSucceeded = Boolean(storage);
  const behaviorBySimulation = new WeakMap(), customized = new WeakSet();
  const warn = message => { if (!warnings.includes(message)) warnings.push(message); };
  function notify(kind, report = null) {
    lastReport = report;
    try { onChange({ kind, report }); } catch { warn('设置已更新，但界面刷新回调失败。'); }
  }
  function read(key) {
    if (!storage) return null;
    try { return storage.getItem(key); } catch { warn('本机存储不可读；当前设置仍可使用或导出。'); return null; }
  }
  function write(key, document) {
    if (!storage) { lastWriteSucceeded = false; warn('本机存储不可用；修改仅保留在本次窗口，请导出 JSON。'); return false; }
    try { storage.setItem(key, JSON.stringify(document)); lastWriteSucceeded = true; return true; }
    catch { lastWriteSucceeded = false; warn('本机存储写入失败；修改仅保留在本次窗口，请导出 JSON。'); return false; }
  }
  function persistDraft() { return write(DRAFT_KEY, { schemaVersion: 1, profile: draft }); }
  function validateLibrary(document) {
    const value = checkedJSON(document, MAX_LIBRARY_BYTES);
    strictKeys(value, ['schemaVersion', 'presets'], 'preset library');
    if (value.schemaVersion !== 1 || !Array.isArray(value.presets) || value.presets.length > MAX_PRESETS) throw new TypeError('Invalid preset library');
    const ids = new Set();
    for (const record of value.presets) {
      strictKeys(record, ['id', 'name', 'profile'], 'preset');
      if (typeof record.id !== 'string' || !/^preset-[0-9a-z-]{1,80}$/.test(record.id) || ids.has(record.id)) throw new TypeError('Invalid preset id');
      ids.add(record.id); record.name = nameOf(record.name); record.profile = validateProfile(record.profile);
    }
    return value.presets;
  }
  const draftText = read(DRAFT_KEY), presetsText = read(PRESETS_KEY);
  if (draftText !== null) try {
    const saved = parseJSON(draftText); strictKeys(saved, ['schemaVersion', 'profile'], 'draft');
    if (saved.schemaVersion !== 1) throw new TypeError('Invalid draft schema');
    draft = validateProfile(saved.profile); draftBaseline = clone(draft);
  } catch { warn('本机草稿损坏，未载入或应用；原记录未覆盖。'); }
  if (presetsText !== null) try { presets = validateLibrary(parseJSON(presetsText, MAX_LIBRARY_BYTES)); }
  catch { warn('本机预设库损坏，未载入或应用；原记录未覆盖。'); }

  function install(sim, behavior, custom) {
    if (behaviorBySimulation.has(sim)) { behaviorBySimulation.set(sim, clone(behavior)); if (custom) customized.add(sim); return; }
    behaviorBySimulation.set(sim, clone(behavior)); if (custom) customized.add(sim);
    const originalAi = sim.ai, originalCreate = sim.createUnit;
    sim.ai = function (...args) {
      return behaviorBySimulation.get(this).enemyAi ? originalAi.apply(this, args) : this.p2[0] + this.p2[1] * 8;
    };
    sim.createUnit = function (...args) {
      if (customized.has(this) && this.scene.children.filter(child => child.kind === 'unit').length >= MAX_SANDBOX_UNITS) return null;
      return originalCreate.apply(this, args);
    };
  }
  // Calling the original factory with autoStart:false lets optional behavior be
  // installed before its first frame, preserving the original immediate step.
  const originalFactory = controller.createSimulation;
  controller.createSimulation = function (options) {
    const configuration = nextIsCustom ? configurationFromProfile(configurationTemplate, next) : faithfulConfig;
    const sim = originalFactory.call(this, { ...options, config: configuration, autoStart: false });
    install(sim, next.rules, nextIsCustom);
    sim.p1[2] = Number(next.rules.leftRecruitment); sim.p2[2] = Number(next.rules.rightRecruitment);
    controller.config = configuration; applied = clone(next); currentMode = nextMode;
    if (options.autoStart !== false) sim.step();
    return sim;
  };
  if (controller.simulation) install(controller.simulation, applied.rules, false);
  function isBattle() { return controller.phase === 'game' && controller.simulation && !controller.simulation.winner; }
  function battle() { if (!isBattle()) throw new Error('请先开始尚未结束的一局游戏'); return controller.simulation; }
  function enableCustom(sim) {
    install(sim, behaviorBySimulation.get(sim) ?? applied.rules, true); currentMode = 'custom';
  }
  function replaceDraft(value, remember = true) {
    const valid = validateProfile(value);
    if (remember) { undo.push(clone(draft)); if (undo.length > 30) undo.shift(); }
    draft = valid; persistDraft(); notify('draft'); return clone(draft);
  }
  function changedFields(before, after) {
    return metadata(baseline).flatMap(group => group.entries.flatMap(entry => entry.fields))
      .filter(field => !same(at(before, field.path), at(after, field.path)));
  }
  function currentResources(sim) {
    const side = side => ({ money: sim[`${side}Money`], income: sim[`${side}Income`], population: sim[`${side}Population`],
      baseHp: (side === 'left' ? sim.redBoss : sim.blueBoss).nowHP,
      units: (side === 'left' ? sim.friendList : sim.enemyList).filter(entity => entity.kind === 'unit').length,
      recruitment: (side === 'left' ? sim.p1 : sim.p2)[2] === 1 });
    return { left: side('left'), right: side('right'), enemyAi: behaviorBySimulation.get(sim)?.enemyAi ?? true,
      difficulty: sim.difficulty, frame: sim.frame, round: sim.round, canSpawn: true };
  }
  const api = {
    getMode() { return { current: currentMode, next: nextMode }; },
    async flush() {
      if (!lastWriteSucceeded) return false;
      try { return typeof storage?.flush === 'function' ? await storage.flush() : Boolean(storage); }
      catch { warn('本机存储写入失败；请导出 JSON 保存修改。'); return false; }
    },
    getMetadata() { return clone(metadata(baseline)); },
    getState() {
      const storageWarning = storage?.warning;
      return { draft: clone(draft), applied: clone(applied), next: clone(next), defaults: clone(original),
        dirty: !same(draft, draftBaseline), differsFromCurrent: !same(draft, applied), differsFromNext: !same(draft, next),
        canUndo: undo.length > 0, presets: presets.map(({ id, name }) => ({ id, name })),
        warnings: [...warnings, ...(storageWarning ? [storageWarning] : [])],
        storageStatus: storage?.status ?? (storage ? 'ready' : 'memory'),
        isBattle: Boolean(isBattle()), battle: isBattle() ? currentResources(controller.simulation) : null,
        mode: currentMode, nextMode, lastReport: lastReport ? clone(lastReport) : null,
        limits: { presets: MAX_PRESETS, units: MAX_SANDBOX_UNITS, manualSpawnPerAction: 100 },
        unsupported: ['建筑建造', '主动技能', '固定波次 / 关卡增援'] };
    },
    setDraft(profile) { return replaceDraft(profile); },
    updateDraft(path, value) { return replaceDraft(setProfileField(draft, path, value, baseline)); },
    resetDraft() { return replaceDraft(original); },
    undoDraft() {
      if (!undo.length) return false;
      draft = undo.pop(); persistDraft(); notify('draft'); return true;
    },
    applyCurrent({ health = 'ratio' } = {}) {
      if (!['ratio', 'absolute'].includes(health)) throw new TypeError('health must be ratio or absolute');
      const sim = battle(), valid = validateProfile(draft), configuration = configurationFromProfile(configurationTemplate, valid);
      const changes = changedFields(applied, valid);
      const report = { applied: changes.filter(field => field.apply !== '下局').map(field => field.path),
        deferred: changes.filter(field => field.apply === '下局').map(field => field.path),
        note: '当前倒计时、已有攻击冷却、现有金币与剩余人口不重置；初始值仅下局使用。', health };
      enableCustom(sim); behaviorBySimulation.set(sim, clone(valid.rules));
      applyToSimulation(sim, configuration, valid.rules, health);
      controller.config = configuration; controller.revision++;
      applied = clone(valid); next = clone(valid); nextMode = 'custom'; nextIsCustom = true;
      notify('apply-current', report); return report;
    },
    applyNext() {
      const valid = validateProfile(draft), configuration = configurationFromProfile(configurationTemplate, valid);
      next = clone(valid); nextIsCustom = true; nextMode = 'custom';
      if (controller.phase !== 'game') controller.config = configuration;
      notify('apply-next', { applied: [], deferred: changedFields(applied, valid).map(field => field.path) });
      return clone(next);
    },
    startBattle({ difficulty = controller.difficulty, singlePlay = controller.singlePlay } = {}) {
      integer(difficulty, 0, 3, 'difficulty');
      if (typeof singlePlay !== 'boolean') throw new TypeError('singlePlay must be boolean');
      api.applyNext(); controller.startMatch(singlePlay, difficulty);
      notify('start-battle'); return api.getState();
    },
    returnToOriginal() {
      controller.home(); faithfulConfig = freeze(clone(baseline)); configurationTemplate = faithfulConfig; controller.config = faithfulConfig;
      next = clone(original); applied = clone(original); nextIsCustom = false;
      currentMode = nextMode = 'original';
      notify('return-original'); return api.getState();
    },
    savePreset(name, id = null) {
      name = nameOf(name); const profile = validateProfile(draft);
      const index = id === null ? -1 : presets.findIndex(record => record.id === id);
      if (id !== null && index < 0) throw new RangeError('Unknown preset');
      if (index < 0 && presets.length >= MAX_PRESETS) throw new RangeError('最多保存 25 个预设');
      if (id === null) { do { id = `preset-${++presetSequence}`; } while (presets.some(record => record.id === id)); }
      const records = clone(presets), record = { id, name, profile };
      if (index < 0) records.push(record); else records[index] = record;
      const valid = validateLibrary({ schemaVersion: 1, presets: records });
      const queued = write(PRESETS_KEY, { schemaVersion: 1, presets: valid });
      presets = valid; draftBaseline = clone(draft);
      notify('preset-saved'); return { id, name, queued, storageStatus: storage?.status ?? (queued ? 'ready' : 'memory') };
    },
    loadPreset(id) {
      const preset = presets.find(record => record.id === id); if (!preset) throw new RangeError('Unknown preset');
      replaceDraft(preset.profile); draftBaseline = clone(draft); return clone(draft);
    },
    deletePreset(id) {
      if (!presets.some(record => record.id === id)) throw new RangeError('Unknown preset');
      presets = presets.filter(record => record.id !== id);
      write(PRESETS_KEY, { schemaVersion: 1, presets }); notify('preset-deleted');
    },
    importJSON(text) {
      const document = parseJSON(text);
      strictKeys(document, ['schemaVersion', 'name', 'profile'], 'export');
      if (document.schemaVersion !== 1) throw new TypeError('Unsupported customization export');
      nameOf(document.name); return replaceDraft(validateProfile(document.profile));
    },
    exportJSON(name = '我的米拉奇规则') {
      return JSON.stringify({ schemaVersion: 1, name: nameOf(name), profile: validateProfile(draft) }, null, 2) + '\n';
    },
    spawn({ side, unitId, count = 1 } = {}) {
      sideOf(side); integer(unitId, 0, 15, 'unitId'); integer(count, 1, 100, 'count');
      const sim = battle(), total = sim.scene.children.filter(child => child.kind === 'unit').length;
      if (total + count > MAX_SANDBOX_UNITS) throw new RangeError(`自定义模式最多 ${MAX_SANDBOX_UNITS} 个单位（含死亡动画）`);
      if ((side === 'left' ? sim.redBoss : sim.blueBoss).nowHP <= 0) throw new Error('水晶已毁，不能再刷兵');
      enableCustom(sim);
      const keys = [`${side}Money`, `${side}Income`, `${side}Population`], saved = keys.map(key => sim[key]);
      const unit = sim.config.units[unitId], units = [];
      try {
        for (let i = 0; i < count; i++) {
          sim[keys[0]] = unit.cost; sim[keys[2]] = unit.population;
          const entity = sim.createUnit(side, unitId);
          if (!entity) throw new Error('已达到安全单位上限');
          units.push(entity.uid);
        }
      } finally { keys.forEach((key, i) => { sim[key] = saved[i]; }); refresh(sim); }
      notify('spawn', { side, unitId, count: units.length }); return units;
    },
    clearTroops(side = 'both') {
      if (side !== 'both') sideOf(side);
      const sim = battle(); enableCustom(sim);
      const remove = new Set(sim.scene.children.filter(child => child.kind === 'unit' && (side === 'both' || child.side === side)));
      // Both sides' attacks referencing removed actors must be removed too.
      // The engine otherwise dereferences father/target on the next frame.
      for (const child of sim.scene.children) if (child.kind === 'attack' && (remove.has(child.father) || remove.has(child.target))) remove.add(child);
      for (const child of [...sim.scene.children]) if (remove.has(child)) sim.scene.removeChild(child);
      for (const list of [sim.friendList, sim.enemyList]) for (let i = list.length - 1; i >= 0; i--) if (remove.has(list[i])) list.splice(i, 1);
      for (const child of sim.scene.children) if (remove.has(child.target)) child.target = null;
      const count = [...remove].filter(child => child.kind === 'unit').length;
      refresh(sim); notify('clear-troops', { side, count }); return count;
    },
    setResources(input = {}) {
      checkedJSON(input); const { side } = input; sideOf(side);
      if (Object.keys(input).some(key => !['side', 'money', 'income', 'population'].includes(key)) || Object.keys(input).length < 2) throw new TypeError('Unknown or empty resource edit');
      for (const key of ['money', 'income', 'population']) if (Object.hasOwn(input, key)) integer(input[key], 0, key === 'population' ? 10000 : 100000000, key);
      const sim = battle(); enableCustom(sim);
      for (const key of ['money', 'income', 'population']) if (Object.hasOwn(input, key)) sim[`${side}${key[0].toUpperCase()}${key.slice(1)}`] = input[key];
      refresh(sim); notify('resources'); return currentResources(sim);
    },
    selectUnit({ side, unitId } = {}) {
      sideOf(side); integer(unitId, 0, 15, 'unitId'); const sim = battle(); enableCustom(sim);
      const selection = side === 'left' ? sim.p1 : sim.p2; selection[0] = unitId % 8; selection[1] = Math.trunc(unitId / 8);
      notify('selection'); return unitId;
    },
    setRecruitment(side, enabled) {
      sideOf(side); if (typeof enabled !== 'boolean') throw new TypeError('enabled must be boolean');
      const sim = battle(); enableCustom(sim); (side === 'left' ? sim.p1 : sim.p2)[2] = Number(enabled);
      behaviorBySimulation.get(sim)[`${side}Recruitment`] = enabled;
      applied.rules[`${side}Recruitment`] = enabled; notify('recruitment');
    },
    setEnemyAi(enabled) {
      if (typeof enabled !== 'boolean') throw new TypeError('enabled must be boolean');
      const sim = battle(); enableCustom(sim); behaviorBySimulation.get(sim).enemyAi = enabled;
      applied.rules.enemyAi = enabled; notify('enemy-ai');
    },
  };
  return Object.freeze(api);
}
