// ============================================================
// Eidos · 游戏设置（localStorage 持久化）
// ============================================================

import { DEFAULT_SETTINGS, type GameSettings } from "./types";
import { normalizeCustomPalette, normalizeInterfacePalette } from "@/lib/ui/interface-palette";
import { normalizeModPreferences } from './plugins/preferences';
import { normalizeShortcuts } from './keyboard-shortcuts';

export const EIDOS_SETTINGS_STORAGE_KEY = "eidos_settings";
export const EIDOS_SETTINGS_CHANGE_EVENT = "eidos-settings-change";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isLanguage(value: unknown): value is GameSettings["interfaceLanguage"] {
  return value === "zh-CN" || value === "en";
}

function isInterfaceTheme(value: unknown): value is GameSettings["interfaceTheme"] {
  return value === "dark" || value === "light";
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function booleanOr(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function compressionPercent(value: unknown, min: number, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(min, Math.min(100, Math.round(value))) : fallback;
}

function isAiProviderMode(value: unknown): value is GameSettings["aiProviderMode"] {
  return value === "simple" || value === "advanced";
}

function isAiQualityProfile(value: unknown): value is GameSettings["aiQualityProfile"] {
  return value === "economy" || value === "balanced" || value === "quality";
}

function isCompatibilityMode(value: unknown): value is GameSettings["aliceCompatibilityMode"] {
  return value === "openai" || value === "anthropic" || value === "native";
}

function isReasoningEffort(value: unknown): value is GameSettings["keiReasoningEffort"] {
  return value === "low" || value === "medium" || value === "high" || value === "max";
}

function inferProviderId(saved: Record<string, unknown>): string {
  const explicit = stringOr(saved.aiGlobalProviderId, "");
  if (explicit) return explicit;
  const defaultEndpoint = DEFAULT_SETTINGS.aliceEndpoint;
  const aliceEndpoint = stringOr(saved.aliceEndpoint, stringOr(saved.apiEndpoint, defaultEndpoint));
  const keiEndpoint = stringOr(saved.keiEndpoint, aliceEndpoint);
  if (aliceEndpoint !== defaultEndpoint || keiEndpoint !== defaultEndpoint) {
    return "custom-openai-compatible";
  }
  return DEFAULT_SETTINGS.aiGlobalProviderId;
}

function inferredCompatibility(providerId: string): GameSettings["aliceCompatibilityMode"] {
  if (providerId === "custom-openai-compatible" || providerId === "openrouter") return "openai";
  if (providerId === "anthropic" || providerId === "custom-anthropic-compatible") return "anthropic";
  return "native";
}

function nonnegativeIntegerOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.trunc(value)
    : fallback;
}

export function normalizeSettings(input: unknown): GameSettings {
  const saved = isRecord(input) ? input : {};
  const legacyApiKey = stringOr(saved.apiKey, DEFAULT_SETTINGS.aliceApiKey);
  const legacyEndpoint = stringOr(saved.apiEndpoint, DEFAULT_SETTINGS.aliceEndpoint);

  const inferredProviderId = inferProviderId(saved);
  const defaultCompatibility = inferredCompatibility(inferredProviderId);

  // Constructing an allowlisted object keeps persisted and future unknown fields out.
  return {
    aiProviderMode: isAiProviderMode(saved.aiProviderMode)
      ? saved.aiProviderMode
      : DEFAULT_SETTINGS.aiProviderMode,
    aiGlobalProviderId: stringOr(saved.aiGlobalProviderId, inferredProviderId),
    aiCompatibleJsonMode: booleanOr(saved.aiCompatibleJsonMode, true),
    aiCompatibleStreamUsage: booleanOr(saved.aiCompatibleStreamUsage, true),
    aiQualityProfile: isAiQualityProfile(saved.aiQualityProfile)
      ? saved.aiQualityProfile
      : DEFAULT_SETTINGS.aiQualityProfile,
    aliceProviderId: stringOr(saved.aliceProviderId, stringOr(saved.aiGlobalProviderId, inferredProviderId)),
    keiProviderId: stringOr(saved.keiProviderId, stringOr(saved.aiGlobalProviderId, inferredProviderId)),
    uzqProviderId: stringOr(saved.uzqProviderId, stringOr(saved.aiGlobalProviderId, inferredProviderId)),
    aliceCompatibilityMode: isCompatibilityMode(saved.aliceCompatibilityMode)
      ? saved.aliceCompatibilityMode
      : defaultCompatibility,
    keiCompatibilityMode: isCompatibilityMode(saved.keiCompatibilityMode)
      ? saved.keiCompatibilityMode
      : defaultCompatibility,
    uzqCompatibilityMode: isCompatibilityMode(saved.uzqCompatibilityMode)
      ? saved.uzqCompatibilityMode
      : defaultCompatibility,
    aliceEnableReasoning: booleanOr(saved.aliceEnableReasoning, DEFAULT_SETTINGS.aliceEnableReasoning),
    keiEnableReasoning: booleanOr(saved.keiEnableReasoning, DEFAULT_SETTINGS.keiEnableReasoning),
    uzqEnableReasoning: booleanOr(saved.uzqEnableReasoning, DEFAULT_SETTINGS.uzqEnableReasoning),
    aliceContextWindowTokens: nonnegativeIntegerOr(saved.aliceContextWindowTokens, 0),
    keiContextWindowTokens: nonnegativeIntegerOr(saved.keiContextWindowTokens, 0),
    uzqContextWindowTokens: nonnegativeIntegerOr(saved.uzqContextWindowTokens, 0),
    reserveReasoningBudget: booleanOr(saved.reserveReasoningBudget, DEFAULT_SETTINGS.reserveReasoningBudget),
    aliceReasoningEffort: isReasoningEffort(saved.aliceReasoningEffort)
      ? saved.aliceReasoningEffort
      : DEFAULT_SETTINGS.aliceReasoningEffort,
    keiReasoningEffort: isReasoningEffort(saved.keiReasoningEffort)
      ? saved.keiReasoningEffort
      : DEFAULT_SETTINGS.keiReasoningEffort,
    uzqReasoningEffort: isReasoningEffort(saved.uzqReasoningEffort)
      ? saved.uzqReasoningEffort
      : DEFAULT_SETTINGS.uzqReasoningEffort,
    keiEndpoint: stringOr(
      saved.keiEndpoint,
      stringOr(saved.apiEndpoint, stringOr(saved.keyEndpoint, DEFAULT_SETTINGS.keiEndpoint)),
    ),
    keiApiKey: stringOr(
      saved.keiApiKey,
      stringOr(saved.apiKey, stringOr(saved.keyApiKey, DEFAULT_SETTINGS.keiApiKey)),
    ),
    keiModel: stringOr(saved.keiModel, stringOr(saved.keyModel, DEFAULT_SETTINGS.keiModel)),
    uzqEndpoint: stringOr(
      saved.uzqEndpoint,
      stringOr(saved.keiEndpoint, stringOr(saved.apiEndpoint, DEFAULT_SETTINGS.uzqEndpoint)),
    ),
    uzqApiKey: stringOr(
      saved.uzqApiKey,
      stringOr(saved.keiApiKey, stringOr(saved.apiKey, DEFAULT_SETTINGS.uzqApiKey)),
    ),
    uzqModel: stringOr(saved.uzqModel, stringOr(saved.keiModel, DEFAULT_SETTINGS.uzqModel)),
    enableUzqAliceBrief: booleanOr(
      saved.enableUzqAliceBrief,
      DEFAULT_SETTINGS.enableUzqAliceBrief,
    ),
    aliceEndpoint: stringOr(saved.aliceEndpoint, legacyEndpoint),
    aliceApiKey: stringOr(saved.aliceApiKey, legacyApiKey),
    aliceModel: stringOr(
      saved.aliceModel,
      stringOr(saved.modelName, DEFAULT_SETTINGS.aliceModel),
    ),
    temperature:
      typeof saved.temperature === "number" && Number.isFinite(saved.temperature)
        ? Math.min(2, Math.max(0, saved.temperature))
        : DEFAULT_SETTINGS.temperature,
    maxTokens:
      typeof saved.maxTokens === "number"
      && Number.isFinite(saved.maxTokens)
      && Number.isInteger(saved.maxTokens)
      && saved.maxTokens > 0
        ? saved.maxTokens
        : DEFAULT_SETTINGS.maxTokens,
    fontSize: normalizeFontSize(saved.fontSize),
    aliceUserPrompt: stringOr(saved.aliceUserPrompt, DEFAULT_SETTINGS.aliceUserPrompt),
    contextCompressionUpperPercent: compressionPercent(saved.contextCompressionUpperPercent, 1, DEFAULT_SETTINGS.contextCompressionUpperPercent),
    contextCompressionLowerPercent: Math.min(compressionPercent(saved.contextCompressionLowerPercent, 0, DEFAULT_SETTINGS.contextCompressionLowerPercent), compressionPercent(saved.contextCompressionUpperPercent, 1, DEFAULT_SETTINGS.contextCompressionUpperPercent)),
    interfaceLanguage: isLanguage(saved.interfaceLanguage)
      ? saved.interfaceLanguage
      : DEFAULT_SETTINGS.interfaceLanguage,
    narrativeLanguage: isLanguage(saved.narrativeLanguage)
      ? saved.narrativeLanguage
      : DEFAULT_SETTINGS.narrativeLanguage,
    interfaceTheme: isInterfaceTheme(saved.interfaceTheme)
      ? saved.interfaceTheme
      : DEFAULT_SETTINGS.interfaceTheme,
    interfacePalette: normalizeInterfacePalette(saved.interfacePalette),
    interfaceCustomColors: normalizeCustomPalette(saved.interfaceCustomColors),
    reduceMotion: booleanOr(saved.reduceMotion, DEFAULT_SETTINGS.reduceMotion),
    hideNarrationInDialogue: booleanOr(saved.hideNarrationInDialogue, DEFAULT_SETTINGS.hideNarrationInDialogue),
    sceneOverlayOpacity: compressionPercent(saved.sceneOverlayOpacity, 0, DEFAULT_SETTINGS.sceneOverlayOpacity),
    autoAdvance: booleanOr(saved.autoAdvance, DEFAULT_SETTINGS.autoAdvance),
    autoAdvanceDelay: nonnegativeIntegerOr(
      saved.autoAdvanceDelay,
      DEFAULT_SETTINGS.autoAdvanceDelay,
    ),
    autoSelect: booleanOr(saved.autoSelect, DEFAULT_SETTINGS.autoSelect),
    enableSpeculation: booleanOr(saved.enableSpeculation, DEFAULT_SETTINGS.enableSpeculation),
    enableContentReview: booleanOr(saved.enableContentReview, DEFAULT_SETTINGS.enableContentReview),
    autoStopSteps:
      typeof saved.autoStopSteps === "number"
      && Number.isFinite(saved.autoStopSteps)
      && Number.isInteger(saved.autoStopSteps)
      && saved.autoStopSteps >= 0
        ? saved.autoStopSteps
        : DEFAULT_SETTINGS.autoStopSteps,
    // The former default was unused by the pipeline. Migrate it to the slower background cadence.
    autoSaveInterval: saved.autoSaveInterval === 10 ? DEFAULT_SETTINGS.autoSaveInterval : nonnegativeIntegerOr(
      saved.autoSaveInterval,
      DEFAULT_SETTINGS.autoSaveInterval,
    ),
    keyboardShortcuts: normalizeShortcuts(saved.keyboardShortcuts),
    modPreferences: normalizeModPreferences(saved.modPreferences),
  };
}

export function loadSettings(): GameSettings {
  if (typeof window === "undefined") return { ...DEFAULT_SETTINGS };
  try {
    const raw = localStorage.getItem(EIDOS_SETTINGS_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed: unknown = JSON.parse(raw);
    return normalizeSettings(parsed);
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(s: GameSettings): boolean {
  if (typeof window === "undefined") return false;
  try {
    localStorage.setItem(EIDOS_SETTINGS_STORAGE_KEY, JSON.stringify(s));
    window.dispatchEvent(new Event(EIDOS_SETTINGS_CHANGE_EVENT));
    return true;
  } catch (error: unknown) {
    const detail = error instanceof Error ? error.message : error;
    console.warn("[Settings] saveSettings localStorage failed:", detail);
    return false;
  }
}

/** 字号映射：级别 1-4 → 根元素 font-size。级别 2 对应旧版"大"。 */
const FONT_SIZE_MAP: Record<GameSettings["fontSize"], string> = {
  1: "14px",
  2: "18px",
  3: "22px",
  4: "26px",
};

/** 迁移旧版字号字符串 → 新级别。旧"大" → 2，旧"中/小" → 1。 */
function normalizeFontSize(value: unknown): GameSettings["fontSize"] {
  if (typeof value === "number" && value >= 1 && value <= 4 && Number.isInteger(value)) {
    return value as GameSettings["fontSize"];
  }
  // 旧版字符串迁移：large → 2，其余回退到 1
  if (value === "large") return 2;
  return DEFAULT_SETTINGS.fontSize;
}

/** 应用字体大小到根元素 */
export function applyFontSize(size: GameSettings["fontSize"]): void {
  if (typeof document === "undefined") return;
  document.documentElement.style.fontSize = FONT_SIZE_MAP[size];
}
