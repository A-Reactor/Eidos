import { callAi } from '../client';
import { estimateTextTokens } from '../prompt-budget';
import { parseCreationJSON } from '../creation-stream';
import { buildSourceTaskPrompt } from './prompts';
import { assertSourceTask, type SourceTaskRequest, type SourceTaskPayload } from '@/lib/game/source-reconstruction/task-protocol';
import { isRecord, strings, validateDigest } from '@/lib/game/source-reconstruction/validation';
import { WORLD_BRIEF_FIELDS, type WorldCreationBrief } from '@/lib/game/world-creation-brief';
import { stableHash } from '@/lib/game/source-reconstruction/source-index';
import type { SourceBlock, SourceIssue, SourceLookupRequest, SourceTaskEnvelope } from '@/lib/game/source-reconstruction/types';
import type { TokenUsage } from '../types';

export class SourceLookupNeeded extends Error { constructor(readonly lookup: SourceLookupRequest) { super('需要局部回查原文'); } }
export interface SourceTaskDependencies {
  maxRepairs?: number;
  verificationScope?: 'constraints';
  signal?: AbortSignal; settings?: Record<string, string>; onUsage?: (usage: TokenUsage) => void;
  call?: (input: ReturnType<typeof buildSourceTaskPrompt> & { signal?: AbortSignal }) => Promise<string>;
  lookup?: (request: SourceLookupRequest) => SourceBlock[] | Promise<SourceBlock[]>;
}
export async function runSourceTask(request: SourceTaskRequest, deps: SourceTaskDependencies = {}): Promise<SourceTaskEnvelope<SourceTaskPayload>> {
  assertSourceTask(request); deps.signal?.throwIfAborted();
  const prompt = buildSourceTaskPrompt(request);
  // Reading tasks can be repartitioned; final world review must see its linked fields together.
  // callAi still enforces the selected model's actual context budget for verification.
  if (request.stage !== 'verify' && estimateTextTokens(prompt.systemPrompt + prompt.userMessage) > 24000) throw new Error('当前任务超过资料预算，请缩小分组后重试');
  const call = deps.call ?? (async (input: ReturnType<typeof buildSourceTaskPrompt>) => {
    const result = await callAi({ ...input, signal: deps.signal, settingsOverride: deps.settings, temperature: 0.2, maxTokens: 2000, jsonMode: true, timeoutMs: 0, noRetry: true, callType: `source_${request.stage}` });
    deps.onUsage?.(result.usage);
    return result.content;
  });
  let repairs = 0, lookups = request.lookupCount ?? 0;
  for (;;) {
    deps.signal?.throwIfAborted();
    const text = await call({ ...prompt, signal: deps.signal }); // Transport errors never enter the content-repair loop.
    deps.signal?.throwIfAborted();
    let raw: unknown;
    try { raw = parseCreationJSON(text); } catch { raw = undefined; }
    if (isRecord(raw) && isRecord(raw.lookup) && strings(raw.lookup.refIds) && typeof raw.lookup.reason === 'string') {
      if (lookups++ >= 2) throw new Error('局部回查已达上限，请检查相关资料');
      const query = { refIds: raw.lookup.refIds, reason: raw.lookup.reason };
      if (!deps.lookup) throw new SourceLookupNeeded(query);
      const found = await deps.lookup(query);
      prompt.userMessage += `\n本次核验原文：${JSON.stringify(found)}`;
      if (request.stage !== 'verify' && estimateTextTokens(prompt.systemPrompt + prompt.userMessage) > 24000) throw new Error('回查内容超过任务预算');
      continue;
    }
    try {
      const payload = parsePayload(raw, request);
      const blockIds = request.stage === 'extract' ? request.input.blocks.map(b => b.id) : request.stage === 'merge' ? request.input.digests.flatMap(d => d.blockIds) : request.stage === 'brief' ? request.input.dossier.blockIds : [];
      const expected = [...new Set(blockIds)];
      return { schemaVersion: 2, taskId: request.taskId, stage: request.stage, inputHash: request.inputHash, sourceRevision: request.sourceRevision, promptVersion: request.promptVersion, modelConfigHash: request.modelConfigHash, dependsOn: request.dependsOn, coverage: { expected, completed: expected, failed: [] }, payload, issues: 'issues' in payload ? payload.issues : [] };
    } catch (error) {
      if (repairs++ >= (deps.maxRepairs ?? 1)) throw new Error(`资料结构验证失败：${error instanceof Error ? error.message : '无效输出'}`);
      prompt.userMessage += `\n上次输出未通过结构检查：${error instanceof Error ? error.message : '无效 JSON'}。请重新输出本任务完整 JSON；不要编造来源。`;
    }
  }
}
function parsePayload(raw: unknown, task: SourceTaskRequest): SourceTaskPayload {
  if (task.stage === 'extract' || task.stage === 'merge') {
    const result = validateDigest(raw, { sourceRevision: task.sourceRevision, blocks: task.stage === 'extract' ? task.input.blocks : [], digests: task.stage === 'merge' ? task.input.digests : undefined });
    if (!result.ok) throw new Error(result.issues.join('；'));
    return result.value;
  }
  if (!isRecord(raw)) throw new Error('缺少有效 JSON');
  const issues = parseIssues(raw.issues);
  if (task.stage === 'verify') return { issues };
  if (!isRecord(raw.fields)) throw new Error('缺少世界生成稿字段');
  const fields = {} as WorldCreationBrief['fields'], dossier = task.input.dossier;
  for (const key of WORLD_BRIEF_FIELDS) {
    const field = raw.fields[key];
    if (!isRecord(field) || typeof field.text !== 'string' || !strings(field.factRefs) || field.factRefs.some(id => !dossier.claims.some(c => c.id === id))) throw new Error(`生成稿字段 ${key} 无效`);
    fields[key] = { text: field.text, sourceText: field.text, customText: '', policy: field.text.trim() ? 'source' : 'generate', factRefs: field.factRefs, required: false };
  }
  const samples = dossier.styleCandidates.filter(s => s.safe && strings(raw.sampleIds) && raw.sampleIds.includes(s.id)).slice(0, 3);
  const startAnchor = dossier.starts.find(s => s.id === raw.startId) ?? dossier.starts[0];
  if (startAnchor?.origin === 'generated') { fields.opening.policy = 'generate'; fields.opening.sourceText = ''; fields.opening.text = fields.opening.text.startsWith('补全建议：') ? fields.opening.text : '补全建议：' + fields.opening.text; }
  const brief: WorldCreationBrief = { version: 2, origin: 'source', fields, styleChoice: samples.length ? 'source' : 'preset', sourceStyle: { traits: typeof raw.styleTraits === 'string' ? raw.styleTraits : '', samples: samples.slice(0, 1) }, sourceStyleAnchorId: startAnchor?.id, startAnchor, sourceDossierRef: dossier.id, overrides: [], issues, revision: '' };
  brief.revision = stableHash(brief); return brief;
}
function parseIssues(raw: unknown): SourceIssue[] {
  if (!Array.isArray(raw) || raw.some(i => !isRecord(i) || typeof i.code !== 'string' || typeof i.message !== 'string' || typeof i.blocking !== 'boolean')) throw new Error('缺少检查结果');
  return raw as SourceIssue[];
}
