// @vitest-environment jsdom

import React from "react";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { WorldLibraryItem } from "@/components/library/world-library-model";
import type { PlaythroughMeta, WorldDefinition } from "@/lib/game/types";

type CapturedWorldLibraryProps = {
  sandboxMode?: boolean;
  onImportWorldFiles?: (files: File[]) => Promise<boolean>;
  onNewContinuity?: (world: WorldDefinition) => Promise<boolean>;
  management?: {
    onCreateInitialSave: (playthrough: PlaythroughMeta, world: WorldDefinition) => Promise<boolean>;
    onExportWorld: (world: WorldDefinition) => Promise<boolean>;
    onExportWorldArchive: (item: WorldLibraryItem) => Promise<boolean>;
  };
};

const { builtInWorld, loadPlayerWorlds, store, capturedWorldLibrary, exportPackageMock } = vi.hoisted(() => {
  const builtInWorld = {
    id: "builtin",
    name: "Built in",
    subtitle: "Built in subtitle",
    overview: "Built in overview",
    regions: {},
    npcs: {},
    contradictions: [],
    history: [],
    timeline: [],
    clues: [],
    systemPromptBase: "ALICE",
    identityPrompt: "",
  } as unknown as WorldDefinition;
  const playerWorld = {
    id: "player",
    name: "Player world",
    subtitle: "Player subtitle",
    overview: "Player overview",
    regions: {},
    npcs: {},
    contradictions: [],
    history: [],
    timeline: [],
    clues: [],
    systemPromptBase: "ALICE",
    identityPrompt: "",
    isPlayerCreated: true,
  } as unknown as WorldDefinition;
  const noop = vi.fn();
  const store: {
    setPhase: ReturnType<typeof vi.fn>;
    setCurrentWorld: ReturnType<typeof vi.fn>;
    loadGame: ReturnType<typeof vi.fn>;
    playerWorlds: WorldDefinition[];
    createPlaythrough: ReturnType<typeof vi.fn>;
    setCurrentPlaythrough: ReturnType<typeof vi.fn>;
    initWorldLine: ReturnType<typeof vi.fn>;
    cachedSaveSlots: unknown[];
    cachedPlaythroughs: unknown[];
    loadIndices: ReturnType<typeof vi.fn>;
    setGalleryWorld: ReturnType<typeof vi.fn>;
    addPlayerWorld: ReturnType<typeof vi.fn>;
    deleteSave: ReturnType<typeof vi.fn>;
    saveGame: ReturnType<typeof vi.fn>;
    deletePlaythrough: ReturnType<typeof vi.fn>;
    sandboxMode: boolean;
    sandboxDossierId: string | null;
    sandboxWorlds: WorldDefinition[];
    loadSandboxWorlds: ReturnType<typeof vi.fn>;
    addSandboxWorld: ReturnType<typeof vi.fn>;
    removeSandboxWorld: ReturnType<typeof vi.fn>;
    exitSandboxDossier: ReturnType<typeof vi.fn>;
    addBoundaryEvent: ReturnType<typeof vi.fn>;
    boundaryEvents: unknown[];
  } = {
    setPhase: noop,
    setCurrentWorld: noop,
    loadGame: vi.fn(),
    playerWorlds: [],
    createPlaythrough: vi.fn().mockResolvedValue("pt_sandbox"),
    setCurrentPlaythrough: noop,
    initWorldLine: vi.fn().mockResolvedValue("worldline_sandbox"),
    cachedSaveSlots: [],
    cachedPlaythroughs: [],
    loadIndices: noop,
    setGalleryWorld: noop,
    addPlayerWorld: vi.fn(),
    deleteSave: vi.fn(),
    saveGame: vi.fn(),
    deletePlaythrough: vi.fn(),
    sandboxMode: false,
    sandboxDossierId: null as string | null,
    sandboxWorlds: [],
    loadSandboxWorlds: vi.fn(),
    addSandboxWorld: vi.fn(),
    removeSandboxWorld: vi.fn(),
    exitSandboxDossier: vi.fn(),
    addBoundaryEvent: vi.fn(),
    boundaryEvents: [],
  };
  store.loadSandboxWorlds = vi.fn(() => store.sandboxWorlds);
  store.addSandboxWorld = vi.fn((world: WorldDefinition) => {
    store.sandboxWorlds = [...store.sandboxWorlds, world];
  });
  store.removeSandboxWorld = vi.fn((worldId: string) => {
    store.sandboxWorlds = store.sandboxWorlds.filter((world) => world.id !== worldId);
  });
  return {
    builtInWorld,
    loadPlayerWorlds: vi.fn(() => [playerWorld]),
    store,
    capturedWorldLibrary: { props: null as CapturedWorldLibraryProps | null },
    exportPackageMock: vi.fn().mockResolvedValue("single_file"),
  };
});

vi.mock("@/lib/ai/builtin-worlds", () => ({
  getBuiltInWorld: () => builtInWorld,
}));

vi.mock('@/lib/game/archive-presets', () => ({ demoWorld: builtInWorld, installArchivePreset: vi.fn().mockResolvedValue(undefined) }));

vi.mock("@/store/game-store", () => ({
  useGameStore: Object.assign(() => store, { getState: () => store, setState: vi.fn() }),
  loadPlayerWorlds,
  renameWorldData: vi.fn(),
}));

vi.mock("@/lib/game/package-download", () => ({
  exportPackage: exportPackageMock,
}));

vi.mock("@/components/library/WorldLibrary", () => ({
  WorldLibrary: (props: { items: unknown[] }) => {
    capturedWorldLibrary.props = props as unknown as CapturedWorldLibraryProps;
    return React.createElement("output", { "data-testid": "world-count" }, props.items.length);
  },
}));

import { WorldSelectScreen } from "@/components/game/WorldSelectScreen";

afterEach(() => {
  cleanup();
  store.sandboxMode = false;
  store.sandboxDossierId = null;
  store.playerWorlds = [];
  store.sandboxWorlds = [];
  loadPlayerWorlds.mockClear();
  store.loadIndices.mockClear();
  store.addPlayerWorld.mockClear();
  store.createPlaythrough.mockReset();
  store.createPlaythrough.mockResolvedValue("pt_sandbox");
  store.initWorldLine.mockReset();
  store.initWorldLine.mockResolvedValue("worldline_sandbox");
  store.setPhase.mockClear();
  store.setCurrentWorld.mockClear();
  store.setCurrentPlaythrough.mockClear();
  store.saveGame.mockClear();
  store.loadSandboxWorlds.mockClear();
  store.addSandboxWorld.mockClear();
  store.removeSandboxWorld.mockClear();
  store.exitSandboxDossier.mockClear();
  store.addBoundaryEvent.mockClear();
  store.boundaryEvents = [];
  exportPackageMock.mockReset();
  exportPackageMock.mockResolvedValue("single_file");
  capturedWorldLibrary.props = null;
});

describe("WorldSelectScreen", () => {
  it("keeps the server snapshot deterministic and loads browser worlds after mount", async () => {
    const html = renderToString(React.createElement(WorldSelectScreen));

    expect(loadPlayerWorlds).not.toHaveBeenCalled();
    expect(html).toContain(">1<");

    render(React.createElement(WorldSelectScreen));
    await waitFor(() => expect(screen.getByTestId("world-count").textContent).toBe("2"));
    expect(loadPlayerWorlds).toHaveBeenCalledTimes(1);
  });

  it("imports a standalone world json into the player library", async () => {
    render(React.createElement(WorldSelectScreen));
    await waitFor(() => expect(screen.getByTestId("world-count").textContent).toBe("2"));

    const importedWorld = {
      id: "imported-world",
      name: "导入世界",
      subtitle: "来自导出包",
      overview: "一个被导入的世界。",
      regions: {
        core: {
          id: "core",
          description: "核心区",
          scenes: {
            plaza: {
              id: "plaza",
              name: "中央广场",
              region: "core",
              initialDescription: "风从档案缝隙里吹过。",
              connections: [],
              npcs: [],
              secrets: [],
              detailLevel: 10,
              discoveredSecrets: [],
            },
          },
        },
      },
      npcs: {},
      contradictions: [],
      history: [],
      timeline: [],
      clues: [],
      systemPromptBase: "你是 ALICE。",
      identityPrompt: "",
      isPlayerCreated: true,
      createdAt: 1,
    } satisfies Partial<WorldDefinition>;
    const file = new File([JSON.stringify(importedWorld)], "world.json", {
      type: "application/json",
    });

    await act(async () => {
      await capturedWorldLibrary.props?.onImportWorldFiles?.([file]);
    });

    expect(store.addPlayerWorld).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "imported-world",
        name: "导入世界",
        isPlayerCreated: true,
      }),
    );
    expect(store.addBoundaryEvent).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByTestId("world-count").textContent).toBe("3"));
  });

  it("keeps sandbox world selection isolated from ordinary built-in and player worlds", async () => {
    store.sandboxMode = true;
    store.sandboxDossierId = "002";
    store.playerWorlds = [{
      id: "ordinary-player-world",
      name: "普通环境世界",
      clues: [],
      isPlayerCreated: true,
    } as unknown as WorldDefinition];

    const html = renderToString(React.createElement(WorldSelectScreen));

    expect(html).toContain(">0<");
    expect(loadPlayerWorlds).not.toHaveBeenCalled();
    expect(store.loadIndices).not.toHaveBeenCalled();

    render(React.createElement(WorldSelectScreen));

    await waitFor(() => expect(screen.getByTestId("world-count").textContent).toBe("0"));
    expect(capturedWorldLibrary.props?.sandboxMode).toBe(true);
    expect(loadPlayerWorlds).not.toHaveBeenCalled();
    expect(store.loadIndices).toHaveBeenCalledTimes(1);
    expect(store.loadSandboxWorlds).toHaveBeenCalledWith("002");
  });

  it("imports sandbox worlds into the sandbox dossier without touching the ordinary library", async () => {
    store.sandboxMode = true;
    store.sandboxDossierId = "002";

    render(React.createElement(WorldSelectScreen));
    await waitFor(() => expect(screen.getByTestId("world-count").textContent).toBe("0"));

    const importedWorld = {
      id: "sandbox-imported-world",
      name: "沙箱世界",
      subtitle: "只属于 002",
      overview: "一个被装载进沙箱的世界。",
      regions: {
        core: {
          id: "core",
          description: "核心区",
          scenes: {
            lab: {
              id: "lab",
              name: "沙箱实验室",
              region: "core",
              initialDescription: "白色噪声在墙内流动。",
              connections: [],
              npcs: [],
              secrets: [],
              detailLevel: 10,
              discoveredSecrets: [],
            },
          },
        },
      },
      npcs: {},
      contradictions: [],
      history: [],
      timeline: [],
      clues: [],
      systemPromptBase: "你是 ALICE。",
      identityPrompt: "",
      isPlayerCreated: true,
      createdAt: 1,
    } satisfies Partial<WorldDefinition>;
    const file = new File([JSON.stringify(importedWorld)], "world.json", {
      type: "application/json",
    });

    await act(async () => {
      await capturedWorldLibrary.props?.onImportWorldFiles?.([file]);
    });

    expect(store.addSandboxWorld).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "sandbox-imported-world",
        name: "沙箱世界",
        isPlayerCreated: true,
      }),
      "002",
    );
    expect(store.addBoundaryEvent).not.toHaveBeenCalled();
    expect(store.addPlayerWorld).not.toHaveBeenCalled();
    expect(loadPlayerWorlds).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByTestId("world-count").textContent).toBe("1"));
  });

  it("starts sandbox continuities through the normal world card flow without ordinary world leakage", async () => {
    store.sandboxMode = true;
    store.sandboxDossierId = "002";
    const sandboxWorld = {
      id: "sandbox-world",
      name: "沙箱世界",
      clues: [],
      isPlayerCreated: true,
    } as unknown as WorldDefinition;
    store.sandboxWorlds = [sandboxWorld];

    render(React.createElement(WorldSelectScreen));
    await waitFor(() => expect(screen.getByTestId("world-count").textContent).toBe("1"));

    await act(async () => {
      await capturedWorldLibrary.props?.onNewContinuity?.(sandboxWorld);
    });

    expect(store.setCurrentWorld).toHaveBeenCalledWith(sandboxWorld);
    expect(store.createPlaythrough).toHaveBeenCalledWith("sandbox-world");
    expect(store.initWorldLine).toHaveBeenCalledWith("pt_sandbox", "sandbox-world");
    expect(store.setPhase).toHaveBeenCalledWith("identity");
    expect(store.addPlayerWorld).not.toHaveBeenCalled();
  });

  it("resumes identity setup instead of creating an identityless initial save", async () => {
    const world = {
      id: "player-world",
      name: "玩家世界",
      clues: [],
      isPlayerCreated: true,
    } as unknown as WorldDefinition;
    const playthrough = {
      id: "pt_without_identity",
      worldId: world.id,
      name: "世界树 #1",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      playerName: "",
      actionCount: 0,
      gameTime: { day: 0, hour: 8, minute: 0 },
      currentSceneName: "",
      status: "active",
      totalPlayDuration: 0,
      worldLineId: "worldline_without_identity",
      saves: [],
    } as unknown as PlaythroughMeta;

    render(React.createElement(WorldSelectScreen));
    await waitFor(() => expect(capturedWorldLibrary.props?.management).toBeTruthy());

    let result = false;
    await act(async () => {
      result = await capturedWorldLibrary.props!.management!.onCreateInitialSave(playthrough, world);
    });

    expect(result).toBe(true);
    expect(store.setCurrentWorld).toHaveBeenCalledWith(world);
    expect(store.setCurrentPlaythrough).toHaveBeenCalledWith(playthrough.id);
    expect(store.initWorldLine).toHaveBeenCalledWith(playthrough.id, world.id);
    expect(store.saveGame).not.toHaveBeenCalled();
    expect(store.setPhase).toHaveBeenCalledWith("identity");
  });

  it("exports world packages through the world library management callbacks", async () => {
    render(React.createElement(WorldSelectScreen));
    await waitFor(() => expect(capturedWorldLibrary.props?.management).toBeTruthy());

    await act(async () => {
      await capturedWorldLibrary.props!.management!.onExportWorld(builtInWorld);
    });
    const worldPackage = await exportPackageMock.mock.calls[0][0]();
    expect(exportPackageMock.mock.calls[0][1]).toBe('Built_in_world.eidos.zip');
    expect(JSON.parse(worldPackage.files.find((file: { path: string }) => file.path === "manifest.json").content).packageKind).toBe("world");
    expect(store.addBoundaryEvent).not.toHaveBeenCalled();

    await act(async () => {
      await capturedWorldLibrary.props!.management!.onExportWorldArchive({
        world: builtInWorld,
        continuityCount: 0,
        historyNodeCount: 0,
        saveCount: 0,
        latestSave: null,
        activeContinuity: null,
        continuities: [],
      });
    });
    const archivePackage = await exportPackageMock.mock.calls[1][0]();
    expect(exportPackageMock.mock.calls[1][1]).toBe('Built_in_world_archive.eidos.zip');
    expect(JSON.parse(archivePackage.files.find((file: { path: string }) => file.path === "manifest.json").content).packageKind).toBe("world_archive");
    expect(store.addBoundaryEvent).not.toHaveBeenCalled();
  });

  it("does not record a file export event when package export is cancelled", async () => {
    exportPackageMock.mockResolvedValueOnce("cancelled");
    render(React.createElement(WorldSelectScreen));
    await waitFor(() => expect(capturedWorldLibrary.props?.management).toBeTruthy());

    await act(async () => {
      await capturedWorldLibrary.props!.management!.onExportWorld(builtInWorld);
    });

    expect(store.addBoundaryEvent).not.toHaveBeenCalled();
  });
});
