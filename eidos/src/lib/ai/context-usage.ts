import type { AiRoleConfig } from './providers/types';
import type { InputContextUsage, TokenUsage } from './types';

/** Published model windows, checked 2026-09-30. Custom deployments may use smaller windows. */
export function getModelContextWindow(config: Pick<AiRoleConfig, 'providerId' | 'model' | 'baseUrl'>): number | undefined {
  const hosts: Record<string, string> = { deepseek: 'api.deepseek.com', openai: 'api.openai.com',
    anthropic: 'api.anthropic.com', gemini: 'generativelanguage.googleapis.com', openrouter: 'openrouter.ai' };
  try { if (new URL(config.baseUrl).hostname !== hosts[config.providerId]) return undefined; }
  catch { return undefined; }
  const model = config.model.toLowerCase().replace(/^(openai|anthropic|google|deepseek)\//, '');
  // https://api-docs.deepseek.com/quick_start/pricing/ (1M, legacy v4-flash remains accepted).
  if (['deepseek', 'openrouter'].includes(config.providerId) &&
    /^(deepseek-flash|deepseek-v4-flash|deepseek-v4-pro|deepseek-v4\.1-flash)(-\d{4})?$/.test(model)) return 1_000_000;
  // https://developers.openai.com/api/docs/models/gpt-4o-mini and /gpt-4o
  if (['openai', 'openrouter'].includes(config.providerId) && /^gpt-4o(-mini)?(-\d{4}-\d{2}-\d{2})?$/.test(model)) return 128_000;
  // https://platform.claude.com/docs/en/build-with-claude/context-windows
  if (['anthropic', 'openrouter'].includes(config.providerId) && /^claude-3[.-]5-(haiku|sonnet)(-latest|-\d{8})?$/.test(model)) return 200_000;
  // https://ai.google.dev/gemini-api/docs/models/gemini-2.5-flash and /gemini-2.5-pro
  if (['gemini', 'openrouter'].includes(config.providerId) && /^gemini-2\.5-(flash|pro)$/.test(model)) return 1_048_576;
  return undefined;
}

export function buildInputContextUsage(config: AiRoleConfig, usage: TokenUsage): InputContextUsage | undefined {
  if (usage.model !== 'alice' || !Number.isFinite(usage.promptTokens) || usage.promptTokens < 0) return undefined;
  return { modelId: config.model, providerId: config.providerId, inputTokens: usage.promptTokens,
    windowTokens: config.contextWindowTokens ?? getModelContextWindow(config), estimated: usage.usageEstimated === true };
}
