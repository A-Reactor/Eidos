import { directorFrameRecorded } from '@/lib/game/director-cues';
import { actionImageMessage, type ActionImageInput } from './action-images';
import { workspaceProtocol, workspacePromptParts, toolReplyForContinuation, hasActionTool, parseWorkspaceToolReply } from './workspace-tools';
import { NATIVE_WEB_TOOL_GUIDE } from './action-web-tools';
import { createActionNativeTools, NATIVE_ACTION_TOOL_GUIDE } from './action-native-tools';
import { attachSearchSources, compactWebReceipt } from '@/lib/game/web-context';
import { attachChapterGeneration, chapterGenerationSnapshot, prepareChapterGeneration } from './chapter-director';
import { normalizeChapterSnapshot } from './chapter-director';
import { documentResponse, recoveredDocument, normalizeDocumentReply, actionDocumentForContinuation } from './document-response';
import { aliceUserInstructions } from './user-instructions';
import { loadSettings } from '@/lib/game/settings';
import { fitActionContext } from './action-context-diagnostics';
import { narrativePrompt, NARRATIVE_KNOWLEDGE_RULE, protectNarrativeResponse, type NarrativeRequest } from '@/lib/game/narrative';
import { extractNarrativeFrame } from './stream-parser';
import { composeSystemPrompt } from './prompt-layout';
import { hasActiveGameplayGuide, buildGameplayPromptSections, buildGameplayRuntimePrompt } from "@/lib/game/plugins/runtime";
import { buildActionTimeContext } from '@/lib/game/time';
// ============================================================
// AI 玩家行动处理（非流式版）
// ============================================================
// 处理玩家输入，构造完整 prompt，调用 DeepSeek API，
// 解析 JSON 响应并返回结构化的 AIGameResponse。

import { buildWorldContextSections, buildKnowledgeGateContext } from "./context-builder";
import { resolveCardActionContext } from '@/lib/game/cards/context';
import { isInitialWorldObservation } from '@/lib/game/world-entry';
import { buildGenerationBiasInstruction } from "./action-guidance";
import { callAi, callDeepSeek, parseJSON, setCurrentSettings, _keiCorrectionSubscribers } from "./client";
import { getBuiltInWorld } from "./builtin-worlds";
import { FANTASY_RESPONSES, getRandomFantasyResponse, buildActionPromptSections, buildNarrativeLanguageInstruction, resolveNarrativeLanguage, type NarrativeLanguage } from "./prompt-templates";
import { salvagePartialGameResponse } from "./salvage";
import { emptyOutputError, withFailureUsage } from './providers/stream-control';
import {
  buildUzqAliceBriefForAction,
  shouldInjectUzqAliceBrief,
} from "./uzq-personality";
import { collectSceneNpcNames } from "./npc-context";
import { projectNpcMemoryState } from "@/lib/game/npc-memory-save";
import { repairLegacyNpcDefaults } from '@/lib/personality/legacy-defaults';
import {
  type AIGameResponse,
  type StorySegment,
  type TokenUsage,
  type DirectorFrame,
  type LiteraryControlHints,
} from "./types";
import type {
  WorldSnapshot,
  WorldDefinition,
  InventoryItem,
  Clue,
  CriticalFactEntry,
  EncyclopediaEntry,
  QuestEntry,
  ProtagonistState,
  GameTime,
} from "@/lib/game/types";
import type { CreativeModeConfig } from "@/lib/game/types";
import { buildAlicePromptAdditions, resolveAliceTemperature } from "./creative-injector";
import { buildMetaRealityRuntimePromptContext } from "./meta-reality-runtime";
import {
  buildSandboxToolProtocolContext,
  type SandboxToolAuditPromptEntry,
} from "./sandbox-tool-pipeline";

/** 保存最近一次发给 AI 的完整 prompt（调试用） */
export let lastPromptSent = "";

export function missingActionTextError(response: Partial<AIGameResponse> | null, usage: TokenUsage, hasProgressiveText = false) {
  if (response?.document?.content) return undefined;
  if (response && hasActionTool(response)) return undefined;
  if (response?.validity?.isPossible === false || hasProgressiveText ||
    (Array.isArray(response?.segments) && response.segments.some(segment => typeof segment?.text === 'string' && segment.text.trim())) ||
    (typeof response?.narrative === 'string' && response.narrative.trim()) ||
    (typeof response?.dialogue === 'string' && response.dialogue.trim())) return undefined;
  return withFailureUsage(emptyOutputError(usage.finishReason), usage);
}

/**
 * 设置 lastPromptSent 的值。
 * 供 action-stream.ts 等外部模块写入（ES module let 导入为只读绑定）。
 */
export function setLastPromptSent(value: string): void {
  lastPromptSent = value;
}

// ============================================================
// 文学控制：旧调用方的导演帧镜像；行动生成只读取请求快照中的帧。
// ============================================================

/** 当前可用的导演帧（由上一轮 KEI Quality Review 产出） */
let _currentDirectorFrame: DirectorFrame | null = null;

/** 获取当前导演帧（供 action-stream.ts 等外部模块读取） */
export function getCurrentDirectorFrame(): DirectorFrame | null {
  return _currentDirectorFrame;
}

/** 设置当前导演帧（供外部模块注入） */
export function setCurrentDirectorFrame(frame: DirectorFrame | null): void {
  _currentDirectorFrame = frame;
}

// 订阅 KEI 修正回调，从中提取 directorFrame 供下一轮使用
_keiCorrectionSubscribers.add((result) => {
  if (result.directorFrame !== undefined) {
    _currentDirectorFrame = result.directorFrame;
  }
});

// ============================================================
// 玩家行动处理（增强版）
// ============================================================

export interface ProcessActionOptions {
  webToolExecutor?: import('@/lib/game/web-tools').WebToolExecutor;
  imageInputs?: ActionImageInput[];
  imageCatalog?: import('@/lib/game/midori/image-context').ImageCatalogEntry[];
  chapterPreparation?: unknown;
  documentMode?: boolean;
  workspaceContext?: import('@/lib/game/workspace/context').WorkspacePromptContext;
  cardContext?: import('@/lib/game/cards/types').CardActionContext;
  narrativeRequest?: NarrativeRequest;
  playerInput: string;
  snapshot: WorldSnapshot;
  recentHistory?: Array<{ playerInput: string; summary: string; aiResponse?: string }>;
  world?: WorldDefinition | null;
  inventory?: InventoryItem[];
  clues?: Clue[];
  encyclopedia?: EncyclopediaEntry[];
  criticalFacts?: CriticalFactEntry[];
  questLog?: QuestEntry[];
  introspection?: boolean;
  weather?: string;
  protagonistState?: ProtagonistState | null;
  forceFull?: boolean;
  clientSettings?: Record<string, string> | null;
  creativeConfig?: CreativeModeConfig | null;
  metaRealityContext?: string;
  longMemoryContext?: string;
  generationBias?: number; // 0=细节展示, 100=任务推进
  worldLineSummary?: import("./context-builder").WorldLineSummary;
  narrativeLanguage?: NarrativeLanguage;
  sandboxMode?: boolean;
  sandboxToolAudit?: SandboxToolAuditPromptEntry[];
  /** @deprecated 保留调用兼容；审核申请由浏览器接受行动时建立。 */
  skipKeiStorage?: boolean;
  signal?: AbortSignal;
}

/**
 * 处理玩家行动——非流式主路径。
 *
 * 1. 构建完整的世界上下文（含背包/线索/百科/任务/关键信息）
 * 2. 如果是 introspection 模式，以主角身份直接回答问题
 * 3. 如果是正常行动，构造详细 system prompt + 调用 DeepSeek
 * 4. 解析 JSON 响应，兼容旧版 narrative/dialogue 格式
 * 5. 合理性检查：不合理行动用幻想回复替代
 * 6. 返回候选响应，浏览器实际接受后再申请 KEI 审核
 */
export async function processPlayerAction(
  opts: ProcessActionOptions
): Promise<AIGameResponse> {
  opts = { ...opts, snapshot: normalizeChapterSnapshot(opts.snapshot) };
  const generation = await prepareChapterGeneration(opts);
  try {
    const response = await generatePlayerAction({ ...opts, snapshot: chapterGenerationSnapshot(opts.snapshot, generation) });
    return attachChapterGeneration(response, generation);
  } catch (error) {
    if (error && typeof error === 'object' && generation.usage) Object.assign(error, { _chapterUsage: [generation.usage] });
    throw error;
  }
}

async function generatePlayerAction(opts: ProcessActionOptions): Promise<AIGameResponse> {
  const {
    playerInput,
    snapshot,
    recentHistory = [],
    world = null,
    inventory = [],
    clues = [],
    encyclopedia = [],
    criticalFacts = [],
    questLog = [],
    introspection = false,
    weather = "晴",
    protagonistState = null,
    forceFull = false,
    clientSettings = null,
    creativeConfig = null,
    metaRealityContext = "",
    longMemoryContext = "",
    generationBias = 50,
    worldLineSummary,
    narrativeLanguage: requestedNarrativeLanguage,
    sandboxMode = false,
    sandboxToolAudit = [],
  } = opts;
  const imageRequest = actionImageMessage(playerInput, opts.imageInputs);
  const narrativeLanguage = requestedNarrativeLanguage ?? resolveNarrativeLanguage(clientSettings);
  setCurrentSettings(clientSettings);
  const worldDef = world ?? getBuiltInWorld();
  const sceneNpcNames = collectSceneNpcNames(worldDef, snapshot.currentSceneId);
  const npcProjection = projectNpcMemoryState(snapshot.npcMemory);
  const npcStates = snapshot.npcStates ?? npcProjection.npcStates;
  const relationships = snapshot.relationships ?? npcProjection.relationships;
  const { npcBehaviors, npcPersonalities } = repairLegacyNpcDefaults({
    npcBehaviors: snapshot.npcBehaviors ?? npcProjection.npcBehaviors,
    npcPersonalities: snapshot.npcPersonalities ?? npcProjection.npcPersonalities,
  }, worldDef);

  const historySummary =
    recentHistory.length > 0
      ? `\n## 最近行动记录\n${recentHistory
          .map((h) => `- 玩家：${h.playerInput} → ${h.summary}`)
          .join("\n")}`
      : "";

  const cards = await resolveCardActionContext({ ...opts, world: worldDef });
  const worldContextInput = {
    imageCatalog: opts.imageCatalog,
    cardContext: cards,
    world: worldDef,
    snapshot,
    inventory,
    clues,
    encyclopedia,
    criticalFacts,
    questLog,
    historySummary,
    initialObservation: !introspection && isInitialWorldObservation(playerInput, snapshot),
    longMemoryContext,
    weather,
    protagonistState,
    forceFull,
    npcStates,
    diary: snapshot.diary ?? [],
    relationships,
    causalProjections: snapshot.causalProjections ?? [],
    npcBehaviors,
    npcPersonalities,
    worldLineSummary,
  };

  // 思考模式——主角的知识问答，不影响世界
  if (introspection) {
    const buildIntrospection = (historySummary: string) => {
    const worldContextSections = buildWorldContextSections({ ...worldContextInput, historySummary });
    const prompt = `你是${worldDef.name}中主角「${snapshot.playerName}」的意识。
玩家在向你提问，你需要基于主角已知的信息直接回答。

## 身份
你是「${snapshot.playerName}」。
你拥有这个身份应有的知识和记忆。以下是你在冒险中积累的所有信息。
有些信息玩家可能还不知道——但作为主角，你知道。直接回答即可。

## 回答规则
- 直接回答玩家的问题，不要绕弯子，不要写叙事
- 主角知道的信息就直接说；不知道的就诚实说「我不太确定」并可以给出合理推测
- 回答简洁——50-200 字，像真人在快速回忆或估量
- 用第一人称「我」，语气自然
- 可以利用背包物品、已发现线索、百科、历史记录来回答
- 例如「到观景桥大概十分钟，从中央广场穿过主路就到了」
- 例如「我上次见到她是昨天下午在酒馆，她说要去走私码头」

${NARRATIVE_KNOWLEDGE_RULE}
${aliceUserInstructions(clientSettings)}
${composeSystemPrompt(worldContextSections)}
${buildMetaRealityRuntimePromptContext(metaRealityContext)}

${buildNarrativeLanguageInstruction(narrativeLanguage)}

## 输出格式
简单的 JSON：
{
  "narrative": "直接回答（50-200字，第一人称）",
  "summary": "思考摘要（10字以内）",
  "criticalFactsDiscovered": ["如果发现值得记录的关键信息，填在这里（可选）"],
  "encyclopediaUpdates": [{"name":"","type":"npc|item|location|concept","description":"","knowledge":""}],
  "encyclopediaDeletions": ["要删除的条目名"]
}`;
    return { stablePrefix: '', dynamicSuffix: prompt };
    };
    const { systemPrompt, diagnostics: contextDiagnostics } = fitActionContext({ cards, recentHistory: recentHistory.map(({ playerInput, summary }) => ({ playerInput, summary })),
      build: buildIntrospection, userMessage: imageRequest.userMessage, maxTokens: 1000, settings: clientSettings });

    const introTemp = resolveAliceTemperature(creativeConfig, 0.7);
    const { content, usage, elapsedMs } = imageRequest.media
      ? await callAi({ role: "alice", media: imageRequest.media, systemPrompt, userMessage: imageRequest.userMessage, temperature: introTemp, maxTokens: 1000, jsonMode: true, timeoutMs: 90000, settingsOverride: clientSettings, callType: "alice_introspection", signal: opts.signal })
      : await callDeepSeek(systemPrompt, playerInput, introTemp, 1000, true, 90000, false, clientSettings, undefined, "alice_introspection", opts.signal);
    const parsed = parseJSON<{ narrative: string; summary: string; criticalFactsDiscovered?: string[]; encyclopediaUpdates?: Array<{ name: string; type: string; description: string; knowledge: string }>; encyclopediaDeletions?: string[] }>(content);
    const missingText = missingActionTextError({ narrative: parsed?.narrative }, usage);
    if (missingText) throw missingText;
    return {
      validity: { isPossible: true, fantasyResponse: null, reason: null },
      _contextDiagnostics: contextDiagnostics,
      segments: [{ type: "narration", text: parsed.narrative || "..." }],
      narrative: parsed.narrative,
      sceneChanges: [],
      discoveredSecrets: [],
      npcsReacted: [],
      availableActions: [],
      summary: parsed.summary || "思考了一下",
      timeSpent: { day: 0, hour: 0, minute: 1 },
      itemsGained: [],
      itemsUsed: [],
      cluesDiscovered: [],
      worldImpacts: [],
      criticalFactsDiscovered: parsed.criticalFactsDiscovered ?? [],
      encyclopediaUpdates: parsed.encyclopediaUpdates ?? [],
      encyclopediaDeletions: parsed.encyclopediaDeletions ?? [],
      _tokenUsage: usage,
      _elapsedMs: elapsedMs,
    };
  }

  // 主行动 prompt：按「稳定规则 → 动态状态」排序，让 DeepSeek 缓存命中稳定前缀
  const timeNote = buildActionTimeContext(snapshot.currentGameTime);

  // 文学控制层：构建知识门禁 + 读取当前导演帧
  const knowledgeGate = buildKnowledgeGateContext({
    clues,
    encyclopedia,
    criticalFacts,
    world: worldDef,
    snapshot,
  });
  const literaryControl: LiteraryControlHints = {
    directorFrame: snapshot.lastDirectorFrame ?? null,
    knowledgeGate,
    uzqBrief: buildUzqAliceBriefForAction({
      enabled: shouldInjectUzqAliceBrief(clientSettings),
      playerInput,
      personalities: npcPersonalities,
      worldLineSummary,
      sceneNpcNames,
      maxNpcs: 3,
    }),
  };

  const webTools = createActionNativeTools(clientSettings, opts.webToolExecutor);
  const workspace = workspacePromptParts(opts.workspaceContext);
  const runtimeAdditions = buildAlicePromptAdditions(creativeConfig)
    + NARRATIVE_KNOWLEDGE_RULE + narrativePrompt(opts.narrativeRequest, snapshot)
    + workspace.catalog
    + buildMetaRealityRuntimePromptContext(metaRealityContext)
    + buildGenerationBiasInstruction(generationBias)
    + buildSandboxToolProtocolContext({
      enabled: sandboxMode,
      recentAudit: sandboxToolAudit,
    }) + workspace.execution;
  const pluginSections = buildGameplayPromptSections(worldDef, 'action', { flags: snapshot.worldFlags, sceneId: snapshot.currentSceneId });
  const promptInput = {
    stableAdditions: workspaceProtocol(webTools ? NATIVE_WEB_TOOL_GUIDE : undefined, Boolean(opts.workspaceContext)) + (webTools ? NATIVE_ACTION_TOOL_GUIDE : ''),
    documentMode: opts.documentMode,
    flexibleNarrative: Boolean(cards?.selected.length) || hasActiveGameplayGuide(worldDef, snapshot.worldFlags, snapshot.currentSceneId),
    systemPromptBase: worldDef.systemPromptBase, worldName: worldDef.name, timeNote,
    pluginStatic: pluginSections.stablePrefix,
    pluginRuntime: pluginSections.dynamicSuffix + buildGameplayRuntimePrompt(worldDef, snapshot.worldFlags, snapshot.gameplayResources, snapshot.currentSceneId),
    runtimeAdditions, literaryControl, narrativeLanguage, userPrompt: clientSettings?.aliceUserPrompt ?? loadSettings().aliceUserPrompt,
  };
  const { systemPrompt, promptSections, diagnostics: contextDiagnostics, historyEpoch } = fitActionContext({ cards, recentHistory, historyEpoch: snapshot.historyEpochPlan, historyScope: snapshot.promptContextScope ?? { worldId: worldDef.id, playthroughId: '', archiveScope: 'ordinary' }, userMessage: imageRequest.userMessage, maxTokens: 8000, settings: clientSettings,
    build: (historySummary, selectedHistory) => buildActionPromptSections({ ...promptInput, directorRecorded: directorFrameRecorded(snapshot.lastDirectorFrame, [...(selectedHistory ?? []).flatMap(h => h.directorCues ?? []), ...(snapshot.directorCueCandidate ? [snapshot.directorCueCandidate] : [])]), worldContext: buildWorldContextSections({ ...worldContextInput, historySummary, includeDirectorCue: true }) }) });

  const actionTemp = resolveAliceTemperature(creativeConfig, 0.85);
  const { content, usage, elapsedMs } = await callAi({ role: "alice", tools: webTools, media: imageRequest.media, systemPrompt, promptSections, userMessage: imageRequest.userMessage, temperature: actionTemp, maxTokens: 8000, jsonMode: true, timeoutMs: 90000, settingsOverride: clientSettings, callType: "alice_action", signal: opts.signal });
  lastPromptSent = systemPrompt + "\n\n--- USER ---\n" + playerInput;

  let parsed: AIGameResponse, formatFailureReason: string | undefined;
  try {
    parsed = parseWorkspaceToolReply(content) ?? parseJSON<AIGameResponse>(content);
  } catch (e) {
    formatFailureReason = (e as Error).message;
    console.warn("[Action] parseJSON failed, attempting salvage...", (e as Error).message.slice(0, 100));
    try {
      parsed = salvagePartialGameResponse(content);
      console.log("[Action] Salvage succeeded: " +
        parsed.segments.length + " segs, " +
        (parsed.availableActions?.length ?? 0) + " actions");
    } catch (salvageErr) {
      console.error("[Action] Salvage also failed:", (salvageErr as Error).message);
      parsed = documentResponse(recoveredDocument(content));
    }
  }
  parsed = toolReplyForContinuation(parsed);
  parsed = normalizeDocumentReply(parsed, content, opts.documentMode, !opts.documentMode);
  if (parsed?.documents?.length && usage.finishReason === 'length') parsed = documentResponse({ ...recoveredDocument(content), incomplete: true });
  if (parsed?.document && usage.finishReason === 'length') parsed.document.incomplete = true;
  if (!opts.documentMode) parsed = actionDocumentForContinuation(parsed, content, usage.finishReason, formatFailureReason);
  const missingText = missingActionTextError(parsed, usage, Boolean(opts.workspaceContext?.narrative?.length));
  if (missingText) throw missingText;
  delete parsed._workspaceSessionId;
  delete parsed._npcProfileUpdates;
  parsed._historyEpochPlan = historyEpoch;
  parsed._directorCue = snapshot.directorCueCandidate ?? null;
  parsed._contextDiagnostics = { ...contextDiagnostics, budget: usage.promptBudget ?? contextDiagnostics.budget };
  parsed._tokenUsage = usage;
  parsed._webToolReceipts = webTools?.receipts.map(compactWebReceipt) ?? [];
  parsed.segments = attachSearchSources(parsed.segments ?? [], parsed._webToolReceipts);
  parsed._elapsedMs = elapsedMs;
  if (parsed.document || hasActionTool(parsed)) return { ...parsed, segments: parsed.segments ?? [] };

  // 向后兼容：如果 AI 返回了 narrative/dialogue 但没有 segments，自动拆分
  if ((!parsed.segments || parsed.segments.length === 0) && parsed.narrative) {
    parsed.segments = legacyNarrativeToSegments(parsed.narrative!, parsed.dialogue!);
  }

  // 确保字段存在
  if (!parsed.validity) {
    parsed.validity = { isPossible: true, fantasyResponse: null, reason: null };
  }
  if (!parsed.timeSpent) {
    parsed.timeSpent = { day: 0, hour: 0, minute: 5 };
  }
  if (!parsed.segments) parsed.segments = [];
  if (!parsed.itemsGained) parsed.itemsGained = [];
  // 防御：AI 可能生成不在枚举中的 category，统一回退为 misc
  for (const item of parsed.itemsGained) {
    const validCategories = ["weapon", "tool", "consumable", "key", "document", "misc"];
    if (!validCategories.includes(item.category)) {
      item.category = "misc";
    }
  }
  if (!parsed.itemsUsed) parsed.itemsUsed = [];
  // 防御：AI 可能返回对象数组而非字符串数组，规范化为字符串数组
  parsed.itemsUsed = parsed.itemsUsed.map((u: unknown) =>
    typeof u === "string" ? u : ((u as Record<string, unknown>)?.name as string) || ((u as Record<string, unknown>)?.id as string) || ""
  ).filter(Boolean);
  if (!parsed.cluesDiscovered) parsed.cluesDiscovered = [];
  if (!parsed.worldImpacts) parsed.worldImpacts = parsed.sceneChanges ?? [];
  if (!parsed.availableActions?.length) parsed.availableActions = ["观察周围环境", "与附近的人交谈", "继续探索"];

  if (opts.narrativeRequest?.kind === 'result') parsed = protectNarrativeResponse(parsed, snapshot.currentGameTime, opts.narrativeRequest, snapshot);

  // 行动不合理时，用幻想回复作为单个 narration segment
  if (!parsed.validity.isPossible) {
    parsed.segments = [
      {
        type: "narration",
        text: parsed.validity.fantasyResponse ?? getRandomFantasyResponse(),
      },
    ];
    parsed.dialogue = "";
    parsed.timeSpent = { day: 0, hour: 0, minute: 0 };
    parsed.timeAfter = { ...snapshot.currentGameTime };
    parsed.availableActions = [];
  }


  parsed.narrativeFrame ??= extractNarrativeFrame(content);
  parsed = protectNarrativeResponse(parsed, snapshot.currentGameTime, opts.narrativeRequest, snapshot);
  parsed.segments = attachSearchSources(parsed.segments ?? [], parsed._webToolReceipts ?? []);
  return parsed;
}

// ============================================================
// 向后兼容：旧版 narrative+dialogue → segments
// ============================================================

/** 将旧版 narrative+dialogue 自动拆分为 segments（向后兼容） */
export function legacyNarrativeToSegments(
  narrative: string,
  dialogue?: string
): StorySegment[] {
  const segments: StorySegment[] = [];

  // 按自然段落拆分 narrative
  const paragraphs = narrative.split(/\n\n+/).filter((p) => p.trim());
  for (const para of paragraphs) {
    const trimmed = para.trim();
    if (trimmed.length === 0) continue;
    // 如果段落太长（>200字），按句号拆
    if (trimmed.length > 200) {
      const sentences = trimmed.split(/(?<=[。！？])/);
      let buf = "";
      for (const s of sentences) {
        if ((buf + s).length > 150 && buf.length > 0) {
          segments.push({ type: "narration", text: buf.trim() });
          buf = s;
        } else {
          buf += s;
        }
      }
      if (buf.trim()) segments.push({ type: "narration", text: buf.trim() });
    } else {
      segments.push({ type: "narration", text: trimmed });
    }
  }

  // 如果有 dialogue，追加到末尾
  if (dialogue && dialogue.trim()) {
    segments.push({ type: "dialogue", text: dialogue.trim() });
  }

  return segments;
}
