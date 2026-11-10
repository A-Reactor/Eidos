import type { GameSettings } from "@/lib/game/types";
import { getProviderPreset, getRoleModelForQuality } from "@/lib/ai/provider-presets";

export const AI_ROLES = ["alice", "kei", "uzq"] as const;
export type ConnectionRole = typeof AI_ROLES[number];

export function roleProviderPatch(role: ConnectionRole, provider: string, quality: GameSettings["aiQualityProfile"]): Partial<GameSettings> {
  const preset = getProviderPreset(provider);
  return {
    [`${role}ProviderId`]: provider,
    [`${role}Endpoint`]: preset.defaultBaseUrl,
    [`${role}Model`]: getRoleModelForQuality(provider, role, quality),
    [`${role}CompatibilityMode`]: preset.protocol === "openai-compatible" ? "openai" : preset.protocol === "anthropic-compatible" ? "anthropic" : "native",
  };
}

export function sharedKeyPatch(value: string): Partial<GameSettings> {
  return { aliceApiKey: value, keiApiKey: value, uzqApiKey: value };
}

export function sharedProviderPatch(provider: string, quality: GameSettings["aiQualityProfile"]): Partial<GameSettings> {
  return Object.assign({ aiGlobalProviderId: provider }, ...AI_ROLES.map((role) => roleProviderPatch(role, provider, quality)));
}

export function hasIndependentConnections(settings: GameSettings): boolean {
  const custom = getProviderPreset(settings.aliceProviderId).allowCustomBaseUrl;
  return AI_ROLES.some((role) => settings[`${role}ProviderId`] !== settings.aliceProviderId || settings[`${role}Endpoint`] !== settings.aliceEndpoint || settings[`${role}ApiKey`] !== settings.aliceApiKey || settings[`${role}Model`] !== (custom ? settings.aliceModel : getRoleModelForQuality(settings[`${role}ProviderId`], role, settings.aiQualityProfile)));
}

export function qualityProfilePatch(settings: GameSettings, quality: GameSettings['aiQualityProfile']): Partial<GameSettings> {
  // A quality label cannot choose an installed model or reset a player's custom endpoint.
  if (getProviderPreset(settings.aiGlobalProviderId).allowCustomBaseUrl) return { aiQualityProfile: quality };
  return Object.assign({ aiQualityProfile: quality }, ...AI_ROLES.map(role => ({ [`${role}Model`]: getRoleModelForQuality(settings.aiGlobalProviderId, role, quality) })));
}
