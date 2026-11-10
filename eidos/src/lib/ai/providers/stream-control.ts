import type { AiStreamActivity, TokenUsage } from '../types';
import type { AiStreamRequest } from './types';

const MAX_STREAM_WAIT_MS = 600000;
const ACTIVITY_REPORT_INTERVAL_MS = 1000;

export class AiGenerationError extends Error {
  usage?: TokenUsage;
  constructor(public readonly code: 'stream_idle' | 'stream_deadline' | 'output_limit' | 'empty_output' | 'tool_error', message: string) {
    super(message); this.name = 'AiGenerationError';
  }
}

/** Carry paid failure usage across the server/browser boundary without resending or charging it again. */
export function withFailureUsage(error: AiGenerationError, usage: TokenUsage): AiGenerationError {
  error.usage = { ...usage, success: false, errorCode: error.code };
  return error;
}

/** Transport progress includes reasoning and keepalives, rather than only visible prose. */
export async function withStreamControl(request: AiStreamRequest,
  run: (controlled: AiStreamRequest, touch: () => void) => Promise<void>): Promise<void> {
  const controller = new AbortController();
  let idle: ReturnType<typeof setTimeout> | undefined;
  let ceiling: ReturnType<typeof setTimeout> | undefined;
  const touch = () => {
    if (request.timeoutMs <= 0 || controller.signal.aborted) return;
    clearTimeout(idle);
    idle = setTimeout(() => controller.abort(new AiGenerationError('stream_idle', 'Model response stalled.')), request.timeoutMs);
  };
  const cancel = () => controller.abort(request.signal?.reason);
  request.signal?.addEventListener('abort', cancel, { once: true });
  if (request.signal?.aborted) cancel();
  touch();
  if (request.timeoutMs > 0 && !controller.signal.aborted) {
    ceiling = setTimeout(() => controller.abort(new AiGenerationError('stream_deadline', 'Model response timed out.')),
      Math.max(request.timeoutMs, MAX_STREAM_WAIT_MS));
  }
  try {
    // The controller owns streaming limits; disable the old unconditional wall-clock signal.
    controller.signal.throwIfAborted();
    await run({ ...request, signal: controller.signal, timeoutMs: 0 }, touch);
  } catch (error) {
    request.onError(error instanceof Error ? error : new Error(String(error)));
  } finally {
    clearTimeout(idle); clearTimeout(ceiling);
    request.signal?.removeEventListener('abort', cancel);
  }
}

export function createStreamActivityReporter(request: AiStreamRequest, startedAt: number) {
  let phase: AiStreamActivity['phase'] = 'waiting';
  let reasoningChars = 0;
  let lastReport = -Infinity;
  const report = (next: AiStreamActivity['phase']) => {
    const now = Date.now();
    if (phase !== next || now - lastReport >= ACTIVITY_REPORT_INTERVAL_MS) {
      phase = next; lastReport = now;
      request.onActivity?.({ phase, reasoningChars, elapsedMs: now - startedAt });
    }
  };
  report('waiting');
  return {
    thinking(text: string) { reasoningChars += text.length; if (phase !== 'generating') report('thinking'); },
    generating(text: string) { if (text.trim()) report('generating'); },
  };
}

export function emptyOutputError(finishReason?: string): AiGenerationError {
  return ['length', 'max_tokens', 'MAX_TOKENS'].includes(finishReason ?? '')
    ? new AiGenerationError('output_limit', 'Output limit reached before a response was generated.')
    : new AiGenerationError('empty_output', `Model returned no text${finishReason ? ` (${finishReason})` : ''}.`);
}

export function finishStream(request: AiStreamRequest, text: string, usage: TokenUsage): void {
  if (text.trim()) { request.onDone(text, usage); return; }
  const error = emptyOutputError(usage.finishReason);
  request.onUsage?.({ ...usage, success: false, errorCode: error.code });
  request.onError(error);
}

export function reportedReasoningTokens(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}
