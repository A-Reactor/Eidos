import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("image resource navigation", () => {
  it("uses the resource archive instead of an image engine drawer", () => {
    const game = readFileSync(join(process.cwd(), "src/components/game/GameScreen.tsx"), "utf-8");
    const gallery = readFileSync(join(process.cwd(), "src/components/game/GalleryScreen.tsx"), "utf-8");
    expect(game).not.toContain("MidoriPanel");
    expect(gallery).toContain("ArchiveScreen");
    expect(gallery).toContain('title={ui("图像管理")}');
  });
});
