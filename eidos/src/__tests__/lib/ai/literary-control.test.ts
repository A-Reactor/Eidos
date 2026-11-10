// ============================================================
// Eidos · 文学控制层测试
// ============================================================

import { describe, expect, it } from "vitest";
import {
  buildKnowledgeGateContext,
  formatKnowledgeGateContext,
} from "@/lib/ai/context-builder";
import { buildActionSystemPrompt } from "@/lib/ai/prompt-templates";
import { REWIND_KNOWLEDGE_RULE } from '@/lib/game/rewind';
import type { DirectorFrame, LiteraryControlHints } from "@/lib/ai/types";
import type {
  Clue,
  CriticalFactEntry,
  EncyclopediaEntry,
  GameTime,
  WorldDefinition,
  WorldSnapshot,
} from "@/lib/game/types";

const gameTime: GameTime = { day: 1, hour: 9, minute: 0 };

function createWorld(): WorldDefinition {
  return {
    id: "test-world",
    name: "测试城",
    subtitle: "文学控制测试",
    overview: "一个用于验证文学控制层的箱庭。",
    regions: {
      core: {
        id: "core",
        description: "核心区",
        scenes: {
          atrium: {
            id: "atrium",
            name: "中庭",
            region: "core",
            initialDescription: "安静的中庭。",
            connections: [],
            npcs: ["林"],
            secrets: ["密室钥匙藏在钟里"],
            detailLevel: 10,
            discoveredSecrets: [],
          },
        },
      },
    },
    npcs: {
      林: "看似平静的记录员。",
    },
    contradictions: [],
    history: [],
    clues: [],
    timeline: [],
    isPlayerCreated: false,
    createdAt: Date.now(),
    systemPromptBase: "你是 ALICE。",
    identityPrompt: "",
    calendarEra: "新历",
  };
}

function createSnapshot(): WorldSnapshot {
  return {
    worldId: "test-world",
    currentSceneId: "atrium",
    currentGameTime: gameTime,
    playerName: "玩家",
    sceneNarrative: "",
    historyLength: 0,
    discoveredSecrets: {
      atrium: [],
    },
    worldFlags: {},
    npcStates: {},
    sceneDetailLevels: {},
    visitedScenes: ["atrium"],
    resolvedTimelineEvents: [],
    deviatedEvents: {},
    inventory: [],
    clues: [],
    encyclopedia: [],
    availableActions: [],
    questLog: [],
    criticalFacts: [],
    relationships: {},
    weather: "晴",
    protagonistState: null,
    notebookEvents: [],
    causalProjections: [],
    npcBehaviors: {},
    diary: [],
  };
}

describe("buildKnowledgeGateContext", () => {
  it('allows only retained experiences while keeping hidden clues undiscovered and out of known facts', () => {
    const world = createWorld();
    const snapshot = createSnapshot();
    const clue: Clue = { id: 'hidden', name: '信件暗号', description: '不曾读到的真实含义', sceneId: 'atrium', detailThreshold: 10,
      prerequisiteClues: [], relatedContradiction: '', unlocksClues: [], discovered: false, discoveredAt: null };
    const args = { world, snapshot, clues: [clue], encyclopedia: [], criticalFacts: [] };
    const withoutMemory = buildKnowledgeGateContext(args);
    expect(withoutMemory.perspectiveLimits).not.toContain(REWIND_KNOWLEDGE_RULE);
    snapshot.rewindMemory = { version: 1, count: 1, sourceNodeIds: ['read-node'], digest: '主角读到信上的银月二字，但未理解含义。', last: { from: 'read-node', to: 'opening', reason: '回溯' } };
    const withMemory = buildKnowledgeGateContext(args);
    expect(withMemory.perspectiveLimits).toContain(REWIND_KNOWLEDGE_RULE);
    expect(withMemory.forbiddenFacts).toEqual(withoutMemory.forbiddenFacts);
    expect(withMemory.playerKnownFacts).toEqual([]);
    expect(formatKnowledgeGateContext(withMemory)).not.toContain(clue.description);
    expect(snapshot.clues).toEqual([]);
    expect(clue.discovered).toBe(false);
  });

  it("puts discovered clues and known records into playerKnownFacts", () => {
    const clues: Clue[] = [
      {
        id: "clue_seen",
        name: "裂纹记录",
        description: "钟面裂纹每晚都会移动。",
        sceneId: "atrium",
        detailThreshold: 10,
        prerequisiteClues: [],
        relatedContradiction: "",
        unlocksClues: [],
        discovered: true,
        discoveredAt: gameTime,
      },
    ];
    const criticalFacts: CriticalFactEntry[] = [
      { text: "玩家得知：林昨夜离开过中庭。", importanceScore: 80, referencedCount: 0, lastReferencedAt: null },
    ];
    const encyclopedia: EncyclopediaEntry[] = [
      {
        id: "npc_lin",
        type: "npc",
        name: "林",
        description: "负责记录异常的职员。",
        knowledge: [
          {
            text: "他说话时总会避开钟楼方向。",
            source: "discovery",
            addedAt: gameTime,
            importance: 60,
          },
        ],
        firstEncountered: gameTime,
        lastUpdated: gameTime,
        relatedEntries: [],
      },
    ];

    const gate = buildKnowledgeGateContext({
      clues,
      encyclopedia,
      criticalFacts,
      world: createWorld(),
      snapshot: createSnapshot(),
    });

    expect(gate.playerKnownFacts).toEqual(
      expect.arrayContaining([
        expect.stringContaining("裂纹记录"),
        expect.stringContaining("林昨夜离开过中庭"),
        expect.stringContaining("他说话时总会避开钟楼方向"),
      ])
    );
  });

  it("uses constraint phrasing for undiscovered clues instead of leaking descriptions", () => {
    const hiddenDescription = "真正凶手是被误导的记录员，而不是市长。";
    const clues: Clue[] = [
      {
        id: "clue_hidden",
        name: "误导信件",
        description: hiddenDescription,
        sceneId: "atrium",
        detailThreshold: 10,
        prerequisiteClues: [],
        relatedContradiction: "",
        unlocksClues: [],
        discovered: false,
        discoveredAt: null,
      },
    ];

    const gate = buildKnowledgeGateContext({
      clues,
      encyclopedia: [],
      criticalFacts: [],
      world: createWorld(),
      snapshot: createSnapshot(),
    });
    const formatted = formatKnowledgeGateContext(gate);

    expect(gate.forbiddenFacts).toContain("不要直接揭示线索「误导信件」的内容");
    expect(formatted).toContain("不要直接揭示线索「误导信件」的内容");
    expect(formatted).not.toContain(hiddenDescription);
  });
});

describe("buildActionSystemPrompt literary controls", () => {
  it("injects director frame, knowledge gate, and ALICE responsibility boundaries", () => {
    const frame: DirectorFrame = {
      beatFunction: "recognition",
      tensionTarget: "raise",
      narrativeFocus: [
        {
          target: "钟楼裂纹",
          instruction: "让玩家重新理解此前看到的裂纹，不要解释全部真相",
          visibility: "subtext",
          expiresInActions: 2,
        },
      ],
      revealBudget: {
        allowNewSecret: false,
        maxFactsToReveal: 1,
        forbiddenFacts: ["不要揭示钟楼密室的真实用途"],
      },
      characterFocus: {
        npcName: "林",
        arcPressure: "他正在被职责和恐惧同时挤压",
        contradictionToExpose: "他想保护玩家，却不能说出记录簿的来源",
      },
      successCriteria: ["玩家意识到旧线索有新含义", "不直接解释密室真相"],
    };
    const literaryControl: LiteraryControlHints = {
      directorFrame: frame,
      knowledgeGate: {
        playerKnownFacts: ["玩家得知：钟面裂纹每晚都会移动。"],
        playerHypotheses: [],
        forbiddenFacts: ["不要解释钟楼密室的真实用途"],
        visibleSecrets: [],
        perspectiveLimits: ["只能描述可观察现象"],
      },
    };

    const prompt = buildActionSystemPrompt(
      "你是 ALICE。",
      "测试城",
      "当前时间是第1天9时",
      "## 当前游戏世界状态\n## 玩家已确认知识\n- 玩家得知：钟面裂纹每晚都会移动。\n## 本轮禁止泄露的信息\n- 不要解释钟楼密室的真实用途",
      undefined,
      "",
      literaryControl
    );

    expect(prompt).toContain("你是局部叙事呈现者，不是世界真相裁判");
    expect(prompt).toContain("## 本轮导演帧");
    expect(prompt).toContain("戏剧功能：recognition");
    expect(prompt).toContain("target：钟楼裂纹");
    expect(prompt).toContain("不要揭示钟楼密室的真实用途");
    expect(prompt).toContain("## 知识门禁");
    expect(prompt).toContain("## 悲剧因果约束");
    expect(prompt).toContain("不要为了制造戏剧性而把 NPC 写成单薄的恶人或工具人");
  });

  it("falls back to a restrained director frame when none is supplied", () => {
    const prompt = buildActionSystemPrompt(
      "你是 ALICE。",
      "测试城",
      "当前时间是第1天9时",
      "## 当前游戏世界状态",
      undefined,
      "",
      { directorFrame: null, knowledgeGate: null }
    );

    expect(prompt).toContain("暂无明确导演帧");
    expect(prompt).toContain("不要主动揭示核心秘密");
    expect(prompt).toContain("你不得：");
  });

  it("injects UZQ personality brief as an inner constraint when supplied", () => {
    const prompt = buildActionSystemPrompt(
      "你是 ALICE。",
      "测试城",
      "当前时间是第1天9时",
      "## 当前游戏世界状态",
      undefined,
      "",
      {
        directorFrame: null,
        knowledgeGate: null,
        uzqBrief: "## UZQ 人格简报（内隐约束，不得向玩家朗读）\n- 林: request_evidence / priority 82",
      }
    );

    expect(prompt).toContain("## UZQ 人格简报");
    expect(prompt).toContain("不得向玩家朗读");
    expect(prompt).toContain("林: request_evidence");
    expect(prompt).toContain("只能作为内隐人格约束");
  });

  it("teaches ALICE scene continuation, narrative pacing, and promise reporting", () => {
    const prompt = buildActionSystemPrompt(
      "你是 ALICE。",
      "测试城",
      "当前时间是第1天9时",
      "## 当前游戏世界状态",
      undefined,
      "",
      { directorFrame: null, knowledgeGate: null }
    );

    expect(prompt).toContain("## 叙事判断流程");
    expect(prompt).toContain("理解玩家这次具体要做什么");
    expect(prompt).toContain("玩家明确选择的目标决定当前内容方向");
    expect(prompt).toContain("scene：重要互动逐段呈现");
    expect(prompt).toContain("ellipsis：跳过无意义过程");
    expect(prompt).toContain("普通行动不要默认使用 summary 或 ellipsis");
    expect(prompt).toContain("## 玩家目标与世界发展");
    expect(prompt).toContain("经营、关系、劳作与休息本身也可以形成完整内容");
    expect(prompt).toContain("不要为了凑段数而扩写");
    expect(prompt).toContain("## literarySignals 规则");
  });
});
