import { describe, expect, it } from "vitest";
import type {
  EncyclopediaEntry,
  GameTime,
  NPCRelationship,
  NpcBehavior,
} from "@/lib/game/types";
import { buildNpcViewModels } from "@/lib/game/npc-view-model";

const now: GameTime = { day: 3, hour: 10, minute: 0 };

const linKnowledge: EncyclopediaEntry = {
  id: "enc_lin",
  type: "npc",
  name: "林",
  description: "观测局记录员，负责异常钟声档案。",
  knowledge: [
    { text: "玩家知道林会在钟声后检查观测日志。", source: "ai", addedAt: now, importance: 60 },
  ],
  firstEncountered: now,
  lastUpdated: now,
  relatedEntries: [],
};

const linBehavior: NpcBehavior = {
  currentScene: "observatory",
  currentActivity: "在记录钟声偏移",
  currentMood: "紧张",
  interactingWith: ["玩家"],
  lastObserved: now,
  source: "kei_update",
};

const linRelationship: NPCRelationship = {
  npcName: "林",
  affinity: 25,
  trust: 45,
  tags: ["谨慎合作"],
  firstMet: now,
  lastInteraction: now,
  notes: "愿意交换证据，但不会透露观测局底稿。",
};

describe("buildNpcViewModels", () => {
  it("combines scene order, behavior, relationship, state, and player-known NPC knowledge", () => {
    const models = buildNpcViewModels(["林"], {
      encyclopedia: [linKnowledge],
      npcStates: { 林: "reacted" },
      npcBehaviors: { 林: linBehavior },
      relationships: { 林: linRelationship },
    });

    expect(models).toHaveLength(1);
    expect(models[0]).toMatchObject({
      name: "林",
      state: "reacted",
      hasReacted: true,
      mood: "紧张",
      activity: "在记录钟声偏移",
      currentScene: "observatory",
      interactingWith: ["玩家"],
      affinityLabel: "好感",
      relationshipLine: "好感 25 | 信任 45 | 谨慎合作",
      knownDescription: "观测局记录员，负责异常钟声档案。",
      primaryKnowledge: "玩家知道林会在钟声后检查观测日志。",
      statusLine: "[紧张] 在记录钟声偏移",
    });
  });
});
