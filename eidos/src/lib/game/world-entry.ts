import type { IdentityOption, WorldDefinition, WorldSnapshot } from './types';

export interface WorldEntryContext {
  version: 1;
  worldId: string;
  source: 'preset' | 'custom' | 'card';
  identityId: string | null;
  canonicalName: string;
  playerName: string;
  identityDescription: string;
  startingSceneId: string;
  openingNarrative: string;
}
export function buildEntryContext({ world, playerName, startingSceneId, option, customIdentity }: {
  world: Pick<WorldDefinition, 'id' | 'sourceMode'>; playerName: string; startingSceneId: string; option?: IdentityOption; customIdentity?: string;
}): WorldEntryContext {
  const custom = customIdentity?.trim();
  return { version: 1, worldId: world.id, source: custom ? 'custom' : world.sourceMode === 'external_cards' ? 'card' : 'preset',
    identityId: custom ? null : option?.id ?? null, canonicalName: custom ? playerName : option?.name ?? playerName,
    playerName, identityDescription: custom || option?.description || '', startingSceneId,
    openingNarrative: custom || world.sourceMode === 'external_cards' ? '' : option?.openingNarrative ?? '' };
}
export function parseEntryContext(value: unknown, worldId?: string): WorldEntryContext | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (v.version !== 1 || !['preset', 'custom', 'card'].includes(String(v.source)) || typeof v.worldId !== 'string' || worldId !== undefined && v.worldId !== worldId || v.identityId !== null && typeof v.identityId !== 'string') return null;
  if (['canonicalName', 'playerName', 'identityDescription', 'startingSceneId', 'openingNarrative'].some(key => typeof v[key] !== 'string')) return null;
  return { version: 1, worldId: v.worldId, source: v.source as WorldEntryContext['source'], identityId: v.identityId as string | null,
    canonicalName: v.canonicalName as string, playerName: v.playerName as string, identityDescription: v.identityDescription as string, startingSceneId: v.startingSceneId as string, openingNarrative: v.openingNarrative as string };
}
export function entryContextPrompt(value: unknown, worldId: string): string {
  const entry = parseEntryContext(value, worldId);
  if (!entry) return '';
  return `\n## 本周目入场上下文\n${JSON.stringify(entry)}\n这是当前玩家选择的身份，不是其他候选身份的经历。世界概述、场景初始描述和旧身份提示中的默认主角经历只是背景资料，不自动成为本角色的记忆或已发生行动。原身份名与玩家使用名表示同一角色，不再生成一个独立的同名 NPC 与自己交谈；开场原文中的名称不做全局替换。已展示的该身份开场与本周目已接受历史优先维持连续性，不搬用其他角色的第一人称经历，也不在后续轮次重新开场。\n${entry.source === 'custom' ? '自定义身份尚无预写抵达经历；首次观察时结合身份背景、当前合法起点及世界环境生成实际衔接，不声称玩家已经经历了默认主角的开场。' : entry.source === 'card' ? '首次观察遵循所选身份及原始卡片的首段材料；参考范例不是本周目已发生历史。' : '首次观察承接 openingNarrative 的最后时刻及当前起点，不从头复述整段开场；开场未明确发生的行动仍留给玩家决定。'}`;
}
/** Import allocates a new world ID; only this explicit boundary may rebind an existing entry. */
export function rebaseEntryContext(value: unknown, sourceWorldId: string, targetWorldId: string): WorldEntryContext | null {
  const entry = parseEntryContext(value, sourceWorldId);
  return entry ? { ...entry, worldId: targetWorldId } : null;
}

export const INITIAL_WORLD_OBSERVATION = '（进入世界，观察周围）';

/** Failed first attempts can retry; accepted observations increase history and stop registration. */
export function isInitialWorldObservation(input: string, snapshot: WorldSnapshot): boolean {
  return input === INITIAL_WORLD_OBSERVATION && Number.isInteger(snapshot.historyLength)
    && snapshot.historyLength >= 0 && snapshot.historyLength <= 1 && (snapshot.inventory?.length ?? 0) === 0;
}
