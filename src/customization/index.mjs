import { clone, freeze, checkedJSON, parseJSON, validateProfile, profileFromConfiguration, configurationFromProfile,
  metadata, setProfileField, fieldSpecification, at, DRAFT_KEY, PRESETS_KEY, MAX_LIBRARY_BYTES, MAX_PRESETS, MAX_SANDBOX_UNITS, MAX_INTEGER } from './schema.mjs';
import { installCustomRuntime, hasCustomRuntime, customSideConfiguration } from './runtime.mjs';
import { clampInteger, clampFinite } from './numeric.mjs';
import { releaseSpatialIndexes } from '../performance/simulation-spatial.mjs';
import { installCombatHitRules } from '../extensions/combat-hits.mjs';
import { installCasterProjectileLifetime } from '../extensions/projectile-lifetime.mjs';
import { dualAISnapshot, normalizeDualAIOptions } from '../extensions/dual-ai.mjs';

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
  // Explicit edits/paused clear must not retain the previous army until a tick.
  releaseSpatialIndexes(sim);
  sim.renderSnapshot = sim.scene.children.map(child => child.visualState());
  sim.renderCamera = { ...sim.camera };
}
/**
 * Explicit, opt-in editor adapter. No recovered module/prototype is patched.
 * Legacy draft methods remain staging-only. Confirmed settings apply and save
 * together; autoRestore opts into loading those settings at the next launch.
 * Runtime options are supplied only through actual recovered fields.
 */
export function createCustomization({ controller, defaults, initialConfig = controller?.config,
  storage = null, autoRestore = false, onChange = () => {}, schedule = callback => setTimeout(callback, 0), cancelSchedule = handle => clearTimeout(handle),
  workNow = () => performance.now(), spawnBatchSize = 32, spawnWorkMs = 4 } = {}) {
  if (!controller || typeof controller.createSimulation !== 'function') throw new TypeError('A GameController is required');
  if (typeof onChange !== 'function') throw new TypeError('onChange must be a function');
  if (typeof autoRestore !== 'boolean') throw new TypeError('autoRestore must be boolean');
  if (typeof schedule !== 'function' || typeof cancelSchedule !== 'function' || typeof workNow !== 'function') throw new TypeError('Spawn scheduling functions required');
  if (!Number.isSafeInteger(spawnBatchSize) || spawnBatchSize < 1 || spawnBatchSize > 256 || !Number.isFinite(spawnWorkMs) || spawnWorkMs <= 0) throw new RangeError('Invalid spawn batch budget');
  const original = profileFromConfiguration(defaults), initial = profileFromConfiguration(initialConfig);
  if (defaults.rules.frameRate !== 30 || initialConfig.rules.frameRate !== 30) throw new RangeError('Logic must remain 30 Hz');
  const baseline = clone(defaults);
  let faithfulConfig = initialConfig, configurationTemplate = initialConfig;
  let draft = clone(initial), applied = clone(initial), next = clone(initial);
  let draftBaseline = clone(initial), undo = [], presets = [], warnings = [], nextIsCustom = false;
  let currentMode = same(defaults, initialConfig) ? 'original' : 'custom', nextMode = currentMode, lastReport = null;
  let presetSequence = 0, lastWriteSucceeded = Boolean(storage);
  let writeRevision = 0, flushRevision = 0;
  let automaticSettings = autoRestore, templateSource = 'startup', settingsUndo = [], restoredSettings = false;
  const behaviorBySimulation = new WeakMap(), aiWrapperBySimulation = new WeakMap(), battleIds = new WeakMap();
  let battleSequence = 0;
  let spawnJob = null, spawnTimer = null, spawnSequence = 0;
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
    writeRevision++;
    if (!storage) { lastWriteSucceeded = false; warn('本机存储不可用；修改仅保留在本次窗口，请导出 JSON。'); return false; }
    try { storage.setItem(key, JSON.stringify(document)); lastWriteSucceeded = true; return true; }
    catch { lastWriteSucceeded = false; warn('本机存储写入失败；修改仅保留在本次窗口，请导出 JSON。'); return false; }
  }
  function persistSettings() { return write(DRAFT_KEY, { schemaVersion: 2, template: templateSource, profile: next }); }
  function persistDraft() { return automaticSettings ? persistSettings() : write(DRAFT_KEY, { schemaVersion: 1, profile: draft }); }
  function validateLibrary(document) {
    const value = checkedJSON(document, MAX_LIBRARY_BYTES);
    strictKeys(value, ['schemaVersion', 'presets'], 'preset library');
    if (value.schemaVersion !== 1 || !Array.isArray(value.presets) || value.presets.length > MAX_PRESETS) throw new TypeError('Invalid preset library');
    const ids = new Set();
    for (const record of value.presets) {
      strictKeys(record, ['id', 'name', 'profile'], 'preset');
      if (typeof record.id !== 'string' || !/^preset-[0-9a-z-]{1,80}$/.test(record.id) || ids.has(record.id)) throw new TypeError('Invalid preset id');
      ids.add(record.id); record.name = nameOf(record.name); record.profile = validateProfile(record.profile, { configuration: initialConfig });
    }
    return value.presets;
  }
  const draftText = read(DRAFT_KEY), presetsText = read(PRESETS_KEY);
  if (draftText !== null) try {
    const saved = parseJSON(draftText);
    if (saved.schemaVersion === 1) strictKeys(saved, ['schemaVersion', 'profile'], 'draft');
    else {
      strictKeys(saved, ['schemaVersion', 'template', 'profile'], 'settings');
      if (saved.schemaVersion !== 2 || !['startup', 'original'].includes(saved.template)) throw new TypeError('Invalid settings schema');
    }
    const valid = validateProfile(saved.profile, { configuration: initialConfig });
    if (autoRestore) {
      const source = saved.template ?? 'startup';
      const template = source === 'original' ? freeze(clone(baseline)) : initialConfig;
      const custom = !(same(valid, original) && same(template, baseline));
      const configuration = custom ? configurationFromProfile(template, valid) : template;
      templateSource = source; configurationTemplate = template; faithfulConfig = template;
      next = clone(valid); applied = clone(valid);
      nextIsCustom = custom;
      currentMode = nextMode = nextIsCustom ? 'custom' : 'original';
      controller.config = configuration;
      restoredSettings = true;
    }
    draft = valid; draftBaseline = clone(draft);
  } catch { warn('本机草稿损坏，未载入或应用；原记录未覆盖。'); }
  if (presetsText !== null) try { presets = validateLibrary(parseJSON(presetsText, MAX_LIBRARY_BYTES)); }
  catch { warn('本机预设库损坏，未载入或应用；原记录未覆盖。'); }

  function install(sim, behavior, custom, { initialize = false } = {}) {
    behaviorBySimulation.set(sim, clone(behavior));
    if (custom && (initialize || !hasCustomRuntime(sim))) installCustomRuntime(sim, sim.config, { initialize });
    if (sim.ai !== aiWrapperBySimulation.get(sim)) {
      const originalAi = sim.ai;
      const wrapped = function (...args) {
        return behaviorBySimulation.get(this).enemyAi ? originalAi.apply(this, args) : this.p2[0] + this.p2[1] * 8;
      };
      sim.ai = wrapped; aiWrapperBySimulation.set(sim, wrapped);
    }
  }
  function applyRuntime(sim, configuration, behavior, health) {
    installCustomRuntime(sim, configuration, { health });
    install(sim, behavior, true);
    sim.p1[2] = Number(behavior.leftRecruitment); sim.p2[2] = Number(behavior.rightRecruitment);
    refresh(sim);
  }
  function cancelSpawn(reason = 'cancelled') {
    if (spawnTimer !== null) { cancelSchedule(spawnTimer); spawnTimer = null; }
    if (!spawnJob) return false;
    if (spawnJob.status !== 'running') { spawnJob.simulation = null; return false; }
    spawnJob.status = 'cancelled'; spawnJob.reason = reason;
    // Keep the progress receipt, not an abandoned scene and all of its units.
    spawnJob.simulation = null;
    notify('spawn-cancelled', publicSpawnJob()); return true;
  }
  function publicSpawnJob() {
    if (!spawnJob) return null;
    const { simulation, ...info } = spawnJob; return { ...info, remaining: info.requested - info.completed };
  }
  function spawnOne(sim, side, unitId) {
    const keys = [`${side}Money`, `${side}Income`, `${side}Population`], saved = keys.map(key => sim[key]);
    const unit = customSideConfiguration(sim, side).units[unitId];
    try { sim[keys[0]] = unit.cost; sim[keys[2]] = unit.population; return sim.createUnit(side, unitId); }
    finally { keys.forEach((key, i) => { sim[key] = saved[i]; }); }
  }
  function advanceSpawn() {
    spawnTimer = null;
    if (!spawnJob || spawnJob.status !== 'running') return;
    const job = spawnJob, sim = job.simulation;
    if (!isBattle() || controller.simulation !== sim) { cancelSpawn('battle-changed'); return; }
    const base = job.side === 'left' ? sim.redBoss : sim.blueBoss;
    if (base.nowHP <= 0) { cancelSpawn('crystal-destroyed'); return; }
    const started = workNow(); let batch = 0;
    try {
      while (job.completed < job.requested && batch < spawnBatchSize && (batch === 0 || workNow() - started < spawnWorkMs)) {
        if (!spawnOne(sim, job.side, job.unitId)) throw new Error('当前条件无法生成士兵');
        job.completed++; batch++;
      }
      refresh(sim);
      if (job.completed === job.requested) { job.status = 'completed'; job.simulation = null; }
      notify('spawn-progress', publicSpawnJob());
      if (job.status === 'running') spawnTimer = schedule(advanceSpawn);
    } catch {
      job.status = 'failed'; job.simulation = null;
      job.error = '生成中断；已生成的士兵保留，可减少数量后重试。';
      refresh(sim); notify('spawn-failed', publicSpawnJob());
    }
  }
  // Calling the original factory with autoStart:false lets optional behavior be
  // installed before its first frame, preserving the original immediate step.
  const originalFactory = controller.createSimulation;
  controller.createSimulation = function (options = {}) {
    cancelSpawn('battle-changed');
    const configuration = nextIsCustom ? configurationFromProfile(configurationTemplate, next) : faithfulConfig;
    const sim = originalFactory.call(this, { ...options, config: configuration, autoStart: false });
    const needsCustomRuntime = nextIsCustom || nextMode === 'custom';
    install(sim, next.rules, needsCustomRuntime, { initialize: needsCustomRuntime });
    sim.p1[2] = Number(next.rules.leftRecruitment); sim.p2[2] = Number(next.rules.rightRecruitment);
    controller.config = configuration; applied = clone(next); currentMode = options.matchMode === 'ai-vs-ai' ? 'custom' : nextMode;
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
    const valid = validateProfile(value, { configuration: configurationTemplate });
    if (remember) { undo.push(clone(draft)); if (undo.length > 30) undo.shift(); }
    draft = valid; persistDraft(); notify('draft'); return clone(draft);
  }
  function changedFields(before, after) {
    return metadata(baseline).flatMap(group => group.entries.flatMap(entry => entry.fields))
      .filter(field => !same(at(before, field.path), at(after, field.path)));
  }
  function currentResources(sim) {
    if (!battleIds.has(sim)) battleIds.set(sim, ++battleSequence);
    const side = side => {
      const base = side === 'left' ? sim.redBoss : sim.blueBoss, selection = side === 'left' ? sim.p1 : sim.p2;
      return { money: sim[`${side}Money`], income: sim[`${side}Income`], population: sim[`${side}Population`],
        baseHp: base.nowHP, baseMaxHp: base.spawnHP, baseDamage: [...base.damage], baseRange: base.range,
        baseWeaponSpeedFrames: base.weaponSpeed, selectedUnit: selection[0] + selection[1] * 8,
        units: (side === 'left' ? sim.friendList : sim.enemyList).filter(entity => entity.kind === 'unit').length,
        recruitment: selection[2] === 1 };
    };
    return { left: side('left'), right: side('right'), enemyAi: behaviorBySimulation.get(sim)?.enemyAi ?? true,
      matchMode: sim.dualAI ? 'ai-vs-ai' : sim.singlePlay ? 'single' : 'dual', dualAI: dualAISnapshot(sim),
      battleId: battleIds.get(sim), difficulty: sim.difficulty, frame: sim.frame, round: sim.round, canSpawn: true };
  }
  function currentBehavior(sim) {
    return { leftRecruitment: sim.p1[2] === 1, rightRecruitment: sim.p2[2] === 1,
      enemyAi: behaviorBySimulation.get(sim)?.enemyAi ?? true };
  }
  function liveFields(edits, { health = 'ratio' } = {}) {
    if (!['ratio', 'absolute'].includes(health)) throw new TypeError('health must be ratio or absolute');
    const sim = battle(); let current = clone(applied), future = clone(next), editedDraft = clone(draft);
    for (const [path, value] of edits) {
      if (fieldSpecification(path, baseline).apply === '下局') throw new Error('开局字段只能应用到下局');
      current = setProfileField(current, path, value, baseline);
      future = setProfileField(future, path, value, baseline);
      editedDraft = setProfileField(editedDraft, path, value, baseline);
    }
    current.rules = currentBehavior(sim);
    const configuration = configurationFromProfile(configurationTemplate, current);
    enableCustom(sim); applyRuntime(sim, configuration, current.rules, health);
    controller.config = configuration; controller.revision++;
    applied = current; next = future; draft = editedDraft; nextIsCustom = true; nextMode = 'custom'; persistDraft();
    const report = { applied: edits.map(([path]) => path), deferred: [], health };
    notify('apply-live-field', report); return report;
  }
  function keepOpeningValues(profile) {
    // These fields describe a new match, never the balances/counters of a live one.
    for (const key of ['initialMoney', 'startingIncome', 'leftStartingPopulation', 'initialRoundFrames']) profile.config.rules[key] = applied.config.rules[key];
    for (const side of ['left', 'right']) profile.config.sides[side].initial = clone(applied.config.sides[side].initial);
    for (let i = 0; i < 4; i++) for (const key of ['rightStartingIncome', 'rightStartingPopulation']) profile.config.difficulties[i][key] = applied.config.difficulties[i][key];
    return profile;
  }
  function applyConfirmed(input, { source = templateSource, behavior = null, remember = true, consumeUndo = false, kind = 'settings-committed' } = {}) {
    // Fully validate both next-match and live configurations before touching a
    // battle, undo history, storage, or the active configuration template.
    if (!['startup', 'original'].includes(source)) throw new TypeError('Invalid configuration template');
    const template = source === 'original' ? freeze(clone(baseline)) : initialConfig;
    const valid = validateProfile(input, { configuration: template });
    const originalRules = same(valid, original) && same(template, baseline);
    const futureConfiguration = originalRules ? template : configurationFromProfile(template, valid);
    const live = isBattle(), sim = live ? controller.simulation : null;
    const priorBehavior = live ? currentBehavior(sim) : clone(applied.rules);
    const overrides = behavior ?? valid.rules;
    for (const [key, value] of Object.entries(overrides)) {
      if (!Object.hasOwn(original.rules, key) || typeof value !== 'boolean') throw new TypeError('Invalid behavior setting');
    }
    const current = live ? keepOpeningValues(clone(valid)) : clone(valid);
    if (live) current.rules = { ...priorBehavior, ...overrides };
    const currentConfiguration = live ? configurationFromProfile(template, current) : futureConfiguration;
    const changes = changedFields(applied, valid), behaviorKeys = Object.keys(overrides);
    const changed = !same(next, valid) || source !== templateSource || behaviorKeys.some(key => priorBehavior[key] !== overrides[key]);
    const record = { profile: clone(next), source: templateSource,
      behavior: Object.fromEntries(behaviorKeys.map(key => [key, priorBehavior[key]])) };
    const report = {
      applied: live ? changes.filter(field => field.apply !== '下局' || behaviorKeys.includes(field.path.replace(/^rules\./, ''))).map(field => field.path) : [],
      deferred: live ? changes.filter(field => field.apply === '下局' && !behaviorKeys.includes(field.path.replace(/^rules\./, ''))).map(field => field.path) : changes.map(field => field.path),
      health: 'ratio', template: source,
      note: '确认后自动应用并保存；开局参数下局生效。当前资源、倒计时和已发出的攻击保持；生命按比例更新。',
    };
    if (live) {
      // An attack already in flight is a committed action, not a fresh shot.
      // Keep its trajectory/hit mode and elapsed delay/life when templates
      // change, rather than turning a swept projectile into a locked-target hit.
      const committed = sim.scene.children.filter(entity => entity.kind === 'attack').map(attack => ({ attack, step: attack.step, life: attack.life, delay: attack.delay }));
      applyRuntime(sim, currentConfiguration, current.rules, 'ratio');
      installCombatHitRules(installCasterProjectileLifetime(sim));
      for (const entry of committed) {
        Object.defineProperty(entry.attack, 'step', { value: entry.step, configurable: true, writable: true });
        entry.attack.life = entry.life; entry.attack.delay = entry.delay;
      }
      controller.revision++;
    }
    if (remember && changed) { settingsUndo.push(record); if (settingsUndo.length > 30) settingsUndo.shift(); }
    templateSource = source; configurationTemplate = template; faithfulConfig = template;
    draft = clone(valid); next = clone(valid); applied = current; nextIsCustom = !originalRules;
    nextMode = originalRules ? 'original' : 'custom'; currentMode = live ? 'custom' : nextMode;
    controller.config = currentConfiguration; automaticSettings = true; draftBaseline = clone(draft);
    if (consumeUndo) settingsUndo.pop();
    report.queued = persistSettings(); notify(kind, report); return report;
  }
  const api = {
    getMode() { return { current: currentMode, next: nextMode }; },
    getBattleState() { return isBattle() ? currentResources(controller.simulation) : null; },
    async flush() {
      if (!lastWriteSucceeded) return false;
      const request = ++flushRevision, revision = writeRevision;
      try {
        const succeeded = typeof storage?.flush === 'function' ? Boolean(await storage.flush()) : Boolean(storage);
        if (request === flushRevision && revision === writeRevision) lastWriteSucceeded = succeeded;
        return succeeded;
      } catch {
        if (request === flushRevision && revision === writeRevision) {
          lastWriteSucceeded = false; warn('本机存储写入失败；请导出 JSON 保存修改。');
        }
        return false;
      }
    },
    getMetadata() { return clone(metadata(baseline)); },
    getState() {
      const storageWarning = storage?.warning;
      return { draft: clone(draft), applied: clone(applied), next: clone(next), defaults: clone(original),
        dirty: !same(draft, draftBaseline), differsFromCurrent: !same(draft, applied), differsFromNext: !same(draft, next),
        canUndo: undo.length > 0, presets: presets.map(({ id, name }) => ({ id, name })),
        canUndoSettings: settingsUndo.length > 0,
        settingsSaved: automaticSettings && lastWriteSucceeded && same(draft, next) && !storage?.warning && !['error', 'pending', 'saving'].includes(storage?.status),
        restoredSettings, template: templateSource,
        pendingNext: isBattle() ? changedFields(applied, next).filter(field => field.apply === '下局').map(field => field.path) : [],
        warnings: [...warnings, ...(storageWarning ? [storageWarning] : [])],
        storageStatus: storage?.status ?? (storage ? 'ready' : 'memory'),
        isBattle: Boolean(isBattle()), battle: isBattle() ? currentResources(controller.simulation) : null,
        mode: currentMode, nextMode, lastReport: lastReport ? clone(lastReport) : null,
        limits: { presets: MAX_PRESETS, units: null, manualSpawnPerAction: MAX_INTEGER, safeInteger: MAX_INTEGER },
        spawnJob: publicSpawnJob(),
        unsupported: ['建筑建造', '主动技能', '固定波次 / 关卡增援'] };
    },
    setDraft(profile) { return replaceDraft(profile); },
    commitSetting(path, value) {
      const valid = setProfileField(draft, path, value, baseline);
      const behavior = path.startsWith('rules.') ? { [path.slice(6)]: at(valid, path) } : {};
      return applyConfirmed(valid, { behavior });
    },
    applySettings() { return applyConfirmed(draft); },
    resetSettings({ originalRules = false } = {}) {
      if (typeof originalRules !== 'boolean') throw new TypeError('originalRules must be boolean');
      return applyConfirmed(original, { source: originalRules ? 'original' : 'startup', kind: 'settings-reset' });
    },
    undoSettings() {
      if (!settingsUndo.length) return false;
      const record = settingsUndo.at(-1);
      return applyConfirmed(record.profile, { source: record.source, behavior: record.behavior, remember: false, consumeUndo: true, kind: 'settings-undone' });
    },
    returnToMenu() {
      cancelSpawn('return-menu'); controller.home();
      controller.config = nextIsCustom ? configurationFromProfile(configurationTemplate, next) : faithfulConfig;
      notify('return-menu'); return api.getState();
    },
    updateDraft(path, value) { return replaceDraft(setProfileField(draft, path, value, baseline)); },
    resetDraft() { return replaceDraft(original); },
    undoDraft() {
      if (!undo.length) return false;
      draft = undo.pop(); persistDraft(); notify('draft'); return true;
    },
    applyLiveField(path, value, options = {}) { return liveFields([[path, value]], options); },
    applyCurrent({ health = 'ratio' } = {}) {
      if (!['ratio', 'absolute'].includes(health)) throw new TypeError('health must be ratio or absolute');
      const sim = battle(), valid = validateProfile(draft), current = clone(valid);
      // Start-page drafts are never enacted by the unit/rule apply button.
      // Keep both the current configuration receipt and actual switches honest.
      for (const key of ['initialMoney','startingIncome','leftStartingPopulation','initialRoundFrames']) current.config.rules[key] = applied.config.rules[key];
      for (const side of ['left','right']) current.config.sides[side].initial = clone(applied.config.sides[side].initial);
      for (let i=0;i<4;i++) for (const key of ['rightStartingIncome','rightStartingPopulation']) current.config.difficulties[i][key] = applied.config.difficulties[i][key];
      current.rules = currentBehavior(sim);
      const configuration = configurationFromProfile(configurationTemplate, current), changes = changedFields(applied, valid);
      const report = { applied: changes.filter(field => field.apply !== '下局').map(field => field.path),
        deferred: changes.filter(field => field.apply === '下局').map(field => field.path),
        note: '当前倒计时、已有攻击冷却、现有金币与剩余人口、当前招募和 AI 开关不重置；开局设置仅下局使用。', health };
      enableCustom(sim); applyRuntime(sim, configuration, current.rules, health);
      controller.config = configuration; controller.revision++;
      applied = current; next = clone(valid); nextMode = 'custom'; nextIsCustom = true;
      notify('apply-current', report); return report;
    },
    applyNext() {
      const valid = validateProfile(draft);
      // Choosing a difficulty with untouched original settings is not a custom
      // rule set. Non-profile external overrides must still remain identifiable.
      const originalRules = same(valid, original) && same(configurationTemplate, baseline);
      const configuration = originalRules ? faithfulConfig : configurationFromProfile(configurationTemplate, valid);
      next = clone(valid); nextIsCustom = !originalRules; nextMode = originalRules ? 'original' : 'custom';
      if (controller.phase !== 'game') controller.config = configuration;
      notify('apply-next', { applied: [], deferred: changedFields(applied, valid).map(field => field.path) });
      return clone(next);
    },
    startBattle(options = {}) {
      const { difficulty = controller.difficulty, singlePlay = controller.singlePlay,
        mode = Object.hasOwn(options, 'singlePlay') ? singlePlay ? 'single' : 'dual' : controller.matchMode,
        dualAI = controller.dualAIOptions } = options;
      integer(difficulty, 0, 3, 'difficulty');
      if (typeof singlePlay !== 'boolean') throw new TypeError('singlePlay must be boolean');
      if (!['single', 'dual', 'ai-vs-ai'].includes(mode)) throw new TypeError('Invalid match mode');
      if (mode === 'ai-vs-ai') normalizeDualAIOptions(dualAI);
      api.applyNext();
      if (mode === 'ai-vs-ai') controller.startAIMatch(dualAI);
      else controller.startMatch(mode === 'single', difficulty);
      notify('start-battle'); return api.getState();
    },
    returnToOriginal() {
      cancelSpawn('return-original'); controller.home(); faithfulConfig = freeze(clone(baseline)); configurationTemplate = faithfulConfig; controller.config = faithfulConfig;
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
      nameOf(document.name); return replaceDraft(validateProfile(document.profile, { configuration: configurationTemplate }));
    },
    exportJSON(name = '我的米拉奇规则') {
      return JSON.stringify({ schemaVersion: 1, name: nameOf(name), profile: validateProfile(draft) }, null, 2) + '\n';
    },
    getSpawnJob() { return publicSpawnJob(); },
    cancelSpawn() { return cancelSpawn('user'); },
    startSpawn({ side, unitId, count = 1 } = {}) {
      sideOf(side); integer(unitId, 0, 15, 'unitId'); count = clampInteger(count, { min: 1 });
      const sim = battle();
      if ((side === 'left' ? sim.redBoss : sim.blueBoss).nowHP <= 0) throw new Error('水晶已毁，不能再刷兵');
      cancelSpawn('replaced'); enableCustom(sim);
      spawnJob = { id: ++spawnSequence, status: 'running', side, unitId, requested: count, completed: 0, error: null, simulation: sim };
      notify('spawn-started', publicSpawnJob()); spawnTimer = schedule(advanceSpawn); return publicSpawnJob();
    },
    // Small legacy calls remain synchronous. Larger requests always yield;
    // only the dedicated startSpawn API is used by the new editor.
    spawn({ side, unitId, count = 1 } = {}) {
      sideOf(side); integer(unitId, 0, 15, 'unitId'); count = clampInteger(count, { min: 1 });
      if (count > 64) return api.startSpawn({ side, unitId, count });
      const sim = battle();
      if ((side === 'left' ? sim.redBoss : sim.blueBoss).nowHP <= 0) throw new Error('水晶已毁，不能再刷兵');
      enableCustom(sim); const units = [];
      for (let i = 0; i < count; i++) { const entity = spawnOne(sim, side, unitId); if (!entity) throw new Error('当前条件无法生成士兵'); units.push(entity.uid); }
      refresh(sim); notify('spawn', { side, unitId, count: units.length }); return units;
    },
    clearTroops(side = 'both') {
      if (side !== 'both') sideOf(side);
      const sim = battle(); enableCustom(sim);
      if (spawnJob?.status === 'running' && (side === 'both' || spawnJob.side === side)) cancelSpawn('troops-cleared');
      const selected = new Set(sim.scene.children.filter(child => child.kind === 'unit' && (side === 'both' || child.side === side)));
      // Clear committed attacks too: a cleared soldier must not damage anyone
      // while its visual body finishes falling. Unrelated attacks keep flying.
      for (const child of [...sim.scene.children]) if (child.kind === 'attack' && (selected.has(child.father) || selected.has(child.target))) sim.scene.removeChild(child);
      let count = 0;
      for (const child of selected) if (child.nowHP > 0) {
        // Reuse original death animation, knockback, events and list removal.
        // Existing corpses keep their current progress; repeated clear is safe.
        child.dead(); count++;
      }
      for (const child of sim.scene.children) if (selected.has(child.target)) child.target = null;
      refresh(sim); notify('clear-troops', { side, count }); return count;
    },
    setResources(input = {}) {
      const { side } = input; sideOf(side);
      if (Object.keys(input).some(key => !['side', 'money', 'income', 'population', 'baseHp'].includes(key)) || Object.keys(input).length < 2) throw new TypeError('Unknown or empty resource edit');
      const values = {};
      for (const key of ['money', 'income', 'population']) if (Object.hasOwn(input,key)) values[key] = clampInteger(input[key]);
      if (Object.hasOwn(input,'baseHp')) values.baseHp = clampFinite(input.baseHp);
      checkedJSON(values);
      const sim = battle();
      const editedBase = side === 'left' ? sim.redBoss : sim.blueBoss;
      if (Object.hasOwn(values,'baseHp') && editedBase.nowHP <= 0 && values.baseHp > 0) throw new Error('已毁水晶不能通过当前生命编辑复活；请开始新局');
      enableCustom(sim);
      for (const key of ['money','income','population']) if(Object.hasOwn(values,key))sim[`${side}${key[0].toUpperCase()}${key.slice(1)}`]=values[key];
      if (Object.hasOwn(values,'baseHp')) {
        const base = side === 'left' ? sim.redBoss : sim.blueBoss;
        base.nowHP = values.baseHp;
      }
      refresh(sim); notify('resources'); return currentResources(sim);
    },
    setBase(input = {}, options = {}) {
      const { side } = input; sideOf(side); const sim = battle();
      if(Object.keys(input).some(key=>!['side','hp','maxHp','damage','range','weaponSpeedFrames'].includes(key)) || Object.keys(input).length<2)throw new TypeError('Unknown or empty crystal edit');
      if(Object.hasOwn(input,'hp')) { const hp=clampFinite(input.hp),base=side==='left'?sim.redBoss:sim.blueBoss; if(base.nowHP<=0 && hp>0)throw new Error('已毁水晶不能通过当前生命编辑复活；请开始新局'); }
      const edits = [];
      if(Object.hasOwn(input,'maxHp'))edits.push([`config.sides.${side}.base.hp`,input.maxHp]);
      if(Object.hasOwn(input,'range'))edits.push([`config.sides.${side}.base.range`,input.range]);
      const aiDifficulty = sim.dualAI ? sim.dualAI.options.applyDifficultyStats ? sim.dualAI.options[`${side}Difficulty`] : 1 : null;
      const usesDifficulty = side === 'right' || aiDifficulty !== null;
      const attackPrefix=usesDifficulty?`config.difficulties.${aiDifficulty ?? sim.difficulty}`:'config.rules';
      if(Object.hasOwn(input,'damage')) { if(!Array.isArray(input.damage)||input.damage.length!==2)throw new TypeError('Two damage values required'); for(let i=0;i<2;i++)edits.push([`${attackPrefix}.${usesDifficulty?'blueBaseDamage':'baseDamage'}.${i}`,input.damage[i]]); }
      if(Object.hasOwn(input,'weaponSpeedFrames'))edits.push([`${attackPrefix}.${usesDifficulty?'blueBaseWeaponSpeedFrames':'baseWeaponSpeedFrames'}`,input.weaponSpeedFrames]);
      if(edits.length)liveFields(edits,options);
      if(Object.hasOwn(input,'hp'))api.setResources({side,baseHp:input.hp});
      return currentResources(sim);
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
      const sim = battle();
      if (sim.dualAI) throw new Error('双 AI 对战固定启用双方 AI；请使用各方出兵开关。');
      enableCustom(sim); behaviorBySimulation.get(sim).enemyAi = enabled;
      applied.rules.enemyAi = enabled; notify('enemy-ai');
    },
  };
  return Object.freeze(api);
}
