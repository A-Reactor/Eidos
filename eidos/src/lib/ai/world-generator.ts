import { parseGeneratedWorldData, parseGeneratedTimeline } from './generated-world-data';
import { verifyWorldCreation } from './source-reconstruction/acceptance';
import { compileWorldCreation, validateCreatedWorld, normalizeCreatedWorldStructure, sourceTimelinePrompt, sourceTimelineContext, type WorldCreationInput } from './world-creation-compiler';
import { timelineCreationPrompt, type WorldGenerationProfile } from "./world-generation-profile";
import { resolveGameplayPlugins } from "@/lib/game/plugins/builtins";
import { buildGameplayPrompt } from "@/lib/game/plugins/runtime";
import { validateGameModeConfig } from "@/lib/game/plugins/manifest";
import type { GameplayPlugin } from "@/lib/game/plugins/types";
import { validateMapRegions, validateInitialMapRoutes } from "@/lib/game/map-state";
import { parseNpcSpeechProfiles } from '@/lib/game/npc-speech';
import { abortWorldConversation, generateWorldConversation } from './world-creation-conversation';
export { generateWorldConversation, generateWorldConversationStream } from './world-creation-conversation';
// ============================================================
// 完整世界创建使用上面的 conversation 导出；以下独立函数仅供旧调用兼容。
// ============================================================
// 生成 world data（name, regions, npcs, contradictions, history, clues）
// 旧调用可独立生成设定或推演，创建界面与创建 API 不再使用这些分段入口。
// 长任务不设应用层计时截止；流式材料由客户端持续保存以便续写。

import type {
  WorldDefinition,
  WorldTimelineEvent,
} from "@/lib/game/types";
import type { WorldCreationProgress } from "./types";
import {
  recordCreationUsage,
  callDeepSeek,
  getKeiConfig,
  _currentSettings,
} from "./client";
import { streamCreationJSON, type CreationStreamOptions } from "./creation-stream";
import { detectCompletedFields } from "./stream-parser";
import { buildSystemPrompt, buildIdentityPrompt } from "./builtin-worlds";
import {
  type NarrativeStyleProfile,
} from "@/lib/game/narrative-style";

// ============================================================
// 世界生成 AbortController 注册表（供 stop 端点使用）
// ============================================================
const worldGenControllers = new Map<string, AbortController>();

/** 中止指定代际 ID 的世界生成。返回 true 表示成功触发中止。 */
export function abortWorldGeneration(generationId: string): boolean {
  const ctrl = worldGenControllers.get(generationId);
  if (ctrl) {
    ctrl.abort();
    return true;
  }
  return abortWorldConversation(generationId);
}

// ============================================================
// 世界创建 — 阶段一：生成世界设定（非流式）
// ============================================================

export async function generateWorldData(
  concept: string,
  skillIds?: string[],
  narrativeStyle?: NarrativeStyleProfile,
  gameplayPlugins?: GameplayPlugin[],
  generationProfile?: WorldGenerationProfile,
  creation?: WorldCreationInput,
): Promise<WorldDefinition> {
  const selectedPlugins = resolveGameplayPlugins(skillIds, gameplayPlugins);
  const skillGuide = buildGameplayPrompt({ gameplayPlugins: selectedPlugins }, "creation");
  const compiled = compileWorldCreation({ concept, ...creation, narrativeStyle, skillGuide, generationProfile });
  const { content: worldRaw } = await callDeepSeek(
    compiled.systemPrompt,
    compiled.userMessage,
    0.9, 393216, true, 0, true, creation?.settings, generationProfile === "quick" ? "high" : "max"
  );

  const worldData = parseGeneratedWorldData(worldRaw);

  const worldId = `player_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  const world: WorldDefinition = {
    id: worldId,
    name: worldData.name,
    subtitle: worldData.subtitle,
    overview: worldData.overview,
    regions: validateMapRegions(worldData.regions),
    mapRoutes: validateInitialMapRoutes(worldData.regions, worldData.mapRoutes),
    npcs: worldData.npcs,
    npcSpeechProfiles: parseNpcSpeechProfiles(worldData.npcSpeechProfiles, Object.keys(worldData.npcs)),
    contradictions: worldData.contradictions,
    history: worldData.history,
    timeline: [], // 阶段二填充
    clues: worldData.clues ?? [],
    identityOptions: worldData.identityOptions,
    calendarEra: worldData.calendarEra || undefined,
    gameModeConfig: validateGameModeConfig(worldData.gameModeConfig),
    gameplayPlugins: selectedPlugins,
    systemPromptBase: buildSystemPrompt(worldData.name, worldData.overview),
    identityPrompt: buildIdentityPrompt(worldData.name, worldData.overview),
    generationProfile,
    isPlayerCreated: true,
    createdAt: Date.now(),
    ...(narrativeStyle ? { narrativeStyle } : {}),
  };

  if (creation) {
    normalizeCreatedWorldStructure(world);
    const checked = validateCreatedWorld({ world }); if (!checked.ok) throw new Error(checked.issues.join('；'));
    await verifyWorldCreation(creation, world, {});
    world.systemPromptBase = buildSystemPrompt(world.name, world.overview);
    world.identityPrompt = buildIdentityPrompt(world.name, world.overview);
  }
  world.npcSpeechProfiles = parseNpcSpeechProfiles(world.npcSpeechProfiles, Object.keys(world.npcs).filter(name => world.npcs[name] === worldData.npcs[name]));
  return world;
}

// ============================================================
// 世界创建 — 阶段一（流式版）
// ============================================================
// 与 generateWorldData 功能相同，但使用 SSE 流式传输
// 逐 token 接收 JSON → 检测字段完成 → 回调通知客户端

/**
 * 从 skills 目录加载指定的 Skill Prompt 的 Part A（KEI 生成指南）。
 * skillIds 为文件名（不含扩展名），如 ["tree-ops", "loop-manager"]。
 */
export function loadSkillGuidesKEI(skillIds: string[]): string {
  return buildGameplayPrompt({ gameplayPlugins: resolveGameplayPlugins(skillIds) }, "creation");
}

export async function generateWorldDataStream(
  concept: string,
  onThinking: () => void,
  onProgress: (progress: WorldCreationProgress) => void,
  generationId: string,
  onTokenUpdate?: (estimatedPrompt: number, estimatedCompletion: number, charsReceived: number) => void,
  skillIds?: string[],
  narrativeStyle?: NarrativeStyleProfile,
  streamOptions?: CreationStreamOptions,
  gameplayPlugins?: GameplayPlugin[],
  generationProfile?: WorldGenerationProfile,
  creation?: WorldCreationInput,
): Promise<{ world: WorldDefinition; truncated: boolean }> {
  const cfg = getKeiConfig(creation?.settings ?? streamOptions?.settings ?? _currentSettings);
  const selectedPlugins = resolveGameplayPlugins(skillIds, gameplayPlugins);
  const skillGuide = buildGameplayPrompt({ gameplayPlugins: selectedPlugins }, "creation");
  const { systemPrompt, userMessage } = compileWorldCreation({ concept, ...creation, narrativeStyle, skillGuide, generationProfile });

  // 估算 prompt token 数
  const estimatedPromptTokens = Math.ceil((systemPrompt.length + userMessage.length) / 2.5);

  // 用户中止用的 AbortController，注册到全局 Map
  const userAbortController = new AbortController();
  worldGenControllers.set(generationId, userAbortController);
  const body: Record<string, unknown> = {
    model: cfg.model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userMessage },
    ],
    temperature: 0.9,
    // 世界 JSON 输出量极大（regions+scenes+npc+12-18条clues）。
    // thinking enabled 时推理 token 也计入 max_tokens，必须留足预算避免截断。
    max_tokens: 393216, // DeepSeek 上限
    stream: true,
    stream_options: { include_usage: true },
    // 保留推理能力；快速模式降低推理强度以减少生成耗时
    thinking: { type: "enabled" },
    reasoning_effort: generationProfile === "quick" ? "high" : "max",
  };

  let fullText: string;
  const alreadySeen = new Set<string>();
  let cursor = 0; let depth = 0;
  try {
    fullText = await streamCreationJSON(cfg, body, onThinking, {
      ...streamOptions,
      validate: text => { parseGeneratedWorldData(text); },
      onReset: (text, reason) => {
        alreadySeen.clear(); cursor = 0; depth = 0;
        streamOptions?.onReset?.(text, reason);
      },
      onUsage: (raw, timing) => {
        const usage = recordCreationUsage(cfg, 'kei', 'world_create', raw, timing);
        streamOptions?.onTokenUsage?.(usage); streamOptions?.onUsage?.(raw, timing);
      },
      signal: streamOptions?.signal ? AbortSignal.any([userAbortController.signal, streamOptions.signal]) : userAbortController.signal,
      onText: (text, delta) => {
        streamOptions?.onText?.(text, delta);
        const detected = detectCompletedFields(text, alreadySeen, cursor, depth);
        cursor = detected.resumePos; depth = detected.depth;
        for (const field of detected.fields) {
          alreadySeen.add(field); onProgress({ field });
        }
        onTokenUpdate?.(estimatedPromptTokens, Math.ceil(text.length / 2.5), text.length);
      },
    });
  } finally { worldGenControllers.delete(generationId); }

  // 解析完整 JSON（可能被截断）
  const worldData = parseGeneratedWorldData(fullText);

  const worldId = `player_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  const world: WorldDefinition = {
    id: worldId,
    name: worldData.name,
    subtitle: worldData.subtitle,
    overview: worldData.overview,
    regions: validateMapRegions(worldData.regions),
    mapRoutes: validateInitialMapRoutes(worldData.regions, worldData.mapRoutes),
    npcs: worldData.npcs,
    npcSpeechProfiles: parseNpcSpeechProfiles(worldData.npcSpeechProfiles, Object.keys(worldData.npcs)),
    contradictions: worldData.contradictions,
    history: worldData.history,
    timeline: [],
    clues: worldData.clues ?? [],
    identityOptions: worldData.identityOptions,
    calendarEra: worldData.calendarEra || undefined,
    gameModeConfig: validateGameModeConfig(worldData.gameModeConfig),
    gameplayPlugins: selectedPlugins,
    systemPromptBase: buildSystemPrompt(worldData.name, worldData.overview),
    identityPrompt: buildIdentityPrompt(worldData.name, worldData.overview),
    generationProfile,
    isPlayerCreated: true,
    createdAt: Date.now(),
    ...(narrativeStyle ? { narrativeStyle } : {}),
  };

  if (creation) {
    normalizeCreatedWorldStructure(world);
    const checked = validateCreatedWorld({ world }); if (!checked.ok) throw new Error(checked.issues.join('；'));
    await verifyWorldCreation(creation, world, { signal: streamOptions?.signal, onUsage: streamOptions?.onTokenUsage });
    world.systemPromptBase = buildSystemPrompt(world.name, world.overview);
    world.identityPrompt = buildIdentityPrompt(world.name, world.overview);
  }
  world.npcSpeechProfiles = parseNpcSpeechProfiles(world.npcSpeechProfiles, Object.keys(world.npcs).filter(name => world.npcs[name] === worldData.npcs[name]));
  return { world, truncated: false };
}

// ============================================================
// 世界创建 — 阶段二：生成推演时间线
// ============================================================
// 按生成规模推演：完整模式 20–30 个事件，快速模式 6–8 个关键事件。
// 保留完整 JSON 输出预算，不以截断文本的方式压缩信息量。

export async function generateWorldTimeline(
  world: WorldDefinition,
  settings?: Record<string, string>,
): Promise<WorldTimelineEvent[]> {
  const { content: timelineRaw } = await callDeepSeek(
    (world.sourceArchive?.reconstruction ? sourceTimelinePrompt(world.generationProfile) : timelineCreationPrompt(world.generationProfile)),
    `基于以下世界设定推演时间线：\n\n## 概述\n${world.overview}\n\n## 区域\n${JSON.stringify(world.regions, null, 2)}\n\n## NPC\n${JSON.stringify(world.npcs, null, 2)}\n\n## 矛盾\n${JSON.stringify(world.contradictions, null, 2)}\n\n## 历史\n${JSON.stringify(world.history, null, 2)}${sourceTimelineContext(world)}\n\n输出严格JSON。`,
    0.9, 393216, true, 0, true, settings, world.generationProfile === "quick" ? "high" : "max" // 快速模式使用较低推理强度
  );

  return parseGeneratedTimeline(timelineRaw, world);
}

/** 从流式 JSON 中统计已完成的时间线事件数（简单模式匹配） */
function countTimelineEvents(text: string): number {
  const matches = text.match(/"id"\s*:\s*"wt_\d+"/g);
  return matches ? matches.length : 0;
}

/**
 * 流式生成世界推演时间线。
 * 与 generateWorldDataStream 相同的模式——SSE 逐 token 接收，
 * 实时报告已推演的事件数。
 */
export async function generateWorldTimelineStream(
  world: WorldDefinition,
  onThinking: () => void,
  onProgress: (eventCount: number) => void,
  onTokenUpdate?: (estimatedPrompt: number, estimatedCompletion: number, charsReceived: number) => void,
  streamOptions?: CreationStreamOptions,
): Promise<WorldTimelineEvent[]> {
  const cfg = getKeiConfig(streamOptions?.settings ?? _currentSettings);
  const regionsJSON = JSON.stringify(world.regions, null, 2);
  const npcsJSON = JSON.stringify(world.npcs, null, 2);
  const contradictionsJSON = JSON.stringify(world.contradictions, null, 2);
  const historyJSON = JSON.stringify(world.history, null, 2);
  const userMessage = `基于以下世界设定推演时间线：\n\n## 概述\n${world.overview}\n\n## 区域\n${regionsJSON}\n\n## NPC\n${npcsJSON}\n\n## 矛盾\n${contradictionsJSON}\n\n## 历史\n${historyJSON}${sourceTimelineContext(world)}\n\n输出严格JSON。`;

  const estimatedPromptTokens = Math.ceil(((world.sourceArchive?.reconstruction ? sourceTimelinePrompt(world.generationProfile) : timelineCreationPrompt(world.generationProfile)).length + userMessage.length) / 2.5);

  const body: Record<string, unknown> = {
    model: cfg.model,
    messages: [
      { role: "system", content: (world.sourceArchive?.reconstruction ? sourceTimelinePrompt(world.generationProfile) : timelineCreationPrompt(world.generationProfile)) },
      { role: "user", content: userMessage },
    ],
    temperature: 0.9,
    max_tokens: 393216,
    stream: true,
    stream_options: { include_usage: true },
    thinking: { type: "enabled" },
    reasoning_effort: world.generationProfile === "quick" ? "high" : "max",
  };

  const fullText = await streamCreationJSON(cfg, body, onThinking, {
    ...streamOptions,
    validate: text => { parseGeneratedTimeline(text, world); },
    onUsage: (raw, timing) => {
      const usage = recordCreationUsage(cfg, 'kei', 'world_create', raw, timing, world.id);
      streamOptions?.onTokenUsage?.(usage); streamOptions?.onUsage?.(raw, timing);
    },
    onText: (text, delta) => {
      streamOptions?.onText?.(text, delta);
      onProgress(countTimelineEvents(text));
      onTokenUpdate?.(estimatedPromptTokens, Math.ceil(text.length / 2.5), text.length);
    },
  });
  return parseGeneratedTimeline(fullText, world);
}

// ============================================================
// 世界创建 — 完整流程（向后兼容，一次性生成世界 + 时间线）
// ============================================================

export async function generateWorld(
  concept: string
): Promise<WorldDefinition> {
  return generateWorldConversation({ concept });
}
