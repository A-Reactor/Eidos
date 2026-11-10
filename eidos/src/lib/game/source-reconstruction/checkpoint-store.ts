import { loadFromDB, saveToDB } from '../storage';
import type { SourceCheckpoint } from './types';
import { isRecord } from './validation';
import { sourceRevision } from './source-index';
export const saveSourceCheckpoint = (checkpoint: SourceCheckpoint): Promise<void> => saveToDB(`source-reconstruction:${checkpoint.id}`, checkpoint);
export async function loadSourceCheckpoint(id: string): Promise<SourceCheckpoint | null> {
  const value = await loadFromDB(`source-reconstruction:${id}`);
  if (value === null || value === undefined) return null;
  assertSourceCheckpoint(value);
  if (value.id !== id) throw new Error('文本梳理检查点 ID 不一致');
  return value;
}

export function assertSourceCheckpoint(value: unknown): asserts value is SourceCheckpoint {
  if (!isRecord(value) || value.version !== 2 || typeof value.id !== 'string' || typeof value.sourceRevision !== 'string' || !isRecord(value.tasks) || !isRecord(value.graph) || !isRecord(value.graph.tasks) || !isRecord(value.corpus) || !Array.isArray(value.corpus.documents) || value.corpus.documents.some(d => !isRecord(d) || ['id', 'title', 'kind', 'content'].some(k => typeof d[k] !== 'string'))) throw new Error('文本梳理检查点版本无效，请从原始资料重新梳理');
  if (sourceRevision(value.corpus as unknown as SourceCheckpoint['corpus']) !== value.sourceRevision) throw new Error('文本检查点与原始资料版本不一致');
  for (const task of Object.values(value.tasks)) {
    if (!isRecord(task) || task.schemaVersion !== 2 || !['extract', 'merge', 'brief'].includes(String(task.stage)) || ['taskId', 'inputHash', 'sourceRevision', 'promptVersion', 'modelConfigHash'].some(k => typeof task[k] !== 'string') || !isRecord(task.payload) || !isRecord(task.coverage) || ['expected', 'completed', 'failed'].some(k => !Array.isArray((task.coverage as Record<string, unknown>)[k]))) throw new Error('文本检查点任务无效');
  }
}

export async function restoreSourceCheckpoint(value: unknown, id = crypto.randomUUID()): Promise<SourceCheckpoint> {
  assertSourceCheckpoint(value);
  const checkpoint = { ...structuredClone(value), id };
  await saveSourceCheckpoint(checkpoint);
  return checkpoint;
}
