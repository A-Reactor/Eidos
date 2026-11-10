import type { ActionOperationReceipt } from './action-operations';
import type { TokenUsage } from '@/lib/ai/types';
import { parseNpcProfileProposal, npcProfileBasis, npcProfileDescription, profileText, type NpcProfileProposal, type NpcProfileSource } from './npc-profile';
import { uniqueWebSources, type WebSource } from './web-context';

export interface NpcProfileReviewInput {
  proposal: NpcProfileProposal; playerInput: string; worldId: string; worldName: string; worldOverview: string; currentDescription: string; sources: WebSource[];
}
export const PROFILE_SETTING_KEYS = ['keiProviderId', 'keiApiKey', 'keiEndpoint', 'keiModel', 'keiEnableReasoning', 'keiReasoningEffort', 'keiContextWindowTokens'] as const;
export function parseNpcProfileReviewInput(value: unknown): NpcProfileReviewInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('人设审核材料无效');
  const raw = value as Record<string, unknown>;
  if (!Array.isArray(raw.sources) || raw.sources.length > 80) throw new Error('人设审核来源无效');
  return { proposal: parseNpcProfileProposal(raw.proposal), playerInput: profileText(raw.playerInput, 8000), worldId: profileText(raw.worldId, 512),
    worldName: profileText(raw.worldName, 512), worldOverview: profileText(raw.worldOverview, 4000, true), currentDescription: profileText(raw.currentDescription, 6000, true),
    sources: uniqueWebSources(raw.sources as WebSource[]) };
}
export async function stageNpcProfileChange(options: {
  proposal: NpcProfileProposal; source: NpcProfileSource; playerInput: string; sources: WebSource[]; signal?: AbortSignal; settings?: Record<string, string> | null;
}): Promise<ActionOperationReceipt> {
  const { source, proposal, playerInput, signal } = options;
  try {
    const known = Object.hasOwn(source.currentWorld?.npcs ?? {}, proposal.npcName) || Object.hasOwn(source.npcPersonalities, proposal.npcName)
      || source.encyclopedia.some(entry => entry.type === 'npc' && entry.name === proposal.npcName);
    if (!source.currentWorld || !known) throw new Error('目标人物尚未建档，请使用真实人物名');
    const basis = npcProfileBasis(source, proposal.npcName);
    const material = parseNpcProfileReviewInput({ proposal, playerInput, worldId: source.currentWorld.id, worldName: source.currentWorld.name,
      worldOverview: source.currentWorld.overview.slice(0, 4000), currentDescription: npcProfileDescription(source, proposal.npcName), sources: options.sources });
    const settings = Object.fromEntries(Object.entries(options.settings ?? {}).filter(([key]) => (PROFILE_SETTING_KEYS as readonly string[]).includes(key)));
    const response = await fetch('/api/game/npc/profile', { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal,
      body: JSON.stringify({ ...material, _settings: settings }) });
    const reviewed = await response.json();
    signal?.throwIfAborted();
    const usage = reviewed.usage as TokenUsage | undefined;
    if (!response.ok || reviewed.approved !== true) return { method: 'npc.profile.update', status: 'failed', usage,
      error: typeof reviewed.reason === 'string' ? reviewed.reason : reviewed.error ?? 'KEI未批准人设变更；请修正具体问题后重新提交' };
    const operationId = crypto.randomUUID();
    return { method: 'npc.profile.update', status: 'staged', operationId, usage,
      npcProfile: { ...proposal, operationId, worldId: source.currentWorld.id, basis, reviewedBy: 'KEI', reviewReason: profileText(reviewed.reason, 2000), sources: material.sources },
      result: { reviewedBy: 'KEI', approved: true, applied: false, npcName: proposal.npcName, description: proposal.description,
        note: '实际KEI已审核；请在终局operationEffects选择此operationId，接受行动后才写入人设与NPC档案。' } };
  } catch (error) {
    signal?.throwIfAborted();
    return { method: 'npc.profile.update', status: 'failed', error: error instanceof Error ? error.message : '人设审核失败' };
  }
}
