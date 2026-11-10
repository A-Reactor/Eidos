import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildRiftCityStartState } from '@/lib/test/fixtures';
import { parseGameplayPlugins } from '@/lib/game/plugins/manifest';
import { createChapterState, acceptChapterAction, chapterBasis } from '@/lib/game/chapters/state';
import { openChapter } from '../game/chapter-fixtures';
import { makeResponse, usage } from './kei-fixtures';
import { prepareChapterGeneration } from '@/lib/ai/chapter-director';
import { processPlayerAction } from '@/lib/ai/action-handler';
import { processPlayerActionStream } from '@/lib/ai/action-stream';
import { continueActionTools } from '@/lib/game/action-tool-continuation';
import type { AIGameResponse } from '@/lib/ai/types';

vi.mock('@/lib/ai/client', async original => ({ ...await original<typeof import('@/lib/ai/client')>(), callAi: vi.fn(), callAiStream: vi.fn() }));
import { callAi, callAiStream } from '@/lib/ai/client';
const settings = { keiApiKey: 'test-key' };
function options() {
  const { world, snapshot } = buildRiftCityStartState();
  return { world: { ...world, gameplayPlugins: parseGameplayPlugins([{ format: 'eidos-gameplay-plugin', version: 1, id: 'chapter-narrative', name: '篇章叙事', description: '篇章测试', tags: [], rules: [], prompts: { creation: '', action: '', review: '' } }]) },
    snapshot, playerInput: '帮忙归还挂钟', clientSettings: settings };
}
beforeEach(() => {
  vi.mocked(callAi).mockReset().mockImplementation(async opts => ({ content: JSON.stringify(opts.role === 'kei' ? openChapter() : makeResponse()), usage: { ...usage, model: opts.role }, elapsedMs: 1 }));
  vi.mocked(callAiStream).mockReset().mockImplementation(async opts => { const text = JSON.stringify(makeResponse()); opts.onChunk(text); opts.onDone(text, { ...usage, model: 'alice' }); });
});
describe('KEI chapter preparation before generation', () => {
  it('prepares the opening using KEI without mutating the snapshot', async () => {
    const opts = options(), before = structuredClone(opts.snapshot);
    const result = await prepareChapterGeneration(opts);
    expect(result.preparation?.decision.chapter?.id).toBe('clock');
    expect(result.preparation?.basis).toEqual({ worldId: opts.world.id, revision: 0, lastActionId: null });
    expect(result.usage?.model).toBe('kei');
    expect(opts.snapshot).toEqual(before);
    expect(vi.mocked(callAi).mock.calls[0][0]).toMatchObject({ role: 'kei', noRetry: true });
  });
  it.each(['JSON', 'SSE'])('injects the prepared chapter in %s prose while preserving its candidate envelope', async mode => {
    const opts = options();
    let response: AIGameResponse | undefined;
    if (mode === 'JSON') response = await processPlayerAction(opts);
    else await processPlayerActionStream({ ...opts, callbacks: { onDone: data => { response = data; } } });
    const actualPrompt = mode === 'JSON' ? vi.mocked(callAi).mock.calls.find(c => c[0].role === 'alice')?.[0].systemPrompt : vi.mocked(callAiStream).mock.calls[0]?.[0].systemPrompt;
    expect(actualPrompt).toContain('一只走错的钟');
    expect(actualPrompt).toContain('怎样回应修理承诺与异常担忧');
    expect(response?.chapterPreparation?.decision.chapter?.id).toBe('clock');
    expect(opts.snapshot.chapterState).toBeUndefined();
  });
  it('reuses an active chapter without another KEI call', async () => {
    const opts = options(), state = createChapterState(opts.world.id);
    opts.snapshot.chapterState = acceptChapterAction({ worldId: opts.world.id, state, actionId: 'a1', input: opts.playerInput, sceneId: 'shop', segments: makeResponse().segments, summary: '相遇', preparation: { basis: chapterBasis(opts.world.id, state), decision: openChapter() } });
    expect((await prepareChapterGeneration(opts)).preparation).toBeUndefined();
    expect(vi.mocked(callAi).mock.calls).toHaveLength(0);
  });
  it('revalidates pending advice against the actual latest action instead of applying it directly', async () => {
    const opts = options(), state = createChapterState(opts.world.id);
    const opened = acceptChapterAction({ worldId: opts.world.id, state, actionId: 'a1', input: '查看挂钟', sceneId: 'shop', segments: makeResponse().segments, summary: '相遇', preparation: { basis: chapterBasis(opts.world.id, state), decision: openChapter() } });
    opened.pending = { basis: chapterBasis(opts.world.id, opened), decision: { ...openChapter(), move: 'complete', chapter: undefined, evidence: [{ actionId: 'a1', segment: 0 }], reason: '旧提案认为可以结束' } };
    opts.snapshot.chapterState = acceptChapterAction({ worldId: opts.world.id, state: opened, actionId: 'a2', input: '我还想和钟表匠一起做晚饭', sceneId: 'shop', segments: makeResponse().segments, summary: '留下做饭' });
    vi.mocked(callAi).mockResolvedValueOnce({ content: JSON.stringify({ ...openChapter(), move: 'continue', chapter: undefined, reason: '新的相处尚在展开' }), usage, elapsedMs: 1 });
    const result = await prepareChapterGeneration(opts);
    expect(result.preparation?.decision.move).toBe('continue');
    expect(vi.mocked(callAi).mock.calls[0][0].userMessage).toContain('我还想和钟表匠一起做晚饭');
    expect(opts.snapshot.chapterState.chapters[0].status).toBe('active');
  });
  it('falls back to normal generation on malformed direction or provider failure and respects cancellation', async () => {
    vi.mocked(callAi).mockResolvedValueOnce({ content: '{"move":"transition","chapter":{"title":"坏数据"}}', usage, elapsedMs: 1 });
    expect((await prepareChapterGeneration(options())).status).toBe('invalid');
    vi.mocked(callAi).mockRejectedValueOnce(new Error('temporary provider failure'));
    expect((await prepareChapterGeneration(options())).status).toBe('unavailable');
    const controller = new AbortController(); controller.abort();
    await expect(prepareChapterGeneration({ ...options(), signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
  });
  it('does not plan introspection, result-only prose, disabled review or worlds without the plugin', async () => {
    const opts = options();
    for (const item of [{ ...opts, introspection: true }, { ...opts, narrativeRequest: { kind: 'result' as const } }, { ...opts, clientSettings: { ...settings, enableContentReview: false } as never }, { ...opts, world: { ...opts.world, gameplayPlugins: [] } }]) {
      expect((await prepareChapterGeneration(item)).preparation).toBeUndefined();
    }
    expect(vi.mocked(callAi).mock.calls).toHaveLength(0);
  });
  it('carries one preparation through read-only tool continuation without paying for it again', async () => {
    const opts = options();
    vi.mocked(callAi).mockImplementation(async args => ({ content: JSON.stringify(args.role === 'kei' ? openChapter() : { historyRequest: { query: '钟表铺' } }), usage: { ...usage, model: args.role }, elapsedMs: 1 }));
    const response = await processPlayerAction(opts);
    const final = await continueActionTools({ response, historySource: { allNodes: {}, currentNode: null }, session: null,
      context: { longMemoryContext: '', workspaceContext: { draftRoot: 'drafts/test', mounts: [], results: [], nextOffset: null } }, isCurrent: () => true, onResponse() {},
      invoke: async context => {
        vi.mocked(callAi).mockImplementation(async args => ({ content: JSON.stringify(args.role === 'kei' ? openChapter() : makeResponse()), usage: { ...usage, model: args.role }, elapsedMs: 1 }));
        return processPlayerAction({ ...opts, chapterPreparation: context.chapterPreparation });
      } });
    expect(final.chapterPreparation?.decision.chapter?.id).toBe('clock');
    expect(vi.mocked(callAi).mock.calls.filter(c => c[0].role === 'kei')).toHaveLength(1);
  });
  it('does not retry failed chapter planning in each tool continuation', async () => {
    const opts = options();
    vi.mocked(callAi).mockImplementation(async args => {
      if (args.role === 'kei') throw new Error('offline');
      return { content: JSON.stringify({ historyRequest: { query: '挂钟' } }), usage, elapsedMs: 1 };
    });
    const response = await processPlayerAction(opts);
    await continueActionTools({ response, historySource: { allNodes: {}, currentNode: null }, session: null,
      context: { longMemoryContext: '', workspaceContext: { draftRoot: 'drafts/test', mounts: [], results: [], nextOffset: null } }, isCurrent: () => true, onResponse() {},
      invoke: async context => {
        vi.mocked(callAi).mockImplementation(async args => {
          if (args.role === 'kei') throw new Error('offline');
          return { content: JSON.stringify(makeResponse()), usage, elapsedMs: 1 };
        });
        return processPlayerAction({ ...opts, chapterPreparation: context.chapterPreparation });
      } });
    expect(vi.mocked(callAi).mock.calls.filter(c => c[0].role === 'kei')).toHaveLength(1);
  });
  it('recovers malformed optional saved chapter metadata without breaking prose generation', async () => {
    const opts = options(); opts.snapshot.chapterState = { version: 8, worldId: opts.world.id } as never;
    expect((await processPlayerAction(opts)).segments.length).toBeGreaterThan(0);
  });

  it('plans from the same observed branch and read evidence supplied to ALICE', async () => {
    const opts = options();
    await prepareChapterGeneration({ ...opts, longMemoryContext: '本轮观察资料：旧信中的左门已经显现为右门。玩家要按右门行动。' });
    const request = vi.mocked(callAi).mock.calls[0][0];
    expect(request.userMessage).toContain('旧信中的左门已经显现为右门');
    expect(request.systemPrompt).toContain('历史原文');
  });

});
