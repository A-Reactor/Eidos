import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildRiftCityStartState } from '@/lib/test/fixtures';
import { parsePluginFile } from '@/lib/game/plugins/manifest';
import { processPlayerAction } from '@/lib/ai/action-handler';
import { callAi, subscribeKeiCorrection } from '@/lib/ai/client';
import { cancelKeiQueue, submitKeiReview, hasPendingKeiReviews } from '@/lib/ai/kei-review';
import { acceptChapterAction, chapterBasis } from '@/lib/game/chapters/state';
import { parseChapterState } from '@/lib/game/chapters/validation';
import { chapterContextForModel } from '@/lib/game/chapters/context';
import { clockChapter, openChapter } from '../game/chapter-fixtures';
import { makeResponse, usage } from './kei-fixtures';
import type { ChapterDecision, ChapterState } from '@/lib/game/chapters/types';
vi.mock('@/lib/ai/client', async original => ({ ...await original<typeof import('@/lib/ai/client')>(), callAi: vi.fn() }));
const settings = { keiApiKey: 'test', aliceApiKey: 'test' };
const installed = () => { const s = buildRiftCityStartState(); return { ...s, world: { ...s.world, gameplayPlugins: parsePluginFile(JSON.parse(readFileSync('mods/dist/chapter-narrative.eidos-plugin.json', 'utf8'))) } }; };

describe('a branching multi-chapter journey through actual generation', () => {
  it('carries departure, early payoff, character handoff, aftermath and return into two independent successor branches', async () => {
    const { world, snapshot } = installed(); let state: ChapterState | null = null;
    async function turn(id: string, input: string, prose: string, decision?: ChapterDecision) {
      vi.mocked(callAi).mockImplementation(async args => ({ usage, elapsedMs: 1,
        content: JSON.stringify(args.role === 'kei' ? decision : makeResponse({ segments: [{ type: 'narration', text: prose }], summary: prose, chapterSignal: { reason: 'turn', note: '请核对新的经历', segments: [0] } })) }));
      const response = await processPlayerAction({ world, snapshot: { ...snapshot, chapterState: state }, playerInput: input, clientSettings: settings });
      expect(state?.experiences.some(e => e.actionId === id)).not.toBe(true);
      state = acceptChapterAction({ worldId: world.id, state, actionId: id, input, sceneId: 'shop', inputSource: 'player', segments: response.segments,
        summary: response.summary, preparation: response.chapterPreparation, signal: response.chapterSignal });
      state = parseChapterState(JSON.parse(JSON.stringify(state)))!;
      expect(state).not.toBeNull();
      return response;
    }
    await turn('a1', '去看看挂钟', '钟表匠托你在顾客离城前归还挂钟。', openChapter());
    await turn('a2', '先去渡口找她', '你离开钟表铺，顾客正在渡口等船。', { ...openChapter({ ...clockChapter, id: 'wharf', title: '渡口的约定', kind: 'relationship' }), previousStatus: 'suspended', evidence: [{ actionId: 'a1', segment: 0 }] });
    await turn('a3', '直接问她并归还', '她收下钟，说搬家的原因是与妹妹团聚。', { ...openChapter(), move: 'continue', chapter: undefined });
    await turn('a4', '我来帮她打包', '妹妹赶来，两人一起收拾旧铺的招牌。', { ...openChapter({ ...clockChapter, id: 'sisters', title: '旧招牌', kind: 'daily', cast: [{ name: '妹妹', desire: '陪姐姐搬家', tension: '对旧店的不舍' }] }), previousStatus: 'completed', evidence: [{ actionId: 'a3', segment: 0 }],
      promises: [{ id: 'return-clock', text: '在离城前归还挂钟', status: 'paid_off', evidence: [{ actionId: 'a1', segment: 0 }, { actionId: 'a3', segment: 0 }] }],
      relationships: [{ id: 'sisters', characters: ['顾客', '妹妹'], change: '共同告别旧铺', unresolved: '新生活如何开始', evidence: [{ actionId: 'a3', segment: 0 }] }] });
    await turn('a5', '回钟表铺告诉师傅', '钟表匠听完点头，邀请你坐下喝茶。', { ...openChapter(), move: 'resume', chapter: undefined, targetId: 'clock', previousStatus: 'completed', evidence: [{ actionId: 'a4', segment: 0 }] });
    const fork = structuredClone(state!);
    const shared = fork.chapters.find(c => c.id === 'clock')!;
    expect(shared.openedAt).toBe('a1'); expect(shared.experienceIds).toEqual(['a1', 'a5']);
    const draftA = { ...openChapter({ ...clockChapter, id: 'city', title: '钟声之外', kind: 'main' }), previousStatus: 'completed' as const, evidence: [{ actionId: 'a5', segment: 0 }] };
    await turn('a6', '去追查异常来源', '你走向市政厅，准备查阅旧档。', draftA);
    const branchA = structuredClone(state!);
    state = structuredClone(fork);
    await turn('b6', '留下学修钟', '你留在铺里，从分辨齿轮开始学起。', { ...draftA, chapter: { ...clockChapter, id: 'apprentice', title: '从一枚齿轮开始', kind: 'relationship' } });
    expect(branchA.activeId).toBe('city'); expect(state!.activeId).toBe('apprentice');
    expect(state!.experiences.some(e => e.actionId === 'a6')).toBe(false);
    expect(chapterContextForModel(world, { ...snapshot, chapterState: state })).not.toContain('你走向市政厅');
    expect(state!.promises[0].status).toBe('paid_off');
    expect(state!.relationships[0].characters).toEqual(['顾客', '妹妹']);
    expect(snapshot.chapterState).toBeUndefined();
  });
  it('feeds accepted paragraph evidence to real background review and host-stamps the basis', async () => {
    cancelKeiQueue();
    const { world, snapshot } = installed();
    const state = acceptChapterAction({ worldId: world.id, actionId: 'a1', input: '归还', sceneId: 'shop', summary: '挂钟归还', segments: [{ type: 'narration', text: '她接过挂钟。' }], preparation: { basis: chapterBasis(world.id), decision: openChapter() } });
    const decision = { ...openChapter(), move: 'complete', chapter: undefined, evidence: [{ actionId: 'a1', segment: 0 }] };
    vi.mocked(callAi).mockResolvedValue({ content: JSON.stringify({ approved: true, corrections: '', chapterDecision: decision, _chapterBasis: { worldId: 'forged', revision: 999, lastActionId: 'future' } }), usage, elapsedMs: 1 });
    const received: unknown[] = [], unsubscribe = subscribeKeiCorrection(r => received.push(r));
    try {
      submitKeiReview(makeResponse({ chapterSignal: { reason: 'closure', note: '归还已完成', segments: [0] } }), world, { ...snapshot, chapterState: state }, '', undefined, null, '', {
        origin: { worldId: world.id, playthroughId: 'run', worldLineId: 'line', archiveScope: 'ordinary', parentNodeId: 'root', actionId: 'a1' }, settingsOverride: settings });
      await vi.waitFor(() => expect(hasPendingKeiReviews()).toBe(false));
      expect(received).toHaveLength(1);
      expect(received[0]).toMatchObject({ chapterDecision: { move: 'complete' }, _chapterBasis: chapterBasis(world.id, state) });
      const request = vi.mocked(callAi).mock.calls.at(-1)![0];
      expect(request.userMessage).toContain('她接过挂钟。');
      expect(request.systemPrompt).toContain('chapterDecision');
      expect(request.systemPrompt).not.toContain('返回一个 JSON 篇章决定，不写正文，不输出世界状态更新。');
    } finally { unsubscribe(); cancelKeiQueue(); }
  });
});
