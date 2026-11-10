import { describe, expect, it } from 'vitest';
import { normalizeCacheUsage, summarizeCacheUsage } from '@/lib/ai/cache-usage';
import type { TokenUsage } from '@/lib/ai/types';
describe('reported cache usage', () => {
  it('preserves DeepSeek hits and misses', () => expect(normalizeCacheUsage('deepseek-native', { prompt_tokens: 1000, prompt_cache_hit_tokens: 800, prompt_cache_miss_tokens: 200 })).toEqual({ cachedTokens: 800, uncachedPromptTokens: 200, cacheUsageReported: true }));
  it('maps OpenAI and Gemini cached tokens', () => {
    expect(normalizeCacheUsage('openai-native', { prompt_tokens: 1000, prompt_tokens_details: { cached_tokens: 600 } })).toMatchObject({ cachedTokens: 600, uncachedPromptTokens: 400, cacheUsageReported: true });
    expect(normalizeCacheUsage('gemini-native', { promptTokenCount: 1000, cachedContentTokenCount: 600 })).toMatchObject({ cachedTokens: 600, uncachedPromptTokens: 400, cacheUsageReported: true });
  });
  it('distinguishes Anthropic reads, writes and uncached input', () => expect(normalizeCacheUsage('anthropic-compatible', { input_tokens: 100, cache_creation_input_tokens: 200, cache_read_input_tokens: 700 })).toEqual({ cachedTokens: 700, cacheWriteTokens: 200, uncachedPromptTokens: 100, cacheUsageReported: true }));
  it('distinguishes a reported zero from unknown', () => {
    expect(normalizeCacheUsage('openai-compatible', { prompt_tokens: 1000 }).cacheUsageReported).toBe(false);
    expect(normalizeCacheUsage('openai-compatible', { prompt_tokens: 1000, prompt_tokens_details: { cached_tokens: 0 } })).toMatchObject({ cachedTokens: 0, cacheUsageReported: true });
  });
  it.each([-1, NaN, 1001])('rejects invalid reads %s', cached => expect(normalizeCacheUsage('deepseek-native', { prompt_tokens: 1000, prompt_cache_hit_tokens: cached }).cacheUsageReported).toBe(false));
  it('excludes unknown and estimates from a token-weighted ratio', () => {
    const base: TokenUsage = { promptTokens: 1000, completionTokens: 10, totalTokens: 1010, model: 'alice' };
    expect(summarizeCacheUsage([{ ...base, cachedTokens: 800, uncachedPromptTokens: 200, cacheUsageReported: true }, { ...base, promptTokens: 100, cachedTokens: 0, uncachedPromptTokens: 100, cacheUsageReported: true }, base, { ...base, usageEstimated: true, cacheUsageReported: true }])).toMatchObject({ reportedCalls: 2, unknownCalls: 1, estimatedCalls: 1, promptTokens: 1100, cachedTokens: 800, uncachedPromptTokens: 300, hitRate: 800 / 1100 });
    expect(summarizeCacheUsage([base]).hitRate).toBeUndefined();
  });
});
