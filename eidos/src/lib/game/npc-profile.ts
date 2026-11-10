import type { StoreApi } from 'zustand';
import type { GameStore } from '@/store/game-store';
import { quickHash } from './cas-storage';
import { normalizeNpcDescription } from './npc-description';
import { parseNpcSpeechProfile, type NpcSpeechProfile } from './npc-speech';
import type { WebSource } from './web-context';

export interface NpcProfileProposal { npcName: string; description: string; reason: string; speechProfile?: NpcSpeechProfile }
export interface NpcProfileChange extends NpcProfileProposal {
  operationId: string; worldId: string; basis: string; reviewedBy: 'KEI'; reviewReason: string; sources: WebSource[];
}
export interface AuthoredNpcProfile { description: string; operationId: string; reviewedBy: 'KEI'; reviewReason: string; sources: WebSource[] }
export type NpcProfileSource = Pick<GameStore, 'currentWorld' | 'npcPersonalities' | 'encyclopedia'>;
/** Only explicit edit-and-review requests require a receipt; ordinary character discussion remains narrative. */
export function requestsNpcProfileChange(input: string): boolean {
  const text = input.normalize('NFKC');
  return /(?:KEI|审核)/iu.test(text) && /(?:补充|修改|改编|调整|重写|完善)[^。！？\n]{0,80}(?:人设|人物设定|角色设定|言语档案|说话方式)/u.test(text)
    && !/(?:不要|不必|无需|不用|禁止|别)[^。！？\n]{0,8}(?:补充|修改|改编|调整|重写|完善)/u.test(text);
}
const record = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('人设提案须为对象');
  return value as Record<string, unknown>;
};
export function profileText(value: unknown, max: number, optional = false): string {
  if (optional && value === undefined) return '';
  if (typeof value !== 'string' || !optional && !value.trim() || value.length > max) throw new Error('人设提案文本无效或过长');
  return value.trim();
}
export function parseNpcProfileProposal(value: unknown): NpcProfileProposal {
  const raw = record(value), npcName = profileText(raw.npcName, 160);
  if (['__proto__', 'constructor', 'prototype'].includes(npcName)) throw new Error('人物名无效');
  const speechProfile = parseNpcSpeechProfile(raw.speechProfile);
  if (raw.speechProfile !== undefined && !speechProfile) throw new Error('言语档案格式不完整，请提交完整档案');
  return { npcName, description: profileText(raw.description, 6000), reason: profileText(raw.reason, 1000), ...(speechProfile ? { speechProfile } : {}) };
}
export function npcProfileDescription(source: NpcProfileSource, name: string): string {
  return source.npcPersonalities[name]?.authoredProfile?.description || normalizeNpcDescription(source.currentWorld?.npcs?.[name])
    || source.encyclopedia.find(entry => entry.type === 'npc' && entry.name === name)?.description || '';
}
export function npcProfileBasis(source: NpcProfileSource, name: string): string {
  return quickHash([source.currentWorld?.id, name, npcProfileDescription(source, name), source.npcPersonalities[name]?.authoredProfile,
    source.encyclopedia.find(entry => entry.type === 'npc' && entry.name === name)?.description, source.npcPersonalities[name]?.speechProfile]);
}
/** The immutable receipt is checked again after local I/O; old approvals cannot overwrite a newer edit. */
export function assertNpcProfileChanges(source: NpcProfileSource, changes: readonly NpcProfileChange[] = []): void {
  if (!Array.isArray(changes) || changes.length > 8) throw new Error('人设变更回执无效');
  const names = new Set<string>();
  for (const change of changes) {
    parseNpcProfileProposal(change);
    if (change.reviewedBy !== 'KEI' || !change.operationId || change.worldId !== source.currentWorld?.id ||
      change.basis !== npcProfileBasis(source, change.npcName) || names.has(change.npcName)) throw new Error('人设已变化或审核回执失效，请重新提交审核');
    names.add(change.npcName);
  }
}
/** Commit only at action acceptance. Branch snapshots own overrides; reusable world seeds stay unchanged. */
export function commitNpcProfileChanges(store: StoreApi<GameStore>, changes: readonly NpcProfileChange[] = []): void {
  assertNpcProfileChanges(store.getState(), changes);
  for (const change of changes) {
    // Author approval changes the simulation profile, not what the player has learned in the story.
    store.getState().ensurePersonality(change.npcName, change.description, false);
    store.setState(state => ({ npcPersonalities: { ...state.npcPersonalities, [change.npcName]: { ...state.npcPersonalities[change.npcName],
      ...(change.speechProfile ? { speechProfile: change.speechProfile } : {}),
      authoredProfile: { description: change.description, operationId: change.operationId, reviewedBy: change.reviewedBy, reviewReason: change.reviewReason, sources: change.sources },
    } } }));
  }
}
