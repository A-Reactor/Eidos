// ============================================================
// AI 类型定义（从 ai.ts 提取）
// ============================================================

import type { GameTime, InventoryItem, Clue, ValidityCheck, EncyclopediaEntry, QuestEntry, ProtagonistState, RippleEffect } from "@/lib/game/types";
import type { SandboxToolRequest } from "@/lib/ai/sandbox-tool-pipeline";

// ============================================================
// AI 响应类型
// ============================================================

/** 一个文本段落（旁白或对话） */
export interface StorySegment {
  /** Host-generated, deduplicated search page metadata; excludes webpage body text. */
  searchSources?: import('@/lib/game/web-context').WebSource[];
  /** Reference to an existing, world-scoped image resource; never a model-authored URL. */
  imageId?: string;
  /** Exact mounted images/*.json reference, using the same paths as files.search/read. */
  imagePath?: string;
  /** Per-dialogue lexical image query; the host selects the matching expression. */
  expressionTags?: string[];
  workspaceEffects?: string[];
  /** Optional native lettering; original text remains the saved narrative. */
  textEffects?: import('@/lib/game/text-effects').TextEffect[];
  beat?: import('@/lib/game/narrative-beat').NarrativeBeat;
  choices?: import('@/lib/game/narrative').NarrativeChoice[];
  type: "narration" | "dialogue";
  /** 文本内容（50-150字，适合一个文本框） */
  text: string;
  /** 对话时必填——说话人名称 */
  speaker?: string;
  /** Optional model-written facial expression, independent of spoken dialogue. */
  kaomoji?: string;
  /** 说话人表情（用于驱动立绘差分） */
  /** Reader camera; does not move the protagonist or grant knowledge. */
  view?: import("@/lib/game/narrative").NarrativeFrame;
  /** Built-in names and player-defined image tags are both valid expressions. */
  emotion?: string;
}

export interface AIGameResponse {
  /** Host-selected, actually reviewed receipts; provider-authored values are discarded. */
  _npcProfileUpdates?: import('@/lib/game/npc-profile').NpcProfileChange[];
  illustrations?: import('@/lib/game/midori/image-context').IllustrationDraft[];
  chapterPreparation?: import('@/lib/game/chapters/types').ChapterPreparation | null;
  chapterSignal?: import('@/lib/game/chapters/types').ChapterSignal;
  /** Request-local planning usage; transported separately from ALICE. */
  _chapterUsage?: TokenUsage[];
  /** Client-owned candidate reference; never accepted from a provider. */
  _workspaceSessionId?: string;
  /** 尚未建档且本轮实际说话人物的言语档案；接受行动后才保存。 */
  npcSpeechProfiles?: Record<string, import('@/lib/game/npc-speech').NpcSpeechProfile>;
  document?: import('./document-response').ModelDocument;
  historyRequest?: import('@/lib/game/history-reader').HistoryReadRequest;
  documents?: import('@/lib/game/documents/types').DocumentDraft[];
  fileOutcome?: 'failed' | 'completed';
  workspaceEffects?: string[];
  workspaceRequest?: import('@/lib/game/workspace/types').WorkspaceToolRequest;
  toolRequest?: import('@/lib/game/action-operations').ActionToolRequest;
  /** Host-generated protocol failure; never trusted as a model-authored receipt. */
  toolError?: { message: string; method?: import('@/lib/game/workspace/types').WorkspaceMethod; path?: string; kind?: 'format'; rawOutput?: string };
  operationOutcome?: 'failed' | 'completed';
  operationEffects?: string[];
  narrativeBeat?: import('@/lib/game/narrative-beat').NarrativeBeat;
  narrativeChoices?: import('@/lib/game/narrative').NarrativeChoice[];
  _gameplayResult?: { pluginId: string; id: string };
  _contextDiagnostics?: import('./action-context-diagnostics').ActionContextDiagnostics;
  _diagnosticRounds?: import('@/lib/game/action-diagnostics').ActionDiagnosticRound[];
  _historyEpochPlan?: import('./history-epoch').HistoryEpochPlan;
  _directorCue?: import('@/lib/game/director-cues').DirectorCue | null;
  narrativeFrame?: import("@/lib/game/narrative").NarrativeFrame;
  validity: ValidityCheck;
  /** 拆分的文本段落（旁白居中显示，对话在底部对话框） */
  segments: StorySegment[];
  /** 向后兼容——如果 AI 不返回 segments，回退到 narrative */
  narrative?: string;
  dialogue?: string;
  sceneChanges: string[];
  mapUpdates?: import("@/lib/game/map-state").MapUpdates;
  discoveredSecrets: string[];
  /** Actual character names only; reaction prose belongs in personalityObservations. */
  npcsReacted: string[];
  availableActions: string[];
  summary: string;
  timeSpent: GameTime;
  /** Absolute in-world time after the action; preferred over duration when present. */
  timeAfter?: GameTime;
  itemsGained: (InventoryItem & { documentKey?: string })[];
  itemsUsed: string[];
  cluesDiscovered: string[];
  worldImpacts: string[];
  /** Declarative gameplay events; the client validates and commits their state. */
  pluginEvents?: import("@/lib/game/plugins/types").PluginEvent[];
  cardVariableUpdates?: import('@/lib/game/cards/variable-updates').CardVariableUpdate[];
  /** AI 标记的关键新信息（自动加入 criticalFacts） */
  criticalFactsDiscovered?: string[];
  /** AI 识别的新任务/待办（自动加入 questLog） */
  questsDiscovered?: Array<{ title: string; description: string; relatedNpcs?: string[]; deadline?: GameTime | null }>;
  /** AI 建议的百科更新（新增或覆盖） */
  encyclopediaUpdates?: Array<{ name: string; type: string; description: string; knowledge: string }>;
  /** AI 建议删除的百科条目（名称列表） */
  encyclopediaDeletions?: string[];
  /** AI 识别的 NPC 关系变更 */
  relationshipUpdates?: Array<{
    npcName: string;
    affinityDelta?: number;
    trustDelta?: number;
    addTags?: string[];
    removeTags?: string[];
  }>;
  /** 物品价值更新 */
  itemValueUpdates?: Array<{ itemId: string; value: number }>;
  protagonistStateUpdate?: Partial<ProtagonistState>;
  timelineDeviation?: {
    eventId: string;
    newOutcome: string;
  };
  _tokenUsage?: TokenUsage;
  /** Host-generated native tool evidence, retained across file-tool continuations. */
  _webToolReceipts?: import('@/lib/game/action-operations').ActionOperationReceipt[];
  /** API 调用耗时（毫秒），前端展示用 */
  _elapsedMs?: number;
  /** 文学控制信号（可选）：本轮叙事承诺、回收、克制和戏剧功能自评 */
  literarySignals?: LiterarySignals;
  /** ALICE 提供审核理由，程序决定是否后台执行或等待关键状态确认。 */
  reviewRequest?: {
    reason: 'narrative_stall' | 'continuity_uncertainty' | 'major_turn' | 'causal_change';
    evidence: string;
  } | null;
  /** 人格观察信号（可选，Phase 2）：ALICE 在叙事中观察到的 NPC 人格相关事件。
   *  这不是让 AI 分析人格——只是让 AI 报告叙事中自然涉及的 NPC 互动，
   *  人格推演器（确定性代码）据此更新 NPC 状态。 */
  personalityObservations?: PersonalityObservations;
  /** 沙箱工具请求（仅 002 卷宗可执行）：ALICE 描述角色意图，执行器决定真实结果。 */
  sandboxToolRequests?: SandboxToolRequest[];
}

// ============================================================
// 人格观察信号（Phase 2：人格推演循环）
// ============================================================

/** ALICE 在叙事中观察到的人格相关事件。
 *  这不是让 AI 进行心理分析——只是让 AI 报告叙事中自然涉及的 NPC。
 *  人格推演器（确定性代码）收到这些信号后，自行更新 NPC 状态。 */
export interface PersonalityObservations {
  /** 本轮叙事中涉及的 NPC 及其反应 */
  npcsInvolved?: Array<{
    /** NPC 名称（需与 WorldDefinition.npcs 的 key 一致） */
    npcName: string;
    /** NPC 在本轮中的行为或反应摘要（一句话） */
    reaction: string;
    /** NPC 表现出的情绪 */
    emotion?: string;
    /** 本轮互动是否涉及该 NPC 的核心欲望/恐惧 */
    touchesCoreConcern?: boolean;
  }>;
  /** 值得该 NPC 记住的事件（情节记忆） */
  memoryWorthyEvents?: Array<{
    npcName: string;
    event: string;
    importanceHint: "low" | "medium" | "high";
    emotion?: string;
  }>;
  /** NPC 之间发生的值得记录的互动 */
  npcInteractions?: Array<{
    npcA: string;
    npcB: string;
    interaction: string;
    emotionalTone?: string;
  }>;
}

// ============================================================
// 底层 API 类型
// ============================================================

export interface InputContextUsage {
  modelId: string;
  providerId: string;
  inputTokens: number;
  windowTokens?: number;
  estimated: boolean;
}

export interface TokenUsage {
  promptBudget?: import('./prompt-budget').PromptBudgetReport;
  /** 请求时的实际模型和输入占用，缓存命中的输入同样占据上下文。 */
  inputContext?: InputContextUsage;
  usageEstimated?: boolean;
  /** 已收到计费信息但正文流失败时为 false。旧记录缺字段视为成功。 */
  success?: boolean;
  /** 请求发起时所属世界；null 表示不归属某一世界。 */
  worldId?: string | null;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cachedTokens?: number;
  uncachedPromptTokens?: number;
  cacheWriteTokens?: number;
  /** false / 缺字段表示缓存统计未知，不能当成真实零命中。 */
  cacheUsageReported?: boolean;
  providerId?: string;
  modelId?: string;
  /** 流式首个非空正文时间；不包含 thinking。 */
  firstTokenMs?: number;
  /** Provider termination and reasoning diagnostics; never includes reasoning text. */
  finishReason?: string;
  reasoningTokens?: number;
  outputChars?: number;
  errorCode?: string;
  model: "alice" | "kei" | "uzq";
  /** AI 调用类型标签（telemetry 用） */
  callType?: string;
  /** API 调用耗时（毫秒） */
  elapsedMs?: number;
}

// ============================================================
// 流式 API 回调类型
// ============================================================

/** 流式 chunk 回调：收到增量文本 */
export type StreamChunkCallback = (delta: string) => void;
/** 流式完成回调：返回完整文本 + token 用量 */
export type StreamDoneCallback = (fullText: string, usage: TokenUsage) => void;
/** 流式错误回调 */
export type StreamErrorCallback = (error: Error) => void;

export interface AiStreamActivity {
  phase: 'waiting' | 'thinking' | 'generating' | 'files' | 'search' | 'operation';
  elapsedMs: number;
  reasoningChars: number;
}

// ============================================================
// 流式回调接口
// ============================================================

/**
 * 流式回调
 *
 * 调用顺序：onProgress（多次）→ onSegments（渐进多次，每次有新 segment 完成时）
 * → onDone（一次，含完整元数据）
 *
 * onSegments 设计为渐进式——extractPartialSegments 从部分 JSON 中提取已完成的
 * segment 对象并立即通知，不等整个响应。这样让第一个 segment 在 2-3 秒内就到达
 * 客户端，而不是等 15-40 秒整个 JSON 完成。
 */
export interface StreamCallbacks {
  /** 独立于正文完成的失败请求计费信息。 */
  onUsage?: (usage: TokenUsage) => void;
  onActivity?: (activity: AiStreamActivity) => void;
  /** 收到增量文本时（用于进度指示） */
  onProgress?: (charsReceived: number) => void;
  /** 渐进式：每完成一个 segment 就调用一次（可能调用 3-6 次），最后一次含完整列表
   *  lastIsDraft 标记最后一个 segment 是否仍在生成中（文本可能不完整） */
  onSegments?: (segments: StorySegment[], lastIsDraft?: boolean) => void;
  /** 完整响应解析完成，含所有元数据 */
  onDone?: (response: AIGameResponse) => void;
  /** 流式错误 */
  onError?: (error: Error) => void;
}

// ============================================================
// 世界创建进度
// ============================================================

export interface WorldCreationProgress {
  field: string;
}

// ============================================================
// KEI 审核结果
// ============================================================

/** Runtime provenance is attached by the queue, never accepted from model output. */
export interface KeiReviewOrigin {
  worldId: string | null;
  playthroughId: string | null;
  worldLineId: string | null;
  archiveScope: string;
  parentNodeId: string | null;
  /** Actual live head while a directly forked action is still being saved. */
  expectedHeadId?: string;
  actionId: string;
}

export interface KeiNarrativeReviewContext {
  playerInput: string;
  responseText: string;
  recentHistory: Array<{ playerInput: string; aiResponse: string; summary: string; sceneId: string }>;
}

export interface KeiReviewResult {
  chapterDecision?: import('@/lib/game/chapters/types').ChapterDecision;
  _chapterBasis?: import('@/lib/game/chapters/types').ChapterBasis;
  _reviewOrigin?: KeiReviewOrigin;
  _reviewMode?: KeiReviewMode;
  _reviewLevel?: 'light' | 'quality' | 'causal';
  _reviewTrigger?: import('./kei-review-policy').KeiReviewTrigger;
  _reviewSequence?: number;
  _reviewSceneId?: string;
  _reviewOriginalCounts?: { encyclopedias: number; criticalFacts: number; quests: number };
  approved: boolean;
  corrections: string;
  correctedUpdates?: {
    encyclopediaUpdates?: Array<{ name: string; type: string; description: string; knowledge: string }>;
    criticalFactsDiscovered?: string[];
    questsDiscovered?: Array<{ title: string; description: string; relatedNpcs?: string[]; deadline?: GameTime | null }>;
    encyclopediaDeletions?: string[];
  };
  /** 因果推演：玩家行动的连锁反应预测（Deep Review 时生成） */
  causalProjections?: RippleEffect[];
  /** 预测验证：之前 pending 预测是否被本次行动实现/打破 */
  projectionVerifications?: Array<{ rippleId: string; status: "fulfilled" | "defied"; note: string }>;
  /** NPC 行为更新：受影响 NPC 的新行为快照 */
  npcBehaviorUpdates?: Array<{ npcName: string; currentActivity: string; currentMood: string; interactingWith: string[] }>;
  /** KEI 质量审核的接续指导：省略保留，对象整体替换，null 主动撤下。 */
  directorFrame?: DirectorFrame | null;
  /** 泄密警告：检测到 ALICE 泄露了未解锁信息 */
  spoilerWarnings?: Array<{
    fact: string;
    reason: string;
    severity: "low" | "medium" | "high";
  }>;
  /** 文学退化警告：检测到叙事质量退化（善恶简化、无铺垫揭示等） */
  literaryWarnings?: Array<{
    type:
      | "over_simple_morality"
      | "unearned_reveal"
      | "ignored_promise"
      | "character_flattening"
      | "causal_handwave"
      | "pacing_monotony"
      | "genre_contract_mismatch"
      | "lore_dump"
      | "premature_payoff"
      | "abstract_summary";
    note: string;
  }>;
  /** 人格连续性警告：ALICE 对 NPC 的行为描述与该 NPC 人格档案不一致 */
  personalityWarnings?: Array<{
    npcName: string;
    issue: string;
    severity: "minor" | "major";
  }>;
  /** 原作漂移警告：档案世界中 ALICE 把未知、桥接或推断误写成原作事实 */
  sourceDriftWarnings?: Array<{
    claim: string;
    issue: string;
    severity: "minor" | "major";
    evidenceRefs?: string[];
  }>;
}

export type KeiReviewMode = 'background' | 'blocking';
export type KeiStateProposal = Pick<KeiReviewResult, 'correctedUpdates' | 'npcBehaviorUpdates' | 'projectionVerifications'>;

// ============================================================
// 文学控制层类型（文学性世界引擎 v1）
// ============================================================

/** 导演帧：KEI 给 ALICE 的结构化导演指令。
 *  定义本轮叙事的戏剧功能、张力目标、揭示预算和焦点。 */
export interface DirectorFrame {
  /** 本轮戏剧功能 */
  beatFunction:
    | "setup"
    | "complicate"
    | "delay"
    | "partial_reveal"
    | "reversal"
    | "recognition"
    | "payoff"
    | "relief";
  /** 张力目标 */
  tensionTarget: "lower" | "hold" | "raise" | "spike" | "resolve";
  /** 叙事焦点列表（建议 1-2 条，最多 3 条） */
  narrativeFocus: Array<{
    /** 焦点对象（NPC 名称、场景 ID、线索 ID 或事件描述） */
    target: string;
    /** 下一轮叙事应如何处理该焦点 */
    instruction: string;
    /** 对玩家可见性 */
    visibility: "overt" | "subtext" | "hidden";
    /** @deprecated 旧存档兼容字段；适用性由模型结合内容判断，不做轮数倒计时。 */
    expiresInActions?: number;
  }>;
  /** 揭示预算：控制本轮信息释放量 */
  revealBudget: {
    /** 是否允许引入全新秘密 */
    allowNewSecret: boolean;
    /** 本轮最多揭示的事实数量 */
    maxFactsToReveal: number;
    /** 绝对禁止揭示的事实 ID 或描述 */
    forbiddenFacts: string[];
  };
  /** 可选的角色焦点（当本轮需要聚焦特定 NPC 时） */
  characterFocus?: {
    npcName: string;
    /** 该角色当前承受的弧线压力 */
    arcPressure: string;
    /** 需要暴露的角色内在矛盾（可选） */
    contradictionToExpose?: string;
  };
  /** 本轮叙事成功标准（不超过 3 条） */
  successCriteria: string[];
}

/** 知识门禁：决定本轮 ALICE 的信息视野。
 *  区分世界真相、NPC 知识、主角知识和 ALICE 可见信息。 */
export interface KnowledgeGate {
  /** 玩家已确认知道的事实（来自已发现线索、关键信息、百科知识） */
  playerKnownFacts: string[];
  /** 玩家可能猜测但尚未确认的假说（可选） */
  playerHypotheses?: string[];
  /** 未发现信息的约束；保留亲历记忆的有限例外由 perspectiveLimits 指定。 */
  forbiddenFacts: string[];
  /** 当前场景中已解锁、本轮可使用的秘密（可选） */
  visibleSecrets?: string[];
  /** 视角限制规则列表（如"只能描述可观察现象"） */
  perspectiveLimits?: string[];
}

/** 文学控制提示：传给 ALICE prompt 的容器参数。
 *  流式和非流式路径共用同一结构。 */
export interface LiteraryControlHints {
  /** 当前导演帧（KEI 上一轮产出或规则层默认生成） */
  directorFrame?: DirectorFrame | null;
  /** 当前知识门禁 */
  knowledgeGate?: KnowledgeGate | null;
  /** UZQ 人格简报。只作为 ALICE 的内隐人格约束，不得向玩家朗读。 */
  uzqBrief?: string | null;
}

/** ALICE 输出的叙事信号（可选字段，附加在 AIGameResponse 中）。
 *  帮助 KEI 追踪叙事承诺的打开和回收。 */
export interface LiterarySignals {
  /** 本轮新打开的叙事承诺 */
  promisesOpened?: string[];
  /** 本轮回收/兑现的叙事承诺 */
  promisesPaidOff?: string[];
  /** 本轮有意克制未揭示的事实 */
  factsWithheld?: string[];
  /** 本轮实际执行的戏剧功能（自评） */
  dramaticBeat?: DirectorFrame["beatFunction"];
}
