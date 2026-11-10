import { describe, expect, it } from "vitest";
import type {
  EncyclopediaEntry,
  GameTime,
  NPCRelationship,
  NpcBehavior,
  SerializedGameState,
} from "@/lib/game/types";
import type { AnyPersonalityState } from "@/lib/personality/types";
import { createSaveSlice } from "@/store/slices/save-slice";
import {
  buildNpcMemoryState,
  projectNpcMemoryState,
  splitNpcKnowledgeFromEncyclopedia,
} from "@/lib/game/npc-memory-save";

const now: GameTime = { day: 2, hour: 9, minute: 30 };

function npcEntry(): EncyclopediaEntry {
  return {
    id: "enc_lin",
    type: "npc",
    name: "林",
    description: "观测局记录员。",
    knowledge: [
      {
        text: "玩家知道林负责异常记录。",
        source: "ai",
        addedAt: now,
        importance: 50,
      },
    ],
    firstEncountered: now,
    lastUpdated: now,
    relatedEntries: ["enc_observatory"],
  };
}

function locationEntry(): EncyclopediaEntry {
  return {
    id: "enc_plaza",
    type: "location",
    name: "中央广场",
    description: "钟声会在这里回荡。",
    knowledge: [],
    firstEncountered: now,
    lastUpdated: now,
    relatedEntries: [],
  };
}

function relationship(): NPCRelationship {
  return {
    npcName: "林",
    affinity: 12,
    trust: 40,
    tags: ["谨慎合作"],
    firstMet: now,
    lastInteraction: now,
    notes: "保持距离，但愿意交换证据。",
  };
}

function behavior(): NpcBehavior {
  return {
    currentScene: "observatory",
    currentActivity: "在记录钟声",
    currentMood: "紧张",
    interactingWith: [],
    lastObserved: now,
    source: "kei_update",
  };
}

describe("npc memory save structure", () => {
  it("groups character state, relationship, behavior, personality, and player knowledge by NPC name", () => {
    const memory = buildNpcMemoryState({
      encyclopedia: [npcEntry(), locationEntry()],
      npcStates: { 林: "reacted" },
      relationships: { 林: relationship() },
      npcBehaviors: { 林: behavior() },
      npcPersonalities: {
        林: { npcId: "林", isImportant: false, archive: { cognitiveStyle: "analytical" } } as unknown as AnyPersonalityState,
      },
    });

    expect(memory.version).toBe("npc_memory_v1");
    expect(Object.keys(memory.records)).toEqual(["林"]);
    expect(memory.records.林).toMatchObject({
      name: "林",
      state: "reacted",
      relationship: { trust: 40, tags: ["谨慎合作"] },
      behavior: { currentActivity: "在记录钟声" },
      playerKnowledge: {
        entryId: "enc_lin",
        description: "观测局记录员。",
      },
    });
    expect(memory.records.林.playerKnowledge?.knowledge[0].text).toBe("玩家知道林负责异常记录。");
  });

  it("keeps non-NPC encyclopedia entries outside npcMemory and restores NPC entries from npcMemory", () => {
    const { npcMemory, encyclopedia } = splitNpcKnowledgeFromEncyclopedia({
      encyclopedia: [npcEntry(), locationEntry()],
      npcStates: { 林: "reacted" },
      relationships: { 林: relationship() },
      npcBehaviors: { 林: behavior() },
      npcPersonalities: {},
    });

    expect(encyclopedia.map((entry) => entry.type)).toEqual(["location"]);

    const projected = projectNpcMemoryState(npcMemory);
    expect(projected.npcStates).toEqual({ 林: "reacted" });
    expect(projected.relationships.林.trust).toBe(40);
    expect(projected.npcBehaviors.林.currentActivity).toBe("在记录钟声");
    expect(projected.encyclopedia).toHaveLength(1);
    expect(projected.encyclopedia[0]).toMatchObject({
      id: "enc_lin",
      type: "npc",
      name: "林",
      description: "观测局记录员。",
    });
  });

  it("ignores malformed NPC encyclopedia names instead of crashing during save projection", () => {
    expect(() => splitNpcKnowledgeFromEncyclopedia({
      encyclopedia: [
        { ...npcEntry(), name: { text: "坏名字" } as never },
        locationEntry(),
      ],
      npcStates: { 林: "reacted" },
    })).not.toThrow();

    const { npcMemory, encyclopedia } = splitNpcKnowledgeFromEncyclopedia({
      encyclopedia: [
        { ...npcEntry(), name: { text: "坏名字" } as never },
        locationEntry(),
      ],
      npcStates: { 林: "reacted" },
    });
    expect(Object.keys(npcMemory.records)).toEqual(["林"]);
    expect(encyclopedia.map((entry) => entry.type)).toEqual(["location"]);
  });

  it("serializes saves with npcMemory as the canonical character domain", () => {
    type MutableState = Record<string, unknown>;
    const state: MutableState = {
      gameTime: now,
      playerName: "测试玩家",
      currentSceneId: "observatory",
      sceneNarrative: "钟声落下。",
      history: [],
      availableActions: [],
      sceneDetailLevels: {},
      discoveredSecrets: {},
      worldFlags: {},
      npcStates: { 林: "reacted" },
      resolvedTimelineEvents: [],
      deviatedEvents: {},
      visitedScenes: ["observatory"],
      inventory: [],
      clues: [],
      encyclopedia: [npcEntry(), locationEntry()],
      criticalFacts: [],
      questLog: [],
      relationships: { 林: relationship() },
      diary: [],
      weather: "晴",
      protagonistState: { health: "良好", mood: "平静", statusEffects: [], notes: "" },
      notebookEvents: [],
      causalProjections: [],
      npcBehaviors: { 林: behavior() },
      npcPersonalities: {},
    };
    const set = (partial: MutableState | ((s: MutableState) => MutableState)) => {
      Object.assign(state, typeof partial === "function" ? partial(state) : partial);
    };
    const get = () => state;
    Object.assign(
      state,
      createSaveSlice(
        set as Parameters<typeof createSaveSlice>[0],
        get as Parameters<typeof createSaveSlice>[1],
      ),
    );

    const serialized = (state as MutableState & { serializeState: () => SerializedGameState }).serializeState();

    expect(serialized.npcMemory.records.林.state).toBe("reacted");
    expect(serialized.npcMemory.records.林.playerKnowledge?.description).toBe("观测局记录员。");
    expect(serialized.encyclopedia.map((entry: EncyclopediaEntry) => entry.type)).toEqual(["location"]);
    expect(serialized.npcStates).toBeUndefined();
    expect(serialized.relationships).toBeUndefined();
    expect(serialized.npcBehaviors).toBeUndefined();
    expect(serialized.npcPersonalities).toBeUndefined();
  });
});
