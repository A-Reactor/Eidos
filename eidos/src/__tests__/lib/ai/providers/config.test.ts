import { describe, expect, it, vi } from "vitest";

import { DEFAULT_SETTINGS } from "@/lib/game/types";
import { normalizeProviderError } from "@/lib/ai/providers/errors";
import { resolveAiRoleConfig } from "@/lib/ai/providers/config";

describe("resolveAiRoleConfig", () => {
  it.each(['alice', 'kei', 'uzq'] as const)('passes the reserve setting to %s and honors a boolean runtime override', role => {
    expect(resolveAiRoleConfig(role).reserveReasoningBudget).toBe(true);
    expect(resolveAiRoleConfig(role, { ...DEFAULT_SETTINGS, reserveReasoningBudget: false }).reserveReasoningBudget).toBe(false);
    expect(resolveAiRoleConfig(role, DEFAULT_SETTINGS, { reserveReasoningBudget: false }).reserveReasoningBudget).toBe(false);
  });
  it("resolves DeepSeek role config from settings", () => {
    const cfg = resolveAiRoleConfig("kei", {
      ...DEFAULT_SETTINGS,
      keiApiKey: "kei-key",
      keiModel: "deepseek-v4-pro",
    });

    expect(cfg).toMatchObject({
      providerId: "deepseek",
      protocol: "deepseek-native",
      baseUrl: "https://api.deepseek.com/v1",
      apiKey: "kei-key",
      model: "deepseek-v4-pro",
      compatibilityMode: "native",
      enableReasoning: true,
      reasoningEffort: "high",
    });
  });

  it("uses role-specific override before settings", () => {
    const cfg = resolveAiRoleConfig("alice", DEFAULT_SETTINGS, {
      aliceProviderId: "openai",
      aliceEndpoint: "https://override.example/v1",
      aliceApiKey: "override-key",
      aliceModel: "override-model",
    });

    expect(cfg.providerId).toBe("openai");
    expect(cfg.baseUrl).toBe("https://override.example/v1");
    expect(cfg.apiKey).toBe("override-key");
    expect(cfg.model).toBe("override-model");
  });

  it("falls back to provider environment variable", () => {
    vi.stubEnv("OPENAI_API_KEY", "env-openai-key");
    const cfg = resolveAiRoleConfig("alice", {
      ...DEFAULT_SETTINGS,
      aiGlobalProviderId: "openai",
      aliceProviderId: "openai",
      aliceApiKey: "",
    });

    expect(cfg.apiKey).toBe("env-openai-key");
    vi.unstubAllEnvs();
  });

  it("keeps legacy DEEPSEEK_API_KEY fallback for DeepSeek", () => {
    vi.stubEnv("DEEPSEEK_API_KEY", "legacy-deepseek-key");
    const cfg = resolveAiRoleConfig("alice", {
      ...DEFAULT_SETTINGS,
      aliceApiKey: "",
    });

    expect(cfg.apiKey).toBe("legacy-deepseek-key");
    vi.unstubAllEnvs();
  });
});

describe("normalizeProviderError", () => {
  it.each([
    [401, "auth_failed"],
    [403, "auth_failed"],
    [404, "model_not_found"],
    [429, "rate_limited"],
    [500, "provider_error"],
  ] as const)("maps HTTP %s to %s", (status, code) => {
    expect(normalizeProviderError(status, "provider message").code).toBe(code);
  });

  it("maps fetch failures to provider_unreachable", () => {
    const err = normalizeProviderError(undefined, "fetch failed");

    expect(err.code).toBe("provider_unreachable");
    expect(err.message).toContain("Connection failed");
  });

  it("maps local missing key checks to a missing API key error", () => {
    const err = normalizeProviderError(undefined, "missing api key");

    expect(err.code).toBe("missing_api_key");
    expect(err.message).toContain("API key is missing");
  });
});
