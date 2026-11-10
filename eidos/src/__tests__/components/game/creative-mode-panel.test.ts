// @vitest-environment jsdom

import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { WorldDefinition } from "@/lib/game/types";
import type { MetaChannelManifest } from "@/lib/meta-reality/types";

const world = {
  id: "creator-world",
  name: "创作世界",
  subtitle: "",
  overview: "",
  regions: {},
  npcs: {},
  contradictions: [],
  history: [],
  timeline: [],
  clues: [],
  systemPromptBase: "",
  identityPrompt: "",
  isPlayerCreated: true,
  createdAt: 1,
} satisfies WorldDefinition;

const manifest = {
  id: "manifest_existing",
  title: "旧边界通道",
  tone: "gentle",
  channels: [
    {
      id: "letter",
      kind: "text",
      promptToPlayer: "把信交给输入框。",
      worldInterpretation: "一封来自现实的信落入房间。",
      allowedConsumers: ["ALICE"],
      consequenceTemplate: "角色读到了这封信。",
      refusalFallback: "信没有被世界承认。",
    },
  ],
  forbiddenMoves: ["读取未授权路径"],
} satisfies MetaChannelManifest;

const store = {
  currentWorld: { ...world, metaChannelManifest: manifest } as WorldDefinition,
  metaChannelManifest: null as MetaChannelManifest | null,
  protagonistState: { health: "良好", mood: "平静", notes: "" },
  inventory: [],
  relationships: {},
  encyclopedia: [],
  criticalFacts: [],
  clues: [],
  diary: [],
  worldFlags: {},
  npcStates: {},
  npcBehaviors: {},
  sceneDetailLevels: {},
  questLog: [],
  causalProjections: [],
  applyMetaChannelManifestToCurrentWorld: vi.fn(),
};

vi.mock("@/store/game-store", () => ({
  useGameStore: Object.assign(
    (selector?: (state: typeof store) => unknown) => (selector ? selector(store) : store),
    { getState: () => store },
  ),
}));

import { CreativeModePanel } from "@/components/game/CreativeModePanel";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  store.currentWorld = { ...world, metaChannelManifest: manifest };
  store.metaChannelManifest = null;
});

describe("CreativeModePanel meta channel editor", () => {
  it("opens and saves the active world's meta channel manifest", () => {
    render(React.createElement(CreativeModePanel, { onClose: vi.fn() }));

    fireEvent.click(screen.getByRole("button", { name: "边界通道" }));
    fireEvent.click(screen.getByRole("button", { name: /旧边界通道/ }));

    fireEvent.change(screen.getByLabelText("通道标题"), {
      target: { value: "新的边界通道" },
    });
    fireEvent.change(screen.getByLabelText("禁用动作"), {
      target: { value: "读取未授权路径\n伪装成系统弹窗" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    expect(store.applyMetaChannelManifestToCurrentWorld).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "manifest_existing",
        title: "新的边界通道",
        forbiddenMoves: ["读取未授权路径", "伪装成系统弹窗"],
      }),
    );
  });

  it("creates a default manifest item when the world has no meta channel manifest", () => {
    store.currentWorld = { ...world, metaChannelManifest: null };

    render(React.createElement(CreativeModePanel, { onClose: vi.fn() }));

    fireEvent.click(screen.getByRole("button", { name: "边界通道" }));
    fireEvent.click(screen.getByRole("button", { name: /未配置边界通道/ }));

    expect((screen.getByLabelText("通道标题") as HTMLInputElement).value)
      .toBe("创作世界边界通道");
    expect(screen.getByDisplayValue("reality_offering")).toBeTruthy();
  });
});
