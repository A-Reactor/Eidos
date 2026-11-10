import type { EngineNarrator, EngineNarrationInput, EngineProposal, EngineUsage } from './types';
import { ENGINE_ENVELOPE_DEPTH, EngineError, fields, jsonObject, object, string } from './validation';
import { parseEngineNarrationInput } from './transport';
import { parseEngineProposal, parseEngineUsage } from './proposal';

export class EngineHttpError extends EngineError {
  constructor(code: string, message: string, readonly status: number) { super(code, message); }
}
export interface HttpNarratorOptions {
  url: string; token?: string; headers?: Record<string, string>; timeoutMs?: number; fetch?: typeof fetch;
}
async function responseProposal(response: Response, input: EngineNarrationInput): Promise<EngineProposal> {
  let body: Record<string, unknown>;
  try { body = jsonObject(await response.json(), { maxDepth: ENGINE_ENVELOPE_DEPTH }); }
  catch { throw new EngineHttpError('invalid_response', 'Narrative endpoint returned invalid JSON', response.status); }
  let usage: EngineUsage | undefined;
  try {
    if (body.usage !== undefined) usage = parseEngineUsage(body.usage);
    if (!response.ok) {
      const detail = object(body.error), error = new EngineHttpError(string(detail.code), string(detail.message), response.status);
      error.usage = usage;
      throw error;
    }
    fields(body, ['version', 'sessionId', 'revision', 'proposal', 'usage']);
    if (body.version !== 1 || body.sessionId !== input.context.sessionId || body.revision !== input.context.revision) throw new Error('Mismatched narrative response');
    const proposal = object(body.proposal);
    // Usage is host metadata. A remote model cannot supply a second billing ledger.
    fields(proposal, ['segments', 'commands']);
    return parseEngineProposal({ ...proposal, ...(usage === undefined ? {} : { usage }) }, input.context);
  } catch (cause) {
    if (cause instanceof EngineHttpError) throw cause;
    const error = new EngineHttpError('invalid_response', cause instanceof Error ? cause.message : 'Invalid narrative response', response.status);
    error.usage = usage;
    throw error;
  }
}
/** One request per generate call. Retrying a paid call is an explicit host decision. */
export function createHttpNarrator(options: HttpNarratorOptions): EngineNarrator {
  const url = new URL(options.url);
  if (!['http:', 'https:'].includes(url.protocol)) throw new EngineError('invalid_input', 'Narrative URL must use HTTP or HTTPS');
  const timeoutMs = options.timeoutMs ?? 90_000;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new EngineError('invalid_input', 'Invalid narrative timeout');
  return { async generate(raw, requestOptions = {}) {
    if (requestOptions.signal?.aborted) throw new EngineError('aborted', 'Narrative request canceled');
    const input = parseEngineNarrationInput(raw), timeout = AbortSignal.timeout(timeoutMs);
    const signal = requestOptions.signal ? AbortSignal.any([requestOptions.signal, timeout]) : timeout;
    const headers = new Headers(options.headers); headers.set('Content-Type', 'application/json');
    if (options.token) headers.set('Authorization', `Bearer ${options.token}`);
    try {
      const response = await (options.fetch ?? globalThis.fetch)(url.href, { method: 'POST', headers, signal, body: JSON.stringify({ version: 1, ...input }) });
      return await responseProposal(response, input);
    } catch (error) {
      if (signal.aborted) throw new EngineError(requestOptions.signal?.aborted ? 'aborted' : 'timeout', 'Narrative request canceled or timed out');
      throw error;
    }
  } };
}
