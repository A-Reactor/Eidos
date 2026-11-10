import { describe, expect, it } from "vitest";

import { buildQualityPrompt } from "@/lib/ai/kei-review";
import type { WorldDefinition } from "@/lib/game/types";

function makeArchiveWorld(): WorldDefinition {
  return {
    id: "world_1",
    name: "档案世界",
    subtitle: "",
    overview: "玩家资料建档世界。",
    regions: {},
    npcs: { 林: "调查员。source_confirmed。" },
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
          claim: "林只知道裂隙正在扩大，不知道裂隙来源。",
          entities: ["林"],
          confidence: 92,
        },
      ],
      ledger: {
        id: "ledger_1",
        title: "裂隙档案",
        summary: "资料只确认裂隙扩大与林的调查。",
        entities: [
          {
            id: "ent_1",
            name: "林",
            type: "character",
            description: "调查员。",
            status: "source_confirmed",
            evidenceRefs: ["ev_1"],
          },
        ],
        relationships: [],
        events: [],
        worldRules: [],
        unresolvedQuestions: [
          {
            id: "unk_1",
            question: "裂隙来源未知",
            relatedEntities: ["林"],
            evidenceRefs: ["ev_1"],
          },
        ],
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
        lockedFacts: ["林不知道裂隙来源。"],
        allowedInventions: ["低风险调查支线。"],
        forbiddenInventions: ["把裂隙来源写成已确认事实。"],
        bridgeContent: [
          {
            id: "bridge_1",
            purpose: "探索入口",
            content: "给玩家一个进入调查的初始委托。",
            risk: "low",
          },
        ],
      },
    },
  };
}

describe("KEI source drift audit", () => {
  it("adds source drift rules to quality review prompts for archive worlds", () => {
    const prompt = buildQualityPrompt(
      makeArchiveWorld(),
      "百科更新：林确认裂隙来自远古实验。",
      "当前场景：档案室",
    );

    expect(prompt).toContain("原作漂移审计");
    expect(prompt).toContain("source_confirmed");
    expect(prompt).toContain("generated_bridge");
    expect(prompt).toContain("裂隙来源未知");
    expect(prompt).toContain("sourceDriftWarnings");
  });

  it("teaches KEI to audit narrative director quality and stronger warning types", () => {
    const prompt = buildQualityPrompt(
      makeArchiveWorld(),
      "玩家翻耕荒地，ALICE 立刻让魔王军从天而降。",
      "当前场景：边境村庄；玩家最近连续经营农田。",
    );

    expect(prompt).toContain("## 叙事导演审核");
    expect(prompt).toContain("场景/概述/省略/停顿");
    expect(prompt).toContain("承诺管理");
    expect(prompt).toContain("玩家目标与后续行动");
    expect(prompt).toContain("世界事件是否通过有依据的局部后果进入现场");
    expect(prompt).toContain("pacing_monotony");
    expect(prompt).toContain("genre_contract_mismatch");
    expect(prompt).toContain("lore_dump");
    expect(prompt).toContain("premature_payoff");
    expect(prompt).toContain("abstract_summary");
  });
});
