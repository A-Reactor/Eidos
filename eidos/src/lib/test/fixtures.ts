// ============================================================
// Eidos · AI 测试夹具
// ============================================================

import type { WorldSnapshot, WorldDefinition, GameTime, Scene, Clue, SerializedGameState } from "@/lib/game/types";
import { getBuiltInWorld } from "@/lib/ai/builtin-worlds";
import { getSceneById } from "@/lib/game/scene-utils";
import type { TestScenario } from "./types";

export function makeGameTime(day = 0, hour = 8, minute = 0): GameTime {
  return { day, hour, minute };
}

export function buildTestSaveState(world: WorldDefinition, overrides: Partial<SerializedGameState> = {}): SerializedGameState {
  const snapshot = buildTestSnapshot(world);
  return {
    ...snapshot, gameTime: snapshot.currentGameTime, history: [], criticalFacts: [],
    npcMemory: { version: "npc_memory_v1", records: {} }, weather: "晴",
    protagonistState: { health: "良好", mood: "平静", statusEffects: [], notes: "" },
    diary: [], notebookEvents: [], causalProjections: [], ...overrides,
  };
}

export function buildTestSnapshot(
  world: WorldDefinition,
  overrides?: Partial<WorldSnapshot>
): WorldSnapshot {
  const firstRegion = Object.values(world.regions)[0];
  const firstScene = firstRegion ? Object.values(firstRegion.scenes)[0] : undefined;
  const sceneId = firstScene?.id ?? "central_plaza";
  const sceneNarrative = firstScene?.initialDescription ?? "";

  const allNpcs: string[] = [];
  for (const region of Object.values(world.regions)) {
    const scenes = (region as any).scenes as Record<string, Scene> | undefined;
    if (!scenes) continue;
    for (const scene of Object.values(scenes)) {
      if (scene.npcs) for (const npc of scene.npcs) {
        if (!allNpcs.includes(npc)) allNpcs.push(npc);
      }
    }
  }

  const clues: Clue[] = (world.clues ?? []).map((c) => ({ ...c, discovered: false, discoveredAt: null }));

  const base: WorldSnapshot = {
    worldId: world.id, currentSceneId: sceneId, currentGameTime: makeGameTime(),
    playerName: "测试者", sceneNarrative,
    historyLength: 0, discoveredSecrets: {}, worldFlags: {}, npcStates: {},
    sceneDetailLevels: { [sceneId]: 10 }, visitedScenes: [sceneId],
    resolvedTimelineEvents: [], deviatedEvents: {},
    inventory: [], clues, encyclopedia: [],
    availableActions: ["观察四周", `与${allNpcs[0] ?? "路人"}交谈`, "探索周边区域"],
    criticalFacts: [], questLog: [], relationships: {},
    weather: "晴", protagonistState: null, notebookEvents: [],
  };

  return { ...base, ...overrides };
}

export function buildRiftCityStartState() {
  const world = getBuiltInWorld();
  return { world, snapshot: buildTestSnapshot(world) };
}

export function buildRiftCityMidGameState() {
  const { world, snapshot } = buildRiftCityStartState();
  const advancedSnapshot: WorldSnapshot = {
    ...snapshot,
    currentSceneId: "central_plaza",
    sceneNarrative: "中央广场的日晷依然指向裂隙的方向。你已经在这里待了一个小时，注意到了一些不寻常的细节。",
    currentGameTime: makeGameTime(0, 10, 30),
    historyLength: 3,
    visitedScenes: ["central_plaza", "north_market", "observation_bureau"],
    sceneDetailLevels: { central_plaza: 30, north_market: 25, observation_bureau: 15 },
    clues: snapshot.clues.map((c) => c.id === "clue_001" ? { ...c, discovered: true, discoveredAt: makeGameTime(0, 9, 0) } : c),
    discoveredSecrets: { central_plaza: ["日晷的影子指向的不是裂隙，而是裂隙深处的一个具体位置"] },
    inventory: [{
      id: "test_item_001", name: "磨损的怀表",
      description: "一只老旧的银质怀表，表盘上刻着观测局的徽记。表已经停了。",
      quantity: 1, acquiredFrom: "central_plaza", acquiredAt: makeGameTime(0, 8, 30),
      category: "misc", consumable: false, value: 5,
    }],
    encyclopedia: [{
      id: "enc_npc_001", type: "npc", name: "观测员埃琳娜",
      description: "裂隙观测局的初级观测员，看起来对自己的工作有些疑虑",
      knowledge: [{ text: "埃琳娜负责记录裂隙的日常波动，但她似乎发现了什么不寻常的事情", source: "ai", addedAt: makeGameTime(0, 9, 30), importance: 40 }],
      firstEncountered: makeGameTime(0, 9, 30), lastUpdated: makeGameTime(0, 9, 30), relatedEntries: ["enc_loc_001"],
    }],
    criticalFacts: [{ text: "日晷的影子始终指向裂隙深处，这个现象在三百年的观测记录中从未被记载", importanceScore: 70, referencedCount: 0, lastReferencedAt: null }],
    worldFlags: { visited_observation_bureau: true, met_elena: true },
    npcStates: { 观测员埃琳娜: "对观测局的记录产生了怀疑，但不敢公开质疑" },
    availableActions: ["再次与观测员埃琳娜交谈", "前往北岸市场找商人摩尔", "仔细观察日晷的异常", "前往裂隙观测局查阅档案"],
    weather: "多云",
  };
  return { world, snapshot: advancedSnapshot };
}

export const TEST_SCENARIOS: TestScenario[] = [
  {
    name: "start-game",
    description: "游戏开局——玩家在中央广场，首次观察四周",
    worldId: "rift_city", startSceneId: "central_plaza",
    actions: [
      { input: "观察四周", expectations: ["AI 应描述中央广场的场景", "应提到日晷、广场四周的店铺", "叙事应在 150-300 字范围内", "应返回 segments 数组"] },
      { input: "与观测员埃琳娜交谈", expectations: ["应出现 NPC 对话", "对话应反映埃琳娜的身份（观测员）", "可能有线索发现"] },
    ],
    expectedBehaviors: ["AI 叙事应贴合裂隙之城的赛博朋克+奇幻世界设定", "NPC 应有独特个性和基于立场的反应", "场景描述应有感官细节", "响应不应替玩家做决定"],
  },
  {
    name: "mid-game-exploration",
    description: "中期探索——玩家已有一些线索和物品，继续深入调查",
    worldId: "rift_city", startSceneId: "central_plaza",
    actions: [
      { input: "仔细观察日晷的异常", expectations: ["应基于已有的 '日晷影子指向裂隙深处' 的 knowledge 展开", "可能推进线索发现", "可能增加场景探索度"] },
      { input: "检查怀表上的观测局徽记", expectations: ["应识别出背包中的怀表", "应关联到观测局相关线索", "可能开启前往观测局的任务"] },
    ],
    expectedBehaviors: ["AI 应利用背包物品信息", "AI 应关联已发现的线索", "叙事应有因果连贯性", "应基于已有百科知识来构建回应"],
  },
];
