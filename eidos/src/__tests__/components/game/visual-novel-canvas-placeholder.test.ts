import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("Visual novel canvas placeholder", () => {
  it("does not use a hard black fallback when scene art is absent", () => {
    const canvasSource = readFileSync(join(process.cwd(), "src/components/game/VisualNovelCanvas.tsx"), "utf-8");
    const backgroundSource = readFileSync(join(process.cwd(), "src/components/game/BackgroundLayer.tsx"), "utf-8");

    expect(canvasSource).not.toContain("bg-zinc-950 overflow-hidden");
    expect(backgroundSource).not.toContain("bg-zinc-950");
    expect(backgroundSource).toContain("eidos-scene-placeholder");
  });
});
