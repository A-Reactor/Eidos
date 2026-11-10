// @vitest-environment jsdom

import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { EncyclopediaEntry, GameTime, NPCRelationship, NpcBehavior } from "@/lib/game/types";
import { NpcInfoBar } from "@/components/game/NpcInfoBar";

const now: GameTime = { day: 1, hour: 9, minute: 0 };

const npcEntry: EncyclopediaEntry = {
  id: "enc_lin",
  type: "npc",
  name: "林",
  description: "观测局记录员，负责异常钟声档案。",
  knowledge: [{ text: "玩家知道林会检查观测日志。", source: "ai", addedAt: now, importance: 60 }],
  firstEncountered: now,
  lastUpdated: now,
  relatedEntries: [],
};

const behavior: NpcBehavior = {
  currentScene: "中央广场",
  currentActivity: "在记录钟声偏移",
  currentMood: "紧张",
  interactingWith: ["玩家"],
  lastObserved: now,
  source: "kei_update",
};

const relationship: NPCRelationship = {
  npcName: "林",
  affinity: 25,
  trust: 45,
  tags: ["谨慎合作"],
  firstMet: now,
  lastInteraction: now,
  notes: "",
};

afterEach(cleanup);

describe("NpcInfoBar", () => {
  it("shows actionable current-scene NPC details without requiring encyclopedia navigation", () => {
    render(
      React.createElement(NpcInfoBar, {
        npcIds: ["林"],
        npcBehaviors: { 林: behavior },
        npcStates: { 林: "reacted" },
        relationships: { 林: relationship },
        encyclopedia: [npcEntry],
        isLoading: false,
      }),
    );

    expect(screen.getByText("林")).toBeTruthy();
    expect(screen.getByText("NPC 档案")).toBeTruthy();
    expect(screen.getByText("当前位置")).toBeTruthy();
    expect(screen.getByText("中央广场")).toBeTruthy();
    expect(screen.getByText("当前行动")).toBeTruthy();
    expect(screen.getByText("在记录钟声偏移")).toBeTruthy();
    expect(screen.getByText("互动对象")).toBeTruthy();
    expect(screen.getByText("玩家")).toBeTruthy();
    expect(screen.getByText("关系温度")).toBeTruthy();
    expect(screen.getByText("谨慎合作")).toBeTruthy();
    expect(screen.getByText("观测局记录员，负责异常钟声档案。")).toBeTruthy();
    expect(screen.getByText("好感")).toBeTruthy();
  });
});
