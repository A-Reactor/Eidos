import type { ChapterBasis, ChapterDecision, ChapterEvidenceRef, ChapterExperience, ChapterPlan, ChapterPreparation, ChapterSignal, ChapterState } from './types';

type ObjectValue = Record<string, unknown>;
function record(v: unknown): ObjectValue {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('对象无效');
  if (Object.keys(v).some(k => ['__proto__', 'constructor', 'prototype'].includes(k))) throw new Error('保留字段');
  return v as ObjectValue;
}
function text(v: unknown, empty = false): string {
  if (typeof v !== 'string' || (!empty && !v.trim())) throw new Error('文字无效');
  return v;
}
function id(v: unknown): string {
  const s = text(v);
  if (['__proto__', 'constructor', 'prototype'].includes(s)) throw new Error('标识无效');
  return s;
}
function number(v: unknown): number {
  if (!Number.isSafeInteger(v) || (v as number) < 0) throw new Error('序号无效');
  return v as number;
}
function list<T>(v: unknown, parse: (v: unknown) => T): T[] {
  if (!Array.isArray(v)) throw new Error('数组无效');
  return v.map(parse);
}
function strings(v: unknown): string[] { return list(v ?? [], x => text(x)); }
function oneOf<T extends string>(v: unknown, values: readonly T[]): T {
  if (!values.includes(v as T)) throw new Error('类型无效');
  return v as T;
}
function unique<T extends { id: string }>(values: T[]): T[] {
  if (new Set(values.map(v => v.id)).size !== values.length) throw new Error('重复标识');
  return values;
}
function refs(v: unknown): ChapterEvidenceRef[] {
  return list(v ?? [], x => { const r = record(x); return { actionId: id(r.actionId), segment: number(r.segment) }; });
}
function plan(v: unknown): ChapterPlan {
  const r = record(v);
  return { id: id(r.id), title: text(r.title), kind: text(r.kind), focus: text(r.focus), stage: text(r.stage ?? '', true),
    cast: list(r.cast ?? [], x => { const c = record(x); return { name: text(c.name), desire: text(c.desire ?? '', true), tension: text(c.tension ?? '', true) }; }),
    material: strings(r.material), possibilities: strings(r.possibilities), closure: strings(r.closure), threadIds: strings(r.threadIds) };
}
function memories(r: ObjectValue): Pick<ChapterDecision, 'threads' | 'promises' | 'relationships' | 'candidates'> {
  return {
    threads: unique(list(r.threads ?? [], x => { const t = record(x); return { id: id(t.id), title: text(t.title), kind: text(t.kind), question: text(t.question),
      status: oneOf(t.status, ['open', 'paused', 'resolved', 'abandoned'] as const), characters: strings(t.characters), note: text(t.note ?? '', true), evidence: refs(t.evidence) }; })),
    promises: unique(list(r.promises ?? [], x => { const p = record(x); return { id: id(p.id), text: text(p.text),
      status: oneOf(p.status, ['open', 'paid_off', 'dropped'] as const), evidence: refs(p.evidence) }; })),
    relationships: unique(list(r.relationships ?? [], x => { const p = record(x); return { id: id(p.id), characters: strings(p.characters),
      change: text(p.change), unresolved: text(p.unresolved ?? '', true), evidence: refs(p.evidence) }; })),
    candidates: unique(list(r.candidates ?? [], x => { const p = record(x); return { id: id(p.id), title: text(p.title), focus: text(p.focus),
      grounds: text(p.grounds), characters: strings(p.characters), invalidatedBy: text(p.invalidatedBy ?? '', true) }; })),
  };
}
export function parseChapterDecision(value: unknown): ChapterDecision | null {
  try {
    const r = record(value);
    const move = oneOf(r.move, ['continue', 'revise', 'transition', 'resume', 'complete', 'suspend', 'merge'] as const);
    const chapter = r.chapter === undefined ? undefined : plan(r.chapter);
    const targetId = r.targetId === undefined ? undefined : id(r.targetId);
    if (['revise', 'transition', 'merge'].includes(move) && !chapter || move === 'resume' && !targetId) return null;
    return { move, reason: text(r.reason), evidence: refs(r.evidence), ...memories(r),
      ...(chapter ? { chapter } : {}), ...(targetId ? { targetId } : {}),
      ...(r.previousStatus === undefined ? {} : { previousStatus: oneOf(r.previousStatus, ['completed', 'suspended', 'merged'] as const) }),
      ...(r.recap === undefined ? {} : { recap: text(r.recap, true) }) };
  } catch { return null; }
}
export function parseChapterBasis(value: unknown): ChapterBasis | null {
  try { const r = record(value); return { worldId: id(r.worldId), revision: number(r.revision), lastActionId: r.lastActionId === null ? null : id(r.lastActionId) }; }
  catch { return null; }
}
export function parseChapterPreparation(value: unknown): ChapterPreparation | null {
  try { const r = record(value), basis = parseChapterBasis(r.basis), decision = parseChapterDecision(r.decision); return basis && decision ? { basis, decision } : null; }
  catch { return null; }
}
export function parseChapterSignal(value: unknown): ChapterSignal | undefined {
  try { const r = record(value); return { reason: oneOf(r.reason, ['turn', 'departure', 'closure', 'stalled', 'return', 'new_focus'] as const), note: text(r.note), segments: list(r.segments ?? [], number) }; }
  catch { return undefined; }
}
function experience(value: unknown): ChapterExperience {
  const r = record(value), signal = parseChapterSignal(r.signal);
  return { actionId: id(r.actionId), chapterId: r.chapterId === null ? null : id(r.chapterId), input: text(r.input, true),
    inputSource: oneOf(r.inputSource, ['player', 'choice', 'continue', 'automatic', 'unknown'] as const), sceneId: text(r.sceneId, true),
    summary: text(r.summary, true), segments: list(r.segments, x => text(x, true)),
    perspective: oneOf(r.perspective, ['protagonist', 'reader'] as const), ...(signal ? { signal } : {}) };
}
export function parseChapterState(value: unknown): ChapterState | null {
  try {
    const r = record(value);
    if (r.version !== 1) return null;
    const chapters = unique(list(r.chapters, x => { const c = record(x); return { ...plan(c),
      status: oneOf(c.status, ['active', 'suspended', 'completed', 'merged'] as const), openedAt: text(c.openedAt, true),
      ...(c.closedAt === undefined ? {} : { closedAt: id(c.closedAt) }), summary: text(c.summary, true), experienceIds: strings(c.experienceIds) }; }));
    const activeId = r.activeId === null ? null : id(r.activeId);
    if (activeId && !chapters.some(c => c.id === activeId)) return null;
    if (chapters.filter(c => c.status === 'active').some(c => c.id !== activeId)) return null;
    const experiences = list(r.experiences, experience);
    if (new Set(experiences.map(e => e.actionId)).size !== experiences.length) return null;
    if (experiences.some(e => e.chapterId && !chapters.some(c => c.id === e.chapterId))) return null;
    const pending = r.pending === undefined ? undefined : parseChapterPreparation(r.pending);
    if (r.pending !== undefined && !pending) return null;
    const needsPlanning = parseChapterSignal(r.needsPlanning);
    const state: ChapterState = { version: 1, worldId: id(r.worldId), revision: number(r.revision), activeId, chapters, ...memories(r), experiences,
      events: list(r.events, x => { const e = record(x); return { actionId: id(e.actionId), move: oneOf(e.move, ['continue', 'revise', 'transition', 'resume', 'complete', 'suspend', 'merge'] as const),
        from: e.from === null ? null : id(e.from), to: e.to === null ? null : id(e.to), reason: text(e.reason), evidence: refs(e.evidence) }; }),
      ...(pending ? { pending } : {}), ...(needsPlanning ? { needsPlanning } : {}) };
    const evidence = [...state.threads, ...state.promises, ...state.relationships, ...state.events].flatMap(item => item.evidence);
    if (evidence.some(ref => !experiences.find(e => e.actionId === ref.actionId)?.segments[ref.segment]?.trim())) return null;
    const byAction = new Map(experiences.map(e => [e.actionId, e]));
    if (chapters.some(c => new Set(c.experienceIds).size !== c.experienceIds.length || c.experienceIds.some(action => byAction.get(action)?.chapterId !== c.id))) return null;
    if (experiences.some(e => e.chapterId && !chapters.find(c => c.id === e.chapterId)?.experienceIds.includes(e.actionId))) return null;
    if (state.events.some(e => !byAction.has(e.actionId) || e.from && !chapters.some(c => c.id === e.from) || e.to && !chapters.some(c => c.id === e.to))) return null;
    return state;
  } catch { return null; }
}
