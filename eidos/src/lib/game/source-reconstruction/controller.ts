import type { SourceCorpus } from '@/lib/ai/source-archive';
import { estimateTextTokens } from '@/lib/ai/prompt-budget';
import type { WorldCreationBrief } from '../world-creation-brief';
import { createSourceTaskRequest, SOURCE_PROMPT_VERSION, type SourceTaskRequest, type SourceTaskPayload } from './task-protocol';
import { indexSources, sourceRevision, stableHash } from './source-index';
import type { ChunkDigest, SourceCheckpoint, SourceDossier, SourceTaskEnvelope } from './types';
import { saveSourceCheckpoint } from './checkpoint-store';

export interface ReconstructionResumeInput {
  id: string; corpus: SourceCorpus; modelConfigHash: string; checkpoint?: SourceCheckpoint;
  execute: (task: SourceTaskRequest) => Promise<SourceTaskEnvelope<SourceTaskPayload>>;
  persist?: (checkpoint: SourceCheckpoint) => Promise<void>; signal?: AbortSignal;
  onProgress?: (status: { stage: string; completed: number; total: number; message: string; checkpoint: SourceCheckpoint }) => void;
  targetTokens?: number; mergeTokens?: number;
  maxMergeGroupSize?: number;
}
export interface ReconstructionResult { dossier: SourceDossier; digests: ChunkDigest[]; brief: WorldCreationBrief; checkpoint: SourceCheckpoint }
export async function resumeSourceReconstruction(input: ReconstructionResumeInput): Promise<ReconstructionResult> {
  const targetTokens = input.targetTokens ?? input.checkpoint?.targetTokens ?? 6000;
  const mergeTokens = input.mergeTokens ?? input.checkpoint?.mergeTokens ?? 12000;
  const maxMergeGroupSize = input.maxMergeGroupSize ?? input.checkpoint?.maxMergeGroupSize ?? Number.MAX_SAFE_INTEGER;
  const revision = sourceRevision(input.corpus), blocks = indexSources(input.corpus, { targetTokens });
  if (!blocks.length) throw new Error('请提供可读取的原文');
  const old = input.checkpoint;
  const checkpoint: SourceCheckpoint = { version: 2, targetTokens, mergeTokens, maxMergeGroupSize, id: input.id, corpus: input.corpus, sourceRevision: revision, tasks: old?.tasks ? structuredClone(old.tasks) : {}, graph: { tasks: {} }, modelConfigHash: input.modelConfigHash, updatedAt: Date.now() };
  const persist = input.persist ?? saveSourceCheckpoint;
  const save = async () => { input.signal?.throwIfAborted(); checkpoint.updatedAt = Date.now(); await persist(structuredClone(checkpoint)); };
  await save();
  let completed = 0;
  const run = async (request: SourceTaskRequest): Promise<SourceTaskEnvelope<ChunkDigest | WorldCreationBrief>> => {
    input.signal?.throwIfAborted();
    let result = checkpoint.tasks[request.taskId];
    // Global order/revision can change while an independent document's exact indexed bytes stay identical.
    if (!result && request.stage === 'extract') {
      const ids = request.input.blocks.map(b => b.id);
      const reusable = Object.values(checkpoint.tasks).find(t => t.stage === 'extract' && t.modelConfigHash === input.modelConfigHash && t.promptVersion === SOURCE_PROMPT_VERSION && stableHash(t.coverage.expected) === stableHash(ids) && t.coverage.failed.length === 0);
      if (reusable) result = { ...structuredClone(reusable), taskId: request.taskId, inputHash: request.inputHash, sourceRevision: revision, dependsOn: request.dependsOn };
    }
    const blockIds = request.stage === 'extract' ? request.input.blocks.map(b => b.id) : [];
    checkpoint.graph.tasks[request.taskId] = { id: request.taskId, inputHash: request.inputHash, dependsOn: request.dependsOn, blockIds, status: 'running' };
    input.onProgress?.({ stage: request.stage, completed, total: blocks.length, message: request.stage === 'extract' ? `阅读资料 ${completed + 1}/${blocks.length}` : request.stage === 'merge' ? '合并世界设定与来源' : '整理可编辑生成稿', checkpoint });
    try {
      if (!result) result = await input.execute(request) as SourceTaskEnvelope<ChunkDigest | WorldCreationBrief>;
      input.signal?.throwIfAborted();
      if (result.taskId !== request.taskId || result.inputHash !== request.inputHash || result.sourceRevision !== revision || result.modelConfigHash !== input.modelConfigHash) throw new Error('收到过期任务结果，已拒绝覆盖新材料');
      if (result.coverage.failed.length || result.coverage.completed.length !== result.coverage.expected.length) throw new Error('任务资料覆盖尚未完整');
      checkpoint.tasks[request.taskId] = result;
      checkpoint.graph.tasks[request.taskId].status = 'complete';
      if (request.stage === 'extract') completed++;
      await save(); return result;
    } catch (error) {
      checkpoint.graph.tasks[request.taskId].status = input.signal?.aborted ? 'cancelled' : 'failed';
      checkpoint.graph.tasks[request.taskId].error = error instanceof Error ? error.message : '任务失败';
      // Preserve completed tasks even when stopping; failures to persist remain visible to the caller.
      await persist(structuredClone(checkpoint)); throw error;
    }
  };
  const leaves: SourceTaskEnvelope<ChunkDigest>[] = [];
  for (const block of blocks) {
    const task = createSourceTaskRequest('extract', { blocks: [block] }, { sourceRevision: revision, modelConfigHash: input.modelConfigHash, dependsOn: [block.id] });
    try {
      leaves.push(await run(task) as SourceTaskEnvelope<ChunkDigest>);
    } catch (error) {
      if (!input.signal?.aborted && targetTokens > 128 && error instanceof Error && /超过上下文窗口|context_budget_exceeded|超过资料预算/.test(error.message)) {
        return resumeSourceReconstruction({ ...input, checkpoint, targetTokens: Math.max(128, Math.floor(targetTokens / 2)) });
      }
      throw error;
    }
  }
  let level = leaves;
  for (let depth = 0; level.length > 1; depth++) {
    if (depth > 12) throw new Error('资料合并层数过多，请缩小本次可游玩范围');
    const groups = groupDigests(level, mergeTokens, maxMergeGroupSize);
    if (groups.every(g => g.length === 1)) throw new Error('摘要无法在模型预算内合并，请选择较小的资料范围');
    const next: SourceTaskEnvelope<ChunkDigest>[] = [];
    for (const group of groups) {
      if (group.length === 1) { next.push(group[0]); continue; }
      const task = createSourceTaskRequest('merge', { digests: group.map(t => t.payload) }, { sourceRevision: revision, modelConfigHash: input.modelConfigHash, dependsOn: group.map(t => t.taskId) });
      try {
        next.push(await run(task) as SourceTaskEnvelope<ChunkDigest>);
      } catch (error) {
        if (!input.signal?.aborted && group.length > 2 && error instanceof Error && /超过上下文窗口|context_budget_exceeded|超过资料预算/.test(error.message)) {
          return resumeSourceReconstruction({ ...input, checkpoint, targetTokens, mergeTokens, maxMergeGroupSize: Math.max(2, Math.floor(group.length / 2)) });
        }
        throw error;
      }
    }
    level = next;
  }
  const root = level[0];
  const dossier: SourceDossier = { ...root.payload, id: `dossier_${root.inputHash}`, sourceRevision: revision, coverage: { expected: blocks.map(b => b.id), completed: blocks.map(b => b.id), failed: [] }, childRefs: leaves.map(t => t.taskId) };
  if (!dossier.claims.some(c => c.assertion === 'objective' && ['current', 'history'].includes(c.temporal))) dossier.starts = dossier.starts.map(start => ({ ...start, origin: 'generated', label: start.label.startsWith('补全建议：') ? start.label : '补全建议：' + start.label, storyOrder: undefined, sourceRefs: [], knownFactIds: {} }));
  checkpoint.dossier = dossier;
  const task = createSourceTaskRequest('brief', { dossier }, { sourceRevision: revision, modelConfigHash: input.modelConfigHash, dependsOn: [root.taskId] });
  const brief = (await run(task)).payload as WorldCreationBrief;
  checkpoint.brief = brief; await save();
  input.onProgress?.({ stage: 'ready', completed, total: blocks.length, message: '生成稿已整理完成', checkpoint });
  return { dossier, digests: leaves.map(t => t.payload), brief, checkpoint };
}
function groupDigests(tasks: SourceTaskEnvelope<ChunkDigest>[], maxTokens: number, maxItems: number): SourceTaskEnvelope<ChunkDigest>[][] {
  const groups: SourceTaskEnvelope<ChunkDigest>[][] = []; let group: typeof tasks = [], tokens = 0;
  for (const task of tasks) {
    const size = estimateTextTokens(JSON.stringify(task.payload));
    if (size > maxTokens) throw new Error('单份摘要超过合并预算，请缩小原文块重新梳理');
    if (group.length && (tokens + size > maxTokens || group.length >= maxItems)) { groups.push(group); group = []; tokens = 0; }
    group.push(task); tokens += size;
  }
  if (group.length) groups.push(group); return groups;
}
