import { readCreationEvents } from '@/lib/ai/creation-stream';
import { resolveSourceLookup } from '@/lib/ai/source-reconstruction/retrieval';
import type { TokenUsage } from '@/lib/ai/types';
import type { SourceTaskRequest, SourceTaskPayload } from './task-protocol';
import type { SourceIndex, SourceLookupRequest, SourceTaskEnvelope } from './types';
import { stableHash } from './source-index';

export function sourceModelConfigHash(settings: Record<string, unknown>): string {
  return stableHash(Object.fromEntries(Object.entries(settings).filter(([key]) => /^(ai|alice|kei|uzq|provider|reserveReasoningBudget)/i.test(key) && !/(?:api|auth|access|refresh)(?:key|token)|secret|password/i.test(key))));
}
export async function executeSourceTask(task: SourceTaskRequest, options: { index: SourceIndex; settings: Record<string, unknown>; signal: AbortSignal; onUsage?: (usage: TokenUsage) => void }): Promise<SourceTaskEnvelope<SourceTaskPayload>> {
  let request = task;
  for (let round = 0; round <= 2; round++) {
    options.signal.throwIfAborted();
    const response = await fetch('/api/world/source/task', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ task: request, _settings: options.settings }), signal: options.signal });
    let result: SourceTaskEnvelope<SourceTaskPayload> | undefined;
    let lookup: SourceLookupRequest | undefined;
    await readCreationEvents(response, event => {
      if (event.type === 'usage') options.onUsage?.(event.usage);
      if (event.type === 'done') result = event.result;
      if (event.type === 'lookup') lookup = event.lookup;
      if (event.type === 'error') throw new Error(event.message);
    }, { signal: options.signal });
    if (result) return result;
    if (!lookup) throw new Error('连接中断，文本任务尚未完成');
    if (round === 2) throw new Error('原文回查已达上限，请检查资料');
    request = { ...request, references: [...(request.references ?? []), ...resolveSourceLookup(lookup, options.index)], lookupCount: round + 1 };
  }
  throw new Error('文本任务未完成');
}
