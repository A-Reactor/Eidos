import { describe, expect, it } from "vitest";
import { canAutoPlay, autoPlayLimitReached } from "@/lib/ui/auto-play";

describe("automatic play", () => {
  it("allows the first action and stops after exactly the configured number", () => {
    expect(autoPlayLimitReached(0, 1)).toBe(false);
    expect(autoPlayLimitReached(1, 1)).toBe(true);
    expect(autoPlayLimitReached(2, 3)).toBe(false);
    expect(autoPlayLimitReached(3, 3)).toBe(true);
    expect(autoPlayLimitReached(100, 0)).toBe(false);
  });
  it("pauses when a draft or management panel is open", () => {
    expect(canAutoPlay({ draft: "等等", panelOpen: false, phase: "playing" })).toBe(false);
    expect(canAutoPlay({ draft: "", panelOpen: true, phase: "playing" })).toBe(false);
    expect(canAutoPlay({ draft: "", panelOpen: false, phase: "settings" })).toBe(false);
    expect(canAutoPlay({ draft: "", panelOpen: false, phase: "playing" })).toBe(true);
  });
});
