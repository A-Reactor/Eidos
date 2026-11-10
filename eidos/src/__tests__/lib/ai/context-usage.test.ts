import { describe, expect, it } from 'vitest';
import { buildInputContextUsage, getModelContextWindow } from '@/lib/ai/context-usage';
import { resolveAiRoleConfig } from '@/lib/ai/providers/config';
import { DEFAULT_SETTINGS } from '@/lib/game/types';

describe('ALICE input context metadata', () => {
  it.each([
    ['deepseek', 'deepseek-v4-flash', 'https://api.deepseek.com/v1', 1_000_000],
    ['openai', 'gpt-4o-mini', 'https://api.openai.com/v1', 128_000],
    ['anthropic', 'claude-3-5-sonnet-latest', 'https://api.anthropic.com/v1', 200_000],
    ['gemini', 'gemini-2.5-flash', 'https://generativelanguage.googleapis.com/v1beta', 1_048_576],
    ['openrouter', 'openai/gpt-4o-mini', 'https://openrouter.ai/api/v1', 128_000],
  ])('recognizes published %s model windows', (providerId, model, baseUrl, window) => {
    expect(getModelContextWindow({ providerId: String(providerId), model: String(model), baseUrl: String(baseUrl) })).toBe(window);
  });
  it('does not infer the official limit for unknown models or custom deployments', () => {
    expect(getModelContextWindow({ providerId: 'custom-openai-compatible', model: 'gpt-4o-mini', baseUrl: 'http://127.0.0.1:11434/v1' })).toBeUndefined();
    expect(getModelContextWindow({ providerId: 'openai', model: 'gpt-4o-mini', baseUrl: 'https://example.com/v1' })).toBeUndefined();
    expect(getModelContextWindow({ providerId: 'deepseek', model: 'future-model', baseUrl: 'https://api.deepseek.com/v1' })).toBeUndefined();
  });
  it('keeps cache-hit input in the occupancy and excludes generated output', () => {
    const config = resolveAiRoleConfig('alice', DEFAULT_SETTINGS);
    expect(buildInputContextUsage(config, { model: 'alice', promptTokens: 5000, cachedTokens: 4500, completionTokens: 8000, totalTokens: 13000 })).toMatchObject({
      modelId: DEFAULT_SETTINGS.aliceModel, providerId: 'deepseek', inputTokens: 5000, estimated: false,
    });
    expect(buildInputContextUsage(config, { model: 'kei', promptTokens: 5000, completionTokens: 0, totalTokens: 5000 })).toBeUndefined();
  });
});
