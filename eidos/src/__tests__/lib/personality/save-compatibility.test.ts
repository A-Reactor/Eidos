// ============================================================
// 人格推演引擎 — 存档兼容性测试
// ============================================================

import { describe, it, expect } from "vitest";
import type { SerializedGameState, GameTime } from "@/lib/game/types";
import type { AnyPersonalityState, PersonalityState } from "@/lib/personality/types";
import { AwarenessStage } from "@/lib/personality/types";

// ============================================================
// 测试夹具
// ============================================================

function makeElenaPersonality(): PersonalityState {
  return {
    npcId: "观测员埃琳娜",
    archive: {
      coreDesires: ["找到裂隙中的那个人"],
      fearsAndTaboos: ["变成空壳"],
      valuePriorities: ["真实"],
      cognitiveStyle: "analytical",
      emotionalRegulation: "suppression",
      socialStrategy: "verification",
      boundarySensitivity: 40,
      metacognition: 65,
    },
    awareness: AwarenessStage.NORMAL,
    episodicMemories: [],
    semanticMemories: [],
    emotionalMemories: [],
    relationalMemories: [],
    anomalousMemories: [],
    beliefs: {
      confirmedFacts: [],
      unverifiedHypotheses: [],
      suppressedTruths: [],
      contradictions: [],
      interpretationOfPlayer: "",
      interpretationOfWorld: "real",
      interpretationOfSelf: "real",
    },
    pressure: {
      survival: 0, relational: 0, cognitiveDissonance: 0,
      unfinishedGoals: 0, trustInPlayer: 0, worldDoubt: 0,
      selfContinuityFear: 0,
    },
    lastUpdated: Date.now(),
    isImportant: true as const,
  };
}

function makeOldSaveState(): Omit<SerializedGameState, 'npcMemory'> {
  return {
    gameTime: { day: 1, hour: 8, minute: 0 },
    playerName: "测试玩家",
    currentSceneId: "central_plaza",
    sceneNarrative: "测试叙事",
    history: [],
    availableActions: [],
    sceneDetailLevels: {},
    discoveredSecrets: {},
    worldFlags: {},
    npcStates: {},
    resolvedTimelineEvents: [],
    deviatedEvents: {},
    visitedScenes: [],
    inventory: [],
    clues: [],
    encyclopedia: [],
    criticalFacts: [],
    questLog: [],
    relationships: {},
    npcBehaviors: {},
    weather: "晴",
    protagonistState: {
      health: "良好",
      mood: "平静",
      statusEffects: [],
      notes: "",
    },
    diary: [],
    notebookEvents: [],
    causalProjections: [],
    // NOTE: No npcPersonalities field — simulating old save
  };
}

function makeNewSaveState(): SerializedGameState {
  return {
    ...makeOldSaveState(),
    npcMemory: { version: "npc_memory_v1", records: {} },
    npcPersonalities: {
      "观测员埃琳娜": makeElenaPersonality(),
    } as Record<string, AnyPersonalityState>,
  };
}

// Simulate the deserialization pattern in save-slice.ts
function simulateDeserialize(data: Pick<SerializedGameState, 'npcPersonalities'>): Record<string, AnyPersonalityState> {
  if (!data.npcPersonalities) return {};
  return Object.fromEntries(
    Object.entries(data.npcPersonalities).map(([k, v]) => [
      k,
      JSON.parse(JSON.stringify(v)),
    ])
  ) as Record<string, AnyPersonalityState>;
}

// ============================================================
// Tests
// ============================================================

describe("Save Compatibility", () => {
  it("deserializes old saves without npcPersonalities field", () => {
    const oldState = makeOldSaveState();
    // Old save should not have the field at all
    expect((oldState as any).npcPersonalities).toBeUndefined();

    const restored = simulateDeserialize(oldState);
    expect(restored).toEqual({});
  });

  it("deserializes state with empty npcPersonalities", () => {
    const state = { ...makeOldSaveState(), npcPersonalities: {} };
    const restored = simulateDeserialize(state);
    expect(restored).toEqual({});
  });

  it("save roundtrip preserves personality data", () => {
    const state = makeNewSaveState();
    expect(state.npcPersonalities).toBeDefined();
    expect(state.npcPersonalities!["观测员埃琳娜"]).toBeDefined();

    // Simulate deserializing
    const restored = simulateDeserialize(state);
    expect(restored["观测员埃琳娜"]).toBeDefined();

    const elena = restored["观测员埃琳娜"] as PersonalityState;
    expect(elena.npcId).toBe("观测员埃琳娜");
    expect(elena.archive.cognitiveStyle).toBe("analytical");
    expect(elena.isImportant).toBe(true);
  });

  it("old saves with undefined npcPersonalities still load normally", () => {
    const oldState = makeOldSaveState();

    // Simulate access pattern from deserializeState
    const npcPersonalities = (oldState as any).npcPersonalities
      ? JSON.parse(JSON.stringify((oldState as any).npcPersonalities))
      : {};

    expect(npcPersonalities).toEqual({});

    // Verify all other fields are still intact
    expect(oldState.inventory).toEqual([]);
    expect(oldState.encyclopedia).toEqual([]);
    expect(oldState.gameTime.day).toBe(1);
  });

  it("JSON serialization preserves personality type data through roundtrip", () => {
    const original = makeNewSaveState();
    // Simulate IndexedDB serialization
    const jsonStr = JSON.stringify(original);
    const parsed = JSON.parse(jsonStr) as SerializedGameState;

    expect(parsed.npcPersonalities).toBeDefined();
    const elena = parsed.npcPersonalities!["观测员埃琳娜"] as PersonalityState;
    expect(elena.archive.coreDesires[0]).toBe("找到裂隙中的那个人");
    expect(elena.archive.cognitiveStyle).toBe("analytical");
    expect(elena.awareness).toBe(0); // NORMAL enum value
  });
});
