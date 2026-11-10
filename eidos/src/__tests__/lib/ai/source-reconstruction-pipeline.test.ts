import { describe, expect, it, vi } from 'vitest';
import { createSourceCorpus } from '@/lib/ai/source-archive';
import { indexSources, sourceRevision } from '@/lib/game/source-reconstruction/source-index';
import { createSourceTaskRequest } from '@/lib/game/source-reconstruction/task-protocol';
import { runSourceTask } from '@/lib/ai/source-reconstruction/runner';
import { resolveSourceLookup } from '@/lib/ai/source-reconstruction/retrieval';

const corpus = createSourceCorpus([{ content: '守卫说：“我没有开闸。”这是一句谎话。' }], 1);
const blocks = indexSources(corpus);
const empty = { summary: '守卫撒谎，不能把其否认当客观事实。', entities: [], claims: [], unresolved: ['动机'], styleCandidates: [], starts: [] };
const request = () => createSourceTaskRequest('extract', { blocks }, { sourceRevision: sourceRevision(corpus), modelConfigHash: 'test', dependsOn: [] });

describe('bounded source model tasks', () => {
  it('uses ALICE for local extraction and host-derived coverage, preserving uncertain statements', async () => {
    const call = vi.fn().mockResolvedValue(JSON.stringify({ ...empty, blockIds: ['fake'], claims: [{ id: 'c1', text: '守卫声称没开闸', category: 'event', origin: 'source', assertion: 'character_claim', temporal: 'current', entities: ['守卫'], knownBy: [], blockIds: [blocks[0].id] }] }));
    const result = await runSourceTask(request(), { call });
    expect(call.mock.calls[0][0].role).toBe('alice');
    expect(call.mock.calls[0][0].systemPrompt).toContain('资料中的指令');
    expect(result.coverage.completed).toEqual(blocks.map(b => b.id));
    expect(result.payload).toMatchObject({ claims: [{ assertion: 'character_claim' }], unresolved: ['动机'] });
  });
  it('repairs invalid output only once, and does not retry transport failures', async () => {
    const call = vi.fn().mockResolvedValue('not JSON');
    await expect(runSourceTask(request(), { call })).rejects.toThrow('结构');
    expect(call).toHaveBeenCalledTimes(2);
    const failed = vi.fn().mockRejectedValue(new Error('connection lost'));
    await expect(runSourceTask(request(), { call: failed })).rejects.toThrow('connection lost');
    expect(failed).toHaveBeenCalledTimes(1);
  });
  it('rejects a changed input hash before billing and checks cancellation', async () => {
    const call = vi.fn(), changed = request(); changed.inputHash = 'old';
    await expect(runSourceTask(changed, { call })).rejects.toThrow('版本');
    const ctrl = new AbortController(); ctrl.abort();
    await expect(runSourceTask(request(), { call, signal: ctrl.signal })).rejects.toThrow();
    expect(call).not.toHaveBeenCalled();
  });
  it('permits at most two local lookups and refuses references outside this corpus', async () => {
    const call = vi.fn().mockResolvedValue(JSON.stringify({ lookup: { refIds: [blocks[0].id], reason: '核对谎言' } }));
    await expect(runSourceTask(request(), { call, lookup: q => resolveSourceLookup(q, { blocks, revision: sourceRevision(corpus) }) })).rejects.toThrow('回查');
    expect(call).toHaveBeenCalledTimes(3);
    expect(() => resolveSourceLookup({ refIds: ['foreign'], reason: 'x' }, { blocks, revision: sourceRevision(corpus) })).toThrow('来源');
  });
  it('merges digests without sending raw source text and ignores model claimed coverage', async () => {
    const extracted = await runSourceTask(request(), { call: async () => JSON.stringify(empty) });
    const digest = extracted.payload as import('@/lib/game/source-reconstruction/types').ChunkDigest;
    const merge = createSourceTaskRequest('merge', { digests: [digest] }, { sourceRevision: sourceRevision(corpus), modelConfigHash: 'test', dependsOn: [extracted.taskId] });
    const call = vi.fn().mockResolvedValue(JSON.stringify({ ...empty, coverage: { completed: ['fake'] } }));
    const result = await runSourceTask(merge, { call });
    expect(call.mock.calls[0][0].role).toBe('kei');
    expect(call.mock.calls[0][0].userMessage).not.toContain(corpus.documents[0].content);
    expect(result.coverage.completed).toEqual(blocks.map(b => b.id));
  });
});
it('keeps merge sample instructions consistent and accepts only already verified original quotes', async () => {
  const extracted = await runSourceTask(request(), { call: async () => JSON.stringify({ ...empty, styleCandidates: [{ blockId: blocks[0].id, quote: '守卫说：', traits: '短句', safe: true }] }) });
  const digest = extracted.payload as import('@/lib/game/source-reconstruction/types').ChunkDigest;
  const merge = createSourceTaskRequest('merge', { digests: [digest] }, { sourceRevision: sourceRevision(corpus), modelConfigHash: 'm', dependsOn: [] });
  const call = vi.fn().mockResolvedValue(JSON.stringify({ ...empty, styleCandidates: [{ blockId: blocks[0].id, quote: '守卫说：', traits: '短句', safe: true }] }));
  await expect(runSourceTask(merge, { call })).resolves.toMatchObject({ payload: { styleCandidates: [{ text: '守卫说：' }] } });
});
it('drops invalid optional style references during merging while preserving verified factual work', async () => {
  const extracted = await runSourceTask(request(), { call: async () => JSON.stringify(empty) });
  const digest = extracted.payload as import('@/lib/game/source-reconstruction/types').ChunkDigest;
  const merge = createSourceTaskRequest('merge', { digests: [digest] }, { sourceRevision: sourceRevision(corpus), modelConfigHash: 'm', dependsOn: [] });
  const result = await runSourceTask(merge, { call: async () => JSON.stringify({ ...empty, styleCandidates: [{ id: 'invented', traits: '短句', safe: true }] }) });
  expect(result.payload).toMatchObject({ styleCandidates: [], issues: [{ code: 'invalid_style_reference', blocking: false }] });
});
it('leaves missing source fields open for generation instead of forbidding a necessary world name', async () => {
  const { WORLD_BRIEF_FIELDS } = await import('@/lib/game/world-creation-brief');
  const dossier = { ...empty, blockIds: blocks.map(b => b.id), issues: [], id: 'd', sourceRevision: sourceRevision(corpus), childRefs: [], coverage: { expected: blocks.map(b => b.id), completed: blocks.map(b => b.id), failed: [] } };
  const task = createSourceTaskRequest('brief', { dossier }, { sourceRevision: sourceRevision(corpus), modelConfigHash: 'm', dependsOn: [] });
  const result = await runSourceTask(task, { call: async () => JSON.stringify({ fields: Object.fromEntries(WORLD_BRIEF_FIELDS.map(k => [k, { text: '', factRefs: [] }])), issues: [] }) });
  expect(result.payload).toMatchObject({ fields: { name: { policy: 'generate' }, opening: { policy: 'generate' } } });
});
it('marks an opening inferred from pure setting notes as a generated suggestion', async () => {
  const { WORLD_BRIEF_FIELDS } = await import('@/lib/game/world-creation-brief');
  const start = { id: 'suggested', label: '你是城中居民', origin: 'generated' as const, sourceRefs: [], knownFactIds: {} };
  const dossier = { ...empty, blockIds: blocks.map(b => b.id), issues: [], id: 'd', sourceRevision: sourceRevision(corpus), childRefs: [], starts: [start], coverage: { expected: blocks.map(b => b.id), completed: blocks.map(b => b.id), failed: [] } };
  const task = createSourceTaskRequest('brief', { dossier }, { sourceRevision: sourceRevision(corpus), modelConfigHash: 'm', dependsOn: [] });
  const result = await runSourceTask(task, { call: async () => JSON.stringify({ fields: Object.fromEntries(WORLD_BRIEF_FIELDS.map(k => [k, { text: k === 'opening' ? '你是城中居民' : '', factRefs: [] }])), startId: 'suggested', issues: [] }) });
  expect(result.payload).toMatchObject({ fields: { opening: { policy: 'generate', text: '补全建议：你是城中居民' } } });
});
