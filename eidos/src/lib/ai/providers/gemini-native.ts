import { readCreationEvents } from '../creation-stream';
import { normalizeCacheUsage } from '../cache-usage';
import { requestSignal } from './types';
import { geminiUserParts } from './media';
import { withStreamControl, createStreamActivityReporter, finishStream, reportedReasoningTokens } from './stream-control';
import { geminiThinkingConfig } from './request-options';
import { requestedGenerationTokens } from '../prompt-budget';
import { geminiHttpError, geminiNetworkError, geminiRequestUrl } from './gemini-transport';
// ============================================================
// Gemini Native Adapter — generateContent API adapter
// ============================================================

import { normalizeProviderError } from "./errors";
import type { AiChatRequest, AiChatResult, AiProviderAdapter, AiStreamRequest } from "./types";
import type { TokenUsage } from "@/lib/ai/types";

export function createGeminiNativeAdapter(): AiProviderAdapter {
  return {
    id: "gemini-native",
    protocol: "gemini-native",
    capabilities: {
      supportsImageInput: true,
      supportsDocumentInput: true,
      supportsJsonMode: true,
      supportsStreaming: true,
      supportsStreamingUsage: true,
      supportsReasoning: true,
    },
    async complete(request) {
      const startedAt = Date.now();
      const response = await geminiFetch(request, false);
      const data = await response.json().catch(error => { throw geminiNetworkError(error, request); });
      const content = extractGeminiText(data);
      const elapsedMs = Date.now() - startedAt;
      return {
        content,
        usage: usageFromGemini(data.usageMetadata, request, content, elapsedMs),
        elapsedMs,
        rawFinishReason: data.candidates?.[0]?.finishReason,
      };
    },
    async stream(request: AiStreamRequest) {
      return withStreamControl(request, async (request, touch) => {
        const startedAt = Date.now();
        const activity = createStreamActivityReporter(request, startedAt);
        let response: Response;
        try {
          response = await geminiFetch(request, true);
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
            for (const part of parsed.candidates?.[0]?.content?.parts ?? []) {
              if (part.thought === true && typeof part.text === 'string') activity.thinking(part.text);
            }
            if (typeof parsed.candidates?.[0]?.finishReason === 'string') finishReason = parsed.candidates[0].finishReason;
            const delta = extractGeminiText(parsed);
            if (delta) {
              activity.generating(delta);
              if (firstTokenMs === undefined && delta.trim()) firstTokenMs = Date.now() - startedAt;
              fullText += delta; request.onChunk(delta);
            }
            if (Number.isFinite(parsed.usageMetadata?.promptTokenCount)) rawUsage = parsed.usageMetadata;
          }, { signal: request.signal, onActivity: touch });
        } catch (error) {
          // Billing already reported by the provider must survive the transport failure.
          if (rawUsage) request.onUsage?.({ ...usageFromGemini(rawUsage, request, fullText, Date.now() - startedAt), firstTokenMs, finishReason,
            success: false, errorCode: typeof (error as { code?: unknown })?.code === 'string' ? (error as { code: string }).code : undefined });
          request.onError(geminiNetworkError(error, request)); return;
        }
        finishStream(request, fullText, { ...usageFromGemini(rawUsage, request, fullText, Date.now() - startedAt), firstTokenMs, finishReason });
      });
    },
  };
}

async function geminiFetch(request: AiChatRequest, stream: boolean): Promise<Response> {
  if (!request.config.apiKey) throw normalizeProviderError(401, "missing api key");
  const url = geminiRequestUrl(request.config.baseUrl, request.config.model, stream, request.config.apiKey);
  const thinkingConfig = geminiThinkingConfig(request.config);
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: request.systemPrompt }] },
      contents: request.conversation?.map(message => ({ role: message.role === 'assistant' ? 'model' : 'user', parts: [{ text: message.content }] }))
        ?? [{ role: "user", parts: geminiUserParts(request) }],
      generationConfig: {
        temperature: request.temperature,
        maxOutputTokens: request.generationMaxTokens ?? requestedGenerationTokens(request),
        ...(thinkingConfig ? { thinkingConfig } : {}),
        ...(request.jsonMode ? { responseMimeType: "application/json" } : {}),
      },
    }),
    signal: requestSignal(request),
  }).catch((error: unknown) => {
    throw geminiNetworkError(error, request);
  });
  if (!response.ok) {
    const detail = await response.text().catch(error => { throw geminiNetworkError(error, request); });
    throw geminiHttpError(response.status, detail, request.config.apiKey);
  }
  return response;
}

function extractGeminiText(data: any): string {
  return data.candidates?.[0]?.content?.parts
    ?.map((part: any) => part.thought !== true && typeof part.text === "string" ? part.text : "")
    .join("") ?? "";
}

function usageFromGemini(raw: any, request: AiChatRequest, content: string, elapsedMs: number): TokenUsage {
  if (!raw || !Number.isFinite(raw.promptTokenCount)) return estimatedUsage(request, content, elapsedMs);
  const reasoningTokens = reportedReasoningTokens(raw.thoughtsTokenCount);
  // Gemini reports candidate prose and paid thinking separately; the common completion ledger includes both.
  const completionTokens = (raw.candidatesTokenCount ?? 0) + (reasoningTokens ?? 0);
  return {
    outputChars: content.length,
    reasoningTokens,
    promptTokens: raw.promptTokenCount ?? 0,
    completionTokens,
    totalTokens: raw.totalTokenCount ?? raw.promptTokenCount + completionTokens,
    ...normalizeCacheUsage('gemini-native', raw),
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
