import { describe, expect, it } from "vitest";
import { createPhaseSlice } from "@/store/slices/phase-slice";
import { hasIndependentConnections, roleProviderPatch, sharedKeyPatch } from "@/components/game/settings/connection-model";
import { DEFAULT_SETTINGS } from "@/lib/game/types";

describe("navigation returns", () => {
  it("returns through nested settings to the original world library", () => {
    const state: Record<string, any> = {};
    Object.assign(state, createPhaseSlice((patch) => Object.assign(state, typeof patch === "function" ? patch(state) : patch), () => state));
    state.setPhase("world_select");
    state.setPhase("settings");
    state.setPhase("gallery");
    state.goBack();
    expect(state.phase).toBe("settings");
    state.goBack();
    expect(state.phase).toBe("world_select");
  });
});

describe("connection editing isolation", () => {
  it("opens custom role models in the independent editor", () => {
    expect(hasIndependentConnections({ ...DEFAULT_SETTINGS, keiModel: "custom-kei" })).toBe(true);
  });
  it("changing a shared key does not reset endpoints or models", () => {
    const settings = { ...DEFAULT_SETTINGS, keiEndpoint: "https://kei.example/v1", keiModel: "custom-kei" };
    expect({ ...settings, ...sharedKeyPatch("new-key") }).toMatchObject({
      keiEndpoint: "https://kei.example/v1", keiModel: "custom-kei", aliceApiKey: "new-key", keiApiKey: "new-key", uzqApiKey: "new-key",
    });
  });
  it("changing ALICE provider leaves KEI untouched", () => {
    const updated = { ...DEFAULT_SETTINGS, ...roleProviderPatch("alice", "anthropic", "balanced") };
    expect(updated.keiProviderId).toBe(DEFAULT_SETTINGS.keiProviderId);
    expect(updated.keiEndpoint).toBe(DEFAULT_SETTINGS.keiEndpoint);
    expect(updated.aliceProviderId).toBe("anthropic");
    expect(updated.aliceCompatibilityMode).toBe("anthropic");
  });
});
