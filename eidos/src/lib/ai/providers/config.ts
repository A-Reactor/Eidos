// ============================================================
// AI Role Config Resolution — resolve ALICE/KEI/UZQ config from settings
// ============================================================

import { DEFAULT_SETTINGS, type GameSettings } from "@/lib/game/types";
import { AI_PROVIDER_PRESETS, getProviderPreset } from "@/lib/ai/provider-presets";
import type { AiModelRole, AiRoleConfig } from "./types";

type SettingsOverride = Partial<Record<string, string | boolean | number>>;

/** Per-role field name maps — avoids template literal indexing issues. */
interface RoleFields {
  providerId: keyof GameSettings;
  endpoint: keyof GameSettings;
  apiKey: keyof GameSettings;
  model: keyof GameSettings;
  compatibilityMode: keyof GameSettings;
  enableReasoning: keyof GameSettings;
  reasoningEffort: keyof GameSettings;
}

const ROLE_FIELDS: Record<AiModelRole, RoleFields> = {
  alice: {
    providerId: "aliceProviderId",
    endpoint: "aliceEndpoint",
    apiKey: "aliceApiKey",
    model: "aliceModel",
    compatibilityMode: "aliceCompatibilityMode",
    enableReasoning: "aliceEnableReasoning",
    reasoningEffort: "aliceReasoningEffort",
  },
  kei: {
    providerId: "keiProviderId",
    endpoint: "keiEndpoint",
    apiKey: "keiApiKey",
    model: "keiModel",
    compatibilityMode: "keiCompatibilityMode",
    enableReasoning: "keiEnableReasoning",
    reasoningEffort: "keiReasoningEffort",
  },
  uzq: {
    providerId: "uzqProviderId",
    endpoint: "uzqEndpoint",
    apiKey: "uzqApiKey",
    model: "uzqModel",
    compatibilityMode: "uzqCompatibilityMode",
    enableReasoning: "uzqEnableReasoning",
    reasoningEffort: "uzqReasoningEffort",
  },
};

const ROLE_ENV_KEYS: Record<AiModelRole, string> = {
  alice: "ALICE_API_KEY",
  kei: "KEI_API_KEY",
  uzq: "UZQ_API_KEY",
};

export function resolveAiRoleConfig(
  role: AiModelRole,
  settings: GameSettings = DEFAULT_SETTINGS,
  override?: SettingsOverride | null,
): AiRoleConfig {
  const fields = ROLE_FIELDS[role];

  const providerId = (stringValue(override?.[fields.providerId])
    || String(settings[fields.providerId])
    || String(settings.aiGlobalProviderId)
    || "deepseek") as string;

  const preset = getProviderPreset(providerId);
  if (!Object.hasOwn(AI_PROVIDER_PRESETS, providerId)) throw new Error(`Unknown AI provider: ${providerId}`);

  const endpoint = (stringValue(override?.[fields.endpoint])
    || String(settings[fields.endpoint])
    || preset.defaultBaseUrl) as string;

  const model = (stringValue(override?.[fields.model])
    || String(settings[fields.model])
    || preset.defaultModel) as string;

  const apiKey = (stringValue(override?.[fields.apiKey])
    || String(settings[fields.apiKey])
    || (preset.local ? '' : env(ROLE_ENV_KEYS[role]))
    || env(preset.envKey)
    || (providerId === "deepseek" ? env("DEEPSEEK_API_KEY") : "")) as string;

  const compatibilityMode = (String(settings[fields.compatibilityMode]) as AiRoleConfig["compatibilityMode"]) || "native";
  const enableReasoning = typeof override?.[fields.enableReasoning] === 'boolean' ? Boolean(override[fields.enableReasoning]) : Boolean(settings[fields.enableReasoning]);
  const reasoningEffort = (stringValue(override?.[fields.reasoningEffort]) || String(settings[fields.reasoningEffort])) as AiRoleConfig['reasoningEffort'];
  if (!model.trim()) throw new Error(`${role.toUpperCase()} model ID is missing.`);

  return {
    providerId,
    protocol: preset.protocol,
    baseUrl: endpoint.trim().replace(/\/+$/, ""),
    apiKey,
    model,
    compatibilityMode,
    enableReasoning,
    reserveReasoningBudget: typeof override?.reserveReasoningBudget === 'boolean'
      ? override.reserveReasoningBudget : settings.reserveReasoningBudget !== false,
    reasoningEffort,
    useJsonMode: preset.protocol !== 'openai-compatible' || (override?.aiCompatibleJsonMode ?? settings.aiCompatibleJsonMode) !== false,
    includeStreamUsage: preset.protocol !== 'openai-compatible' || (override?.aiCompatibleStreamUsage ?? settings.aiCompatibleStreamUsage) !== false,
    contextWindowTokens: windowValue(override?.[`${role}ContextWindowTokens`] ?? settings[`${role}ContextWindowTokens`]),
  };
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function env(key: string): string {
  if (typeof process === "undefined" || !process.env) return "";
  return process.env[key] ?? "";
}

function windowValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : undefined;
}
