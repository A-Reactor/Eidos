import type { TokenUsage } from './types';
import type { AiProviderProtocol } from './providers/types';
type CacheUsage = Pick<TokenUsage, 'cachedTokens' | 'uncachedPromptTokens' | 'cacheWriteTokens' | 'cacheUsageReported'>;
const count = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

/** Cache reads occupy input context; Anthropic writes are a third, separately billed partition. */
export function normalizeCacheUsage(protocol: AiProviderProtocol, raw: unknown): CacheUsage {
  const unknown: CacheUsage = { cacheUsageReported: false };
  if (!raw || typeof raw !== 'object') return unknown;
  const r = raw as Record<string, unknown>;
  let prompt: unknown, read: unknown, miss: unknown, write: unknown;
  if (protocol === 'anthropic-compatible') {
    if (r.cache_read_input_tokens === undefined && r.cache_creation_input_tokens === undefined) return unknown;
    read = r.cache_read_input_tokens ?? 0; write = r.cache_creation_input_tokens ?? 0; miss = r.input_tokens;
    if (!count(read) || !count(write) || !count(miss)) return unknown;
    prompt = read + write + miss;
  } else {
    prompt = protocol === 'gemini-native' ? r.promptTokenCount : r.prompt_tokens;
    const details = r.prompt_tokens_details;
    const cached = details && typeof details === 'object' ? (details as Record<string, unknown>).cached_tokens : undefined;
    read = protocol === 'gemini-native' ? r.cachedContentTokenCount : r.prompt_cache_hit_tokens ?? cached;
    if (!count(prompt) || !count(read) || read > prompt) return unknown;
    miss = r.prompt_cache_miss_tokens ?? prompt - read;
    if (!count(miss) || read + miss !== prompt) return unknown;
  }
  if (!count(prompt) || !count(read) || !count(miss)) return unknown;
  return { cachedTokens: read, uncachedPromptTokens: miss, ...(write === undefined ? {} : { cacheWriteTokens: write as number }), cacheUsageReported: true };
}

export function summarizeCacheUsage(usages: readonly TokenUsage[]) {
  let reportedCalls = 0, unknownCalls = 0, estimatedCalls = 0;
  let promptTokens = 0, cachedTokens = 0, cacheWriteTokens = 0, uncachedPromptTokens = 0;
  for (const usage of usages) {
    if (usage.usageEstimated) { estimatedCalls++; continue; }
    const read = usage.cachedTokens, write = usage.cacheWriteTokens ?? 0, miss = usage.uncachedPromptTokens;
    if (!usage.cacheUsageReported || !count(usage.promptTokens) || !count(read) || !count(write) || !count(miss) || read + write + miss !== usage.promptTokens) { unknownCalls++; continue; }
    reportedCalls++; promptTokens += usage.promptTokens; cachedTokens += read; cacheWriteTokens += write; uncachedPromptTokens += miss;
  }
  return { reportedCalls, unknownCalls, estimatedCalls, promptTokens, cachedTokens, cacheWriteTokens, uncachedPromptTokens, hitRate: promptTokens > 0 ? cachedTokens / promptTokens : undefined };
}
