import { reusablePromptBoundary } from '../prompt-blocks';
import { readCreationEvents } from '../creation-stream';
import { normalizeCacheUsage } from '../cache-usage';
import { requestSignal } from './types';
import { anthropicUserContent } from './media';
import { withStreamControl, createStreamActivityReporter, finishStream } from './stream-control';
import { claudeThinkingBudget, claudeThinkingMode } from './request-options';
import { requestedGenerationTokens } from '../prompt-budget';
// ============================================================
// Anthropic-Compatible Adapter — Messages API adapter
// ============================================================

import { normalizeProviderError } from "./errors";
import type {
  AiChatRequest,
  AiChatResult,
  AiProviderAdapter,
  AiStreamRequest,
} from "./types";
import type { TokenUsage } from "@/lib/ai/types";

export function createAnthropicCompatibleAdapter(): AiProviderAdapter {
  return {
    id: "anthropic-compatible",
    protocol: "anthropic-compatible",
    capabilities: {
      supportsImageInput: true,
      supportsDocumentInput: true,
      supportsJsonMode: false,
      supportsStreaming: true,
      supportsStreamingUsage: true,
      supportsReasoning: true,
    },
    async complete(request) {
      const startedAt = Date.now();
      const response = await anthropicFetch(request, false);
      const data = await response.json();
      const content = extractAnthropicText(data);
      const elapsedMs = Date.now() - startedAt;
      return {
        content,
        usage: usageFromAnthropic(data.usage, request, content, elapsedMs),
        elapsedMs,
        rawFinishReason: data.stop_reason,
      };
    },
    async stream(request: AiStreamRequest) {
      return withStreamControl(request, async (request, touch) => {
        const startedAt = Date.now();
        const activity = createStreamActivityReporter(request, startedAt);
        let response: Response;
        try {
          response = await anthropicFetch(request, true);
        } catch (error) {
          request.onError(error instanceof Error ? error : new Error(String(error)));
          return;
        }
        touch();
        let fullText = "";
        let rawUsage: Record<string, number> | null = null;
        let firstTokenMs: number | undefined;
        let finishReason: string | undefined;
        try {
          await readCreationEvents(response, parsed => {
            if (parsed.type === 'error') throw new Error(parsed.error?.message ?? 'Provider error.');
            if (parsed.delta?.type === 'thinking_delta' && typeof parsed.delta.thinking === 'string') activity.thinking(parsed.delta.thinking);
            if (typeof parsed.delta?.stop_reason === 'string') finishReason = parsed.delta.stop_reason;
            if (parsed.type === 'content_block_delta' && typeof parsed.delta?.text === 'string') {
              const delta = parsed.delta.text;
              activity.generating(delta);
              if (firstTokenMs === undefined && delta.trim()) firstTokenMs = Date.now() - startedAt;
              fullText += delta; if (delta) request.onChunk(delta);
            }
            // Later frames carry cumulative output, not extra input to add again.
            if (parsed.type === 'message_start' && parsed.message?.usage) rawUsage = parsed.message.usage;
            if (parsed.type === 'message_delta' && parsed.usage) rawUsage = { ...rawUsage, ...parsed.usage };
          }, { signal: request.signal, onActivity: touch });
        } catch (error) {
          // Billing already reported by the provider must survive the transport failure.
          if (rawUsage) request.onUsage?.({ ...usageFromAnthropic(rawUsage, request, fullText, Date.now() - startedAt), firstTokenMs, finishReason,
            success: false, errorCode: typeof (error as { code?: unknown })?.code === 'string' ? (error as { code: string }).code : undefined });
          request.onError(error instanceof Error ? error : new Error(String(error))); return;
        }
        finishStream(request, fullText, { ...usageFromAnthropic(rawUsage, request, fullText, Date.now() - startedAt), firstTokenMs, finishReason });
      });
    },
  };
}

async function anthropicFetch(request: AiChatRequest, stream: boolean): Promise<Response> {
  if (!request.config.apiKey) throw normalizeProviderError(401, "missing api key");
  const userContent = request.jsonMode
    ? `${request.userMessage}\n\nReturn only one valid JSON object.`
    : request.userMessage;
  const mode = claudeThinkingMode(request.config);
  const thinking = mode && request.config.enableReasoning;
  const limit = request.generationMaxTokens ?? requestedGenerationTokens(request);
  if (thinking && mode === 'manual' && limit <= 1024) throw new Error('Claude thinking requires an output limit above 1024 tokens.');
  const sections = request.promptSections;
  let system: string | Array<{ type: 'text'; text: string; cache_control?: { type: 'ephemeral' } }> = request.systemPrompt;
  if (request.config.providerId === 'anthropic' && sections?.stablePrefix) {
    const fixedEnd = sections.stablePrefix.length;
    const boundary = reusablePromptBoundary(sections);
    // Keep a fixed checkpoint even when the accepted history grows or is compacted.
    system = [{ type: 'text', text: sections.stablePrefix, cache_control: { type: 'ephemeral' } }];
    if (boundary > fixedEnd) system.push({ type: 'text', text: request.systemPrompt.slice(fixedEnd, boundary), cache_control: { type: 'ephemeral' } });
    if (boundary < request.systemPrompt.length) system.push({ type: 'text', text: request.systemPrompt.slice(boundary) });
  }
  const response = await fetch(`${request.config.baseUrl}/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": request.config.apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: request.config.model,
      system,
      messages: request.conversation ?? [{ role: "user", content: anthropicUserContent(request, userContent) }],
      max_tokens: limit,
      ...(!thinking && mode !== 'adaptive' ? { temperature: request.temperature } : {}),
      ...(mode ? { thinking: thinking
        ? mode === 'adaptive' ? { type: 'adaptive' } : { type: 'enabled', budget_tokens: Math.min(claudeThinkingBudget(request.config), limit - 1) }
        : { type: 'disabled' } } : {}),
      ...(thinking && mode === 'adaptive' ? { output_config: { effort: request.config.reasoningEffort === 'max' ? 'high' : request.config.reasoningEffort } } : {}),
      stream,
    }),
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

function extractAnthropicText(data: any): string {
  return (data.content ?? [])
    .filter((part: any) => part?.type === "text" && typeof part.text === "string")
    .map((part: any) => part.text)
    .join("");
}

function usageFromAnthropic(raw: any, request: AiChatRequest, content: string, elapsedMs: number): TokenUsage {
  if (!raw || !Number.isFinite(raw.input_tokens)) return estimatedUsage(request, content, elapsedMs);
  // Anthropic separates cached input from input_tokens; all three still occupy context.
  const promptTokens = raw.input_tokens + (raw.cache_creation_input_tokens ?? 0) + (raw.cache_read_input_tokens ?? 0);
  const completionTokens = raw.output_tokens ?? 0;
  return {
    outputChars: content.length,
    promptTokens,
    completionTokens,
    totalTokens: promptTokens + completionTokens,
    ...normalizeCacheUsage('anthropic-compatible', raw),
    model: request.role,
    callType: request.callType,
    elapsedMs,
  };
}

function estimatedUsage(request: AiChatRequest, content: string, elapsedMs: number): TokenUsage {
  const promptChars = request.systemPrompt.length + request.userMessage.length;
  return {
    outputChars: content.length,
    usageEstimated: true,
    cacheUsageReported: false,
    promptTokens: Math.ceil(promptChars / 2.5),
    completionTokens: Math.ceil(content.length / 2.5),
    totalTokens: Math.ceil((promptChars + content.length) / 2.5),
    cachedTokens: 0,
    model: request.role,
    callType: request.callType,
    elapsedMs,
  };
}
