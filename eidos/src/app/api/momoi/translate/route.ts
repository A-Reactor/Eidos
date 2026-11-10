// Local same-origin API; POST {text,speaker,emotion,_settings} -> {text,usage}.
// 400 invalid input, 403 origin, 429 busy, 499 cancelled, 502 model failure. No paid retries.
import { callAi } from '@/lib/ai/client';
import { AiGenerationError } from '@/lib/ai/providers/stream-control';
import { readJsonObject, RequestInputError, inputErrorResponse } from '@/lib/api/request-input';
import { allowedFields, record, PluginInputError } from '@/lib/game/plugins/validation';
import type { TokenUsage } from '@/lib/ai/types';
import { isVoiceLanguage } from '@/lib/game/momoi/languages';
import { voiceTranslationPrompt } from '@/lib/game/momoi/translation-prompt';

let active = 0;
export async function POST(request: Request): Promise<Response> {
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin) return Response.json({ error: '不允许跨站翻译请求' }, { status: 403 });
  let counted = false, usage: TokenUsage | undefined;
  try {
    const body = await readJsonObject(request, 80_000);
    allowedFields(body, ['text', 'speaker', 'emotion', '_settings', 'targetLanguage']);
    const target = body.targetLanguage ?? 'ja';
    if (!isVoiceLanguage(target)) throw new RequestInputError('目标配音语言不支持');
    if (typeof body.text !== 'string' || !body.text.trim() || body.text.length > 10_000 || typeof body.speaker !== 'string' || body.speaker.length > 200 || typeof body.emotion !== 'string' || body.emotion.length > 100) throw new RequestInputError('台词、说话人或情绪无效');
    const settings = body._settings === undefined ? undefined : record(body._settings);
    if (settings && Object.entries(settings).some(([key, value]) => (!key.startsWith('alice') && key !== 'reserveReasoningBudget') || !(typeof value === 'string' && value.length <= 8192 || typeof value === 'boolean' || key === 'aliceContextWindowTokens' && typeof value === 'number' && Number.isSafeInteger(value) && value >= 0))) throw new RequestInputError('翻译连接设置无效');
    if (active >= 4) throw new RequestInputError('翻译任务繁忙，请稍后重试', 429);
    active++; counted = true;
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(60_000)]);
    signal.throwIfAborted();
    const result = await callAi({ role: 'alice', noRetry: true, signal, callType: target === 'ja' ? 'voice_japanese_translation' : 'voice_translation',
      systemPrompt: voiceTranslationPrompt(target),
      userMessage: JSON.stringify({ speaker: body.speaker, emotion: body.emotion, dialogue: body.text }),
      temperature: .2, maxTokens: 5000, jsonMode: false, timeoutMs: 60_000, settingsOverride: settings as Record<string, string> });
    usage = result.usage; signal.throwIfAborted();
    const text = result.content.trim();
    if (!text || text.length > 10_000) throw new Error('模型没有返回有效的配音台词');
    return Response.json({ text, usage });
  } catch (error) {
    if (error instanceof AiGenerationError) usage = error.usage;
    if (error instanceof RequestInputError || error instanceof PluginInputError) return inputErrorResponse(error);
    return Response.json({ error: request.signal.aborted ? '翻译已取消' : error instanceof Error ? error.message : '日语翻译失败', ...(usage ? { usage: { ...usage, success: false } } : {}) }, { status: request.signal.aborted ? 499 : 502 });
  } finally { if (counted) active--; }
}
