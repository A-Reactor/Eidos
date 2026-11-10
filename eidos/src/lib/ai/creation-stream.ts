import type { TokenUsage } from './types';
import type { AiRoleConfig } from './providers/types';
type CreationConfig = Pick<AiRoleConfig, 'baseUrl' | 'apiKey' | 'model'> & Partial<AiRoleConfig>;
export interface CreationUsageTiming { providerUsage?: TokenUsage; success?: boolean; elapsedMs: number; firstTokenMs?: number; promptChars: number; completionChars: number }

/** Creation requests have no application deadline: reasoning can legitimately take 20 minutes. */
export interface CreationStreamOptions {
  settings?: Record<string, string>;
  resumeText?: string;
  signal?: AbortSignal;
  onTokenUsage?: (usage: TokenUsage) => void;
  onUsage?: (raw: unknown, timing: CreationUsageTiming) => void;
  onText?: (text: string, delta: string) => void;
  /** Validate finished output before treating a checkpoint as reusable. */
  validate?: (text: string) => void;
  /** Replacement starts a new document; clients must archive the old prefix first. */
  onReset?: (text: string, reason: string) => void;
}

/** Keep incomplete SSE lines across network chunks, including a final line without a newline. */
export async function readCreationEvents(response: Response, onEvent: (event: any) => void | Promise<void>, options: { signal?: AbortSignal; onActivity?: () => void } = {}) {
  if (!response.ok) {
    const failure = await response.json().catch(() => null);
    throw new Error(typeof failure?.error === 'string' ? failure.error : `生成请求失败 (${response.status})`);
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error("生成服务未返回数据流");
  const decoder = new TextDecoder();
  let buffer = "";
  const consume = async (line: string) => {
    if (!line.startsWith("data:")) return;
    const value = line.slice(5).trim();
    if (!value || value === "[DONE]") return;
    // Do not swallow errors thrown by event handlers, including server error events.
    const event = JSON.parse(value);
    await onEvent(event);
  };
  const onAbort = () => { void reader.cancel(options.signal?.reason).catch(() => {}); };
  options.signal?.addEventListener('abort', onAbort, { once: true });
  try {
    while (true) {
      options.signal?.throwIfAborted();
      const { done, value } = await reader.read();
      options.signal?.throwIfAborted();
      if (value?.byteLength) options.onActivity?.();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) await consume(line);
      if (done) { await consume(buffer); break; }
    }
  } finally {
    options.signal?.removeEventListener('abort', onAbort);
    await reader.cancel().catch(() => {}); reader.releaseLock();
  }
}

/** One author turn, shared by JSON continuations and the editable world conversation. */
export async function streamCreationTurn(
  cfg: CreationConfig, body: Record<string, unknown>,
  onThinking: () => void, options: CreationStreamOptions = {},
): Promise<{ text: string; finishReason?: string }> {
  if (cfg.protocol && cfg.protocol !== 'deepseek-native') {
    // Lazy import avoids a cycle: the ordinary transports also share this module's SSE reader.
    const { streamProviderCreationTurn } = await import('./creation-provider');
    return streamProviderCreationTurn(cfg as AiRoleConfig, body, onThinking, options);
  }
  let text = '', finishReason: string | undefined, rawUsage: unknown, firstTokenMs: number | undefined;
  let success = false;
  const startedAt = Date.now();
  options.signal?.throwIfAborted();
  try {
    const response = await fetch(`${cfg.baseUrl}/chat/completions`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
      body: JSON.stringify({ ...body, stream: true, stream_options: { include_usage: true } }), signal: options.signal,
    });
    if (!response.ok) throw new Error(`KEI API error: ${response.status} ${(await response.text()).slice(0, 300)}`);
    await readCreationEvents(response, event => {
      if (event.error) throw new Error(event.error.message ?? '生成服务返回错误');
      if (Number.isFinite(event.usage?.prompt_tokens)) rawUsage = event.usage;
      const choice = event.choices?.[0];
      if (choice?.finish_reason) finishReason = choice.finish_reason;
      if (choice?.delta?.reasoning_content) onThinking();
      const delta = choice?.delta?.content;
      if (typeof delta === 'string' && delta) {
        if (firstTokenMs === undefined && delta.trim()) firstTokenMs = Date.now() - startedAt;
        text += delta; options.onText?.(text, delta);
      }
    }, { signal: options.signal });
    success = true;
    return { text, finishReason };
  } finally {
    options.onUsage?.(rawUsage, { success, elapsedMs: Date.now() - startedAt, firstTokenMs,
      promptChars: (body.messages as Array<{ content?: unknown }>).reduce((sum, message) => sum + String(message.content ?? '').length, 0), completionChars: text.length });
  }
}

export async function streamCreationJSON(
  cfg: CreationConfig,
  body: Record<string, unknown>,
  onThinking: () => void,
  options: CreationStreamOptions = {},
): Promise<string> {
  let text = options.resumeText ?? "";
  let repairs = 0;
  let repairMessages: Array<Record<string, unknown>> = [];
  const validate = (value: string) => { parseCreationJSON(value); options.validate?.(value); };
  const repair = (error: unknown) => {
    const reason = error instanceof Error ? error.message : '输出结构无效';
    if (repairs++ >= 1) throw new Error(`生成材料修正后仍未通过检查：${reason}。材料已保留，可继续生成或重做未完成阶段。`);
    repairMessages = [
      { role: 'assistant', content: text },
      { role: 'user', content: `以上材料未通过检查：${reason}。请修复这些错误并输出完整 JSON 对象（不是追加后缀、不是字段补丁）。保留其余世界事实、已有 ID、道路及玩家要求，不删除内容来绕过检查。区域和 scenes 均为以唯一 ID 为键的对象；连接和线索只引用实际地点。不要输出代码围栏或解释。` },
    ];
    options.onReset?.('', `正在修正生成材料：${reason}`);
    text = '';
  };
  if (text) {
    try { validate(text); return text; }
    catch (error) { if (!isIncompleteCreationJSON(text)) repair(error); }
  }
  for (;;) {
    options.signal?.throwIfAborted();
    const messages = [...body.messages as Array<Record<string, unknown>>, ...repairMessages];
    if (text) messages.push(
      { role: "assistant", content: text },
      { role: "user", content: "上次输出在此中断。只输出紧接上一条助手消息的剩余 JSON 字符，保持所有已输出内容不变。不要重复前缀、不要添加代码围栏或解释。若已完整，只输出空白。" },
    );
    const before = text.length;
    const { text: responseText, finishReason } = await streamCreationTurn(cfg, { ...body, messages }, onThinking, {
      ...options, onText: (_turn, delta) => { text += delta; options.onText?.(text, delta); },
    });
    try { validate(text); return text; }
    catch (error) {
      // Some providers resend the whole document when asked for a suffix. Accept it
      // only after domain validation, and replace rather than concatenate checkpoints.
      if (before && responseText && options.validate) {
        let validReplacement = false;
        try { validate(responseText); validReplacement = true; } catch { /* A real suffix is not a complete document. */ }
        if (validReplacement) {
          options.onReset?.(responseText, '续写返回了完整材料，正在校验');
          return responseText;
        }
      }
      if (isIncompleteCreationJSON(text)) {
        if (text.length === before) throw new Error('模型本轮未输出正文，材料已保留，请继续生成。');
        // Provider response budgets are not an application-wide output limit.
        if (finishReason === 'length') continue;
        throw new Error('模型正文尚未完整，已收到的材料已保留，请继续生成。');
      }
      repair(error);
    }
  }
}

/** Braces inside strings do not turn a truncated document into a completed one. */
function isIncompleteCreationJSON(value: string): boolean {
  const text = value.trim().replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
  if (!text) return true;
  const stack: string[] = [];
  let inString = false, escaped = false;
  for (const char of text) {
    if (escaped) { escaped = false; continue; }
    if (inString && char === '\\') { escaped = true; continue; }
    if (char === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (char === '{' || char === '[') stack.push(char);
    if (char === '}' || char === ']') {
      if (stack.pop() !== (char === '}' ? '{' : '[')) return false;
    }
  }
  return inString || stack.length > 0;
}

/** Never repair a partial creation response and silently present it as a finished world. */
export function parseCreationJSON<T>(text: string): T {
  const clean = text.trim().replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
  return JSON.parse(clean) as T;
}
