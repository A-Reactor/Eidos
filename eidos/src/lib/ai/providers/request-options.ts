import type { AiChatRequest, AiRoleConfig } from './types';

/** Infer vendor parameters only for the vendor's protocol, never from a local model's name. */
export function isOpenAiReasoning(config: AiRoleConfig): boolean {
  return config.protocol === 'openai-native' && /^(?:o[134](?:-|$)|gpt-5(?:[.-]|$))/.test(config.model);
}

export function claudeThinkingMode(config: AiRoleConfig): 'manual' | 'adaptive' | undefined {
  if (config.protocol !== 'anthropic-compatible') return;
  if (/^claude-3[.-]7-sonnet/.test(config.model)) return 'manual';
  // A dated alias such as sonnet-4-20250514 is still version 4.0.
  const version = config.model.match(/^claude-(?:sonnet|opus|haiku)-(\d+)(?:[.-](\d{1,2})(?=-|$))?/);
  if (!version || Number(version[1]) < 4) return;
  return Number(version[1]) > 4 || Number(version[2] ?? 0) >= 6 ? 'adaptive' : 'manual';
}

export function claudeThinkingBudget(config: AiRoleConfig): number {
  return { low: 1024, medium: 2048, high: 4096, max: 8192 }[config.reasoningEffort];
}

export function geminiThinkingConfig(config: AiRoleConfig): Record<string, number | string> | undefined {
  if (config.protocol !== 'gemini-native') return;
  if (/^gemini-2\.5-(?:flash|pro)(?:-|$)/.test(config.model)) {
    const minimum = /^gemini-2\.5-pro/.test(config.model) ? 128 : 0;
    return { thinkingBudget: config.enableReasoning ? { low: 1024, medium: 4096, high: 8192, max: 16384 }[config.reasoningEffort] : minimum };
  }
  if (/^gemini-3(?:[.-]|$)/.test(config.model)) {
    return { thinkingLevel: config.enableReasoning && ['high', 'max'].includes(config.reasoningEffort) ? 'high' : 'low' };
  }
}

/** These are extra shared output tokens; the common context preflight may reduce the reserve. */
export function extraReasoningTokens(config: AiRoleConfig): number {
  if (!config.enableReasoning || config.reserveReasoningBudget === false) return 0;
  if (isOpenAiReasoning(config)) return { low: 2048, medium: 4096, high: 8192, max: 16384 }[config.reasoningEffort];
  if (claudeThinkingMode(config)) return claudeThinkingBudget(config);
  const gemini = geminiThinkingConfig(config);
  if (gemini) return typeof gemini.thinkingBudget === 'number' ? gemini.thinkingBudget : 8192;
  return 0;
}

export function openAiGenerationOptions(request: AiChatRequest): Record<string, unknown> {
  const limit = request.generationMaxTokens ?? request.maxTokens;
  if (!isOpenAiReasoning(request.config)) return { temperature: request.temperature, max_tokens: limit };
  // Some reasoning models cannot turn thinking off or accept sampling parameters.
  return { max_completion_tokens: limit, reasoning_effort: request.config.enableReasoning
    ? request.config.reasoningEffort === 'max' ? 'high' : request.config.reasoningEffort : 'low' };
}
