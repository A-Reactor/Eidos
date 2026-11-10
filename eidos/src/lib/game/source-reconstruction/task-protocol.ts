import type { WorldDefinition } from '../types';
import type { WorldCreationBrief } from '../world-creation-brief';
import { stableHash } from './source-index';
import type { ChunkDigest, SourceBlock, SourceDossier, SourceIssue, SourceTaskStage } from './types';
import { isRecord, strings } from './validation';

export const SOURCE_PROMPT_VERSION = 'source-reconstruction-2.2';
export interface SourceTaskMeta { sourceRevision: string; modelConfigHash: string; dependsOn: string[] }
interface TaskBase extends SourceTaskMeta { version: 2; taskId: string; inputHash: string; promptVersion: string; references?: SourceBlock[]; lookupCount?: number }
export type SourceTaskRequest = TaskBase & (
  | { stage: 'extract'; input: { blocks: SourceBlock[] } }
  | { stage: 'merge'; input: { digests: ChunkDigest[] } }
  | { stage: 'brief'; input: { dossier: SourceDossier } }
  | { stage: 'verify'; input: { brief: WorldCreationBrief; dossier?: SourceDossier; creationGuide?: string; scope?: 'constraints'; world: Pick<WorldDefinition, 'name' | 'overview' | 'regions' | 'npcs' | 'history' | 'clues'> & Partial<Pick<WorldDefinition, 'timeline' | 'contradictions' | 'gameModeConfig'>> } }
);
export interface SourceVerification { issues: SourceIssue[] }
export type SourceTaskPayload = ChunkDigest | WorldCreationBrief | SourceVerification;
export function taskInputHash(task: Pick<SourceTaskRequest, 'stage' | 'sourceRevision' | 'modelConfigHash' | 'dependsOn' | 'promptVersion'> & { input: unknown }): string {
  return stableHash([task.stage, task.input, task.sourceRevision, task.modelConfigHash, task.dependsOn, task.promptVersion]);
}
export function createSourceTaskRequest<S extends SourceTaskStage>(stage: S, input: Extract<SourceTaskRequest, { stage: S }>['input'], meta: SourceTaskMeta): SourceTaskRequest {
  const base = { version: 2 as const, stage, input, ...meta, promptVersion: SOURCE_PROMPT_VERSION };
  const inputHash = taskInputHash(base);
  return { ...base, inputHash, taskId: `${stage}_${inputHash}` } as SourceTaskRequest;
}
export class SourceTaskError extends Error { constructor(message: string, readonly status = 400) { super(message); } }
export function assertSourceTask(value: unknown): asserts value is SourceTaskRequest {
  if (!isRecord(value) || value.version !== 2 || !['extract', 'merge', 'brief', 'verify'].includes(String(value.stage)) || !isRecord(value.input) || typeof value.sourceRevision !== 'string' || typeof value.modelConfigHash !== 'string' || !strings(value.dependsOn) || typeof value.taskId !== 'string') throw new SourceTaskError('文本任务格式无效');
  if (value.promptVersion !== SOURCE_PROMPT_VERSION || value.inputHash !== taskInputHash(value as unknown as SourceTaskRequest) || value.taskId !== `${value.stage}_${value.inputHash}`) throw new SourceTaskError('任务版本已变化，请重新计算该任务', 409);
  if (value.lookupCount !== undefined && (!Number.isInteger(value.lookupCount) || Number(value.lookupCount) < 0 || Number(value.lookupCount) > 2)) throw new SourceTaskError('回查次数无效');
  const input = value.input;
  if (value.stage === 'extract') {
    if (!Array.isArray(input.blocks) || !input.blocks.length || !input.blocks.every(validBlock)) throw new SourceTaskError('资料片段无效');
    if (input.blocks.some(b => b.sourceRevision !== value.sourceRevision)) throw new SourceTaskError('资料版本已变化', 409);
  } else if (value.stage === 'merge') {
    if (!Array.isArray(input.digests) || !input.digests.length || !input.digests.every(validDigestShape)) throw new SourceTaskError('合并资料无效');
  } else if (value.stage === 'brief') {
    if (!validDigestShape(input.dossier)) throw new SourceTaskError('世界档案无效');
  } else if (!isRecord(input.brief) || input.brief.version !== 2 || !isRecord(input.world)) throw new SourceTaskError('生成检查材料无效');
  if (value.references !== undefined && (!Array.isArray(value.references) || !value.references.every(validBlock))) throw new SourceTaskError('回查资料无效');
}
function validBlock(v: unknown): v is SourceBlock {
  return isRecord(v) && ['id', 'blockId', 'documentId', 'revision', 'sourceRevision', 'title', 'text'].every(k => typeof v[k] === 'string') && v.id === v.blockId && Number.isInteger(v.start) && Number.isInteger(v.end) && Number(v.start) >= 0 && Number(v.end) > Number(v.start) && (v.text as string).length === Number(v.end) - Number(v.start);
}
function validDigestShape(v: unknown): v is ChunkDigest {
  return isRecord(v) && typeof v.summary === 'string' && strings(v.blockIds) && Array.isArray(v.claims) && Array.isArray(v.entities) && Array.isArray(v.styleCandidates) && strings(v.unresolved) && Array.isArray(v.starts) && Array.isArray(v.issues);
}
