import { readCreationEvents } from '../creation-stream';
import { normalizeCacheUsage } from '../cache-usage';
import { requestSignal } from './types';
import { openAiUserContent } from './media';
import { withStreamControl, createStreamActivityReporter, finishStream, reportedReasoningTokens } from './stream-control';
import { runOpenAiTools, type ToolMessage } from './openai-tools';
import { openAiGenerationOptions } from './request-options';
// ============================================================
// OpenAI-Compatible Adapter — shared /chat/completions adapter
// ============================================================

import { normalizeProviderError } from "./errors";
import type {
  AiChatRequest,
  AiChatResult,
  AiProviderAdapter,
  AiProviderCapabilities,
  AiStreamRequest,
} from "./types";
import type { TokenUsage } from "@/lib/ai/types";

const DEFAULT_CAPABILITIES: AiProviderCapabilities = {
  supportsImageInput: true,
  supportsJsonMode: true,
  supportsStreaming: true,
  supportsStreamingUsage: true,
  supportsReasoning: false,
};

export function createOpenAiCompatibleAdapter(
  id = "openai-compatible",
  capabilities: AiProviderCapabilities = DEFAULT_CAPABILITIES,
  requestExtras?: (request: AiChatRequest) => Record<string, unknown>,
): AiProviderAdapter {
  return {
    id,
    protocol: id === "openai-native" ? "openai-native"
      : id === "deepseek-native" ? "deepseek-native"
      : "openai-compatible",
    capabilities,
    async complete(request) {
      if (request.tools) return runOpenAiTools({ request, messages: initialMessages(request, capabilities),
        send: (messages, exhausted, generationMaxTokens) => fetchWithBody({ ...request, generationMaxTokens }, capabilities, false, requestExtras, messages, exhausted),
        usage: (raw, content, elapsed) => usageFromOpenAi(raw, request, content, elapsed) });
      const startedAt = Date.now();
      const response = await fetchWithBody(request, capabilities, false, requestExtras);
      const data = await response.json();
      const elapsedMs = Date.now() - startedAt;
      const content = data.choices?.[0]?.message?.content ?? "";
      return {
        content,
        usage: { ...usageFromOpenAi(data.usage, request, content, elapsedMs), finishReason: data.choices?.[0]?.finish_reason },
        elapsedMs,
        rawFinishReason: data.choices?.[0]?.finish_reason,
      };
    },
    async stream(request: AiStreamRequest) {
      if (request.tools) return withStreamControl(request, async (controlled, touch) => {
        try {
          const result = await runOpenAiTools({ request: controlled, stream: controlled, touch, messages: initialMessages(controlled, capabilities),
            send: (messages, exhausted, generationMaxTokens) => fetchWithBody({ ...controlled, generationMaxTokens }, capabilities, true, requestExtras, messages, exhausted),
            usage: (raw, content, elapsed) => usageFromOpenAi(raw, controlled, content, elapsed) });
          finishStream(controlled, result.content, result.usage);
        } catch (error) {
          const usage = (error as { usage?: TokenUsage }).usage;
          if (usage) controlled.onUsage?.(usage);
          controlled.onError(error instanceof Error ? error : new Error(String(error)));
        }
      });
      return withStreamControl(request, async (request, touch) => {
        const startedAt = Date.now();
        const activity = createStreamActivityReporter(request, startedAt);
        let response: Response;
        try {
          response = await fetchWithBody(request, capabilities, true, requestExtras);
        } catch (error) {
          request.onError(error instanceof Error ? error : new Error(String(error)));
          return;
        }
        touch();
        let fullText = "";
        let rawUsage: unknown;
        let firstTokenMs: number | undefined;
        let finishReason: string | undefined;
        try {
          await readCreationEvents(response, parsed => {
            if (parsed.error) throw new Error(parsed.error.message ?? 'Provider error.');
            const thought = parsed.choices?.[0]?.delta?.reasoning_content;
            if (typeof thought === 'string' && thought) activity.thinking(thought);
            if (typeof parsed.choices?.[0]?.finish_reason === 'string') finishReason = parsed.choices[0].finish_reason;
            const delta = parsed.choices?.[0]?.delta?.content;
            if (typeof delta === 'string' && delta) {
              activity.generating(delta);
              if (firstTokenMs === undefined && delta.trim()) firstTokenMs = Date.now() - startedAt;
              fullText += delta; request.onChunk(delta);
            }
            if (Number.isFinite(parsed.usage?.prompt_tokens)) rawUsage = parsed.usage;
          }, { signal: request.signal, onActivity: touch });
        } catch (error) {
          // Billing already reported by the provider must survive the transport failure.
          if (rawUsage) request.onUsage?.({ ...usageFromOpenAi(rawUsage, request, fullText, Date.now() - startedAt), firstTokenMs, finishReason,
            success: false, errorCode: typeof (error as { code?: unknown })?.code === 'string' ? (error as { code: string }).code : undefined });
          request.onError(error instanceof Error ? error : new Error(String(error))); return;
        }
        finishStream(request, fullText, { ...usageFromOpenAi(rawUsage, request, fullText, Date.now() - startedAt), firstTokenMs, finishReason });
      });
    },
  };
}

async function fetchWithBody(
  request: AiChatRequest,
  capabilities: AiProviderCapabilities,
  stream: boolean,
  requestExtras?: (request: AiChatRequest) => Record<string, unknown>,
  messages?: ToolMessage[],
  exhausted = false,
): Promise<Response> {
  if (!request.config.apiKey && request.config.protocol !== 'openai-compatible') throw normalizeProviderError(401, "missing api key");
  const body: Record<string, unknown> = {
    model: request.config.model,
    messages: messages ?? initialMessages(request, capabilities),
    ...(request.tools ? { tools: request.tools.definitions, tool_choice: exhausted ? 'none' : 'auto' } : {}),
    ...openAiGenerationOptions(request),
    ...(stream ? { stream: true, ...(capabilities.supportsStreamingUsage && request.config.includeStreamUsage !== false ? { stream_options: { include_usage: true } } : {}) } : {}),
    ...(request.jsonMode && capabilities.supportsJsonMode && request.config.useJsonMode !== false ? { response_format: { type: "json_object" } } : {}),
    ...(requestExtras ? requestExtras(request) : {}),
  };
  // Remove undefined values (e.g. DeepSeek clears response_format when reasoning is on)
  const cleanBody = Object.fromEntries(
    Object.entries(body).filter(([, value]) => value !== undefined),
  );
  const response = await fetch(`${request.config.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(request.config.apiKey ? { Authorization: `Bearer ${request.config.apiKey}` } : {}),
    },
    body: JSON.stringify(cleanBody),
    signal: requestSignal(request),
  }).catch((error: unknown) => {
    if (request.signal?.aborted) throw request.signal.reason;
    throw normalizeProviderError(undefined, error instanceof Error ? error.message : String(error));
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => response.statusText);
    throw normalizeProviderError(response.status, detail);
  }
  return response;
}

function initialMessages(request: AiChatRequest, capabilities: AiProviderCapabilities): ToolMessage[] {
  if (request.conversation) return [{ role: 'system', content: request.systemPrompt }, ...request.conversation];
  return [{ role: 'system', content: request.systemPrompt },
    { role: 'user', content: openAiUserContent(request, capabilities.supportsImageInput === true) }];
}

function usageFromOpenAi(raw: any, request: AiChatRequest, content: string, elapsedMs: number): TokenUsage {
  if (!raw || !Number.isFinite(raw.prompt_tokens)) return estimatedUsage(request, content, elapsedMs);
  return {
    outputChars: content.length,
    reasoningTokens: reportedReasoningTokens(raw.completion_tokens_details?.reasoning_tokens),
    promptTokens: raw.prompt_tokens ?? 0,
    completionTokens: raw.completion_tokens ?? 0,
    totalTokens: raw.total_tokens ?? raw.prompt_tokens + (raw.completion_tokens ?? 0),
    ...normalizeCacheUsage(request.config.protocol, raw),
    model: request.role,
    callType: request.callType,
    elapsedMs,
  };
}

function estimatedUsage(request: AiChatRequest, content: string, elapsedMs: number): TokenUsage {
  const promptChars = request.systemPrompt.length + request.userMessage.length;
  const completionChars = content.length;
  return {
    outputChars: content.length,
    usageEstimated: true,
    cacheUsageReported: false,
    promptTokens: Math.ceil(promptChars / 2.5),
    completionTokens: Math.ceil(completionChars / 2.5),
    totalTokens: Math.ceil((promptChars + completionChars) / 2.5),
    cachedTokens: 0,
    model: request.role,
    callType: request.callType,
    elapsedMs,
  };
}
