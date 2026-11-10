import type { AiStreamActivity, StorySegment, TokenUsage } from '@/lib/ai/types';
import { readCreationEvents } from '@/lib/ai/creation-stream';
import { stableRecordJSON } from '@/lib/ai/prompt-layout';
import type { ActionToolResponse } from './action-tool-continuation';

interface ContinuationOptions {
  body: Record<string, unknown>; streaming: boolean; signal?: AbortSignal;
  onActivity?(activity: AiStreamActivity): void;
  onSegments?(segments: StorySegment[], lastIsDraft: boolean): void;
  onUsage?(usage: TokenUsage): void;
  onTiming?(timing: { elapsedMs: number; firstSegmentMs?: number; streaming: boolean; completed: boolean }): void;
}
/** A tool round remains one billed request; transport errors never trigger an implicit paid retry. */
export async function requestActionContinuation(options: ContinuationOptions): Promise<{ response: ActionToolResponse; usageRecorded: boolean }> {
  const started = Date.now(), billing = continuationBilling(options.onUsage);
  let firstSegmentMs: number | undefined, completed = false, usedStreaming = false;
  try {
    const res = await fetch(options.streaming ? '/api/game/action/stream' : '/api/game/action', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(options.body), signal: options.signal,
    });
    options.signal?.throwIfAborted();
    if (!res.ok) { const error = billing.response(await res.json().catch(() => ({}))); throw new Error(error.error || `行动续写失败（${res.status}）`); }
    usedStreaming = Boolean(res.headers.get('Content-Type')?.includes('text/event-stream'));
    if (!usedStreaming) {
      const response = billing.response(await res.json() as ActionToolResponse);
      options.signal?.throwIfAborted(); completed = true;
      return { response, usageRecorded: billing.recorded(response._tokenUsage) };
    }
    let final: ActionToolResponse | undefined, segments: StorySegment[] = [];
    await readCreationEvents(res, event => {
      if (final) throw new Error('续写流包含重复终局');
      if (event.type === 'error') { billing.response(event); throw new Error(event.message || '行动续写失败'); }
      if (event.type === 'usage' && event.usage) billing.accept(event.usage);
      if (event.type === 'activity' && ['waiting', 'thinking', 'generating', 'files', 'search', 'operation'].includes(event.phase)) options.onActivity?.({ phase: event.phase, elapsedMs: event.elapsedMs, reasoningChars: event.reasoningChars });
      if (event.type === 'segments' && Array.isArray(event.segments)) {
        segments = event.segments;
        if (firstSegmentMs === undefined && segments.some(segment => segment.text?.trim())) firstSegmentMs = Date.now() - started;
        options.onSegments?.(segments, event.lastIsDraft === true);
      }
      if (event.type === 'done') {
        const { type: _type, ...response } = event;
        final = billing.response({ ...response, segments: response.segments ?? segments });
      }
    }, { signal: options.signal });
    options.signal?.throwIfAborted();
    if (!final) throw new Error('行动续写流未返回完整结果');
    completed = true;
    return { response: final, usageRecorded: billing.recorded(final._tokenUsage) };
  } finally { options.onTiming?.({ elapsedMs: Date.now() - started, firstSegmentMs, streaming: usedStreaming, completed }); }
}

/** Scope deduplication to one provider request; identical totals in another round are still new usage. */
function continuationBilling(onUsage?: (usage: TokenUsage) => void) {
  const billed = new Set<string>();
  const accept = (usage: TokenUsage) => {
    if (!onUsage) return;
    const key = stableRecordJSON(usage);
    if (!billed.has(key)) { billed.add(key); onUsage(usage); }
  };
  return { accept,
    recorded: (usage?: TokenUsage) => Boolean(usage && billed.has(stableRecordJSON(usage))),
    response: (response: ActionToolResponse): ActionToolResponse => {
      if (response._tokenUsage) accept(response._tokenUsage);
      if (!onUsage || !response._pendingKeyTokens?.length) return response;
      // Pending entries are distinct paid requests, even if two totals happen to match.
      response._pendingKeyTokens.forEach(onUsage);
      return { ...response, _pendingKeyTokens: undefined };
    },
  };
}
