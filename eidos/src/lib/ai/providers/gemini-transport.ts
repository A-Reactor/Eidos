import { normalizeProviderError } from './errors';
import { AiProviderError, type AiChatRequest } from './types';

export function geminiRequestUrl(baseUrl: string, model: string, stream: boolean, key: string): string {
  const base = new URL(baseUrl.trim());
  // The official hostname alone is commonly copied from Google's documentation.
  if (base.hostname === 'generativelanguage.googleapis.com' && base.pathname === '/') base.pathname = '/v1beta';
  const method = stream ? 'streamGenerateContent' : 'generateContent';
  return `${base.href.replace(/\/+$/, '')}/models/${encodeURIComponent(model.trim().replace(/^models\//, ''))}:${method}?${stream ? 'alt=sse&' : ''}key=${encodeURIComponent(key)}`;
}

export function geminiNetworkError(error: unknown, request: AiChatRequest): Error {
  if (request.signal?.aborted) return request.signal.reason;
  if (error instanceof AiProviderError) return error;
  const cause = error instanceof Error ? error.cause as { code?: unknown } | undefined : undefined;
  const code = typeof cause?.code === 'string' && /^[A-Z][A-Z0-9_]{1,79}$/.test(cause.code) ? cause.code : '';
  const message = error instanceof Error ? error.message : String(error);
  if (!(error instanceof TypeError) && !code && !/fetch failed|terminated/i.test(message)) return error instanceof Error ? error : new Error(message);
  // Expose the network code, never the cause's request URL (which can contain credentials).
  return new AiProviderError('provider_unreachable', `Gemini network error${code ? ` (${code})` : ''}.`);
}

export function geminiHttpError(status: number, body: string, key: string): AiProviderError {
  let detail = body;
  try {
    const data = JSON.parse(body);
    if (typeof data.error?.message === 'string') detail = `${typeof data.error.status === 'string' ? data.error.status + ': ' : ''}${data.error.message}`;
  } catch { /* A proxy may return a non-JSON HTTP error. */ }
  if (key) detail = detail.split(key).join('[redacted]');
  const error = normalizeProviderError(status, detail);
  error.message = `Gemini HTTP ${status}: ${detail.slice(0, 300)}`;
  return error;
}
