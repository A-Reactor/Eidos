import { validateGameModeConfig } from './manifest';
import { record, text } from './validation';
import type { GameplayModState } from './mod-ui';
import type { PluginEvent } from './types';
import type { StorySegment } from '@/lib/ai/types';
import { parseTextEffects } from '../text-effects';

export const GAMEPLAY_STATE_KEY = '_eidosGameplay';
export interface GameplayReceipt {
  id: string; revision: number; summary: string; createdAt: number;
  narration: 'pending' | 'complete' | 'none';
}
export interface GameplayLedger { revision: number; facts: Record<string, unknown>; last: GameplayReceipt }
export interface GameplayOperation {
  playerInput?: string;
  segments?: StorySegment[];
  id: string; expectedRevision: number; summary: string; state: Record<string, unknown>;
  facts: Record<string, unknown>; events?: PluginEvent[]; narrate?: boolean;
}
/** Author prose is content, never a second collection of model state-update commands. */
export function authoredSegments(value: unknown): StorySegment[] {
  if (!Array.isArray(value) || !value.length || value.length > 128) throw new Error('作者正文须为 1–128 段');
  return value.map(raw => {
    const segment = record(raw);
    if (!['narration', 'dialogue'].includes(String(segment.type)) || typeof segment.text !== 'string' || !segment.text.trim()) throw new Error('作者正文类型或文本无效');
    if (segment.type === 'dialogue' && (typeof segment.speaker !== 'string' || !segment.speaker.trim())) throw new Error('作者正文缺少有效说话人');
    const speaker = segment.type === 'dialogue' ? text(segment.speaker, Infinity) : undefined;
    const textEffects = parseTextEffects(segment.textEffects);
    return { type: segment.type as StorySegment['type'], text: segment.text, ...(speaker ? { speaker } : {}), ...(textEffects ? { textEffects } : {}) };
  });
}
export interface GameplayModelContext {
  pluginId: string; revision: number; facts: Record<string, unknown>; result: GameplayReceipt;
}
export function gameplayLedger(state: Record<string, unknown>): GameplayLedger | undefined {
  const raw = state[GAMEPLAY_STATE_KEY];
  if (raw === undefined) return undefined;
  const ledger = record(raw), last = record(ledger.last);
  if (!Number.isSafeInteger(ledger.revision) || Number(ledger.revision) < 1 || last.revision !== ledger.revision
    || !['pending', 'complete', 'none'].includes(String(last.narration)) || typeof last.createdAt !== 'number' || !Number.isFinite(last.createdAt)) throw new Error('正式玩法结果账本无效');
  text(last.id, 160); text(last.summary, Infinity); record(ledger.facts);
  return ledger as unknown as GameplayLedger;
}
export function parseGameplayOperation(value: unknown): GameplayOperation {
  const input = record(value);
  if (!Number.isSafeInteger(input.expectedRevision) || Number(input.expectedRevision) < 0) throw new Error('玩法提交缺少有效的当前版本');
  const state = validateGameModeConfig(record(input.state ?? {}))!;
  const facts = validateGameModeConfig(record(input.facts ?? {}))!;
  if (input.narrate !== undefined && typeof input.narrate !== 'boolean') throw new Error('玩法续写选项无效');
  return { id: text(input.id, 160), expectedRevision: Number(input.expectedRevision), summary: text(input.summary, Infinity), state, facts,
    ...(input.playerInput === undefined ? {} : { playerInput: text(input.playerInput, Infinity) }),
    ...(input.events === undefined ? {} : { events: input.events as PluginEvent[] }), ...(input.narrate === undefined ? {} : { narrate: input.narrate }),
    ...(input.segments === undefined ? {} : { segments: authoredSegments(input.segments) }) };
}
/** Only the author's explicit fact view is model material; arbitrary UI state remains local. */
export function gameplayContextForModel(state: GameplayModState = {}): GameplayModelContext[] {
  return Object.entries(state).flatMap(([pluginId, author]) => {
    const ledger = gameplayLedger(author);
    return ledger ? [{ pluginId, revision: ledger.revision, facts: structuredClone(ledger.facts), result: { ...ledger.last } }] : [];
  });
}
/** Presentation messages may replace their own data, never the accepted result ledger or workspace. */
export function preserveGameplayLedger(current: Record<string, unknown>, next: Record<string, unknown>): Record<string, unknown> {
  const { [GAMEPLAY_STATE_KEY]: _untrusted, ...author } = next;
  return { ...author, ...(current[GAMEPLAY_STATE_KEY] === undefined ? {} : { [GAMEPLAY_STATE_KEY]: current[GAMEPLAY_STATE_KEY] }) };
}
export function completeGameplayNarration(state: GameplayModState, reference: { pluginId: string; id: string }): GameplayModState {
  const author = state[reference.pluginId] ?? {}, ledger = gameplayLedger(author);
  if (!ledger || ledger.last.id !== reference.id) throw new Error('玩法结果已变化，旧续写不能结算');
  return { ...state, [reference.pluginId]: { ...author, [GAMEPLAY_STATE_KEY]: { ...ledger, last: { ...ledger.last, narration: 'complete' } } } };
}
