// ============================================================
// AI Provider Presets — built-in providers and quality profiles
// ============================================================

import type {
  AiModelRole,
  AiProviderProtocol,
  AiQualityProfileId,
} from "@/lib/ai/providers/types";

export interface AiProviderPreset {
  id: string;
  labelKey: string;
  protocol: AiProviderProtocol;
  defaultBaseUrl: string;
  defaultModel: string;
  envKey: string;
  models: Record<AiQualityProfileId, Record<AiModelRole, string>>;
  allowCustomBaseUrl: boolean;
  local?: boolean;
}

export interface AiQualityProfile {
  id: AiQualityProfileId;
  labelKey: string;
  descriptionKey: string;
}

export const AI_QUALITY_PROFILES: Record<AiQualityProfileId, AiQualityProfile> = {
  economy: {
    id: "economy",
    labelKey: "settings.aiQualityEconomy",
    descriptionKey: "settings.aiQualityEconomyHint",
  },
  balanced: {
    id: "balanced",
    labelKey: "settings.aiQualityBalanced",
    descriptionKey: "settings.aiQualityBalancedHint",
  },
  quality: {
    id: "quality",
    labelKey: "settings.aiQualityQuality",
    descriptionKey: "settings.aiQualityQualityHint",
  },
};

function localPreset(id: string, labelKey: string, port: number): AiProviderPreset {
  const roles = { alice: '', kei: '', uzq: '' };
  return { id, labelKey, protocol: 'openai-compatible', defaultBaseUrl: `http://127.0.0.1:${port}/v1`, defaultModel: '',
    envKey: `${id === 'ollama' ? 'OLLAMA' : 'LM_STUDIO'}_API_KEY`, local: true, allowCustomBaseUrl: true,
    models: { economy: roles, balanced: roles, quality: roles } };
}

export const AI_PROVIDER_PRESETS: Record<string, AiProviderPreset> = {
  deepseek: {
    id: "deepseek",
    labelKey: "settings.providerDeepSeek",
    protocol: "deepseek-native",
    defaultBaseUrl: "https://api.deepseek.com/v1",
    defaultModel: "deepseek-v4-flash",
    envKey: "DEEPSEEK_API_KEY",
    allowCustomBaseUrl: false,
    models: {
      economy: { alice: "deepseek-v4-flash", kei: "deepseek-v4-pro", uzq: "deepseek-v4-pro" },
      balanced: { alice: "deepseek-v4-flash", kei: "deepseek-v4-pro", uzq: "deepseek-v4-pro" },
      quality: { alice: "deepseek-v4-pro", kei: "deepseek-v4-pro", uzq: "deepseek-v4-pro" },
    },
  },
  openai: {
    id: "openai",
    labelKey: "settings.providerOpenAI",
    protocol: "openai-native",
    defaultBaseUrl: "https://api.openai.com/v1",
    defaultModel: "gpt-4o-mini",
    envKey: "OPENAI_API_KEY",
    allowCustomBaseUrl: false,
    models: {
      economy: { alice: "gpt-4o-mini", kei: "gpt-4o-mini", uzq: "gpt-4o-mini" },
      balanced: { alice: "gpt-4o-mini", kei: "gpt-4o", uzq: "gpt-4o" },
      quality: { alice: "gpt-4o", kei: "gpt-4o", uzq: "gpt-4o" },
    },
  },
  anthropic: {
    id: "anthropic",
    labelKey: "settings.providerAnthropic",
    protocol: "anthropic-compatible",
    defaultBaseUrl: "https://api.anthropic.com/v1",
    defaultModel: "claude-3-5-haiku-latest",
    envKey: "ANTHROPIC_API_KEY",
    allowCustomBaseUrl: false,
    models: {
      economy: { alice: "claude-3-5-haiku-latest", kei: "claude-3-5-sonnet-latest", uzq: "claude-3-5-sonnet-latest" },
      balanced: { alice: "claude-3-5-haiku-latest", kei: "claude-3-5-sonnet-latest", uzq: "claude-3-5-sonnet-latest" },
      quality: { alice: "claude-3-5-sonnet-latest", kei: "claude-3-5-sonnet-latest", uzq: "claude-3-5-sonnet-latest" },
    },
  },
  gemini: {
    id: "gemini",
    labelKey: "settings.providerGemini",
    protocol: "gemini-native",
    defaultBaseUrl: "https://generativelanguage.googleapis.com/v1beta",
    defaultModel: "gemini-2.5-flash",
    envKey: "GEMINI_API_KEY",
    allowCustomBaseUrl: false,
    models: {
      economy: { alice: "gemini-2.5-flash", kei: "gemini-2.5-flash", uzq: "gemini-2.5-flash" },
      balanced: { alice: "gemini-2.5-flash", kei: "gemini-2.5-pro", uzq: "gemini-2.5-pro" },
      quality: { alice: "gemini-2.5-pro", kei: "gemini-2.5-pro", uzq: "gemini-2.5-pro" },
    },
  },
  openrouter: {
    id: "openrouter",
    labelKey: "settings.providerOpenRouter",
    protocol: "openai-compatible",
    defaultBaseUrl: "https://openrouter.ai/api/v1",
    defaultModel: "openai/gpt-4o-mini",
    envKey: "OPENROUTER_API_KEY",
    allowCustomBaseUrl: false,
    models: {
      economy: { alice: "openai/gpt-4o-mini", kei: "openai/gpt-4o-mini", uzq: "openai/gpt-4o-mini" },
      balanced: { alice: "openai/gpt-4o-mini", kei: "anthropic/claude-3.5-sonnet", uzq: "anthropic/claude-3.5-sonnet" },
      quality: { alice: "anthropic/claude-3.5-sonnet", kei: "anthropic/claude-3.5-sonnet", uzq: "anthropic/claude-3.5-sonnet" },
    },
  },
  ollama: localPreset('ollama', 'settings.providerOllama', 11434),
  'lm-studio': localPreset('lm-studio', 'settings.providerLmStudio', 1234),
  "custom-openai-compatible": {
    id: "custom-openai-compatible",
    labelKey: "settings.providerCustomOpenAI",
    protocol: "openai-compatible",
    defaultBaseUrl: "http://127.0.0.1:11434/v1",
    defaultModel: "gpt-4o-mini",
    envKey: "OPENAI_COMPATIBLE_API_KEY",
    allowCustomBaseUrl: true,
    models: {
      economy: { alice: "gpt-4o-mini", kei: "gpt-4o-mini", uzq: "gpt-4o-mini" },
      balanced: { alice: "gpt-4o-mini", kei: "gpt-4o-mini", uzq: "gpt-4o-mini" },
      quality: { alice: "gpt-4o-mini", kei: "gpt-4o-mini", uzq: "gpt-4o-mini" },
    },
  },
  "custom-anthropic-compatible": {
    id: "custom-anthropic-compatible",
    labelKey: "settings.providerCustomAnthropic",
    protocol: "anthropic-compatible",
    defaultBaseUrl: "https://api.anthropic.com/v1",
    defaultModel: "claude-3-5-sonnet-latest",
    envKey: "ANTHROPIC_COMPATIBLE_API_KEY",
    allowCustomBaseUrl: true,
    models: {
      economy: { alice: "claude-3-5-haiku-latest", kei: "claude-3-5-haiku-latest", uzq: "claude-3-5-haiku-latest" },
      balanced: { alice: "claude-3-5-haiku-latest", kei: "claude-3-5-sonnet-latest", uzq: "claude-3-5-sonnet-latest" },
      quality: { alice: "claude-3-5-sonnet-latest", kei: "claude-3-5-sonnet-latest", uzq: "claude-3-5-sonnet-latest" },
    },
  },
};

export function getProviderPreset(providerId: string): AiProviderPreset {
  return AI_PROVIDER_PRESETS[providerId] ?? AI_PROVIDER_PRESETS.deepseek;
}

export function getRoleModelForQuality(
  providerId: string,
  role: AiModelRole,
  quality: AiQualityProfileId,
): string {
  const preset = getProviderPreset(providerId);
  return preset.models[quality]?.[role] ?? preset.defaultModel;
}
