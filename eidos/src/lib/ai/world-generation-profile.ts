import { WORLD_CREATION_SYSTEM_PROMPT, TIMELINE_SIMULATION_PROMPT } from './prompt-templates';

export type WorldGenerationProfile = 'full' | 'quick';
export const normalizeGenerationProfile = (value: unknown): WorldGenerationProfile => value === 'quick' ? 'quick' : 'full';

/** Reduce the requested content itself; cutting tokens would leave broken JSON and references. */
export function compactWorldPrompt(prompt: string, profile?: WorldGenerationProfile): string {
  if (profile !== 'quick') return prompt;
  return prompt
    .replaceAll('300-500字', '80-120字')
    .replaceAll('150-300字', '30-50字')
    .replaceAll('100-200字', '25-40字')
    .replaceAll('100-150字', '30-50字')
    .replaceAll('100-150 字', '30-50 字')
    .replaceAll('通常提供 3–6 个', '通常提供 1–3 个')
    .replaceAll('50-100字', '15-25字')
    .replaceAll('30-80字', '15-25字')
    .replaceAll('5-8 个', '2 个')
    .replaceAll('至少设计 12-18 条线索', '设计 2–3 条线索')
    .replaceAll('至少3个核心矛盾', '1个核心矛盾') + `

## 快速生成预算
本次为快速生成：文本信息量目标不超过完整生成的 35%（低于 40%）。优先建立可立即游玩的最小世界。
只生成 1–2 个区域、合计 3–4 个相连场景、2–3 位关键 NPC、1 个核心矛盾、2 条历史、2–3 条线索。
每项描述只写动机、冲突和行动所需的事实，一至两句，不扩写背景、氛围或支线，不重复事实。
保留既有 JSON 字段和类型、地图连接与引用有效性、原作事实优先级以及选定玩法的必要规则。
以上数量和短文本预算替代其他指南中的丰富度和最低数量要求；玩家素材仅作为事实来源，不逐句复述。`;
}

export function worldCreationPrompt(profile?: WorldGenerationProfile): string {
  return compactWorldPrompt(WORLD_CREATION_SYSTEM_PROMPT, profile);
}

export function timelineCreationPrompt(profile?: WorldGenerationProfile): string {
  if (profile !== 'quick') return TIMELINE_SIMULATION_PROMPT;
  return TIMELINE_SIMULATION_PROMPT
    .replace('至少 20-30 个事件', '只生成 6–8 个事件')
    .replace('80-150字', '20-35字')
    .replace('50-100字', '10-20字') + '\n快速推演：覆盖开局、冲突、转折与新常态；每个事件最多一条连锁效应。文本信息量不超过完整推演的 35%，不要为了覆盖所有日期追加事件。';
}
