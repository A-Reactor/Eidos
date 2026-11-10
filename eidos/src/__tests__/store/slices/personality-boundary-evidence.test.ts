import { describe, expect, it } from "vitest";

import { createPersonalitySlice } from "@/store/slices/personality-slice";
import { AwarenessStage, type PersonalityState } from "@/lib/personality/types";

function makeState(npcId: string): PersonalityState {
  return {
    npcId,
    archive: {
      coreDesires: ["确认边界外的信号是否真实"],
      fearsAndTaboos: ["把外部证据误判成幻觉"],
      valuePriorities: ["真实", "谨慎"],
      cognitiveStyle: "analytical",
      emotionalRegulation: "intellectualization",
      socialStrategy: "verification",
      boundarySensitivity: 80,
      metacognition: 75,
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
      interpretationOfWorld: "连续的世界",
      interpretationOfSelf: "连续的个体",
    },
    pressure: {
      survival: 0,
      relational: 0,
      cognitiveDissonance: 0,
      unfinishedGoals: 0,
      trustInPlayer: 0,
      worldDoubt: 0,
      selfContinuityFear: 0,
    },
    lastUpdated: 1,
    isImportant: true,
  };
}

function createHarness(npcId = "观测员埃琳娜") {
  let state: any;
  const set = (partial: any) => {
    const value = typeof partial === "function" ? partial(state) : partial;
    state = { ...state, ...value };
  };
  const get = () => state;
  const slice = createPersonalitySlice(set, get);
  state = {
    ...slice,
    npcPersonalities: {
      [npcId]: makeState(npcId),
    },
  };
  return { state: () => state, npcId };
}

describe("personality boundary evidence", () => {
  it("records meta-reality boundary material as anomaly evidence when flagged", () => {
    const { state, npcId } = createHarness();

    const summary = state().runInference({
      playerInput: "现实边界材料进入世界：password.txt。",
      playerInputIsMetagaming: true,
      observations: {
        npcsInvolved: [
          {
            npcName: npcId,
            reaction: "她意识到这份材料不像世界内自然出现的物品。",
            emotion: "警觉",
            touchesCoreConcern: true,
          },
        ],
        memoryWorthyEvents: [
          {
            npcName: npcId,
            event: "现实边界材料 password.txt 进入世界，玩家似乎在边界外递交证据。",
            importanceHint: "high",
            emotion: "警觉",
          },
        ],
      },
    });

    const personality = state().npcPersonalities[npcId] as PersonalityState;
    expect(summary[0].anomaliesDetected).toBeGreaterThan(0);
    expect(personality.anomalousMemories[0].anomalyType).toBe("player_knows_too_much");
    expect(personality.episodicMemories[0].content).toContain("password.txt");
  });
});
