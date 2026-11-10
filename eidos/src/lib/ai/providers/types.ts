import type { AiPromptSections } from '../prompt-layout';
import type { AiMediaPart } from './media';
// ============================================================
// AI Provider Contract — unified request/response types for all adapters
// ============================================================

import type {
  StreamChunkCallback,
  StreamDoneCallback,
  StreamErrorCallback,
  TokenUsage,
  AiStreamActivity,
} from "@/lib/ai/types";

export type AiModelRole = "alice" | "kei" | "uzq";
export type AiProviderProtocol =
  | "openai-compatible"
  | "deepseek-native"
  | "openai-native"
  | "anthropic-compatible"
  | "gemini-native";

export type AiCompatibilityMode = "openai" | "anthropic" | "native";
export type AiQualityProfileId = "economy" | "balanced" | "quality";
export type AiProviderMode = "simple" | "advanced";
export type AiReasoningEffort = "low" | "medium" | "high" | "max";

export interface AiProviderCapabilities {
  supportsImageInput?: boolean;
  supportsDocumentInput?: boolean;
  supportsJsonMode: boolean;
  supportsStreaming: boolean;
  supportsStreamingUsage: boolean;
  supportsReasoning: boolean;
}

export interface AiRoleConfig {
  providerId: string;
  protocol: AiProviderProtocol;
  baseUrl: string;
  apiKey: string;
  model: string;
  compatibilityMode: AiCompatibilityMode;
  enableReasoning: boolean;
  reserveReasoningBudget?: boolean;
  contextWindowTokens?: number;
  reasoningEffort: AiReasoningEffort;
  useJsonMode?: boolean;
  includeStreamUsage?: boolean;
}

export interface AiChatMessage { role: 'user' | 'assistant'; content: string }
export interface AiChatRequest {
  /** Full authoring transcript, including completed assistant turns and repair instructions. */
  conversation?: AiChatMessage[];
  tools?: AiToolHarness;
  media?: AiMediaPart[];
  signal?: AbortSignal;
  role: AiModelRole;
  systemPrompt: string;
  promptSections?: AiPromptSections;
  userMessage: string;
  temperature: number;
  maxTokens: number;
  generationMaxTokens?: number;
  jsonMode: boolean;
  timeoutMs: number;
  callType?: string;
  config: AiRoleConfig;
}

export interface AiFunctionTool {
  type: 'function';
  function: { name: string; description: string; parameters: Record<string, unknown> };
}
export interface AiToolHarness {
  /** Return a structured continuation for operations owned by the caller's session. No receipt is fabricated. */
  handoff?(name: string, params: unknown): string | undefined;
  resultCompression?: { lowerPercent: number; upperPercent: number; compact(result: unknown): unknown };
  definitions: AiFunctionTool[];
  maxCalls: number;
  execute(name: string, params: unknown, signal?: AbortSignal): Promise<unknown>;
}

export interface AiChatResult {
  content: string;
  usage: TokenUsage;
  elapsedMs: number;
  rawFinishReason?: string;
}

export interface AiStreamRequest extends AiChatRequest {
  /** Known billing survives a failed stream without completing the story. */
  onUsage?: (usage: TokenUsage) => void;
  onActivity?: (activity: AiStreamActivity) => void;
  onChunk: StreamChunkCallback;
  onDone: StreamDoneCallback;
  onError: StreamErrorCallback;
}

export type AiProviderErrorCode =
  | "missing_api_key"
  | "auth_failed"
  | "rate_limited"
  | "model_not_found"
  | "json_mode_unsupported"
  | "stream_unsupported"
  | "provider_unreachable"
  | "provider_error";

export class AiProviderError extends Error {
  constructor(
    public readonly code: AiProviderErrorCode,
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "AiProviderError";
  }
}

export interface AiProviderAdapter {
  id: string;
  protocol: AiProviderProtocol;
  capabilities: AiProviderCapabilities;
  complete(request: AiChatRequest): Promise<AiChatResult>;
  stream(request: AiStreamRequest): Promise<void>;
}

/** Combine deliberate cancellation with the provider timeout. */
export function requestSignal(request: Pick<AiChatRequest, 'signal' | 'timeoutMs'>): AbortSignal | undefined {
  const timeout = request.timeoutMs > 0 ? AbortSignal.timeout(request.timeoutMs) : undefined;
  return request.signal && timeout ? AbortSignal.any([request.signal, timeout]) : request.signal ?? timeout;
}
