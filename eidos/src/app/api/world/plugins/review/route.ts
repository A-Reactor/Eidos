import { readJsonObject, RequestInputError, inputErrorResponse } from '@/lib/api/request-input';
import { parseGameplayPlugins, PluginInputError } from '@/lib/game/plugins/manifest';
import { allowedFields, record } from '@/lib/game/plugins/validation';
import { callAi } from '@/lib/ai/client';
import { buildUzqGameplayPrompt, parseUzqGameplayReview } from '@/lib/ai/uzq-gameplay';
import { composeSystemPrompt } from '@/lib/ai/prompt-layout';
import { AiGenerationError } from '@/lib/ai/providers/stream-control';
import type { TokenUsage } from '@/lib/ai/types';

const TOTAL_TIMEOUT_MS = 120_000;
// Local design checks have no queue: excessive clicks cannot accumulate paid jobs.
let activeChecks = 0;
export async function POST(request: Request): Promise<Response> {
  let counted = false, timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let usage: TokenUsage | undefined;
  const controller = new AbortController();
  const cancel = () => controller.abort(request.signal.reason);
  request.signal.addEventListener('abort', cancel, { once: true });
  try {
    const body = await readJsonObject(request, Infinity);
    allowedFields(body, ['gameplayPlugins', '_settings']);
    const plugins = parseGameplayPlugins(body.gameplayPlugins);
    if (!plugins.length) throw new RequestInputError('请先选择自定义玩法插件');
    const settings = body._settings === undefined ? undefined : record(body._settings);
    if (settings && Object.values(settings).some(value => !['string', 'number', 'boolean'].includes(typeof value) || typeof value === 'string' && value.length > 8192)) throw new RequestInputError('AI 设置格式无效');
    request.signal.throwIfAborted();
    if (activeChecks >= 4) throw new RequestInputError('玩法检查正在处理其他请求，请稍后重试', 429);
    activeChecks++; counted = true;
    timer = setTimeout(() => { timedOut = true; controller.abort(new DOMException('玩法检查超时', 'TimeoutError')); }, TOTAL_TIMEOUT_MS);
    const promptSections = buildUzqGameplayPrompt(plugins);
    const result = await callAi({ role: 'uzq', signal: controller.signal, systemPrompt: composeSystemPrompt(promptSections), promptSections,
      userMessage: '检查所选玩法设计并返回建议。', temperature: 0.2, maxTokens: 4000, jsonMode: true,
      timeoutMs: TOTAL_TIMEOUT_MS, settingsOverride: settings as Record<string, string> | undefined, callType: 'uzq_gameplay_design' });
    usage = { ...result.usage, worldId: null };
    controller.signal.throwIfAborted();
    return Response.json({ review: parseUzqGameplayReview(result.content, plugins), usage });
  } catch (error) {
    if (error instanceof AiGenerationError && error.usage) usage = { ...error.usage, worldId: null };
    if (!usage && !controller.signal.aborted && (error instanceof RequestInputError || error instanceof PluginInputError)) return inputErrorResponse(error);
    const cancelled = request.signal.aborted;
    const status = cancelled ? 499 : timedOut ? 504 : 502;
    return Response.json({ error: cancelled ? '已停止玩法检查' : timedOut ? '玩法检查超时，可稍后重试或直接继续创建' : error instanceof Error ? error.message : '玩法检查失败',
      ...(usage ? { usage: { ...usage, success: false, errorCode: usage.errorCode ?? 'invalid_response' } } : {}) }, { status });
  } finally {
    if (timer) clearTimeout(timer);
    request.signal.removeEventListener('abort', cancel);
    if (counted) activeChecks--;
  }
}
