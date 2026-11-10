import { preparePromptBudget } from './prompt-budget';
import { assertPromptSections, type AiPromptSections } from './prompt-layout';
import { normalizeCacheUsage } from './cache-usage';
import type { CreationUsageTiming } from './creation-stream';
import type { AiRoleConfig, AiToolHarness } from './providers/types';
import type { AiMediaPart } from './providers/media';
// ============================================================
// AI API 客户端 — 统一 LLM 接入层
// ============================================================

import { loadSettings } from "@/lib/game/settings";
import { withRetry } from "@/lib/game/retry";
import { resolveAiRoleConfig } from "./providers/config";
import { getProviderAdapter } from "./providers/registry";
import { AiGenerationError, emptyOutputError, withFailureUsage } from './providers/stream-control';
import { buildInputContextUsage } from './context-usage';
import type {
  AiChatResult,
  AiModelRole,
} from "./providers/types";
import {
  type TokenUsage,
  type StreamChunkCallback,
  type StreamDoneCallback,
  type StreamErrorCallback,
  type AiStreamActivity,
  type KeiReviewResult,
} from "./types";

// ============================================================
// 统一 AI 客户端门面
// ============================================================

function normalizeRuntimeSettings(override?: Record<string, string> | null): ReturnType<typeof loadSettings> {
  return {
    ...loadSettings(),
    ...(override ?? {}),
  };
}

let usageWorld: (() => string | null) | undefined;
function recordUsage(usage: TokenUsage): void {
  totalPromptTokens += usage.promptTokens;
  totalCompletionTokens += usage.completionTokens;
  totalTokensUsed += usage.totalTokens;
  for (const cb of _tokenUsageSubscribers) {
    try { cb(usage); } catch { /* ignore subscriber errors */ }
  }
  const cacheHit = usage.cachedTokens ?? 0;
  console.log(`[Token] +${usage.totalTokens} (累计 ${totalTokensUsed})${cacheHit > 0 ? ` [缓存命中 ${cacheHit}]` : ""}`);
}

/** Long creation tasks bypass the ordinary facade but share the same one-request ledger. */
export function recordCreationUsage(config: AiRoleConfig, role: AiModelRole, callType: string, raw: unknown, timing: CreationUsageTiming, worldId: string | null = null): TokenUsage {
  const r = raw as Record<string, number> | undefined;
  const reported = typeof r?.prompt_tokens === 'number' && Number.isSafeInteger(r.prompt_tokens) && r.prompt_tokens >= 0;
  const promptTokens = reported ? r!.prompt_tokens : Math.ceil(timing.promptChars / 2.5);
  const completionTokens = reported ? r!.completion_tokens ?? 0 : Math.ceil(timing.completionChars / 2.5);
  const usage: TokenUsage = { ...(timing.providerUsage ?? { promptTokens, completionTokens, totalTokens: reported ? r!.total_tokens ?? promptTokens + completionTokens : promptTokens + completionTokens,
    ...normalizeCacheUsage(config.protocol, raw), ...(reported ? {} : { usageEstimated: true }) }),
    providerId: config.providerId, modelId: config.model, model: role, callType, elapsedMs: timing.elapsedMs, firstTokenMs: timing.firstTokenMs, success: timing.success, worldId };
  recordUsage(usage); return usage;
}

function resolveModelRole(useKey: boolean | AiModelRole): AiModelRole {
  if (useKey === true) return "kei";
  if (useKey === false) return "alice";
  return useKey;
}

export async function callAi(options: {
  tools?: AiToolHarness;
  media?: AiMediaPart[];
  /** Independent resource tasks must never retry a possibly billed request implicitly. */
  noRetry?: boolean;
  role: AiModelRole;
  signal?: AbortSignal;
  systemPrompt: string;
  promptSections?: AiPromptSections;
  userMessage: string;
  temperature: number;
  maxTokens: number;
  jsonMode: boolean;
  timeoutMs: number;
  settingsOverride?: Record<string, string> | null;
  reasoningEffort?: "high" | "max";
  callType?: string;
}): Promise<AiChatResult> {
  assertPromptSections(options.systemPrompt, options.promptSections);
  const worldId = usageWorld?.();
  const effectiveSettings = normalizeRuntimeSettings(options.settingsOverride);
  const configured = resolveAiRoleConfig(options.role, effectiveSettings, options.settingsOverride);
  const config = { ...configured, reasoningEffort: options.reasoningEffort ?? configured.reasoningEffort };
  const budget = preparePromptBudget({ ...options, config });
  const adapter = getProviderAdapter(config.protocol);
  const result = await withRetry(
    () => { options.signal?.throwIfAborted(); return adapter.complete({
      tools: options.tools,
      media: options.media,
      signal: options.signal,
      role: options.role,
      systemPrompt: options.systemPrompt,
      promptSections: options.promptSections,
      userMessage: options.userMessage,
      temperature: options.temperature,
      maxTokens: options.maxTokens,
      generationMaxTokens: budget.generationMaxTokens,
      jsonMode: options.jsonMode,
      timeoutMs: options.timeoutMs,
      callType: options.callType,
      config: {
        ...config,
        reasoningEffort: options.reasoningEffort ?? config.reasoningEffort,
      },
    }); },
    { shouldRetry: error => !options.tools && !options.noRetry && !options.signal?.aborted && (error.name === "AbortError" || error.name === "TimeoutError" || error instanceof TypeError), maxRetries: 3, baseDelayMs: 1000, maxDelayMs: 10000 },
  ).catch(error => {
    if (error instanceof AiGenerationError && error.usage) {
      error.usage = { ...error.usage, providerId: config.providerId, modelId: config.model, worldId, promptBudget: budget.report };
      recordUsage(error.usage);
    }
    throw error;
  });
  // A billed thinking-only response must not become a successful game action or a paid automatic retry.
  const finishReason = result.usage.finishReason ?? result.rawFinishReason;
  const failure = result.content.trim() ? undefined : emptyOutputError(finishReason);
  const usage = { ...result.usage, promptBudget: budget.report, finishReason, outputChars: result.content.length,
    ...(failure ? { success: false, errorCode: failure.code } : {}),
    providerId: config.providerId, modelId: config.model, worldId, inputContext: result.usage.inputContext ?? buildInputContextUsage(config, result.usage) };
  recordUsage(usage);
  if (failure) throw withFailureUsage(failure, usage);
  return { ...result, usage };
}

export async function callAiStream(options: {
  tools?: AiToolHarness;
  media?: AiMediaPart[];
  role: "alice" | "kei";
  signal?: AbortSignal;
  systemPrompt: string;
  promptSections?: AiPromptSections;
  userMessage: string;
  temperature: number;
  maxTokens: number;
  timeoutMs: number;
  settingsOverride?: Record<string, string> | null;
  callType?: string;
  onUsage?: (usage: TokenUsage) => void;
  onActivity?: (activity: AiStreamActivity) => void;
  onChunk: StreamChunkCallback;
  onDone: StreamDoneCallback;
  onError: StreamErrorCallback;
}): Promise<void> {
  assertPromptSections(options.systemPrompt, options.promptSections);
  const worldId = usageWorld?.();
  const effectiveSettings = normalizeRuntimeSettings(options.settingsOverride);
  const configured = resolveAiRoleConfig(options.role, effectiveSettings, options.settingsOverride);
  const config = configured;
  const budget = preparePromptBudget({ ...options, config });
  const adapter = getProviderAdapter(config.protocol);
  await adapter.stream({
    tools: options.tools,
    media: options.media,
    signal: options.signal,
    role: options.role,
    systemPrompt: options.systemPrompt,
    promptSections: options.promptSections,
    userMessage: options.userMessage,
    temperature: options.temperature,
    maxTokens: options.maxTokens,
    generationMaxTokens: budget.generationMaxTokens,
    jsonMode: options.role === "alice",
    timeoutMs: options.timeoutMs,
    callType: options.callType,
    config,
    onChunk: options.onChunk,
    onActivity: options.onActivity,
    onUsage: usage => {
      const annotated = { ...usage, promptBudget: budget.report, providerId: config.providerId, modelId: config.model, worldId, inputContext: usage.inputContext ?? buildInputContextUsage(config, usage) };
      recordUsage(annotated); options.onUsage?.(annotated);
    },
    onDone: (fullText, usage) => {
      const annotated = { ...usage, promptBudget: budget.report, providerId: config.providerId, modelId: config.model, worldId, inputContext: usage.inputContext ?? buildInputContextUsage(config, usage) };
      recordUsage(annotated);
      options.onDone(fullText, annotated);
    },
    onError: options.onError,
  });
}

export function getAliceConfig(override?: Record<string, string> | null) {
  return resolveAiRoleConfig("alice", normalizeRuntimeSettings(override), override);
}

export function getKeiConfig(override?: Record<string, string> | null) {
  return resolveAiRoleConfig("kei", normalizeRuntimeSettings(override), override);
}

export function getUzqConfig(override?: Record<string, string> | null) {
  return resolveAiRoleConfig("uzq", normalizeRuntimeSettings(override), override);
}

// ============================================================
// 请求级设置覆盖（全局引用路径）
// ============================================================

/** 当前请求的客户端设置覆盖。
 *  ⚠️ 仅用于全局 token 追踪订阅（subscribeTokenUsage/subscribeKeiCorrection 等
 *  不经过 callDeepSeek 的路径）。所有 API 调用路径通过参数显式传递 settings，
 *  避免并发请求互相覆盖。 */
export let _currentSettings: Record<string, string> | null = null;
export function setCurrentSettings(s: Record<string, string> | null) { _currentSettings = s; }

// ============================================================
// Token 用量追踪
// ============================================================

/** 全局累计 token 消耗 */
export let totalTokensUsed = 0;
export let totalPromptTokens = 0;
export let totalCompletionTokens = 0;
/** KEI 异步调用积压的 token（在下一次 API 响应中一起返回） */
export let pendingKeiTokens: TokenUsage[] = [];
/** pendingKeiTokens 最大积压数，超过则丢弃最旧的 */
const MAX_PENDING_KEI_TOKENS = 20;

/** Token 使用量订阅者（支持多个消费者同时监听） */
const _tokenUsageSubscribers = new Set<(usage: TokenUsage) => void>();
/** KEI 审核结果订阅者（支持多个消费者同时监听） */
export const _keiCorrectionSubscribers = new Set<(result: KeiReviewResult) => void>();

/** 订阅 token 使用量更新。返回 unsubscribe 函数 */
export function subscribeTokenUsage(cb: (usage: TokenUsage) => void, resolveWorld?: () => string | null): () => void {
  if (resolveWorld) usageWorld = resolveWorld;
  _tokenUsageSubscribers.add(cb);
  return () => { _tokenUsageSubscribers.delete(cb); if (usageWorld === resolveWorld) usageWorld = undefined; };
}
/** 订阅 KEI 审核结果。返回 unsubscribe 函数 */
export function subscribeKeiCorrection(cb: (result: KeiReviewResult) => void): () => void {
  _keiCorrectionSubscribers.add(cb);
  return () => { _keiCorrectionSubscribers.delete(cb); };
}
export function drainPendingTokens(): TokenUsage[] { const t = pendingKeiTokens; pendingKeiTokens = []; return t; }

// ============================================================
// 兼容导出：callDeepSeek / callDeepSeekStream
// ============================================================

/** @deprecated 使用 callAi({ role, ... }) 替代 */
export async function callDeepSeek(
  systemPrompt: string,
  userMessage: string,
  temperature = 0.85,
  maxTokens = 4000,
  jsonMode = true,
  timeoutMs = 90000,
  useKey: boolean | AiModelRole = false,
  settingsOverride?: Record<string, string> | null,
  reasoningEffort?: "high" | "max",
  callType?: string,
  signal?: AbortSignal,
): Promise<{ content: string; usage: TokenUsage; elapsedMs: number }> {
  const role = resolveModelRole(useKey);
  return callAi({
    role,
    systemPrompt,
    userMessage,
    temperature,
    maxTokens,
    jsonMode,
    timeoutMs,
    settingsOverride,
    reasoningEffort,
    callType,
    signal,
  });
}

/** @deprecated 使用 callAiStream({ role, ... }) 替代 */
export async function callDeepSeekStream(
  systemPrompt: string,
  userMessage: string,
  temperature: number,
  maxTokens: number,
  useKey: boolean,
  onChunk: StreamChunkCallback,
  onDone: StreamDoneCallback,
  onError: StreamErrorCallback,
  timeoutMs = 120000,
  settingsOverride?: Record<string, string> | null,
  callType?: string,
): Promise<void> {
  await callAiStream({
    role: useKey ? "kei" : "alice",
    systemPrompt,
    userMessage,
    temperature,
    maxTokens,
    timeoutMs,
    settingsOverride,
    callType,
    onChunk,
    onDone,
    onError,
  });
}

// ============================================================
// JSON 解析工具
// ============================================================

/**
 * 通用 JSON 截断修复：扫描字符找到最后一个完整的顶层字段边界，
 * 在边界处截断并闭合 `}`，返回修复后的 JSON 字符串。
 * 无法找到有效边界时返回 null。
 *
 * 与 salvagePartialWorldJSON 使用相同的字符级状态机。
 */
export function salvageTruncatedJSON(raw: string): string | null {
  // 去掉可能的 markdown fence 前缀
  let json = raw.replace(/^```json\s*/i, "").replace(/```\s*$/i, "");

  // 找到第一个 `{`
  const startBrace = json.indexOf("{");
  if (startBrace === -1) return null;
  json = json.slice(startBrace);

  // 字符级扫描：追踪深度、字符串、转义
  let depth = 0;
  let inString = false;
  let escaped = false;
  let lastGoodComma = -1;   // 最后一个 depth=1 的逗号
  let lastGoodBrace = -1;   // 最后一个 depth 降回 0 的位置

  for (let i = 0; i < json.length; i++) {
    const ch = json[i];
    if (escaped) { escaped = false; continue; }
    if (ch === "\\") { escaped = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === "{" || ch === "[") { depth++; continue; }
    if (ch === "}" || ch === "]") {
      depth--;
      if (depth === 0) lastGoodBrace = i + 1; // 顶层对象闭合完成
      continue;
    }
    if (ch === "," && depth === 1) {
      lastGoodComma = i;
    }
  }

  // 优先用最后一个 depth=1 的逗号截断（保留已完成字段），其次用顶层闭合括号
  const cutPos = lastGoodComma > 0 ? lastGoodComma : lastGoodBrace;
  if (cutPos <= 0) return null;

  const repaired = json.slice(0, cutPos) + "}";
  if (repaired.length < 3) return null; // 太短，无意义
  return repaired;
}

export function parseJSON<T>(raw: string, fallback?: T): T {
  // 防御：空响应
  if (!raw || raw.trim().length === 0) {
    if (fallback !== undefined) return fallback;
    throw new Error("Failed to parse AI response: (empty)");
  }
  // 先尝试提取 ```json 代码块
  const fenceMatch = raw.match(/```json\s*([\s\S]*?)```/);
  if (fenceMatch) {
    try { return JSON.parse(fenceMatch[1].trim()); } catch { /* fall through */ }
  }
  try {
    return JSON.parse(raw);
  } catch {
    const match = raw.match(/\{[\s\S]*\}/);
    if (match) {
      try { return JSON.parse(match[0]); } catch { /* fall through */ }
    }
    // 通用 JSON 截断修复（字符级扫描，零类型知识）
    const salvaged = salvageTruncatedJSON(raw);
    if (salvaged !== null) {
      try {
        const result = JSON.parse(salvaged);
        console.warn(`[parseJSON] Salvaged truncated JSON (${raw.length} → ${salvaged.length} chars)`);
        return result as T;
      } catch {
        // 修复后仍解析失败，继续 fallback/throw
      }
    }
    if (fallback !== undefined) return fallback;
    throw new Error(`Failed to parse AI response: ${raw.slice(0, 200)}`);
  }
}
