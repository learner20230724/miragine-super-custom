/** Original-game menu geometry. Rendering and hit-testing share these stage pixels. */
export const DUAL_AI_DIFFICULTIES = Object.freeze(['简单', '普通', '困难', '不可战胜']);
const DIFFICULTY_SOURCES = Object.freeze(['bn_easy', 'bn_normal', 'bn_hard', 'bn_abyss']);
const rect = (left, top, width, height, item) => ({ ...item, left, top, right: left + width, bottom: top + height });

export function dualAIMenuItems({ panel, options = {}, progress = 1 } = {}) {
  if (panel === 'home') return [rect(212, 328, 227, 46,
    { action: 'dual-ai', source: 'bn_creadit', label: '双 AI 对战', textOverride: true, interactive: true })];
  if (panel !== 'dual-ai') return [];
  const p = Math.max(0, Math.min(1, Number.isFinite(progress) ? progress : 0));
  const items = [];
  for (const [side, target] of [['left', 44], ['right', 369]]) for (let value = 0; value < 4; value++) {
    const left = 212 + (target - 212) * p;
    items.push(rect(left, [200, 256, 312, 368][value], 227, 46, {
      action: `dual-ai-${side}`, side, value, source: DIFFICULTY_SOURCES[value], label: DUAL_AI_DIFFICULTIES[value],
      selected: value === (options[`${side}Difficulty`] ?? 1), interactive: p === 1,
    }));
  }
  items.push(rect(206.5, 420, 227, 46, { action: 'dual-ai-start', source: 'bn_sp', label: '开始对战', textOverride: true, interactive: p === 1 }));
  items.push(rect(78.3, 433.55, 31.85, 18.5, { action: 'dual-ai-back', source: 'bn_back', label: '返回', interactive: p === 1 }));
  const apply = options.applyDifficultyStats ?? true;
  items.push(rect(478, 425, 144, 36, { action: 'dual-ai-stats', source: null,
    label: `数值加成：${apply ? '开启' : '关闭'}`, value: !apply, interactive: p === 1 }));
  return items;
}

export function menuButtonState(item, pointer, pressed) {
  const inside = pointer && pointer.x >= item.left && pointer.x < item.right && pointer.y >= item.top && pointer.y < item.bottom;
  if (inside && pressed?.action === item.action && pressed.value === item.value) return 'pressed';
  return inside || item.selected ? 'hover' : 'normal';
}
