import { describe, expect, it } from "vitest";

import { buildWorldContext, resetSegmentHashes } from "@/lib/ai/context-builder";
import type { InventoryItem, WorldDefinition, WorldSnapshot } from "@/lib/game/types";

describe("source archive context", () => {
  it("adds source constraints for archive-created worlds", () => {
    resetSegmentHashes();
    const world = {
      id: "world_1",
      name: "档案世界",
      subtitle: "",
      overview: "概述",
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
      sourceMode: "source_archive",
      sourceArchive: {
        corpus: {
          id: "corpus_1",
          documents: [],
          language: "zh-CN",
          createdAt: 1,
        },
        evidence: [],
        ledger: {
          id: "ledger_1",
          title: "档案",
          summary: "原作事实摘要",
          entities: [],
          relationships: [],
          events: [],
          worldRules: [],
          unresolvedQuestions: [
            {
              id: "unk_1",
              question: "裂隙来源未知",
              relatedEntities: [],
              evidenceRefs: [],
            },
          ],
          contradictions: [],
          sourceCoverage: {
            documentCount: 1,
            evidenceCount: 0,
            highConfidenceCount: 0,
          },
        },
        adaptationPlan: {
          mode: "faithful",
          playablePremise: "",
          lockedFacts: ["城市边缘出现裂隙"],
          allowedInventions: [],
          forbiddenInventions: ["不得确定裂隙来源"],
          bridgeContent: [],
        },
      },
    } satisfies WorldDefinition;
    const snapshot = {
      worldId: world.id,
      currentSceneId: "",
      currentGameTime: { day: 0, hour: 8, minute: 0 },
      playerName: "",
      sceneNarrative: "",
      historyLength: 0,
      discoveredSecrets: {},
      worldFlags: {},
      npcStates: {},
      sceneDetailLevels: {},
      visitedScenes: [],
      resolvedTimelineEvents: [],
      deviatedEvents: {},
      inventory: [],
      clues: [],
    } as unknown as WorldSnapshot;

    const context = buildWorldContext({ world, snapshot });

    expect(context).toContain("原作事实约束");
    expect(context).toContain("source_confirmed");
    expect(context).toContain("generated_bridge");
    expect(context).toContain("裂隙来源未知");
    expect(context).toContain("城市边缘出现裂隙");
  });
});

describe("narrative style context", () => {
  it("adds the world's narrative style profile to ALICE runtime context", () => {
    resetSegmentHashes();
    const world = {
      id: "world_style",
      name: "市井档案",
      subtitle: "",
      overview: "概述",
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
      narrativeStyle: {
        id: "realist",
        label: "现实主义",
        summary: "用具体社会关系和可验证后果推进叙事。",
        aliceGuidance: "少抒情，多写动作、职业、金钱、制度和关系压力。",
        keiGuidance: "创建世界时让人物动机、组织规则和资源代价自洽。",
        example: "这段示例只给玩家预览，不应进入运行时 prompt。",
        customDescription: "玩家希望看到菜市场、工资、街道和邻里压力。",
      },
    } as unknown as WorldDefinition;
    const snapshot = {
      worldId: world.id,
      currentSceneId: "",
      currentGameTime: { day: 0, hour: 8, minute: 0 },
      playerName: "林",
      sceneNarrative: "",
      historyLength: 0,
      discoveredSecrets: {},
      worldFlags: {},
      npcStates: {},
      sceneDetailLevels: {},
      visitedScenes: [],
      resolvedTimelineEvents: [],
      deviatedEvents: {},
      inventory: [],
      clues: [],
    } as unknown as WorldSnapshot;

    const context = buildWorldContext({ world, snapshot });

    expect(context).toContain("文风档案");
    expect(context).toContain("现实主义");
    expect(context).toContain("菜市场");
    expect(context).toContain("不要复写示例");
    expect(context).not.toContain("这段示例只给玩家预览");
  });
});

describe("inventory context", () => {
  it("includes item ids so ALICE can update existing item state instead of creating duplicates", () => {
    resetSegmentHashes();
    const world = {
      id: "world_1",
      name: "测试世界",
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
    const snapshot = {
      worldId: world.id,
      currentSceneId: "",
      currentGameTime: { day: 0, hour: 8, minute: 0 },
      playerName: "",
      sceneNarrative: "",
      historyLength: 0,
      discoveredSecrets: {},
      worldFlags: {},
      npcStates: {},
      sceneDetailLevels: {},
      visitedScenes: [],
      resolvedTimelineEvents: [],
      deviatedEvents: {},
      inventory: [],
      clues: [],
    } as unknown as WorldSnapshot;
    const inventory: InventoryItem[] = [{
      id: "phone_1",
      name: "手机",
      description: "一部还能亮屏的旧手机。",
      quantity: 1,
      acquiredFrom: "起点",
      acquiredAt: { day: 0, hour: 8, minute: 0 },
      category: "tool",
      consumable: false,
      value: 0,
    }];

    const context = buildWorldContext({ world, snapshot, inventory, forceFull: true });

    expect(context).toContain("- [phone_1] 手机：一部还能亮屏的旧手机。（tool）");
  });
});

describe("long memory context", () => {
  it("keeps retrieved evidence after accepted history near the current task", () => {
    resetSegmentHashes();
    const world = {
      id: "world_1",
      name: "测试世界",
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
    const snapshot = {
      worldId: world.id,
      currentSceneId: "",
      currentGameTime: { day: 0, hour: 8, minute: 0 },
      playerName: "",
      sceneNarrative: "",
      historyLength: 0,
      discoveredSecrets: {},
      worldFlags: {},
      npcStates: {},
      sceneDetailLevels: {},
      visitedScenes: [],
      resolvedTimelineEvents: [],
      deviatedEvents: {},
      inventory: [],
      clues: [],
    } as unknown as WorldSnapshot;

    const context = buildWorldContext({
      world,
      snapshot,
      longMemoryContext: "## 长线记忆检索\n旧纸条：别相信钟楼。",
      historySummary: "## 最近行动记录\n- 玩家：继续走 → 走向街角",
      forceFull: true,
    });

    expect(context).toContain("## 长线记忆检索");
    expect(context.indexOf("## 长线记忆检索")).toBeGreaterThan(context.indexOf("## 最近行动记录"));
  });
});
