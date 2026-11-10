import { describe, expect, it } from "vitest";

import {
  buildSceneNpcProfiles,
  collectSceneNpcNames,
  formatSceneNpcProfiles,
} from "@/lib/ai/npc-context";
import type {
  EncyclopediaEntry,
  GameTime,
  NPCRelationship,
  NpcBehavior,
  WorldDefinition,
} from "@/lib/game/types";

const now: GameTime = { day: 1, hour: 9, minute: 0 };

function makeWorld(): WorldDefinition {
  return {
    id: "world",
    name: "测试城",
    subtitle: "",
    overview: "",
    regions: {
      core: {
        id: "core",
        description: "",
        scenes: {
          plaza: {
            id: "plaza",
            name: "广场",
            region: "core",
            initialDescription: "",
            detailLevel: 10,
            connections: [],
            npcs: ["林", "艾达"],
            secrets: [],
            discoveredSecrets: [],
          },
        },
      },
    },
    npcs: {
      林: "记录员。知道钟楼密室的真正用途，但没有告诉玩家。",
      艾达: "孤儿院院长。",
    },
    contradictions: [],
    history: [],
    timeline: [],
    clues: [],
    systemPromptBase: "",
    identityPrompt: "",
    isPlayerCreated: false,
    createdAt: 1,
  };
}

describe("npc-context", () => {
  it("collects NPC names from the current scene", () => {
    expect(collectSceneNpcNames(makeWorld(), "plaza")).toEqual(["林", "艾达"]);
    expect(collectSceneNpcNames(makeWorld(), "missing")).toEqual([]);
  });

  it("builds compact scene NPC profiles from world, knowledge, relationship, and behavior state", () => {
    const encyclopedia: EncyclopediaEntry[] = [
      {
        id: "enc_lin",
        type: "npc",
        name: "林",
        description: "玩家知道林负责异常记录。",
        knowledge: [
          {
            text: "他说话时总会避开钟楼方向。",
            source: "discovery",
            addedAt: now,
            importance: 60,
          },
        ],
        firstEncountered: now,
        lastUpdated: now,
        relatedEntries: [],
      },
    ];
    const relationships: Record<string, NPCRelationship> = {
      林: {
        npcName: "林",
        affinity: 12,
        trust: 40,
        tags: ["谨慎合作"],
        firstMet: now,
        lastInteraction: now,
        notes: "",
      },
    };
    const npcBehaviors: Record<string, NpcBehavior> = {
      林: {
        currentScene: "plaza",
        currentActivity: "在记录钟声",
        currentMood: "紧张",
        interactingWith: [],
        lastObserved: now,
        source: "default",
      },
    };

    const profiles = buildSceneNpcProfiles({
      world: makeWorld(),
      sceneNpcNames: ["林"],
      encyclopedia,
      relationships,
      npcBehaviors,
    });
    const formatted = formatSceneNpcProfiles(profiles);

    expect(profiles[0].sourceDescription).toContain("钟楼密室");
    expect(profiles[0].playerKnowledge).toContain("玩家知道林负责异常记录。");
    expect(formatted).toContain("设定底稿（内隐约束");
    expect(formatted).toContain("玩家已知：玩家知道林负责异常记录。");
    expect(formatted).toContain("当前行为：在记录钟声");
    expect(formatted).toContain("对玩家：好感 12 | 信任 40 | 谨慎合作");
  });
});
