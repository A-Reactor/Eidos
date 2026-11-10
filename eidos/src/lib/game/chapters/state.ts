import type { StorySegment } from '@/lib/ai/types';
import type { NarrativeBeat } from '../narrative-beat';
import type { ChapterBasis, ChapterDecision, ChapterEvidenceRef, ChapterInputSource, ChapterPreparation, ChapterState } from './types';
import { parseChapterDecision, parseChapterPreparation, parseChapterSignal } from './validation';

export function createChapterState(worldId: string): ChapterState {
  return { version: 1, worldId, revision: 0, activeId: null, chapters: [], threads: [], promises: [], relationships: [], candidates: [], experiences: [], events: [] };
}
export function chapterBasis(worldId: string, state?: ChapterState | null): ChapterBasis {
  return { worldId, revision: state?.revision ?? 0, lastActionId: state?.experiences.at(-1)?.actionId ?? null };
}
export function validateChapterPreparation(state: ChapterState | null | undefined, raw: unknown, worldId: string): ChapterPreparation {
  const p = parseChapterPreparation(raw), b = chapterBasis(worldId, state);
  if (!p || state && state.worldId !== worldId || p.basis.worldId !== b.worldId || p.basis.revision !== b.revision || p.basis.lastActionId !== b.lastActionId) {
    throw new Error('篇章准备已失效，请从当前进度重新行动');
  }
  prepareChapterDraft(state ?? createChapterState(worldId), p.decision);
  return p;
}
export function validateChapterEvidence(state: ChapterState, refs: ChapterEvidenceRef[], required = false): void {
  if (required && !refs.length || refs.some(ref => !state.experiences.find(e => e.actionId === ref.actionId)?.segments[ref.segment]?.trim())) {
    throw new Error('篇章调整缺少当前分支的有效正文证据');
  }
}
function upsert<T extends { id: string }>(previous: T[], updates: T[]): T[] {
  const values = new Map(previous.map(value => [value.id, value]));
  updates.forEach(value => values.set(value.id, structuredClone(value)));
  return [...values.values()];
}

/** A draft is local to a generation; only acceptChapterAction makes it part of a branch. */
export function prepareChapterDraft(previous: ChapterState, raw: ChapterDecision, actionId = ''): ChapterState {
  const decision = parseChapterDecision(raw);
  if (!decision) throw new Error('篇章决定格式无效');
  const state = structuredClone(previous), from = state.activeId, current = state.chapters.find(c => c.id === from);
  const { move, chapter } = decision;
  const changesChapter = ['transition', 'resume', 'complete', 'suspend', 'merge'].includes(move);
  validateChapterEvidence(state, decision.evidence, Boolean(current && changesChapter));
  for (const item of [...decision.threads, ...decision.promises, ...decision.relationships]) validateChapterEvidence(state, item.evidence, true);
  if (move === 'revise') {
    if (!current || chapter?.id !== current.id || current.status !== 'active') throw new Error('不能修订未进行中的篇章');
    Object.assign(current, chapter);
  } else if (move === 'complete' || move === 'suspend') {
    if (!current || current.status !== 'active') throw new Error('篇章已经结束或尚未开始');
    current.status = move === 'complete' ? 'completed' : 'suspended';
    current.closedAt = actionId;
  } else if (move === 'transition' || move === 'merge' || move === 'resume') {
    if (current?.status === 'active') {
      if (!decision.previousStatus) throw new Error('篇章切换须交代原篇章是完成还是暂别');
      current.status = move === 'merge' ? 'merged' : decision.previousStatus;
      current.closedAt = actionId;
    }
    if (move === 'resume') {
      const target = state.chapters.find(c => c.id === decision.targetId);
      if (!target || target.status !== 'suspended') throw new Error('只能接回已有的暂别篇章');
      target.status = 'active'; delete target.closedAt; state.activeId = target.id;
    } else {
      if (!chapter || state.chapters.some(c => c.id === chapter.id)) throw new Error('新篇章标识已存在');
      state.chapters.push({ ...chapter, status: 'active', openedAt: actionId, summary: '', experienceIds: [] });
      state.activeId = chapter.id;
    }
  } else if (!current) throw new Error('尚无篇章可继续');
  if (current && decision.recap !== undefined) current.summary = decision.recap;
  state.threads = upsert(state.threads, decision.threads);
  state.promises = upsert(state.promises, decision.promises);
  state.relationships = upsert(state.relationships, decision.relationships);
  // Candidates are an intentionally replaceable set of unrealized opportunities.
  state.candidates = structuredClone(decision.candidates);
  state.revision++;
  delete state.pending; delete state.needsPlanning;
  if (actionId) state.events.push({ actionId, move, from, to: state.activeId, reason: decision.reason, evidence: decision.evidence });
  return state;
}

interface AcceptChapterAction {
  worldId: string; state?: ChapterState | null; actionId: string; input: string;
  enabled?: boolean; inputSource?: ChapterInputSource; sceneId: string; segments: StorySegment[]; summary: string;
  frame?: { kind: string }; preparation?: ChapterPreparation | null; signal?: unknown;
}
export function acceptChapterAction(input: AcceptChapterAction): ChapterState {
  const previous = input.state?.worldId === input.worldId ? input.state : createChapterState(input.worldId);
  if (previous.experiences.some(e => e.actionId === input.actionId)) return previous;
  let state = structuredClone(previous);
  if (input.preparation && input.enabled !== false) {
    const prepared = validateChapterPreparation(state, input.preparation, input.worldId);
    state = prepareChapterDraft(state, prepared.decision, input.actionId);
  }
  const signal = parseChapterSignal(input.signal);
  const acceptedSignal = signal?.segments.every(i => Boolean(input.segments[i]?.text?.trim())) ? signal : undefined;
  state.experiences.push({ actionId: input.actionId, chapterId: input.enabled === false ? null : state.activeId, input: input.input,
    inputSource: input.inputSource ?? 'unknown', sceneId: input.sceneId, summary: input.summary,
    segments: input.segments.map(s => s.text), perspective: input.frame?.kind === 'cutaway' ? 'reader' : 'protagonist',
    ...(acceptedSignal ? { signal: acceptedSignal } : {}) });
  const chapter = state.chapters.find(c => c.id === state.activeId);
  if (chapter && input.enabled !== false) chapter.experienceIds.push(input.actionId);
  if (acceptedSignal) state.needsPlanning = acceptedSignal;
  if (input.enabled === false) state.needsPlanning = { reason: 'return', note: '篇章停用期间已有新经历；启用后先重新核对当前处境。', segments: [] };
  return state;
}

export function chapterBeat(state?: ChapterState | null): NarrativeBeat | undefined {
  const chapter = state?.chapters.find(c => c.id === state.activeId);
  if (!chapter || !state) return undefined;
  const experience = state.experiences.at(-1);
  return { chapter: { id: chapter.id.slice(0, 160), title: chapter.title.slice(0, 160) }, recap: (chapter.summary || experience?.summary || '').slice(0, 2000),
    threads: state.threads.filter(t => t.status === 'open' || t.status === 'paused').slice(0, 16).map(t => t.question.slice(0, 240)),
    ...(chapter.status === 'completed' ? { boundary: 'chapter' as const } : {}) };
}
