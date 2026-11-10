import { describe, expect, it } from 'vitest';
import { acceptChapterAction, chapterBasis, chapterBeat, createChapterState, prepareChapterDraft, validateChapterPreparation } from '@/lib/game/chapters/state';
import { parseChapterDecision, parseChapterState } from '@/lib/game/chapters/validation';
import { chapterContextForModel } from '@/lib/game/chapters/context';
import type { ChapterDecision, ChapterPreparation, ChapterState } from '@/lib/game/chapters/types';
import { clockChapter, openChapter } from './chapter-fixtures';

const world = { id: 'city', gameplayPlugins: [{ id: 'chapter-narrative', prompts: { creation: '', action: '', review: '' }, rules: [] }] };
const prepare = (state: ChapterState, decision = openChapter()): ChapterPreparation => ({ basis: chapterBasis('city', state), decision });
const accept = (state: ChapterState, actionId: string, preparation?: ChapterPreparation, extra = {}) => acceptChapterAction({
  worldId: 'city', state, actionId, input: '归还挂钟', inputSource: 'player', sceneId: 'shop',
  segments: [{ type: 'narration' as const, text: '他接过修好的钟，认真道谢，然后离开。' }],
  summary: '挂钟归还，顾客离开', preparation, ...extra,
});
const first = () => { const state = createChapterState('city'); return accept(state, 'a1', prepare(state)); };
const ref = { actionId: 'a1', segment: 0 };

describe('branch-local chapter experience', () => {
  it('keeps preparation speculative until the associated action is accepted exactly once', () => {
    const state = createChapterState('city'), preparation = prepare(state);
    const draft = prepareChapterDraft(state, preparation.decision);
    expect(state.chapters).toEqual([]);
    expect(draft.chapters[0].title).toBe('一只走错的钟');
    const accepted = accept(state, 'a1', preparation);
    expect(accepted.activeId).toBe('clock');
    expect(accepted.chapters[0].openedAt).toBe('a1');
    expect(accepted.experiences[0].segments).toEqual(['他接过修好的钟，认真道谢，然后离开。']);
    expect(accept(accepted, 'a1', preparation)).toEqual(accepted);
    expect(state.chapters).toEqual([]);
  });
  it('records ALICE closure as a request, not a completed chapter', () => {
    const state = accept(first(), 'a2', undefined, { signal: { reason: 'closure', note: '承诺已回应', segments: [0] } });
    expect(state.chapters[0].status).toBe('active');
    expect(state.needsPlanning?.reason).toBe('closure');
    expect(chapterBeat(state)?.boundary).toBeUndefined();
  });
  it('requires real accepted evidence before closing and opening a successor', () => {
    const state = first();
    const next = { ...clockChapter, id: 'farewell', title: '街口再见', focus: '离别之后怎样继续生活', kind: 'relationship' };
    const decision: ChapterDecision = { ...openChapter(next), previousStatus: 'completed', evidence: [ref], reason: '顾客已经收下挂钟并离开', recap: '修理承诺已履行' };
    const accepted = accept(state, 'a2', prepare(state, decision));
    expect(accepted.chapters.map(c => [c.id, c.status])).toEqual([['clock', 'completed'], ['farewell', 'active']]);
    expect(accepted.events.at(-1)).toMatchObject({ actionId: 'a2', from: 'clock', to: 'farewell', evidence: [ref] });
    expect(() => accept(state, 'a2', prepare(state, { ...decision, evidence: [{ actionId: 'future', segment: 0 }] }))).toThrow(/证据/);
    expect(() => accept(state, 'a2', prepare(state, { ...decision, evidence: [] }))).toThrow(/证据/);
  });
  it('preserves a suspended line and resumes the same chapter without replaying its opening', () => {
    const state = first();
    const away = accept(state, 'a2', prepare(state, { ...openChapter({ ...clockChapter, id: 'garden', kind: 'daily', title: '院里的草', focus: '种菜' }), previousStatus: 'suspended', evidence: [ref] }));
    const resumed = accept(away, 'a3', prepare(away, { ...openChapter(), move: 'resume', chapter: undefined, targetId: 'clock', previousStatus: 'suspended', evidence: [{ actionId: 'a2', segment: 0 }], reason: '主动回到钟表铺' }));
    expect(resumed.chapters).toHaveLength(2);
    expect(resumed.chapters.find(c => c.id === 'clock')).toMatchObject({ status: 'active', openedAt: 'a1', experienceIds: ['a1', 'a3'] });
  });
  it('allows a relationship chapter to become mainline and records merge without rewriting old experience', () => {
    const state = first();
    const merged = accept(state, 'a2', prepare(state, { ...openChapter({ ...clockChapter, id: 'neighborhood', kind: 'main', title: '街坊之间', focus: '修理铺成为互助中心' }), move: 'merge', previousStatus: 'merged', evidence: [ref] }));
    expect(merged.chapters[0].status).toBe('merged');
    expect(merged.chapters[1].kind).toBe('main');
    expect(merged.experiences[0].chapterId).toBe('clock');
    expect(state.activeId).toBe('clock');
  });
  it('rejects a prepared response from another world or an older accepted action', () => {
    const state = first(), pending = prepare(state, { ...openChapter(), move: 'continue', chapter: undefined });
    expect(() => validateChapterPreparation(accept(state, 'a2'), pending, 'city')).toThrow(/失效/);
    expect(() => validateChapterPreparation(state, pending, 'other')).toThrow(/失效/);
  });
  it('tracks promises and relationships only with evidence and never mutates world knowledge', () => {
    const state = first();
    const decision: ChapterDecision = { ...openChapter(), move: 'continue', chapter: undefined, evidence: [ref],
      promises: [{ id: 'return-clock', text: '归还挂钟', status: 'paid_off', evidence: [ref] }],
      relationships: [{ id: 'craft-customer', characters: ['钟表匠', '顾客'], change: '顾客道谢', unresolved: '下次是否还会见面', evidence: [ref] }],
    };
    const accepted = accept(state, 'a2', prepare(state, decision), { frame: { kind: 'cutaway' } });
    expect(accepted.promises[0].status).toBe('paid_off');
    expect(accepted.relationships[0].change).toBe('顾客道谢');
    expect(accepted.experiences[1].perspective).toBe('reader');
    expect(accepted).not.toHaveProperty('criticalFacts');
    expect(() => accept(state, 'a2', prepare(state, { ...decision, relationships: [{ ...decision.relationships[0], evidence: [{ actionId: 'a1', segment: 4 }] }] }))).toThrow(/证据/);
  });
  it('restores an independent state and rejects corrupt identities or prototype keys', () => {
    const state = first(), saved = parseChapterState(JSON.parse(JSON.stringify(state)))!;
    saved.chapters[0].title = '独立分支';
    expect(state.chapters[0].title).toBe('一只走错的钟');
    expect(parseChapterState({ ...state, activeId: 'missing' })).toBeNull();
    expect(parseChapterDecision({ ...openChapter(), chapter: { ...clockChapter, id: '__proto__' } })).toBeNull();
    expect(parseChapterState(undefined)).toBeNull();
  });
  it('keeps stored experiences while selecting relevant context and labeling reader-only evidence', () => {
    let state = first();
    for (let i = 2; i < 25; i++) state = accept(state, `a${i}`, undefined, { frame: { kind: 'cutaway' }, inputSource: 'automatic' });
    const text = chapterContextForModel(world as never, { chapterState: state, currentSceneId: 'shop', worldFlags: {} } as never, '钟表匠');
    expect(state.experiences).toHaveLength(24);
    expect(text).toContain('reader');
    expect(text).toContain('automatic');
    expect(text).toContain('一只走错的钟');
    expect(text.length).toBeLessThan(JSON.stringify(state).length);
  });
  it('records disabled-period experience without advancing the old chapter, then requests reconciliation', () => {
    const state = first();
    const disabled = accept(state, 'a2', undefined, { enabled: false, input: '离开城市' });
    expect(disabled.chapters).toEqual(state.chapters);
    expect(disabled.experiences.at(-1)?.chapterId).toBeNull();
    expect(disabled.needsPlanning?.reason).toBe('return');
    expect(disabled.revision).toBe(state.revision);
    expect(parseChapterState(disabled)).toEqual(disabled);
  });
  it('rejects a corrupted saved chapter whose experience membership references another branch', () => {
    const state = first(); state.chapters[0].experienceIds.push('another-branch');
    expect(parseChapterState(state)).toBeNull();
  });

});
