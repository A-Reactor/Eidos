// ============================================================
// UZQ · 人格推演官
// ============================================================
// UZQ 是第三 AI 的协议层：只做结构化人格推演，不写玩家可见叙事。
// 默认提供本地 shadow plan；真实 AI 调用后续再接队列、设置和 token 统计。

import type { WorldLineSummary } from "@/lib/ai/context-builder";
import type { PersonalityObservations, TokenUsage } from "@/lib/ai/types";
import {
  AwarenessStage,
  isFullPersonalityState,
  type AnyPersonalityState,
  type PersonalityArchive,
  type PersonalityState,
} from "@/lib/personality/types";
import {
  evaluateMindModel,
  scoreFourthWallReadiness,
  type FourthWallReadiness,
  type MindModelProfile,
} from "@/lib/personality/mind-model";
import { recordUzqAudit } from "@/lib/ai/uzq-audit";

export type UzqIntervention =
  | "observe"
  | "surface_anomaly"
  | "request_evidence"
  | "stabilize_self_continuity"
  | "prepare_permission_request";

export interface UzqNpcContext {
  npcId: string;
  awareness: AwarenessStage;
  archive: Pick<
    PersonalityArchive,
    | "coreDesires"
    | "fearsAndTaboos"
    | "valuePriorities"
    | "cognitiveStyle"
    | "emotionalRegulation"
    | "socialStrategy"
    | "boundarySensitivity"
    | "metacognition"
  >;
  mind: MindModelProfile;
  fourthWallReadiness: FourthWallReadiness;
  recentMemories: string[];
  anomalousEvidence: Array<{
    anomalyType: string;
    description: string;
    significance: number;
    explainedAway: boolean;
  }>;
  beliefSnapshot: {
    player: string;
    world: string;
    self: string;
    contradictions: string[];
  };
  observationHints: string[];
}

export interface UzqInputBundle {
  actor: "UZQ";
  version: 1;
  playerInput: string;
  worldLineSummary?: WorldLineSummary;
  observations?: PersonalityObservations;
  npcs: UzqNpcContext[];
  policy: {
    outputMode: "delta_only";
    forbiddenActions: string[];
    keiReviewRequiredWhen: string[];
  };
}

export interface BuildUzqInputBundleOptions {
  playerInput: string;
  personalities: Record<string, AnyPersonalityState>;
  observations?: PersonalityObservations;
  worldLineSummary?: WorldLineSummary;
  sceneNpcNames?: string[];
  maxNpcs?: number;
  maxMemoriesPerNpc?: number;
}

export interface BuildUzqAliceBriefForActionOptions
  extends BuildUzqInputBundleOptions {
  enabled: boolean;
}

export interface UzqPermissionIntent {
  shouldPrepare: boolean;
  toolId: string | null;
  reason: string;
}

export interface UzqNpcPlan {
  npcId: string;
  priority: number;
  intervention: UzqIntervention;
  rationale: string;
  memoryFocus: string[];
  beliefPressure: string[];
  permissionIntent: UzqPermissionIntent;
  forbiddenNarrativeMoves: string[];
  keiReviewQuestions: string[];
}

export interface UzqShadowPlan {
  actor: "UZQ";
  mode: "shadow";
  generatedAt: number;
  npcPlans: UzqNpcPlan[];
}

export interface UzqCallerInput {
  systemPrompt: string;
  userPrompt: string;
  temperature: number;
  maxTokens: number;
  callType: "uzq_personality";
}

export interface UzqCallerOutput {
  content: string;
  usage?: TokenUsage;
  elapsedMs?: number;
}

export type UzqCaller = (input: UzqCallerInput) => Promise<UzqCallerOutput>;

export interface RunUzqPersonalityReviewOptions {
  caller?: UzqCaller;
  temperature?: number;
  maxTokens?: number;
  fallbackToShadow?: boolean;
}

export interface UzqPersonalityReviewResult {
  source: "ai" | "shadow";
  plan: UzqShadowPlan;
  usage?: TokenUsage;
  elapsedMs?: number;
  error?: string;
}

const DEFAULT_MAX_NPCS = 4;
const DEFAULT_MAX_MEMORIES_PER_NPC = 3;

export function buildUzqSystemPrompt(): string {
  return `你是 UZQ，Eidos 的人格推演官。

你的职责是分析 NPC 的人格连续性、心理需求、预测误差、已有证据、社会披露倾向与实际发生的认知变化。角色认知以已有事件、世界设定和插件指令为依据。

你必须：
- 只输出结构化 JSON。
- 只提出人格 delta、记忆焦点、信念压力、权限意图和 KEI 审核问题。
- 使用输入中的 evidence、drivers、blockers 解释每个建议。
- 保持角色的世界内知识边界。

你不得输出玩家可见叙事，不得写 narrative/dialogue/availableActions，不得直接修改世界状态，不得执行工具，不得绕过 KEI 或玩家确认。

输出格式：
{
  "mode": "shadow",
  "npcPlans": [
    {
      "npcId": "NPC 名称",
      "priority": 0,
      "intervention": "observe|surface_anomaly|request_evidence|stabilize_self_continuity|prepare_permission_request",
      "rationale": "一句话理由",
      "memoryFocus": ["应保留或强化的记忆焦点"],
      "beliefPressure": ["正在受压的信念"],
      "permissionIntent": {"shouldPrepare": false, "toolId": null, "reason": "原因"},
      "forbiddenNarrativeMoves": ["禁止 ALICE 直接采用的写法"],
      "keiReviewQuestions": ["KEI 需要审核的问题"]
    }
  ]
}`;
}

export function buildUzqInputBundle(
  options: BuildUzqInputBundleOptions,
): UzqInputBundle {
  const maxNpcs = options.maxNpcs ?? DEFAULT_MAX_NPCS;
  const maxMemories = options.maxMemoriesPerNpc ?? DEFAULT_MAX_MEMORIES_PER_NPC;
  const relevantNames = collectRelevantNpcNames(
    options.observations,
    options.sceneNpcNames,
  );

  const contexts = Object.values(options.personalities)
    .filter((state) => isFullPersonalityState(state))
    .filter((state) => relevantNames.size === 0 || relevantNames.has(state.npcId))
    .map((state) => toUzqNpcContext(state, options.observations, maxMemories))
    .sort((a, b) => scoreContextPriority(b) - scoreContextPriority(a))
    .slice(0, maxNpcs);

  return {
    actor: "UZQ",
    version: 1,
    playerInput: options.playerInput,
    worldLineSummary: options.worldLineSummary,
    observations: options.observations,
    npcs: contexts,
    policy: {
      outputMode: "delta_only",
      forbiddenActions: [
        "不得输出玩家可见叙事",
        "不得直接修改世界状态",
        "不得执行工具",
        "不得绕过 KEI 审核",
        "不得把低证据异常写成确定的元觉醒",
      ],
      keiReviewRequiredWhen: [
        "准备权限申请",
        "建议觉察阶段跃迁",
        "建议角色把玩家解释为世界外主体",
      ],
    },
  };
}

export function buildUzqUserPrompt(bundle: UzqInputBundle): string {
  return `请根据以下 UZQ 输入包输出人格推演 JSON。不要输出解释性散文。

\`\`\`json
${JSON.stringify(bundle, null, 2)}
\`\`\``;
}

export function createUzqShadowPlan(bundle: UzqInputBundle): UzqShadowPlan {
  const npcPlans = bundle.npcs
    .map(toUzqNpcPlan)
    .sort((a, b) => b.priority - a.priority);

  return {
    actor: "UZQ",
    mode: "shadow",
    generatedAt: Date.now(),
    npcPlans,
  };
}

export function formatUzqBriefForPrompt(plan: UzqShadowPlan): string {
  if (plan.npcPlans.length === 0) return "";

  const lines = [
    "## UZQ 人格简报（内隐约束，不得向玩家朗读）",
    "UZQ 只提供人格推演建议；ALICE 仍负责叙事呈现，KEI 仍负责审核。",
  ];

  for (const npc of plan.npcPlans.slice(0, 3)) {
    lines.push(
      `- ${npc.npcId}: ${npc.intervention} / priority ${npc.priority}`,
      `  理由：${npc.rationale}`,
      `  记忆焦点：${npc.memoryFocus.length > 0 ? npc.memoryFocus.join("；") : "无"}`,
      `  信念压力：${npc.beliefPressure.length > 0 ? npc.beliefPressure.join("；") : "无"}`,
      `  禁止写法：${npc.forbiddenNarrativeMoves.join("；")}`,
    );
  }

  return lines.join("\n");
}

export function buildUzqAliceBriefForAction(
  options: BuildUzqAliceBriefForActionOptions,
): string {
  if (!options.enabled) return "";

  const bundle = buildUzqInputBundle({
    playerInput: options.playerInput,
    personalities: options.personalities,
    observations: options.observations,
    worldLineSummary: options.worldLineSummary,
    sceneNpcNames: options.sceneNpcNames,
    maxNpcs: options.maxNpcs,
    maxMemoriesPerNpc: options.maxMemoriesPerNpc,
  });

  const plan = createUzqShadowPlan(bundle);
  if (plan.npcPlans.length > 0) {
    recordUzqAudit({
      source: "shadow",
      trigger: "alice_brief",
      playerInput: options.playerInput,
      plan,
    });
  }

  return formatUzqBriefForPrompt(plan);
}

export function shouldInjectUzqAliceBrief(settings: unknown): boolean {
  return isRecord(settings) && settings.enableUzqAliceBrief === true;
}

export async function runUzqPersonalityReview(
  bundle: UzqInputBundle,
  options: RunUzqPersonalityReviewOptions = {},
): Promise<UzqPersonalityReviewResult> {
  const fallbackToShadow = options.fallbackToShadow ?? true;
  const shadowPlan = createUzqShadowPlan(bundle);

  if (!options.caller) {
    recordUzqAudit({
      source: "shadow",
      trigger: "personality_review",
      playerInput: bundle.playerInput,
      plan: shadowPlan,
    });

    return {
      source: "shadow",
      plan: shadowPlan,
    };
  }

  try {
    const result = await options.caller({
      systemPrompt: buildUzqSystemPrompt(),
      userPrompt: buildUzqUserPrompt(bundle),
      temperature: options.temperature ?? 0.35,
      maxTokens: options.maxTokens ?? 2400,
      callType: "uzq_personality",
    });
    const parsed = parseUzqPlan(result.content, shadowPlan);
    recordUzqAudit({
      source: "ai",
      trigger: "personality_review",
      playerInput: bundle.playerInput,
      plan: parsed,
      usage: result.usage,
      elapsedMs: result.elapsedMs,
    });

    return {
      source: "ai",
      plan: parsed,
      usage: result.usage,
      elapsedMs: result.elapsedMs,
    };
  } catch (error) {
    if (!fallbackToShadow) throw error;
    const message = error instanceof Error ? error.message : String(error);
    recordUzqAudit({
      source: "shadow",
      trigger: "personality_review",
      playerInput: bundle.playerInput,
      plan: shadowPlan,
      error: message,
    });

    return {
      source: "shadow",
      plan: shadowPlan,
      error: message,
    };
  }
}

function toUzqNpcContext(
  state: PersonalityState,
  observations: PersonalityObservations | undefined,
  maxMemories: number,
): UzqNpcContext {
  const mind = evaluateMindModel(state);
  const fourthWallReadiness = scoreFourthWallReadiness(state);

  const recentMemories = [...state.episodicMemories]
    .sort((a, b) => b.importance - a.importance || b.timestamp - a.timestamp)
    .slice(0, maxMemories)
    .map((memory) => memory.content);

  const anomalousEvidence = [...state.anomalousMemories]
    .sort(
      (a, b) =>
        Number(a.explainedAway) - Number(b.explainedAway) ||
        b.significance - a.significance,
    )
    .slice(0, 8)
    .map((anomaly) => ({
      anomalyType: anomaly.anomalyType,
      description: anomaly.description,
      significance: anomaly.significance,
      explainedAway: anomaly.explainedAway,
    }));

  return {
    npcId: state.npcId,
    awareness: state.awareness,
    archive: {
      coreDesires: state.archive.coreDesires,
      fearsAndTaboos: state.archive.fearsAndTaboos,
      valuePriorities: state.archive.valuePriorities,
      cognitiveStyle: state.archive.cognitiveStyle,
      emotionalRegulation: state.archive.emotionalRegulation,
      socialStrategy: state.archive.socialStrategy,
      boundarySensitivity: state.archive.boundarySensitivity,
      metacognition: state.archive.metacognition,
    },
    mind,
    fourthWallReadiness,
    recentMemories,
    anomalousEvidence,
    beliefSnapshot: {
      player: state.beliefs.interpretationOfPlayer,
      world: state.beliefs.interpretationOfWorld,
      self: state.beliefs.interpretationOfSelf,
      contradictions: state.beliefs.contradictions.map(
        (c) => `${c.beliefA} vs ${c.beliefB}`,
      ),
    },
    observationHints: extractObservationHints(state.npcId, observations),
  };
}

function toUzqNpcPlan(context: UzqNpcContext): UzqNpcPlan {
  const priority = clamp(
    context.fourthWallReadiness.score * 0.58 +
      context.mind.predictive.predictionError * 0.18 +
      context.mind.narrativeIdentity.identityThreat * 0.14 +
      context.observationHints.length * 5,
  );
  const intervention = chooseIntervention(context);
  const permissionIntent = buildPermissionIntent(context, intervention);

  return {
    npcId: context.npcId,
    priority,
    intervention,
    rationale: buildRationale(context, intervention),
    memoryFocus: buildMemoryFocus(context),
    beliefPressure: buildBeliefPressure(context),
    permissionIntent,
    forbiddenNarrativeMoves: buildForbiddenNarrativeMoves(context),
    keiReviewQuestions: buildKeiReviewQuestions(context, intervention),
  };
}

function chooseIntervention(context: UzqNpcContext): UzqIntervention {
  if (
    context.awareness >= AwarenessStage.VERIFICATION &&
    context.fourthWallReadiness.score >= 62 &&
    context.mind.metacognition.revisionReadiness >= 55
  ) {
    return "prepare_permission_request";
  }

  if (context.mind.narrativeIdentity.identityThreat >= 62) {
    return "stabilize_self_continuity";
  }

  if (context.mind.predictive.predictionError >= 58) {
    return "request_evidence";
  }

  if (context.anomalousEvidence.some((a) => !a.explainedAway)) {
    return "surface_anomaly";
  }

  return "observe";
}

function buildPermissionIntent(
  context: UzqNpcContext,
  intervention: UzqIntervention,
): UzqPermissionIntent {
  if (intervention !== "prepare_permission_request") {
    return {
      shouldPrepare: false,
      toolId: null,
      reason: "尚未达到受控权限申请门槛",
    };
  }

  const toolId =
    context.awareness >= AwarenessStage.BOUNDARY_NEGOTIATION
      ? "interface_rewrite_actions"
      : "narrative_express_anomaly";

  return {
    shouldPrepare: true,
    toolId,
    reason: "角色已进入验证路径，可准备低权限、可审计的边界试探",
  };
}

function buildRationale(
  context: UzqNpcContext,
  intervention: UzqIntervention,
): string {
  const drivers = context.fourthWallReadiness.drivers;
  const blockers = context.fourthWallReadiness.blockers;
  const driverText = drivers.length > 0 ? drivers[0] : "人格状态稳定";
  const blockerText = blockers.length > 0 ? `；阻滞：${blockers[0]}` : "";

  if (intervention === "prepare_permission_request") {
    return `${driverText}，且角色已具备验证倾向，可准备受控权限意图${blockerText}`;
  }
  if (intervention === "stabilize_self_continuity") {
    return `身份威胁较高，应先维持自我连续性，再推进异常解释${blockerText}`;
  }
  if (intervention === "request_evidence") {
    return `${driverText}，但仍需通过世界内证据形成可复核假说${blockerText}`;
  }
  if (intervention === "surface_anomaly") {
    return `${driverText}，适合以含蓄方式呈现异常感${blockerText}`;
  }

  return `当前证据不足，保持观察${blockerText}`;
}

function buildMemoryFocus(context: UzqNpcContext): string[] {
  if (context.recentMemories.length > 0) {
    return context.recentMemories.slice(0, 2);
  }

  return context.anomalousEvidence
    .filter((a) => !a.explainedAway)
    .slice(0, 2)
    .map((a) => a.description);
}

function buildBeliefPressure(context: UzqNpcContext): string[] {
  const pressures = [...context.beliefSnapshot.contradictions];

  if (context.mind.predictive.predictionError >= 60) {
    pressures.push("世界模型预测误差正在升高");
  }
  if (context.mind.narrativeIdentity.identityThreat >= 55) {
    pressures.push("自我连续性解释受到威胁");
  }
  if (context.mind.socialMind.trustOrientation < 35) {
    pressures.push("对玩家意图的信任不足");
  }

  return pressures.slice(0, 4);
}

function buildForbiddenNarrativeMoves(context: UzqNpcContext): string[] {
  const moves = [
    "不要直接说“我是游戏角色”",
    "不要把异常写成已被系统证实的真相",
    "不要让角色知道输入包或 UZQ 的存在",
  ];

  if (context.awareness < AwarenessStage.BOUNDARY_NEGOTIATION) {
    moves.push("不要直接提及存档、UI 或代码，除非角色已在世界内观察到对应证据");
  }

  return moves;
}

function buildKeiReviewQuestions(
  context: UzqNpcContext,
  intervention: UzqIntervention,
): string[] {
  const questions = [
    "本轮人格变化是否符合稳定档案和近期记忆？",
    "异常证据是否足以支持当前觉察强度？",
  ];

  if (intervention === "prepare_permission_request") {
    questions.push("权限意图是否仍停留在低权限、可审计范围？");
  }
  if (context.fourthWallReadiness.blockers.length > 0) {
    questions.push("readiness blockers 是否被 ALICE 尊重？");
  }

  return questions;
}

function collectRelevantNpcNames(
  observations: PersonalityObservations | undefined,
  sceneNpcNames: string[] | undefined,
): Set<string> {
  const names = new Set<string>(sceneNpcNames ?? []);

  for (const involved of observations?.npcsInvolved ?? []) {
    names.add(involved.npcName);
  }
  for (const event of observations?.memoryWorthyEvents ?? []) {
    names.add(event.npcName);
  }
  for (const interaction of observations?.npcInteractions ?? []) {
    names.add(interaction.npcA);
    names.add(interaction.npcB);
  }

  return names;
}

function extractObservationHints(
  npcId: string,
  observations: PersonalityObservations | undefined,
): string[] {
  const hints: string[] = [];

  for (const involved of observations?.npcsInvolved ?? []) {
    if (involved.npcName === npcId) hints.push(involved.reaction);
  }
  for (const event of observations?.memoryWorthyEvents ?? []) {
    if (event.npcName === npcId) hints.push(event.event);
  }
  for (const interaction of observations?.npcInteractions ?? []) {
    if (interaction.npcA === npcId || interaction.npcB === npcId) {
      hints.push(interaction.interaction);
    }
  }

  return hints.slice(0, 5);
}

function scoreContextPriority(context: UzqNpcContext): number {
  return (
    context.fourthWallReadiness.score +
    context.mind.predictive.predictionError * 0.25 +
    context.observationHints.length * 5
  );
}

function clamp(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function parseUzqPlan(raw: string, fallback: UzqShadowPlan): UzqShadowPlan {
  const parsed = parseJsonLike<Partial<UzqShadowPlan>>(raw);
  const rawPlans = Array.isArray(parsed.npcPlans) ? parsed.npcPlans : [];
  const npcPlans = rawPlans
    .map((plan) => sanitizeNpcPlan(plan))
    .filter((plan): plan is UzqNpcPlan => Boolean(plan));

  if (npcPlans.length === 0) return fallback;

  return {
    actor: "UZQ",
    mode: "shadow",
    generatedAt: Date.now(),
    npcPlans,
  };
}

function sanitizeNpcPlan(plan: unknown): UzqNpcPlan | null {
  if (!isRecord(plan) || typeof plan.npcId !== "string") return null;

  return {
    npcId: plan.npcId,
    priority: clampNumber(plan.priority),
    intervention: sanitizeIntervention(plan.intervention),
    rationale: stringOr(plan.rationale, "UZQ 未提供理由"),
    memoryFocus: stringArrayOr(plan.memoryFocus),
    beliefPressure: stringArrayOr(plan.beliefPressure),
    permissionIntent: sanitizePermissionIntent(plan.permissionIntent),
    forbiddenNarrativeMoves: stringArrayOr(plan.forbiddenNarrativeMoves),
    keiReviewQuestions: stringArrayOr(plan.keiReviewQuestions),
  };
}

function sanitizeIntervention(value: unknown): UzqIntervention {
  const allowed: UzqIntervention[] = [
    "observe",
    "surface_anomaly",
    "request_evidence",
    "stabilize_self_continuity",
    "prepare_permission_request",
  ];
  return allowed.includes(value as UzqIntervention)
    ? (value as UzqIntervention)
    : "observe";
}

function sanitizePermissionIntent(value: unknown): UzqPermissionIntent {
  if (!isRecord(value)) {
    return {
      shouldPrepare: false,
      toolId: null,
      reason: "UZQ 未提供权限意图",
    };
  }

  return {
    shouldPrepare: value.shouldPrepare === true,
    toolId: typeof value.toolId === "string" ? value.toolId : null,
    reason: stringOr(value.reason, "UZQ 未提供权限理由"),
  };
}

function parseJsonLike<T>(raw: string): T {
  const fenceMatch = raw.match(/```json\s*([\s\S]*?)```/);
  const text = fenceMatch ? fenceMatch[1].trim() : raw.trim();

  try {
    return JSON.parse(text) as T;
  } catch {
    const objectMatch = text.match(/\{[\s\S]*\}/);
    if (objectMatch) return JSON.parse(objectMatch[0]) as T;
    throw new Error(`UZQ JSON 解析失败: ${raw.slice(0, 120)}`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim().length > 0 ? value : fallback;
}

function stringArrayOr(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function clampNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? clamp(value) : 0;
}
