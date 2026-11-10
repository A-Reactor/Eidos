import { readCreationEvents } from '../creation-stream';
import { buildInputContextUsage, getModelContextWindow } from '../context-usage';
import { preparePromptBudget, estimateTextTokens } from '../prompt-budget';
import type { TokenUsage } from '../types';
import type { AiChatRequest, AiChatResult, AiStreamRequest } from './types';
import { AiGenerationError, withFailureUsage } from './stream-control';

interface ToolCall { id: string; type: 'function'; function: { name: string; arguments: string } }
export type ToolMessage = Record<string, unknown>;
interface Round { message: ToolMessage; content: string; calls: ToolCall[]; rawUsage?: unknown; finishReason?: string }
interface ToolLoopOptions {
  request: AiChatRequest;
  messages: ToolMessage[];
  send(messages: ToolMessage[], exhausted: boolean, generationMaxTokens: number): Promise<Response>;
  usage(raw: unknown, content: string, elapsed: number): TokenUsage;
  stream?: Pick<AiStreamRequest, 'onChunk' | 'onActivity'>;
  touch?(): void;
}

/** Use the history thresholds, but reduce transient web evidence before rejecting a grown tool transcript. */
function prepareToolBudget(request: AiChatRequest, messages: ToolMessage[], results: Map<string, unknown>) {
  const harness = request.tools!, policy = harness.resultCompression;
  const serialize = () => JSON.stringify({ messages, tools: harness.definitions }, (_key, value) =>
    typeof value === 'string' && value.startsWith('data:image/') ? '[image media]' : value);
  const totalTokens = (wire: string) => estimateTextTokens(wire + '\n') + 32 + request.maxTokens;
  let wireText = serialize();
  const window = request.config.contextWindowTokens || getModelContextWindow(request.config);
  if (window && policy && totalTokens(wireText) > window * policy.upperPercent / 100) {
    for (const message of messages) {
      const id = String(message.tool_call_id);
      if (message.role !== 'tool' || !results.has(id)) continue;
      const compact = policy.compact(results.get(id)), content = JSON.stringify(compact);
      // A short search result can be cheaper than its summary envelope. Never grow it to satisfy folding.
      if (estimateTextTokens(content) >= estimateTextTokens(String(message.content))) continue;
      results.set(id, compact); message.content = content;
      wireText = serialize();
      if (totalTokens(wireText) <= window * Math.min(policy.lowerPercent, policy.upperPercent) / 100) break;
    }
  }
  return preparePromptBudget({ ...request, systemPrompt: wireText, promptSections: undefined, userMessage: '' });
}

/** Billing accumulates across requests; context occupancy is the last request, not their sum. */
function combinedUsage(entries: TokenUsage[], request: AiChatRequest, content: string, elapsedMs: number): TokenUsage {
  const last = entries.at(-1)!;
  const total = { ...last, elapsedMs, outputChars: content.length, inputContext: buildInputContextUsage(request.config, last) };
  for (const key of ['promptTokens', 'completionTokens', 'totalTokens', 'cachedTokens', 'uncachedPromptTokens', 'cacheWriteTokens', 'reasoningTokens'] as const) {
    if (entries.some(entry => entry[key] !== undefined)) total[key] = entries.reduce((sum, entry) => sum + (entry[key] ?? 0), 0);
  }
  total.cacheUsageReported = entries.every(entry => entry.cacheUsageReported === true);
  total.usageEstimated = entries.some(entry => entry.usageEstimated === true);
  return total;
}

async function completeRound(response: Response): Promise<Round> {
  const data = await response.json(), choice = data.choices?.[0], message = choice?.message ?? {};
  return { message: { ...message, role: 'assistant' }, content: typeof message.content === 'string' ? message.content : '',
    calls: message.tool_calls ?? [], rawUsage: data.usage, finishReason: choice?.finish_reason };
}

async function streamRound(response: Response, options: ToolLoopOptions, started: number, account: (raw: unknown, content: string) => void): Promise<Round> {
  const calls = new Map<number, ToolCall>();
  let content = '', reasoning = '', rawUsage: unknown, finishReason: string | undefined, emitted = false;
  const report = (phase: 'thinking' | 'generating') => options.stream?.onActivity?.({ phase, elapsedMs: Date.now() - started, reasoningChars: reasoning.length });
  try {
    await readCreationEvents(response, event => {
      if (event.error) throw new Error(event.error.message ?? '模型工具回合失败');
      const choice = event.choices?.[0], delta = choice?.delta;
      if (typeof choice?.finish_reason === 'string') finishReason = choice.finish_reason;
      if (Number.isFinite(event.usage?.prompt_tokens)) rawUsage = event.usage;
      if (typeof delta?.reasoning_content === 'string') { reasoning += delta.reasoning_content; report('thinking'); }
      for (const fragment of delta?.tool_calls ?? []) {
        if (emitted) throw new Error('模型在已输出游戏JSON后请求工具，请重新执行本轮行动');
        const index = fragment.index;
        if (!Number.isSafeInteger(index) || index < 0 || index > 15) throw new Error('模型工具序号无效');
        const call = calls.get(index) ?? { id: '', type: 'function', function: { name: '', arguments: '' } };
        if (fragment.id) call.id = fragment.id;
        if (typeof fragment.function?.name === 'string') call.function.name += fragment.function.name;
        if (typeof fragment.function?.arguments === 'string') call.function.arguments += fragment.function.arguments;
        if (call.function.arguments.length > 16000) throw new Error('模型工具参数超过上限');
        calls.set(index, call);
      }
      if (typeof delta?.content === 'string' && delta.content) {
        content += delta.content;
        // Native tool preambles are not game prose. A final JSON response still streams normally.
        if (!calls.size && (emitted || /^\s*(?:```json\s*)?\{/.test(content) || !options.request.jsonMode)) {
          report('generating'); options.stream?.onChunk(emitted ? delta.content : content); emitted = true;
        }
      }
    }, { signal: options.request.signal, onActivity: options.touch });
  } catch (error) {
    if (rawUsage) account(rawUsage, content);
    throw error;
  }
  const toolCalls = [...calls.entries()].sort(([a], [b]) => a - b).map(([, call]) => call);
  if (!toolCalls.length && !emitted && content) options.stream?.onChunk(content);
  return { content, calls: toolCalls, rawUsage, finishReason, message: { role: 'assistant', content: content || null,
    ...(reasoning ? { reasoning_content: reasoning } : {}), ...(toolCalls.length ? { tool_calls: toolCalls } : {}) } };
}

async function executeCall(options: ToolLoopOptions, call: ToolCall, exhausted: boolean, singleCall: boolean): Promise<{ message: ToolMessage; result: unknown } | { handoff: string }> {
  let result: unknown;
  try {
    if (!options.request.tools!.definitions.some(tool => tool.function.name === call.function.name)) throw new Error(`未声明的模型工具：${call.function.name}`);
    const params = JSON.parse(call.function.arguments);
    const handoff = options.request.tools!.handoff?.(call.function.name, params);
    if (handoff !== undefined) {
      if (!singleCall) throw new Error('文件和游戏操作须每轮单独请求一个，等待真实回执后继续，不与其他函数并行调用');
      return { handoff };
    }
    if (exhausted) throw new Error('本轮联网工具额度已用尽，请根据已有资料完成响应');
    result = await options.request.tools!.execute(call.function.name, params, options.request.signal);
    options.request.signal?.throwIfAborted();
  } catch (error) {
    options.request.signal?.throwIfAborted();
    result = { status: 'failed', error: error instanceof Error ? error.message : '联网工具执行失败' };
  }
  return { message: { role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) }, result };
}

/** Standard chat tool loop: keep the original assistant message (including reasoning) and every call ID. */
export async function runOpenAiTools(options: ToolLoopOptions): Promise<AiChatResult> {
  const started = Date.now(), entries: TokenUsage[] = [], messages = [...options.messages], harness = options.request.tools!;
  const toolResults = new Map<string, unknown>();
  let used = 0, firstTokenMs: number | undefined;
  const account = (raw: unknown, content: string) => entries.push(options.usage(raw, content, Date.now() - started));
  const stream = options.stream;
  if (stream) options = { ...options, stream: { ...stream, onChunk: delta => {
    if (firstTokenMs === undefined && delta.trim()) firstTokenMs = Date.now() - started;
    stream.onChunk(delta);
  } } };
  try {
    for (let roundIndex = 0; roundIndex <= harness.maxCalls; roundIndex++) {
      options.request.signal?.throwIfAborted();
      const budget = prepareToolBudget(options.request, messages, toolResults);
      const response = await options.send(messages, used >= harness.maxCalls,
        Math.min(options.request.generationMaxTokens ?? budget.generationMaxTokens, budget.generationMaxTokens));
      options.touch?.();
      const round = options.stream ? await streamRound(response, options, started, account) : await completeRound(response);
      account(round.rawUsage, round.content);
      if (!round.calls.length) {
        const elapsedMs = Date.now() - started;
        return { content: round.content, elapsedMs, rawFinishReason: round.finishReason,
          usage: { ...combinedUsage(entries, options.request, round.content, elapsedMs), finishReason: round.finishReason, firstTokenMs } };
      }
      if (round.calls.length > 16 || new Set(round.calls.map(call => call.id)).size !== round.calls.length || round.calls.some(call => !call.id || call.type !== 'function')) throw new Error('模型工具调用ID或数量无效');
      messages.push(round.message);
      options.stream?.onActivity?.({ phase: 'search', elapsedMs: Date.now() - started, reasoningChars: 0 });
      for (const call of round.calls) {
        const result = await executeCall(options, call, used++ >= harness.maxCalls, round.calls.length === 1);
        if ('handoff' in result) {
          // Files, history and game changes belong to the outer action session, including its grants and staging.
          // Stop here so that the next model request receives the real result from that session.
          options.stream?.onChunk(result.handoff);
          const elapsedMs = Date.now() - started;
          return { content: result.handoff, elapsedMs, rawFinishReason: round.finishReason,
            usage: { ...combinedUsage(entries, options.request, result.handoff, elapsedMs), finishReason: round.finishReason, firstTokenMs } };
        }
        messages.push(result.message); toolResults.set(call.id, result.result); options.touch?.();
      }
    }
    throw new Error('模型未在联网工具额度内完成响应');
  } catch (cause) {
    const error = new AiGenerationError('tool_error', cause instanceof Error ? cause.message : '联网模型回合失败');
    if (entries.length) throw withFailureUsage(error, combinedUsage(entries, options.request, '', Date.now() - started));
    throw error;
  }
}
