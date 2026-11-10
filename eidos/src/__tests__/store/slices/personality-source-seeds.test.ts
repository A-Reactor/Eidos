import { describe, expect, it } from "vitest";

import { createPersonalitySlice } from "@/store/slices/personality-slice";
import { AwarenessStage, isFullPersonalityState } from "@/lib/personality/types";
import type { WorldDefinition } from "@/lib/game/types";

function makeArchiveWorld(): WorldDefinition {
  return {
    id: "world_1",
    name: "档案世界",
    subtitle: "",
    overview: "玩家资料建档世界。",
    regions: {},
    npcs: { 林: "调查员。" },
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
      evidence: [
        {
          id: "ev_1",
          sourceId: "src_001",
          category: "character",
          claim: "林反复记录异常，但不知道裂隙来源。",
          entities: ["林"],
          confidence: 90,
        },
      ],
      ledger: {
        id: "ledger_1",
        title: "裂隙档案",
        summary: "资料只确认林的调查。",
        entities: [],
        relationships: [],
        events: [],
        worldRules: [],
        unresolvedQuestions: [],
        contradictions: [],
        sourceCoverage: {
          documentCount: 1,
          evidenceCount: 1,
          highConfidenceCount: 1,
        },
      },
      adaptationPlan: {
        mode: "faithful",
        playablePremise: "调查裂隙扩大。",
        lockedFacts: [],
        allowedInventions: [],
        forbiddenInventions: [],
        bridgeContent: [],
      },
      uzqSeeds: [
        {
          npcId: "林",
          sourceEntityIds: ["ent_1"],
          archive: {
            coreDesires: ["弄清异常记录的来源"],
            fearsAndTaboos: ["把未知误判为事实"],
            valuePriorities: ["真相", "谨慎"],
            cognitiveStyle: "analytical",
            emotionalRegulation: "intellectualization",
            socialStrategy: "verification",
            boundarySensitivity: 72,
            metacognition: 68,
          },
          confidence: 84,
          evidenceRefs: ["ev_1"],
          forbiddenNarrativeMoves: ["不要让林凭空知道裂隙来源"],
        },
      ],
    },
  };
}

function createHarness(world: WorldDefinition) {
  type HarnessState = ReturnType<typeof createPersonalitySlice> & {
    currentWorld: WorldDefinition;
  };
  let state = {} as HarnessState;
  const set: Parameters<typeof createPersonalitySlice>[0] = (partial) => {
    const value = typeof partial === "function" ? partial(state) : partial;
    state = { ...state, ...value };
  };
  const get: Parameters<typeof createPersonalitySlice>[1] = () => state;
  const slice = createPersonalitySlice(set, get);
  state = {
    ...slice,
    currentWorld: world,
    npcPersonalities: {},
  };
  return { state: () => state };
}

describe("personality source archive seeds", () => {
  it("uses UZQ creation seeds when initializing archive-world NPC personalities", () => {
    const { state } = createHarness(makeArchiveWorld());

    state().ensurePersonality("林", "调查员。", false);

    const personality = state().npcPersonalities.林;
    expect(isFullPersonalityState(personality)).toBe(true);
    if (!isFullPersonalityState(personality)) throw new Error('Expected full personality state');
    expect(personality.archive.coreDesires[0]).toBe("弄清异常记录的来源");
    expect(personality.archive.fearsAndTaboos).toContain("把未知误判为事实");
    expect(personality.archive.fearsAndTaboos).toContain("原作禁忌：不要让林凭空知道裂隙来源");
    expect(personality.archive.cognitiveStyle).toBe("analytical");
    expect(personality.archive.boundarySensitivity).toBe(72);
    expect(personality.semanticMemories.map((memory: { fact: string }) => memory.fact)).toContain(
      "林反复记录异常，但不知道裂隙来源。",
    );
    expect(personality.beliefs.confirmedFacts.map((memory: { fact: string }) => memory.fact)).toContain(
      "林反复记录异常，但不知道裂隙来源。",
    );
  });

  it("initializes generated-world NPC personalities from structured descriptions", () => {
    const world = makeArchiveWorld();
    world.npcs = {
      真红: {
        name: "真红",
        description: "魔法少女，记得每一次失败的审判，并怀疑有人在操控世界线。",
      } as any,
    };
    const { state } = createHarness(world);

    expect(() => state().ensurePersonality("真红", world.npcs.真红 as any, false)).not.toThrow();

    const personality = state().npcPersonalities.真红;
    expect(personality.awareness).toBe(AwarenessStage.ANOMALY_SENSE);
  });
});
it('does not turn other facts about the same NPC into memories in a reconstructed world', () => {
  const world = makeArchiveWorld();
  Object.assign(world.sourceArchive!, { reconstruction: { schemaVersion: 2 } });
  world.sourceArchive!.evidence.push({ id: 'future', sourceId: 'src_001', category: 'event', claim: '林明天会失踪', entities: ['林'], confidence: 90 });
  const { state } = createHarness(world);
  state().ensurePersonality('林', '调查员。', false);
  const personality = state().npcPersonalities.林;
  expect(isFullPersonalityState(personality)).toBe(true);
  if (!isFullPersonalityState(personality)) throw new Error('Expected full personality state');
  expect(personality.semanticMemories.map(memory => memory.fact)).not.toContain('林明天会失踪');
});
