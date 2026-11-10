// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';
import { createSourceCorpus } from '@/lib/ai/source-archive';
import { resumeSourceReconstruction } from '@/lib/game/source-reconstruction/controller';
import { saveSourceCheckpoint, loadSourceCheckpoint } from '@/lib/game/source-reconstruction/checkpoint-store';
import { runSourceTask } from '@/lib/ai/source-reconstruction/runner';
import { WORLD_BRIEF_FIELDS } from '@/lib/game/world-creation-brief';
import type { SourceCheckpoint } from '@/lib/game/source-reconstruction/types';
import type { SourceTaskRequest } from '@/lib/game/source-reconstruction/task-protocol';

const corpus = () => createSourceCorpus([{ content: '第一章：林在港口。' }, { content: '末章：医师关闭了闸门。' }], 1);
const execute = (task: SourceTaskRequest) => runSourceTask(task, { call: async () => JSON.stringify(task.stage === 'brief' ? { fields: Object.fromEntries(WORLD_BRIEF_FIELDS.map(k => [k, { text: '雨港', factRefs: [] }])), issues: [] } : { summary: '雨港', entities: [], claims: [], unresolved: [], styleCandidates: [] }) });

describe('reconstruction recovery', () => {
  it('saves verified chunks across failure and reload and runs only remaining work', async () => {
    let saved: SourceCheckpoint | undefined;
    const failing = vi.fn(async (task: SourceTaskRequest) => { if (failing.mock.calls.length === 2) throw new Error('offline'); return execute(task); });
    await expect(resumeSourceReconstruction({ id: 'resume-test', corpus: corpus(), modelConfigHash: 'model', execute: failing, persist: async c => { saved = structuredClone(c); await saveSourceCheckpoint(c); } })).rejects.toThrow('offline');
    expect(Object.keys(saved!.tasks)).toHaveLength(1);
    const restored = await loadSourceCheckpoint('resume-test');
    expect(restored?.tasks).toEqual(saved!.tasks);
    const resumed = vi.fn(execute);
    const result = await resumeSourceReconstruction({ id: 'resume-test', corpus: corpus(), modelConfigHash: 'model', checkpoint: restored!, execute: resumed, persist: async () => {} });
    expect(resumed.mock.calls.filter(([task]) => task.stage === 'extract')).toHaveLength(1);
    expect(result.dossier.coverage.completed).toHaveLength(2);
    expect(result.brief.origin).toBe('source');
  });
  it('reuses unaffected document reads when another document changes', async () => {
    let saved: SourceCheckpoint | undefined;
    await resumeSourceReconstruction({ id: 'edit-test', corpus: corpus(), modelConfigHash: 'm', execute, persist: async c => { saved = structuredClone(c); } });
    const edited = corpus(); edited.documents[1].content = '末章改写：医师没有关闸。';
    const call = vi.fn(execute);
    await resumeSourceReconstruction({ id: 'edit-test', corpus: edited, modelConfigHash: 'm', checkpoint: saved, execute: call, persist: async () => {} });
    expect(call.mock.calls.filter(([task]) => task.stage === 'extract')).toHaveLength(1);
  });
  it('rejects stale task results and stops if saving fails', async () => {
    const stale = async (task: SourceTaskRequest) => ({ ...await execute(task), inputHash: 'old' });
    await expect(resumeSourceReconstruction({ id: 'stale', corpus: corpus(), modelConfigHash: 'm', execute: stale, persist: async () => {} })).rejects.toThrow('过期');
    const call = vi.fn(execute);
    await expect(resumeSourceReconstruction({ id: 'storage', corpus: corpus(), modelConfigHash: 'm', execute: call, persist: async () => { throw new Error('quota'); } })).rejects.toThrow('quota');
    expect(call).not.toHaveBeenCalled();
  });
});
it('carries paid reading checkpoints to another device through exported materials', async () => {
  const { restoreSourceCheckpoint } = await import('@/lib/game/source-reconstruction/checkpoint-store');
  let saved: SourceCheckpoint | undefined;
  await resumeSourceReconstruction({ id: 'export-device-a', corpus: corpus(), modelConfigHash: 'm', execute, persist: async c => { saved = structuredClone(c); } });
  const imported = await restoreSourceCheckpoint(JSON.parse(JSON.stringify(saved)), 'import-device-b');
  const call = vi.fn(execute);
  await resumeSourceReconstruction({ id: imported.id, corpus: imported.corpus, modelConfigHash: 'm', checkpoint: await loadSourceCheckpoint(imported.id) ?? undefined, execute: call, persist: async () => {} });
  expect(call).not.toHaveBeenCalled();
});
it('shrinks reading blocks for smaller model windows and resumes using that block size', async () => {
  const large = createSourceCorpus([{ content: '一段材料。'.repeat(100) }], 1);
  let saved: SourceCheckpoint | undefined;
  const bounded = vi.fn(async (task: SourceTaskRequest) => {
    if (task.stage === 'extract' && task.input.blocks[0].text.length > 100) throw new Error('完整请求预计超过上下文窗口');
    return execute(task);
  });
  const result = await resumeSourceReconstruction({ id: 'small-window', corpus: large, targetTokens: 512, modelConfigHash: 'm', execute: bounded, persist: async c => { saved = structuredClone(c); } });
  expect(result.dossier.coverage.completed.length).toBeGreaterThan(1);
  const resumed = vi.fn(execute);
  await resumeSourceReconstruction({ id: 'small-window', corpus: large, modelConfigHash: 'm', checkpoint: saved, execute: resumed, persist: async () => {} });
  expect(resumed).not.toHaveBeenCalled();
});
it('shrinks merge groups without rereading documents when the provider rejects a large merge prompt', async () => {
  const docs = createSourceCorpus(Array.from({ length: 5 }, (_, i) => ({ content: `资料 ${i}` })), 1);
  let saved: SourceCheckpoint | undefined;
  const call = vi.fn(async (task: SourceTaskRequest) => {
    if (task.stage === 'merge' && task.input.digests.length > 2) throw new Error('完整请求预计超过上下文窗口');
    const result = await execute(task);
    if (task.stage !== 'brief') (result.payload as import('@/lib/game/source-reconstruction/types').ChunkDigest).summary = '雨港'.repeat(300);
    return result;
  });
  await resumeSourceReconstruction({ id: 'small-merge', corpus: docs, modelConfigHash: 'm', execute: call, persist: async c => { saved = structuredClone(c); } });
  expect(call.mock.calls.filter(([task]) => task.stage === 'extract')).toHaveLength(5);
  const resumed = vi.fn(execute);
  await resumeSourceReconstruction({ id: 'small-merge', corpus: docs, modelConfigHash: 'm', checkpoint: saved, execute: resumed, persist: async () => {} });
  expect(resumed).not.toHaveBeenCalled();
});
