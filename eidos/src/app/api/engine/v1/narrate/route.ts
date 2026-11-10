import { timingSafeEqual } from 'node:crypto';
import { EngineError, parseEngineNarrationInput } from '@/lib/engine';
import { fields, object } from '@/lib/engine/validation';
import { readJsonObject, RequestInputError } from '@/lib/api/request-input';
import { createProviderNarrator } from '@/lib/ai/engine-narrator';
import { resolveAiRoleConfig } from '@/lib/ai/providers/config';
import { DEFAULT_SETTINGS } from '@/lib/game/types';

export const runtime = 'nodejs';
let activeRequests = 0;
const fail = (code: string, message: string, status: number, usage?: EngineError['usage']) =>
  Response.json({ error: { code, message }, ...(usage ? { usage } : {}) }, { status });
function authenticated(request: Request, token: string): boolean {
  const actual = Buffer.from(request.headers.get('authorization') ?? ''), expected = Buffer.from(`Bearer ${token}`);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
function providerConfig() {
  const override: Record<string, string | boolean> = { reserveReasoningBudget: false };
  for (const [envKey, key] of Object.entries({ EIDOS_ENGINE_PROVIDER: 'aliceProviderId', EIDOS_ENGINE_ENDPOINT: 'aliceEndpoint', EIDOS_ENGINE_MODEL: 'aliceModel', EIDOS_ENGINE_API_KEY: 'aliceApiKey' })) {
    if (process.env[envKey]) override[key] = process.env[envKey]!;
  }
  return resolveAiRoleConfig('alice', DEFAULT_SETTINGS, override);
}
/** Stateless transport: the developer's game owns checkpoints and executes commands. */
export async function POST(request: Request): Promise<Response> {
  const token = process.env.EIDOS_ENGINE_TOKEN;
  if (!token) return fail('engine_not_configured', 'Configure EIDOS_ENGINE_TOKEN to enable the developer endpoint', 503);
  if (!authenticated(request, token)) return fail('unauthorized', 'Invalid engine bearer token', 401);
  if (activeRequests >= 4) return fail('busy', 'Engine narrative capacity is full', 429);
  activeRequests++;
  const controller = new AbortController(); let timedOut = false;
  const cancel = () => controller.abort(request.signal.reason);
  request.signal.addEventListener('abort', cancel, { once: true });
  if (request.signal.aborted) cancel();
  const timer = setTimeout(() => { timedOut = true; controller.abort(new DOMException('Narrative deadline exceeded', 'TimeoutError')); }, 90_000);
  try {
    controller.signal.throwIfAborted();
    const body = await readJsonObject(request, 2 * 1024 * 1024, controller.signal); fields(body, ['version', 'context', 'input']);
    if (body.version !== 1) throw new EngineError('invalid_input', 'Unsupported engine API version');
    const input = parseEngineNarrationInput({ context: body.context, input: body.input });
    controller.signal.throwIfAborted();
    const config = providerConfig();
    if (!config.model) return fail('model_not_configured', 'Configure EIDOS_ENGINE_MODEL', 503);
    const result = await createProviderNarrator({ config }).generate(input, { signal: controller.signal });
    controller.signal.throwIfAborted();
    return Response.json({ version: 1, sessionId: input.context.sessionId, revision: input.context.revision,
      proposal: { segments: result.segments, commands: result.commands ?? [] }, ...(result.usage ? { usage: result.usage } : {}) });
  } catch (error) {
    const usage = (error as EngineError)?.usage;
    if (request.signal.aborted) return fail('aborted', 'Narrative request canceled', 499, usage);
    if (timedOut) return fail('timeout', 'Narrative deadline exceeded', 504, usage);
    if (error instanceof RequestInputError) return fail('invalid_input', error.message, error.status);
    if (error instanceof EngineError && error.code === 'invalid_input') return fail(error.code, error.message, 400);
    const code = error && typeof error === 'object' && typeof object(error).code === 'string' ? String(object(error).code) : 'provider_error';
    return fail(code, error instanceof Error ? error.message : 'Narrative generation failed', code === 'context_budget_exceeded' ? 422 : 502, usage);
  } finally {
    clearTimeout(timer); request.signal.removeEventListener('abort', cancel); activeRequests--;
  }
}
