import { directorFrameRecorded } from '@/lib/game/director-cues';
import { actionImageMessage, type ActionImageInput } from './action-images';
import { chapterNarrativeEnabled } from '@/lib/game/chapters/context';
import { workspaceProtocol, workspacePromptParts, toolReplyForContinuation, hasActionTool, parseWorkspaceToolReply } from './workspace-tools';
import { NATIVE_WEB_TOOL_GUIDE } from './action-web-tools';
import { createActionNativeTools, NATIVE_ACTION_TOOL_GUIDE } from './action-native-tools';
import { attachSearchSources, compactWebReceipt } from '@/lib/game/web-context';
import { attachChapterGeneration, chapterGenerationSnapshot, prepareChapterGeneration } from './chapter-director';
import { normalizeChapterSnapshot } from './chapter-director';
import { topLevelJsonContainer, topLevelJsonValueStart } from './json-fields';
import { normalizeDocumentReply, documentResponse, recoveredDocument, actionDocumentForContinuation } from './document-response';
import { loadSettings } from '@/lib/game/settings';
import { fitActionContext } from './action-context-diagnostics';
import { narrativePrompt, NARRATIVE_KNOWLEDGE_RULE, protectNarrativeResponse, frameSegments, responseFrame, type NarrativeRequest } from '@/lib/game/narrative';
import { hasActiveGameplayGuide, buildGameplayPromptSections, buildGameplayRuntimePrompt } from "@/lib/game/plugins/runtime";
import { buildActionTimeContext } from '@/lib/game/time';
// ============================================================
// AI 玩家行动处理（流式版 / SSE）
// ============================================================
// 逐 token 接收 AI 响应，渐进式提取已完成的 StorySegment，
// 不等整个 JSON 结束就推送给前端。
// 完整响应作为候选返回，浏览器接受行动后再建立 KEI 审核申请。

import { buildWorldContextSections, buildKnowledgeGateContext } from "./context-builder";
import { resolveCardActionContext } from '@/lib/game/cards/context';
import { isInitialWorldObservation } from '@/lib/game/world-entry';
import { buildGenerationBiasInstruction } from "./action-guidance";
import { callAiStream, parseJSON, setCurrentSettings } from "./client";
import { getBuiltInWorld } from "./builtin-worlds";
import { extractNarrativeFrame, extractSegmentsProgressive } from "./stream-parser";
import { legacyNarrativeToSegments, setLastPromptSent, missingActionTextError } from "./action-handler";
import { FANTASY_RESPONSES, getRandomFantasyResponse, buildActionPromptSections, resolveNarrativeLanguage, type NarrativeLanguage } from "./prompt-templates";
import { salvagePartialGameResponse } from "./salvage";
import {
  buildUzqAliceBriefForAction,
  shouldInjectUzqAliceBrief,
} from "./uzq-personality";
import { collectSceneNpcNames } from "./npc-context";
import { projectNpcMemoryState } from "@/lib/game/npc-memory-save";
import { repairLegacyNpcDefaults } from '@/lib/personality/legacy-defaults';
import {
  type StorySegment,
  type StreamCallbacks,
  type AIGameResponse,
  type TokenUsage,
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
} from "@/lib/game/types";
import type { CreativeModeConfig } from "@/lib/game/types";
import { buildAlicePromptAdditions, resolveAliceTemperature } from "./creative-injector";
import { buildMetaRealityRuntimePromptContext } from "./meta-reality-runtime";
import {
  buildSandboxToolProtocolContext,
  type SandboxToolAuditPromptEntry,
} from "./sandbox-tool-pipeline";

// ============================================================
// 流式行动处理（SSE 端点使用）
// ============================================================

export interface ProcessActionStreamOptions {
  webToolExecutor?: import('@/lib/game/web-tools').WebToolExecutor;
  imageInputs?: ActionImageInput[];
  imageCatalog?: import('@/lib/game/midori/image-context').ImageCatalogEntry[];
  chapterPreparation?: unknown;
  documentMode?: boolean;
  workspaceContext?: import('@/lib/game/workspace/context').WorkspacePromptContext;
  cardContext?: import('@/lib/game/cards/types').CardActionContext;
  signal?: AbortSignal;
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
  weather?: string;
  protagonistState?: ProtagonistState | null;
  callbacks: StreamCallbacks;
  clientSettings?: Record<string, string> | null;
  creativeConfig?: CreativeModeConfig | null;
  metaRealityContext?: string;
  longMemoryContext?: string;
  generationBias?: number;
  worldLineSummary?: import("./context-builder").WorldLineSummary;
  narrativeLanguage?: NarrativeLanguage;
  sandboxMode?: boolean;
  sandboxToolAudit?: SandboxToolAuditPromptEntry[];
  /** @deprecated 保留调用兼容；审核申请由浏览器接受行动时建立。 */
  skipKeiStorage?: boolean;
}

/**
 * 流式处理玩家行动——使用 SSE 逐 token 接收 AI 响应。
 *
 * 回调顺序：
 * 1. onProgress（多次）—— 增量文本长度
 * 2. onSegments（渐进多次）—— 每次有新 segment 完成时推送
 * 3. onDone（一次）—— 完整响应，含所有元数据
 *
 * onSegments 设计为渐进式——extractPartialSegments 从部分 JSON 中提取已完成的
 * segment 对象并立即通知，不等整个响应。这样让第一个 segment 在 2-3 秒内就到达
 * 客户端，而不是等 15-40 秒整个 JSON 完成。
 *
 * 完整响应返回后，由浏览器实际接受行动时建立 KEI 审核申请。
 */
export async function processPlayerActionStream(
  opts: ProcessActionStreamOptions
): Promise<void> {
  if (!opts.world || !chapterNarrativeEnabled(opts.world, opts.snapshot) || opts.documentMode || opts.narrativeRequest?.kind === 'result') return generatePlayerActionStream(opts);
  opts = { ...opts, snapshot: normalizeChapterSnapshot(opts.snapshot) };
  const generation = await prepareChapterGeneration(opts);
  if (generation.usage) opts.callbacks.onUsage?.(generation.usage);
  return generatePlayerActionStream({ ...opts, snapshot: chapterGenerationSnapshot(opts.snapshot, generation),
    callbacks: { ...opts.callbacks, onDone: response => opts.callbacks.onDone?.(attachChapterGeneration(response, { ...generation, usage: undefined })) } });
}

async function generatePlayerActionStream(opts: ProcessActionStreamOptions): Promise<void> {
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
    weather = "晴",
    protagonistState = null,
    callbacks,
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
    initialObservation: isInitialWorldObservation(playerInput, snapshot),
    longMemoryContext,
    weather,
    protagonistState,
    forceFull: false,
    npcStates,
    diary: snapshot.diary ?? [],
    relationships,
    causalProjections: snapshot.causalProjections ?? [],
    npcBehaviors,
    npcPersonalities,
    worldLineSummary,
  };

  const timeNote = buildActionTimeContext(snapshot.currentGameTime);

  // 文学控制层：构建知识门禁 + 读取当前导演帧（与 action-handler.ts 同步）
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

  let fullText = "";
  const startTime = Date.now();
  // 跟踪草稿段的文本长度——草稿每增长 10+ 字符就推送一次，让客户端逐字显示
  let lastDraftTextLen = 0;
  // 是否已通过渐进提取发送过 segments（用于 parseJSON 失败时的回退判断）
  let progressiveSegmentsSent = false;
  let hasProgressiveText = false;
  let toolActivity: import('./types').AiStreamActivity['phase'] | undefined;

  const actionTemp = resolveAliceTemperature(creativeConfig, 0.85);
  await callAiStream({
    tools: webTools,
    signal: opts.signal, media: imageRequest.media,
    role: 'alice', systemPrompt, promptSections, userMessage: imageRequest.userMessage,
    onUsage: callbacks.onUsage,
    onActivity: activity => callbacks.onActivity?.({ ...activity, phase: toolActivity ?? activity.phase }),
    temperature: actionTemp, maxTokens: 8000,
    onChunk: (delta) => {
      fullText += delta;
      if (!toolActivity) {
        const command = topLevelJsonContainer(fullText, 'toolRequest') ?? topLevelJsonContainer(fullText, 'workspaceRequest');
        const start = command ? topLevelJsonValueStart(command.text, 'method') : -1;
        const method = start >= 0 ? /^"([^"]+)"/.exec(command!.text.slice(start))?.[1] : undefined;
        if (method || topLevelJsonContainer(fullText, 'historyRequest')) {
          toolActivity = method?.startsWith('files.') ? 'files' : 'operation';
          callbacks.onActivity?.({ phase: toolActivity, elapsedMs: Date.now() - startTime, reasoningChars: 0 });
        }
      }
      if (opts.documentMode) return;

      // 渐进式提取：包含已完成 segments + 正在生成的草稿段
      if (callbacks.onSegments) {
        try {
          const { segments: rawSegments, lastIsDraft } = extractSegmentsProgressive(fullText);
          const segments = frameSegments(attachSearchSources(rawSegments, webTools?.receipts ?? []), responseFrame({ segments: rawSegments, narrativeFrame: extractNarrativeFrame(fullText) }, opts.narrativeRequest));
          if (segments.length === 0) return;
          hasProgressiveText ||= segments.some(segment => segment.text.trim());

          progressiveSegmentsSent = true;
          const draftLen = lastIsDraft ? (segments[segments.length - 1]?.text.length ?? 0) : 0;

          // 推送条件：
          //   - 完成段数量增加（新 segment 出现）
          //   - 草稿段文本增长超过阈值（delta 驱动逐字更新）
          const shouldPush =
            draftLen > lastDraftTextLen + 8 ||
            (lastIsDraft && draftLen > lastDraftTextLen && draftLen > 40);

          if (shouldPush || !lastIsDraft) {
            lastDraftTextLen = draftLen;
            callbacks.onSegments(segments, lastIsDraft);
          }
        } catch {
          // 部分 JSON 解析失败正常，忽略
        }
      }

      if (callbacks.onProgress) callbacks.onProgress(fullText.length);
    },
    onDone: (completedText, usage) => {
      setLastPromptSent(systemPrompt + "\n\n--- USER ---\n" + playerInput);

      // 标记 parseJSON 是否成功——失败时不能把 raw JSON 发给客户端
      let parseSucceeded = true;

      let parsed: AIGameResponse, formatFailureReason: string | undefined;
      try {
        parsed = parseWorkspaceToolReply(completedText) ?? parseJSON<AIGameResponse>(completedText);
      } catch (error) {
        formatFailureReason = (error as Error).message;
        parseSucceeded = false;
        // 尝试 salvage 修复截断的 JSON
        try {
          parsed = salvagePartialGameResponse(completedText);
          console.log("[Stream] Salvage succeeded: " +
            parsed.segments.length + " segs, " +
            (parsed.availableActions?.length ?? 0) + " actions");
        } catch {
          // 完整 salvage 也失败——使用最小 fallback
          parsed = documentResponse(recoveredDocument(completedText));
        }
      }

      parsed = toolReplyForContinuation(parsed);
      parsed = normalizeDocumentReply(parsed, completedText, opts.documentMode, !opts.documentMode);
      if (parsed?.documents?.length && usage.finishReason === 'length') parsed = documentResponse({ ...recoveredDocument(completedText), incomplete: true });
      if (parsed?.document && usage.finishReason === 'length') parsed.document.incomplete = true;
      if (!opts.documentMode) parsed = actionDocumentForContinuation(parsed, completedText, usage.finishReason, formatFailureReason);
      const missingText = missingActionTextError(parsed, usage, hasProgressiveText || Boolean(opts.workspaceContext?.narrative?.length));
      if (missingText) {
        if (missingText.usage) callbacks.onUsage?.(missingText.usage);
        callbacks.onError?.(missingText);
        return;
      }
      parsed._historyEpochPlan = historyEpoch;
      parsed._directorCue = snapshot.directorCueCandidate ?? null;
      parsed._contextDiagnostics = { ...contextDiagnostics, budget: usage.promptBudget ?? contextDiagnostics.budget };
      delete parsed._npcProfileUpdates;
      parsed._tokenUsage = usage;
      parsed._webToolReceipts = webTools?.receipts.map(compactWebReceipt) ?? [];
      parsed.segments = attachSearchSources(parsed.segments ?? [], parsed._webToolReceipts);
      parsed._elapsedMs = Date.now() - startTime;
      if (parsed.document || hasActionTool(parsed)) {
        const segments = frameSegments(parsed.segments ?? [], responseFrame(parsed, opts.narrativeRequest));
        if (segments.length) callbacks.onSegments?.(segments, false);
        callbacks.onDone?.({ ...parsed, segments }); return;
      }

      // 确保字段存在
      if (!parsed.validity) parsed.validity = { isPossible: true, fantasyResponse: null, reason: null };
      if (!parsed.timeSpent) parsed.timeSpent = { day: 0, hour: 0, minute: 5 };
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

      // 向后兼容
      if (parsed.segments.length === 0 && parsed.narrative) {
        parsed.segments = legacyNarrativeToSegments(parsed.narrative!, parsed.dialogue!);
      }

      if (opts.narrativeRequest?.kind === 'result') parsed = protectNarrativeResponse(parsed, snapshot.currentGameTime, opts.narrativeRequest, snapshot);

      // 不合理行动处理
      if (!parsed.validity.isPossible) {
        parsed.segments = [{
          type: "narration",
          text: parsed.validity.fantasyResponse ?? getRandomFantasyResponse(),
        }];
        parsed.timeSpent = { day: 0, hour: 0, minute: 0 };
        parsed.timeAfter = { ...snapshot.currentGameTime };
        parsed.availableActions = [];
      }

      // Salvage may recover prose without copying its camera metadata.
      parsed.narrativeFrame ??= extractNarrativeFrame(completedText);
      parsed = protectNarrativeResponse(parsed, snapshot.currentGameTime, opts.narrativeRequest, snapshot);
      parsed.segments = attachSearchSources(parsed.segments ?? [], parsed._webToolReceipts ?? []);

      // ---- 最终 segments 发送 ----
      // 核心防御：渐进提取已成功发送 segments 给客户端后，
      // 仅当 parseJSON 也成功且有 segments 时才用规范版本覆盖；
      // 否则保留渐进提取的结果（防止 raw JSON 或空数组覆盖已正确显示的内容）
      const parsedHasSegments = parsed.segments.length > 0;

      if (!progressiveSegmentsSent || parsedHasSegments) {
        // 正常路径：parseJSON 成功且有内容，或渐进提取也没成功（首次发送）
        if (callbacks.onSegments) callbacks.onSegments(parsed.segments, false);
      } else {
        // 渐进提取成功但 parseJSON 结果不可用——保留客户端已有的渐进 segments
        console.warn("[Stream] 保留渐进提取的segments（parseJSON"
          + (parseSucceeded ? "返回空segments" : "失败") + "）");
      }
      if (callbacks.onDone) callbacks.onDone(parsed);


    },
    onError: (error) => {
      if (callbacks.onError) callbacks.onError(error);
    },
    timeoutMs: 120000,
    settingsOverride: clientSettings,
    callType: 'alice_stream',
  });
}
