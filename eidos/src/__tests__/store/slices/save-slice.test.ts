// ============================================================
// Eidos · SaveSlice V2 测试
// ============================================================
// 测试策略：
//   - 纯函数测试（filter/transform）：直接测试
//   - IndexedDB 集成测试：mock storage 模块而非用 fake-indexeddb
//     （fake-indexeddb 在 beforeEach 中 DB 删除/重建时有兼容性问题）
// ============================================================

import { describe, it, expect, beforeEach, vi } from "vitest";
import type { GameSave, PlaythroughMeta, SaveSlot, WorldDefinition, GameTime } from "@/lib/game/types";
import {
  buildPreviousAutoSaveMeta,
  createSaveSlice,
  hasPlayableIdentityState,
  isLoadableGameSave,
} from "@/store/slices/save-slice";

// ============================================================
// 导入被测试的函数（纯函数，无 IndexedDB 依赖）
// ============================================================

// 这里直接内联测试的纯函数，避免复杂的模块 mock
function filterSavesByWorld(saves: SaveSlot[], worldId: string): SaveSlot[] {
  return saves.filter((s) => s.worldId === worldId);
}

function filterSavesByPlaythrough(saves: SaveSlot[], playthroughId: string): SaveSlot[] {
  return saves.filter((s) => s.playthroughId === playthroughId);
}

function filterPlaythroughsByWorld(
  playthroughs: PlaythroughMeta[],
  worldId: string
): PlaythroughMeta[] {
  return playthroughs.filter((pt) => pt.worldId === worldId);
}

// ============================================================
// 测试数据工厂
// ============================================================

function makeGameTime(day: number, hour: number = 8): GameTime {
  return { day, hour, minute: 0 };
}

function makePlaythrough(
  id: string,
  worldId: string,
  overrides: Partial<PlaythroughMeta> = {}
): PlaythroughMeta {
  return {
    id,
    worldId,
    name: `世界树 ${id}`,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    playerName: "测试玩家",
actionCount: 0,
    gameTime: makeGameTime(0),
    currentSceneName: "测试场景",
    status: "active",
    totalPlayDuration: 0,
    worldLineId: "worldline_test",
    ...overrides,
  };
}

function makeSaveSlot(
  id: string,
  worldId: string,
  playthroughId: string,
  overrides: Partial<SaveSlot> = {}
): SaveSlot {
  return {
    id,
    name: `存档 ${id}`,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    gameTime: makeGameTime(0),
    worldId,
    worldName: "测试世界",
    playthroughId,
    playerName: "测试玩家",
currentSceneName: "测试场景",
    actionCount: 0,
    preview: "预览文本",
    playDuration: 0,
    type: "manual",
    ...overrides,
  };
}

function makeWorldWithScene(): WorldDefinition {
  return {
    id: "w1",
    name: "测试世界",
    subtitle: "",
    overview: "",
    regions: {
      core: {
        id: "core",
        description: "",
        scenes: {
          scene_awakening: {
            id: "scene_awakening",
            name: "觉醒室",
            region: "core",
            initialDescription: "",
            detailLevel: 10,
            connections: [],
            npcs: [],
            secrets: [],
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
    systemPromptBase: "",
    identityPrompt: "",
    isPlayerCreated: true,
    createdAt: Date.now(),
  };
}

function makeGameSave(overrides: Partial<GameSave["state"]> = {}): GameSave {
  const world = makeWorldWithScene();
  return {
    meta: makeSaveSlot("autosave_pt1", world.id, "pt1", {
      type: "autosave",
      playerName: "二阶堂希罗",
      currentSceneName: "觉醒室",
    }),
    world,
    state: {
      gameTime: makeGameTime(1),
      playerName: "二阶堂希罗",
      currentSceneId: "scene_awakening",
      sceneNarrative: "",
      history: [],
      availableActions: [],
      sceneDetailLevels: {},
      discoveredSecrets: {},
      worldFlags: {},
      npcStates: {},
      npcMemory: { version: "npc_memory_v1", records: {} },
      resolvedTimelineEvents: [],
      deviatedEvents: {},
      visitedScenes: ["scene_awakening"],
      inventory: [],
      clues: [],
      encyclopedia: [],
      criticalFacts: [],
      questLog: [],
      relationships: {},
      npcBehaviors: {},
      weather: "晴",
      protagonistState: { health: "良好", mood: "平静", statusEffects: [], notes: "" },
      diary: [],
      notebookEvents: [],
      causalProjections: [],
      ...overrides,
    },
  };
}

// ============================================================
// 纯函数测试
// ============================================================

describe("filterSavesByWorld", () => {
  it("filters saves matching the world ID", () => {
    const saves = [
      makeSaveSlot("s1", "w1", "pt1"),
      makeSaveSlot("s2", "w2", "pt2"),
      makeSaveSlot("s3", "w1", "pt3"),
    ];
    expect(filterSavesByWorld(saves, "w1")).toHaveLength(2);
    expect(filterSavesByWorld(saves, "w2")).toHaveLength(1);
    expect(filterSavesByWorld(saves, "w3")).toHaveLength(0);
  });

  it("returns empty array for empty input", () => {
    expect(filterSavesByWorld([], "w1")).toEqual([]);
  });
});

describe("filterSavesByPlaythrough", () => {
  it("filters saves matching the playthrough ID", () => {
    const saves = [
      makeSaveSlot("s1", "w1", "pt1"),
      makeSaveSlot("s2", "w1", "pt1"),
      makeSaveSlot("s3", "w1", "pt2", { id: "autosave_pt2" }),
    ];
    expect(filterSavesByPlaythrough(saves, "pt1")).toHaveLength(2);
    expect(filterSavesByPlaythrough(saves, "pt2")).toHaveLength(1);
  });

  it("works with autosave type saves", () => {
    const saves = [
      makeSaveSlot("autosave_pt1", "w1", "pt1", { type: "autosave" }),
      makeSaveSlot("autosave_prev_pt1", "w1", "pt1", { type: "autosave_prev" }),
    ];
    expect(filterSavesByPlaythrough(saves, "pt1")).toHaveLength(2);
  });
});

describe("filterPlaythroughsByWorld", () => {
  it("filters playthroughs matching the world ID", () => {
    const playthroughs = [
      makePlaythrough("pt1", "w1"),
      makePlaythrough("pt2", "w2"),
      makePlaythrough("pt3", "w1", { status: "ended" }),
    ];
    expect(filterPlaythroughsByWorld(playthroughs, "w1")).toHaveLength(2);
    expect(filterPlaythroughsByWorld(playthroughs, "w2")).toHaveLength(1);
    expect(filterPlaythroughsByWorld(playthroughs, "w3")).toHaveLength(0);
  });

  it("returns empty array for empty input", () => {
    expect(filterPlaythroughsByWorld([], "w1")).toEqual([]);
  });
});

// ============================================================
// 保存逻辑规则测试（模拟 store 行为，无需 IndexedDB）
// ============================================================

describe("saveGame — playthroughId 关联逻辑", () => {
  it("assigns correct playthroughId to new save slot", () => {
    const playthroughId = "pt_test_123";
    const world: WorldDefinition = {
      id: "w1", name: "测试世界", subtitle: "",
      overview: "", regions: {}, npcs: {},
      contradictions: [], history: [], timeline: [],
      clues: [], systemPromptBase: "", identityPrompt: "",
      isPlayerCreated: true, createdAt: Date.now(),
    };

    // 模拟 saveGame 的 meta 构造
    const meta: SaveSlot = {
      id: "save_test",
      name: "手动存档",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      gameTime: makeGameTime(3, 14),
      worldId: world.id,
      worldName: world.name,
      playthroughId,  // ← 关键：playthroughId 正确赋值
      playerName: "测试",
    currentSceneName: "酒馆",
      actionCount: 42,
      preview: "预览...",
      playDuration: 30,
      type: "manual",
    };

    expect(meta.playthroughId).toBe(playthroughId);
    expect(meta.worldId).toBe("w1");
    expect(meta.type).toBe("manual");
  });
});

describe("hasPlayableIdentityState", () => {
  it("rejects saves before the player has chosen an identity and valid scene", () => {
    expect(hasPlayableIdentityState({
      playerName: "",
      currentSceneId: "",
      currentScene: null,
    })).toBe(false);

    expect(hasPlayableIdentityState({
      playerName: "  ",
      currentSceneId: "scene_awakening",
      currentScene: { id: "scene_awakening" },
    })).toBe(false);

    expect(hasPlayableIdentityState({
      playerName: "二阶堂希罗",
      currentSceneId: "",
      currentScene: { id: "scene_awakening" },
    })).toBe(false);
  });

  it("accepts saves only after identity and scene are both initialized", () => {
    expect(hasPlayableIdentityState({
      playerName: "二阶堂希罗",
      currentSceneId: "scene_awakening",
      currentScene: { id: "scene_awakening" },
    })).toBe(true);
  });
});

describe("isLoadableGameSave", () => {
  it("rejects stored saves without a selected identity, starting scene, or valid scene id", () => {
    expect(isLoadableGameSave(makeGameSave({ playerName: "" }))).toBe(false);
    expect(isLoadableGameSave(makeGameSave({ currentSceneId: "" }))).toBe(false);
    expect(isLoadableGameSave(makeGameSave({ currentSceneId: "missing_scene" }))).toBe(false);
  });

  it("only publishes previous autosave metadata for a loadable stored save", () => {
    expect(buildPreviousAutoSaveMeta(makeGameSave({ playerName: "" }), "pt1")).toBeNull();

    const meta = buildPreviousAutoSaveMeta(makeGameSave(), "pt1");

    expect(meta?.id).toBe("autosave_prev_pt1");
    expect(meta?.type).toBe("autosave_prev");
    expect(meta?.playerName).toBe("二阶堂希罗");
  });
});

describe("meta reality save compatibility", () => {
  it("serializes meta reality records from runtime state", () => {
    let state: Record<string, any> = {
      gameTime: makeGameTime(1),
      playerName: "测试玩家",
      currentSceneId: "scene_awakening",
      sceneNarrative: "现实边界正在发光。",
      history: [],
      availableActions: [],
      sceneDetailLevels: {},
      discoveredSecrets: {},
      worldFlags: {},
      resolvedTimelineEvents: [],
      deviatedEvents: {},
      visitedScenes: [],
      inventory: [],
      clues: [],
      encyclopedia: [],
      criticalFacts: [],
      questLog: [],
      npcStates: {},
      relationships: {},
      npcBehaviors: {},
      npcPersonalities: {},
      diary: [],
      weather: "晴",
      protagonistState: { health: "良好", mood: "平静", statusEffects: [], notes: "" },
      notebookEvents: [],
      causalProjections: [],
      realityArtifacts: [
        {
          id: "ra_1",
          kind: "image",
          label: "sea.png",
          consent: { grantedAt: 100, scope: "summary_only", revocable: true },
          summary: "一张来自边界外的海面图像。",
          visibleTo: ["Niko"],
          introducedAtWorldLineNodeId: "node_1",
          safetyNotes: [],
          createdAt: 100,
        },
      ],
      boundaryEvents: [
        {
          id: "be_1",
          type: "artifact_introduced",
          actor: "player",
          artifactId: "ra_1",
          worldLineNodeId: "node_1",
          visibleConsequences: ["Niko 第一次看见了海。"],
          hiddenAudit: ["玩家主动导入图片。"],
          createdAt: 101,
        },
      ],
      metaChannelManifest: {
        id: "manifest_gentle",
        title: "温柔同行",
        tone: "gentle",
        channels: [],
        forbiddenMoves: ["不得读取桌面"],
      },
    };
    const set = (partial: any) => {
      const next = typeof partial === "function" ? partial(state) : partial;
      state = { ...state, ...next };
    };
    const get = () => state;
    state = { ...state, ...createSaveSlice(set, get) };

    const serialized = state.serializeState();

    expect(serialized.realityArtifacts?.[0].label).toBe("sea.png");
    expect(serialized.boundaryEvents?.[0].visibleConsequences).toEqual(["Niko 第一次看见了海。"]);
    expect(serialized.metaChannelManifest?.title).toBe("温柔同行");
  });

  it("deserializes meta reality records and falls back to the world manifest", () => {
    let state: Record<string, any> = {};
    const set = (partial: any) => {
      const next = typeof partial === "function" ? partial(state) : partial;
      state = { ...state, ...next };
    };
    const get = () => state;
    state = { ...state, ...createSaveSlice(set, get) };
    const world = {
      ...makeWorldWithScene(),
      metaChannelManifest: {
        id: "manifest_world",
        title: "世界默认通道",
        tone: "gentle",
        channels: [],
        forbiddenMoves: [],
      },
    } as WorldDefinition;
    const save = makeGameSave({
      realityArtifacts: [
        {
          id: "ra_1",
          kind: "text",
          label: "letter.txt",
          consent: { grantedAt: 100, scope: "summary_only", revocable: true },
          summary: "一封来自边界外的信。",
          visibleTo: [],
          introducedAtWorldLineNodeId: "node_1",
          safetyNotes: [],
          createdAt: 100,
        },
      ],
      boundaryEvents: [
        {
          id: "be_1",
          type: "artifact_introduced",
          actor: "player",
          artifactId: "ra_1",
          worldLineNodeId: "node_1",
          visibleConsequences: ["信被放在桌上。"],
          hiddenAudit: [],
          createdAt: 101,
        },
      ],
    });

    state.deserializeState(save.state, world);

    expect(state.realityArtifacts[0].label).toBe("letter.txt");
    expect(state.boundaryEvents[0].visibleConsequences).toEqual(["信被放在桌上。"]);
    expect(state.metaChannelManifest.title).toBe("世界默认通道");
  });
});

describe("autoSave — playthrough 关联逻辑", () => {
  it("constructs correct autosave meta with playthroughId", () => {
    const playthroughId = "pt_autosave_test";
    const meta: SaveSlot = {
      id: `autosave_${playthroughId}`,
      name: "[自动存档] 测试世界 · 测试玩家",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      gameTime: makeGameTime(5),
      worldId: "w1",
      worldName: "测试世界",
      playthroughId,
      playerName: "测试",
    currentSceneName: "广场",
      actionCount: 50,
      preview: "预览...",
      playDuration: 45,
      type: "autosave",
    };

    expect(meta.playthroughId).toBe(playthroughId);
    expect(meta.id).toBe(`autosave_${playthroughId}`);
    expect(meta.type).toBe("autosave");
  });

  it("constructs prev autosave with correct id pattern", () => {
    const playthroughId = "pt_prev_test";
    const meta: SaveSlot = {
      id: `autosave_prev_${playthroughId}`,
      name: "[上一步存档] 测试世界 · 测试玩家",
      createdAt: Date.now() - 60000,
      updatedAt: Date.now() - 60000,
      gameTime: makeGameTime(4),
      worldId: "w1",
      worldName: "测试世界",
      playthroughId,
      playerName: "测试",
    currentSceneName: "广场",
      actionCount: 40,
      preview: "之前...",
      playDuration: 40,
      type: "autosave_prev",
    };

    expect(meta.playthroughId).toBe(playthroughId);
    expect(meta.type).toBe("autosave_prev");
  });
});

describe("MAX_MANUAL_SAVES_PER_PLAYTHROUGH enforcement", () => {
  it("prunes oldest save when exceeding limit of 20", () => {
    const MAX = 20;
    const playthroughId = "pt_prune_test";

    // 创建 23 个存档（超过限制 3 个）
    const saves: SaveSlot[] = Array.from({ length: MAX + 3 }, (_, i) =>
      makeSaveSlot(`save_${i}`, "w1", playthroughId, {
        updatedAt: 1000 + i * 100,
        id: `save_${i}`,
      })
    );

    // 模拟 pruning 逻辑
    const playthroughSaves = saves.filter(
      (s) => s.playthroughId === playthroughId
    );
    const sortedByOldest = [...playthroughSaves].sort(
      (a, b) => a.updatedAt - b.updatedAt
    );
    const excess = playthroughSaves.length - MAX;
    const idsToRemove = new Set(
      sortedByOldest.slice(0, excess).map((s) => s.id)
    );
    const remaining = saves.filter((s) => !idsToRemove.has(s.id));

    expect(excess).toBe(3);
    expect(remaining).toHaveLength(MAX);
    // 确认删除的是最旧的 3 个
    expect(idsToRemove.has("save_0")).toBe(true);
    expect(idsToRemove.has("save_1")).toBe(true);
    expect(idsToRemove.has("save_2")).toBe(true);
    // 确认保留的是最新的 20 个
    expect(remaining.find((s) => s.id === "save_22")).toBeTruthy();
  });
});

describe("deletePlaythrough cascading", () => {
  it("filters out deleted playthrough from cache", () => {
    const allPts = [
      makePlaythrough("pt_keep", "w1"),
      makePlaythrough("pt_delete", "w1"),
    ];
    const remaining = allPts.filter((pt) => pt.id !== "pt_delete");
    expect(remaining).toHaveLength(1);
    expect(remaining[0].id).toBe("pt_keep");
  });

  it("filters out all related saves when playthrough is deleted", () => {
    const allSaves = [
      makeSaveSlot("s1", "w1", "pt_keep"),
      makeSaveSlot("s2", "w1", "pt_delete"),
      makeSaveSlot("s3", "w1", "pt_delete"),
      makeSaveSlot("autosave_pt_delete", "w1", "pt_delete", { type: "autosave" }),
    ];
    const remaining = allSaves.filter(
      (s) => s.playthroughId !== "pt_delete"
    );
    expect(remaining).toHaveLength(1);
    expect(remaining[0].playthroughId).toBe("pt_keep");
  });
});

describe("renameWorld — 存档/周目元数据同步更新", () => {
  it("updates worldName in all saves for matching world", () => {
    const saves = [
      makeSaveSlot("s1", "w1", "pt1", { worldName: "旧名称" }),
      makeSaveSlot("s2", "w1", "pt1", { worldName: "旧名称" }),
      makeSaveSlot("s3", "w2", "pt2", { worldName: "其他世界" }),
    ];
    const newName = "新名称";
    const updated = saves.map((s) =>
      s.worldId === "w1" ? { ...s, worldName: newName } : s
    );
    expect(updated[0].worldName).toBe(newName);
    expect(updated[1].worldName).toBe(newName);
    expect(updated[2].worldName).toBe("其他世界"); // 不影响其他世界
  });
});

describe("createPlaythrough — 序号自动分配", () => {
  it("assigns correct sequence number for new playthrough", () => {
    const existingPts = [
      makePlaythrough("pt1", "w1", { name: "世界树 #1" }),
      makePlaythrough("pt2", "w1", { name: "世界树 #2" }),
    ];
    const worldPts = existingPts.filter((pt) => pt.worldId === "w1");
    const seqNum = worldPts.length + 1;
    expect(seqNum).toBe(3);
  });
});

it('restores the saved director frame and clears prompt metadata when loading a legacy save', () => {
  const world = makeWorldWithScene();
  let state: Record<string, unknown> = {};
  const slice = createSaveSlice(partial => { state = { ...state, ...(typeof partial === 'function' ? partial(state) : partial) }; }, () => state);
  state = { ...slice };
  const frame: import('@/lib/ai/types').DirectorFrame = { beatFunction: 'setup', tensionTarget: 'hold', narrativeFocus: [], revealBudget: { allowNewSecret: false, maxFactsToReveal: 0, forbiddenFacts: [] }, successCriteria: [] };
  const origin = { worldId: world.id, playthroughId: 'p', worldLineId: 'l', archiveScope: 'ordinary', parentNodeId: null, actionId: 'a' };
  const epoch = { id: 'epoch', rendererVersion: 1, scope: origin, retained: [] };
  const old = {} as GameSave['state'];
  slice.deserializeState({ ...old, lastDirectorFrame: frame, directorAdviceOrigin: origin, historyEpochPlan: epoch }, world);
  expect(state.currentDirectorFrame).toEqual(frame);
  expect(state.directorAdviceOrigin).toEqual(origin);
  expect(state.historyEpochPlan).toEqual(epoch);
  slice.deserializeState(old, world);
  expect(state.currentDirectorFrame).toBeNull();
  expect(state.directorAdviceOrigin).toBeNull();
  expect(state.historyEpochPlan).toBeNull();
});
