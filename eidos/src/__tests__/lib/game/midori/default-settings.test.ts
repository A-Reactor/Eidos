import { describe, expect, it } from "vitest";

import { DEFAULT_MIDORI_SETTINGS } from "@/lib/game/midori/types";

describe("MIDORI default settings", () => {
  it("keeps local image generation as an explicit opt-in feature", () => {
    expect(DEFAULT_MIDORI_SETTINGS).toMatchObject({
      enabled: false,
      autoGenerate: false,
      model: "pixel-art-xl",
      pixelate: true,
    });
  });
});
