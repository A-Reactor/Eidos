// @vitest-environment jsdom
import React from "react";
import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";
import { WorldLibraryCard } from "@/components/library/WorldLibraryCard";
afterEach(cleanup);
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

function readSrc(file: string): string {
  return readFileSync(path.join(root, "src", file), "utf8");
}

describe("MIDORI entry copy", () => {
  it("omits the image resources entry from shared world details even without playthroughs", () => {
    const world = { id: "paper", name: "纸城", subtitle: "", overview: "", isPlayerCreated: false };
    const onOpenGallery = vi.fn();
    render(React.createElement(WorldLibraryCard, {
      item: { world, continuities: [], continuityCount: 0, historyNodeCount: 0, saveCount: 0, latestSave: null, activeContinuity: null } as never,
      index: 1, expanded: true, expandedContinuityId: null, onOpenGallery,
      onToggle: vi.fn(), onToggleContinuity: vi.fn(), onContinue: vi.fn(), onNewContinuity: vi.fn(),
      management: { onRenameWorld: vi.fn(), onDeleteWorld: vi.fn(), onDeleteContinuity: vi.fn(), onDeleteSave: vi.fn(), onCreateInitialSave: vi.fn(), onExportWorld: vi.fn(), onExportWorldArchive: vi.fn() },
    }));
    expect(screen.queryByRole("button", { name: "图像资源" })).toBeNull();
    expect(onOpenGallery).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "开始新的连续性" }).textContent).toBe("+");
  });

  it("keeps legacy image generation detached from the creation and game screens", () => {
    const creation = readSrc("components/game/WorldCreateScreen.tsx");
    const game = readSrc("components/game/GameScreen.tsx");
    expect(creation).not.toContain("/api/world/create/visual");
    expect(creation).not.toContain("绘画风格");
    expect(game).not.toContain("MidoriPanel");
    expect(game).not.toContain("/api/midori/generate-image");
  });
});
