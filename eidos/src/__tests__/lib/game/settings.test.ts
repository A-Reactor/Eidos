import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  EIDOS_SETTINGS_CHANGE_EVENT,
  loadSettings,
  normalizeSettings,
  saveSettings,
} from "@/lib/game/settings";
import { DEFAULT_SETTINGS } from "@/lib/game/types";
import { MOTION, shouldReduceMotion } from "@/lib/ui/motion";

const storage = new Map<string, string>();

vi.stubGlobal("window", {});
vi.stubGlobal("localStorage", {
  getItem: vi.fn((key: string) => storage.get(key) ?? null),
  setItem: vi.fn((key: string, value: string) => storage.set(key, value)),
  removeItem: vi.fn((key: string) => storage.delete(key)),
  clear: vi.fn(() => storage.clear()),
});

beforeEach(() => {
  storage.clear();
  vi.mocked(localStorage.getItem).mockImplementation(
    (key: string) => storage.get(key) ?? null,
  );
});

afterAll(() => {
  vi.unstubAllGlobals();
});

describe("loadSettings", () => {
  it('defaults the thinking reserve for old or invalid settings and preserves an explicit off switch', () => {
    vi.stubGlobal('window', { dispatchEvent: vi.fn() });
    expect(normalizeSettings({}).reserveReasoningBudget).toBe(true);
    expect(normalizeSettings({ reserveReasoningBudget: 'false' }).reserveReasoningBudget).toBe(true);
    expect(saveSettings({ ...loadSettings(), reserveReasoningBudget: false })).toBe(true);
    expect(loadSettings().reserveReasoningBudget).toBe(false);
  });
  it("returns language and motion defaults when storage is empty", () => {
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
    expect(loadSettings()).toMatchObject({
      uzqEndpoint: "https://api.deepseek.com/v1",
      uzqApiKey: "",
      uzqModel: "deepseek-v4-pro",
      enableUzqAliceBrief: false,
      interfaceLanguage: "zh-CN",
      narrativeLanguage: "zh-CN",
      reduceMotion: false,
    });
  });

  it("fills new defaults into old settings while preserving saved fields", () => {
    localStorage.setItem("eidos_settings", JSON.stringify({ fontSize: "large" }));

    expect(loadSettings()).toMatchObject({
      fontSize: 2,
      interfaceLanguage: "zh-CN",
      narrativeLanguage: "zh-CN",
      reduceMotion: false,
      enableSpeculation: true,
      enableContentReview: true,
    });
  });

  it('preserves explicit disabled play features while defaulting missing or invalid values to enabled', () => {
    expect(normalizeSettings({ enableSpeculation: false, enableContentReview: false }))
      .toMatchObject({ enableSpeculation: false, enableContentReview: false });
    expect(normalizeSettings({ enableSpeculation: 'false', enableContentReview: null }))
      .toMatchObject({ enableSpeculation: true, enableContentReview: true });
  });

  it("loads valid language and motion preferences", () => {
    localStorage.setItem(
      "eidos_settings",
      JSON.stringify({
        interfaceLanguage: "en",
        narrativeLanguage: "en",
        reduceMotion: true,
      }),
    );

    expect(loadSettings()).toMatchObject({
      interfaceLanguage: "en",
      narrativeLanguage: "en",
      reduceMotion: true,
    });
  });

  it("normalizes UZQ settings independently from ALICE and KEI", () => {
    expect(
      normalizeSettings({
        uzqEndpoint: "https://uzq.example/v1",
        uzqApiKey: "uzq-key",
        uzqModel: "uzq-model",
        keiEndpoint: "https://kei.example/v1",
        keiApiKey: "kei-key",
        keiModel: "kei-model",
      }),
    ).toMatchObject({
      uzqEndpoint: "https://uzq.example/v1",
      uzqApiKey: "uzq-key",
      uzqModel: "uzq-model",
      keiEndpoint: "https://kei.example/v1",
      keiApiKey: "kei-key",
      keiModel: "kei-model",
    });
  });

  it("normalizes the UZQ-to-ALICE brief feature flag", () => {
    expect(normalizeSettings({ enableUzqAliceBrief: true })).toMatchObject({
      enableUzqAliceBrief: true,
    });
    expect(normalizeSettings({ enableUzqAliceBrief: "true" })).toMatchObject({
      enableUzqAliceBrief: false,
    });
  });

  it("normalizes invalid language and motion preferences", () => {
    localStorage.setItem(
      "eidos_settings",
      JSON.stringify({
        interfaceLanguage: "fr",
        narrativeLanguage: null,
        reduceMotion: "true",
      }),
    );

    expect(loadSettings()).toMatchObject({
      interfaceLanguage: "zh-CN",
      narrativeLanguage: "zh-CN",
      reduceMotion: false,
    });
  });

  it("falls back to defaults for corrupt JSON", () => {
    localStorage.setItem("eidos_settings", "not valid json{{{");

    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it.each(["null", "[]", "42", '"text"'])(
    "falls back to defaults for parsed non-record JSON %s",
    (raw) => {
      localStorage.setItem("eidos_settings", raw);

      expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
    },
  );

  it("falls back to defaults when localStorage throws", () => {
    vi.mocked(localStorage.getItem).mockImplementationOnce(() => {
      throw new Error("storage unavailable");
    });

    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it("returns defaults during server rendering", () => {
    const browserWindow = globalThis.window;
    vi.stubGlobal("window", undefined);

    try {
      expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
    } finally {
      vi.stubGlobal("window", browserWindow);
    }
  });
});

describe("saveSettings", () => {
  it("dispatches the shared change event exactly once after a successful write", () => {
    const dispatchEvent = vi.fn();
    vi.stubGlobal("window", { dispatchEvent });

    const saved = saveSettings(DEFAULT_SETTINGS);

    expect(saved).toBe(true);
    expect(localStorage.setItem).toHaveBeenCalledWith(
      "eidos_settings",
      JSON.stringify(DEFAULT_SETTINGS),
    );
    expect(dispatchEvent).toHaveBeenCalledTimes(1);
    expect(dispatchEvent.mock.calls[0][0]).toBeInstanceOf(Event);
    expect(dispatchEvent.mock.calls[0][0].type).toBe(EIDOS_SETTINGS_CHANGE_EVENT);
  });

  it("does not dispatch when storage rejects the write", () => {
    const dispatchEvent = vi.fn();
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal("window", { dispatchEvent });
    vi.mocked(localStorage.setItem).mockImplementationOnce(() => {
      throw new Error("denied");
    });

    const saved = saveSettings(DEFAULT_SETTINGS);

    expect(saved).toBe(false);
    expect(dispatchEvent).not.toHaveBeenCalled();
    expect(warning).toHaveBeenCalledOnce();
    warning.mockRestore();
  });

  it("does not write or dispatch during server rendering", () => {
    vi.mocked(localStorage.setItem).mockClear();
    vi.stubGlobal("window", undefined);

    const saved = saveSettings(DEFAULT_SETTINGS);

    expect(saved).toBe(false);
    expect(localStorage.setItem).not.toHaveBeenCalled();
  });
});

describe("normalizeSettings", () => {
  it("normalizes every invalid existing field and drops unknown keys", () => {
    const normalized = normalizeSettings({
      keiEndpoint: 1,
      keiApiKey: null,
      keiModel: false,
      aliceEndpoint: {},
      aliceApiKey: [],
      aliceModel: 7,
      temperature: 8,
      maxTokens: 2.5,
      fontSize: "huge",
      autoAdvance: "true",
      autoAdvanceDelay: 1200.8,
      autoSelect: 1,
      autoStopSteps: 2.5,
      autoSaveInterval: 3.9,
      unknownKey: "must be dropped",
    });

    expect(normalized).toEqual({
      ...DEFAULT_SETTINGS,
      temperature: 2,
      autoAdvanceDelay: 1200,
      autoSaveInterval: 3,
    });
    expect(normalized).not.toHaveProperty("unknownKey");
    expect(normalizeSettings({ temperature: -1 }).temperature).toBe(0);
  });

  it("preserves valid direct string and boolean fields", () => {
    expect(
      normalizeSettings({
        keiEndpoint: "kei-endpoint",
        keiApiKey: "",
        keiModel: "kei-model",
        aliceEndpoint: "alice-endpoint",
        aliceApiKey: "",
        aliceModel: "alice-model",
        autoAdvance: true,
        autoSelect: true,
      }),
    ).toMatchObject({
      keiEndpoint: "kei-endpoint",
      keiApiKey: "",
      keiModel: "kei-model",
      aliceEndpoint: "alice-endpoint",
      aliceApiKey: "",
      aliceModel: "alice-model",
      autoAdvance: true,
      autoSelect: true,
    });
  });

  it("migrates v0 API fields", () => {
    expect(
      normalizeSettings({
        apiKey: "shared-key",
        apiEndpoint: "legacy-endpoint",
        modelName: "legacy-model",
      }),
    ).toMatchObject({
      aliceApiKey: "shared-key",
      keiApiKey: "shared-key",
      aliceEndpoint: "legacy-endpoint",
      keiEndpoint: "legacy-endpoint",
      aliceModel: "legacy-model",
    });
  });

  it("migrates v1 KEY fields to KEI", () => {
    expect(
      normalizeSettings({
        keyApiKey: "kei-key",
        keyEndpoint: "kei-endpoint",
        keyModel: "kei-model",
      }),
    ).toMatchObject({
      keiApiKey: "kei-key",
      keiEndpoint: "kei-endpoint",
      keiModel: "kei-model",
    });
  });

  it("defaults new AI provider settings to easy DeepSeek simple mode", () => {
    expect(normalizeSettings({})).toMatchObject({
      aiProviderMode: "simple",
      aiGlobalProviderId: "deepseek",
      aiQualityProfile: "balanced",
      aliceProviderId: "deepseek",
      keiProviderId: "deepseek",
      uzqProviderId: "deepseek",
      aliceCompatibilityMode: "native",
      keiCompatibilityMode: "native",
      uzqCompatibilityMode: "native",
      aliceReasoningEffort: "high",
      keiReasoningEffort: "high",
      uzqReasoningEffort: "high",
    });
  });

  it("infers custom OpenAI-compatible provider for old non-DeepSeek endpoints", () => {
    expect(
      normalizeSettings({
        aliceEndpoint: "https://example.com/v1",
        aliceModel: "my-fast-model",
        keiEndpoint: "https://example.com/v1",
        keiModel: "my-smart-model",
      }),
    ).toMatchObject({
      aiGlobalProviderId: "custom-openai-compatible",
      aliceProviderId: "custom-openai-compatible",
      keiProviderId: "custom-openai-compatible",
      aliceCompatibilityMode: "openai",
      keiCompatibilityMode: "openai",
    });
  });

  it("preserves explicit advanced provider choices", () => {
    expect(
      normalizeSettings({
        aiProviderMode: "advanced",
        aiGlobalProviderId: "openai",
        aiQualityProfile: "quality",
        aliceProviderId: "openai",
        keiProviderId: "anthropic",
        uzqProviderId: "gemini",
        aliceCompatibilityMode: "native",
        keiCompatibilityMode: "anthropic",
        uzqCompatibilityMode: "native",
        keiEnableReasoning: true,
        keiReasoningEffort: "max",
      }),
    ).toMatchObject({
      aiProviderMode: "advanced",
      aiGlobalProviderId: "openai",
      aiQualityProfile: "quality",
      aliceProviderId: "openai",
      keiProviderId: "anthropic",
      uzqProviderId: "gemini",
      keiEnableReasoning: true,
      keiReasoningEffort: "max",
    });
  });
});

describe("motion preferences", () => {
  it.each([
    [false, false, false],
    [false, true, true],
    [true, false, true],
    [true, true, true],
  ])(
    "resolves setting %s and system preference %s to %s",
    (setting, systemPreference, expected) => {
      expect(shouldReduceMotion(setting, systemPreference)).toBe(expected);
    },
  );

  it("uses the exact motion timing tokens", () => {
    expect(MOTION).toEqual({
      feedback: 140,
      component: 220,
      spatial: 320,
      scene: 760,
      easing: "cubic-bezier(.22, 1, .36, 1)",
    });
  });
});

describe('interface palettes', () => {
  it('defaults old and invalid preferences to classic while preserving warm paper', () => {
    for (const value of [undefined, null, {}, 'unknown', 'classic']) expect(normalizeSettings({ interfacePalette: value }).interfacePalette).toBe('classic');
    expect(normalizeSettings({ interfacePalette: 'warm', interfaceTheme: 'dark' })).toMatchObject({ interfacePalette: 'warm', interfaceTheme: 'dark' });
  });
});

it('migrates empty ALICE preferences and uses a 15–35 percent compression boundary by default', () => {
  expect(normalizeSettings({})).toMatchObject({ aliceUserPrompt: '', contextCompressionLowerPercent: 15, contextCompressionUpperPercent: 35 });
  expect(normalizeSettings({ aliceUserPrompt: '自定偏好\n第二行', contextCompressionLowerPercent: 30, contextCompressionUpperPercent: 80 })).toMatchObject({ aliceUserPrompt: '自定偏好\n第二行', contextCompressionLowerPercent: 30, contextCompressionUpperPercent: 80 });
  expect(normalizeSettings({ aliceUserPrompt: 5, contextCompressionLowerPercent: 99, contextCompressionUpperPercent: 40 })).toMatchObject({ aliceUserPrompt: '', contextCompressionLowerPercent: 40, contextCompressionUpperPercent: 40 });
  expect(normalizeSettings({ contextCompressionLowerPercent: NaN, contextCompressionUpperPercent: Infinity })).toMatchObject({ contextCompressionLowerPercent: 15, contextCompressionUpperPercent: 35 });
});

it('defaults old display settings and clamps only valid overlay opacity numbers', () => {
  expect(normalizeSettings({})).toMatchObject({ hideNarrationInDialogue: true, sceneOverlayOpacity: 100 });
  expect(normalizeSettings({ hideNarrationInDialogue: false, sceneOverlayOpacity: -8 })).toMatchObject({ hideNarrationInDialogue: false, sceneOverlayOpacity: 0 });
  expect(normalizeSettings({ sceneOverlayOpacity: 120 }).sceneOverlayOpacity).toBe(100);
  expect(normalizeSettings({ sceneOverlayOpacity: NaN }).sceneOverlayOpacity).toBe(100);
  expect(normalizeSettings({ sceneOverlayOpacity: 24.6 }).sceneOverlayOpacity).toBe(25);
});
