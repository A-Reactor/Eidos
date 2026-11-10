import { imageCatalogPrompt } from '@/lib/game/midori/image-context';
import { sourceRuntimeContext } from '@/lib/game/source-reconstruction/runtime';
import { renderDirectorCue } from '@/lib/game/director-cues';
import { chapterContextForModel, chapterNarrativeEnabled } from '@/lib/game/chapters/context';
import { CHAPTER_ALICE_PROTOCOL } from '@/lib/game/chapters/protocol';
import { narrativeContinuityPrompt } from '@/lib/game/narrative-beat';
import { entryContextPrompt } from '@/lib/game/world-entry';
import { parseRewindMemory, rewindPolicy, rewindMemoryPrompt, REWIND_KNOWLEDGE_RULE } from '@/lib/game/rewind';
import { HISTORY_READ_PROTOCOL } from '@/lib/game/history-reader';
import { NODE_REFERENCE_GUIDE } from '@/lib/game/node-reference';
import { composeSystemPrompt, type AiPromptSections } from './prompt-layout';
import { gameplayContextForModel } from '@/lib/game/plugins/gameplay-state';
import { isGameplayPluginActive } from '@/lib/game/plugins/activation';
import { mappedScene, mapRoutes, mapScenes, emptyMapState } from "@/lib/game/map-state";
// ============================================================
// 世界上下文构建器 — 从世界数据构建 AI prompt 上下文文本
// ============================================================

import type {
  WorldDefinition,
  WorldSnapshot,
  InventoryItem,
  Clue,
  CriticalFactEntry,
  EncyclopediaEntry,
  KnowledgeItem,
  QuestEntry,
  ProtagonistState,
  DiaryEntry,
  Weather,
  GameTime,
  NPCRelationship,
  CausalProjection,
  NpcBehavior,
} from "@/lib/game/types";
import type { KnowledgeGate } from "./types";
import { gameTimeToCalendar, weatherEffect } from "@/lib/game/calendar";
import {
  buildSceneNpcProfiles,
  formatSceneNpcProfiles,
} from "./npc-context";
import { formatNarrativeStyleForAlice } from "@/lib/game/narrative-style";
import { repairLegacyNpcDefaults } from '@/lib/personality/legacy-defaults';
import { formatNpcSpeechProfiles, parseNpcSpeechProfiles } from '@/lib/game/npc-speech';

// ============================================================
// 运行时类型（用于内部构建）
// ============================================================

interface SceneInfo {
  name: string;
  region: string;
  initialDescription: string;
  connections: string[];
  npcs: string[];
  secrets?: string[];
}

/** 在区域中按 sceneId 查找场景信息 */
export function getScene(world: WorldDefinition, sceneId: string): SceneInfo | null {
  return mappedScene(world, sceneId);
}

/** 将 GameTime 转换为分钟数（用于时间差计算） */
export function timeToMinutes(t: GameTime): number {
  return t.day * 24 * 60 + t.hour * 60 + t.minute;
}

// ============================================================
// 世界上下文构建器（增强版——含背包、线索、涟漪效应）
// ============================================================

/** 简易哈希（用于判断世界静态数据是否变化） */
export function hashStr(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) { h = ((h << 5) - h + s.charCodeAt(i)) | 0; }
  return h.toString(36);
}

// ============================================================
// 兼容存档加载器的旧缓存出口；请求内容不再依赖模块级历史。
// ============================================================
/** @deprecated 请求始终携带完整上下文。 */
export let _segmentHashes: Record<string, string> = {};
export function resetSegmentHashes(): void { _segmentHashes = {}; }
/** @deprecated 保留旧导出以兼容存档加载器。 */
export const _lastStaticHash = "";
/** @deprecated 保留旧导出以兼容存档加载器。 */
export const _lastWorldId = "";
interface ContextSegment { stable: boolean; build: () => string }

/** 每次独立请求都构建完整必要上下文，缓存由服务商复用前缀。 */
export interface BuildWorldContextOptions {
  includeDirectorCue?: boolean;
  imageCatalog?: import('@/lib/game/midori/image-context').ImageCatalogEntry[];
  cardContext?: import('@/lib/game/cards/types').CardActionContext;
  world: WorldDefinition;
  snapshot: WorldSnapshot;
  inventory?: InventoryItem[];
  clues?: Clue[];
  encyclopedia?: EncyclopediaEntry[];
  criticalFacts?: CriticalFactEntry[];
  questLog?: QuestEntry[];
  historySummary?: string;
  initialObservation?: boolean;
  longMemoryContext?: string;
  weather?: string;
  protagonistState?: ProtagonistState | null;
  forceFull?: boolean;
  npcStates?: Record<string, string>;
  diary?: DiaryEntry[];
  relationships?: Record<string, NPCRelationship>;
  causalProjections?: CausalProjection[];
  npcBehaviors?: Record<string, NpcBehavior>;
  /** 人格推演：NPC 人格状态（Phase 1） */
  npcPersonalities?: Record<string, import("@/lib/personality/types").AnyPersonalityState>;
  /** WorldLine 树摘要——让 ALICE 感知自己在时间线中的位置 */
  worldLineSummary?: WorldLineSummary;
}

/** WorldLine 树摘要——精简格式，供 AI 上下文使用 */
export interface WorldLineSummary {
  rewindFailure?: { target: string; reason: string };
  /** 当前节点 ID */
  currentNodeId: string;
  /** 当前步数（从根算起） */
  stepNumber: number;
  /** 从根到当前的深度 */
  depth: number;
  /** 分支总数 */
  branchCount: number;
  /** 可回溯的已标记节点 */
  backtrackableNodes: Array<{ id: string; label: string; stepNumber: number; summary: string }>;
  /** 兄弟分支摘要（同一父节点的其他子节点） */
  siblingBranches: Array<{ id: string; label?: string; summary: string }>;
}

export function buildWorldContext(opts: BuildWorldContextOptions): string {
  return composeSystemPrompt(buildWorldContextSections(opts));
}

export function buildWorldContextSections(opts: BuildWorldContextOptions): AiPromptSections {
  const {
    world: originalWorld,
    snapshot,
    inventory = [],
    clues = [],
    encyclopedia = [],
    criticalFacts = [],
    questLog = [],
    historySummary = "",
    longMemoryContext = "",
    worldLineSummary,
    weather = "晴",
    protagonistState = null,
    npcStates = {},
    diary = [],
    relationships = {},
    causalProjections = [],
    npcBehaviors: suppliedBehaviors = {},
    npcPersonalities: suppliedPersonalities = {},
  } = opts;
  const { npcBehaviors = {}, npcPersonalities = {} } = repairLegacyNpcDefaults(
    { npcBehaviors: suppliedBehaviors, npcPersonalities: suppliedPersonalities }, originalWorld);

  const world = { ...originalWorld, mapState: snapshot.mapState ?? emptyMapState() };
  const worldSpeechProfiles = parseNpcSpeechProfiles(world.npcSpeechProfiles, Object.keys(world.npcs));
  const runtimeSpeechProfiles = parseNpcSpeechProfiles(Object.fromEntries(Object.entries(npcPersonalities)
    .filter(([name, personality]) => !worldSpeechProfiles[name] || personality.authoredProfile)
    .map(([name, personality]) => [name, personality.speechProfile])));
  const scene = getScene(world, snapshot.currentSceneId);
  const cal = gameTimeToCalendar(snapshot.currentGameTime);
  const currentMins = timeToMinutes(snapshot.currentGameTime);

  // ============================================================
  // 段构建器 — 每段返回完整文本（含 ## 标题行）
  // ============================================================

  function emit(_name: string, content: string): string { return content; }

  // ---- 静态段（diffable: true，稳定性最高，放最前面） ----

  const buildWorldOverview = () => emit("world_overview", `
## 世界：${world.name}
${world.overview}
世界背景可能包含不同人物的开场草案；当前主角的经历以本周目身份与已接受历史为准，不能仅凭“你”的叙述视角转移他人的记忆。

## 核心矛盾
${world.contradictions.map((c) => `- ${c.name}：${c.description.slice(0, 100)}`).join("\n")}`);

  const buildSourceConstraints = () => {
    const archive = world.sourceArchive;
    if (!archive || world.sourceMode !== "source_archive") return "";

    if (archive.reconstruction) return emit("source_constraints", sourceRuntimeContext(archive.reconstruction, [snapshot.currentSceneId, scene?.name ?? "", ...(scene?.npcs ?? [])]));
    const ledger = archive.ledger;
    const plan = archive.adaptationPlan;
    const unknowns = ledger.unresolvedQuestions
      .slice(0, 8)
      .map((unknown) => `- ${unknown.question}`)
      .join("\n") || "（暂无）";
    const lockedFacts = plan.lockedFacts
      .slice(0, 8)
      .map((fact) => `- ${fact}`)
      .join("\n") || "（暂无）";
    const bridges = plan.bridgeContent.length > 0
      ? plan.bridgeContent
          .slice(0, 5)
          .map((bridge) => `- [${bridge.risk}] ${bridge.purpose}：${bridge.content}`)
          .join("\n")
      : "（暂无）";

    return emit("source_constraints", `
## 原作事实约束
- 本世界来自玩家资料建档，运行时必须区分原文事实、推断和可玩性桥接。
- source_confirmed / player_note 是强约束，不得被 generated_bridge 覆盖。
- generated_bridge 只是可玩性补全，不能反过来改写原作事实。
- unresolvedQuestions 中的内容保持未知，除非玩家行动、线索发现或后续资料确认。
- 当前建档模式：${plan.mode}
- 资料覆盖：${ledger.sourceCoverage.documentCount} 份资料，${ledger.sourceCoverage.evidenceCount} 条证据，高置信 ${ledger.sourceCoverage.highConfidenceCount} 条。

### 档案摘要
${ledger.summary || "（暂无摘要）"}

### 已锁定事实
${lockedFacts}

### 仍需保持未知
${unknowns}

### 可玩性桥接
${bridges}`);
  };

  const buildNarrativeStyle = () => {
    const styleGuide = formatNarrativeStyleForAlice(world.narrativeStyle);
    return styleGuide ? emit("narrative_style", `\n${styleGuide}`) : "";
  };

  const buildCurrentScene = () => emit("current_scene", `
## 当前场景
${scene ? `ID：${snapshot.currentSceneId}\n名称：${scene.name}\n区域：${scene.region}\n${scene.initialDescription}\n相邻场景：${scene.connections.join("、")}` : "无"}`);

  const buildSceneNpcs = () => {
    const profiles = buildSceneNpcProfiles({
      world,
      sceneNpcNames: scene?.npcs ?? [],
      encyclopedia,
      relationships,
      npcStates,
      npcBehaviors,
      npcPersonalities,
    });
    return emit("scene_npcs", formatSceneNpcProfiles(profiles));
  };

  const buildNpcPersonalities = () => {
    const personalities = npcPersonalities;
    if (!personalities || Object.keys(personalities).length === 0) return "";

    const sceneNpcNames = scene?.npcs ?? [];
    const relevant = sceneNpcNames
      .map((n) => personalities[n])
      .filter(Boolean)
      .filter((p) => (p as any).isImportant === true);

    if (relevant.length === 0) return "";

    const parts = relevant.map((p) => {
      const state = p as import("@/lib/personality/types").PersonalityState;
      const lines: string[] = [`### ${state.npcId}`];
      lines.push(`核心追求：${state.archive.coreDesires.join("；")}`);
      if (state.awareness > 0) {
        lines.push(`（注意：该角色已有轻微异常感知，可能对重复/预知/记忆缺口敏感）`);
      }
      // 最近高重要性记忆
      const recentImportant = state.episodicMemories
        .filter((m) => m.importance >= 50)
        .slice(-2);
      for (const m of recentImportant) {
        const emo = m.emotion ? `[${m.emotion}] ` : "";
        lines.push(`近期印象：${emo}${m.content}`);
      }
      // 认知风格（给 ALICE 行为参考）
      const styleHints: Record<string, string> = {
        analytical: "分析型——偏好逻辑",
        intuitive: "直觉型——偏好感受",
        skeptical: "怀疑型——习惯质疑",
        compliant: "服从型——遵守规则",
        fantasy_prone: "幻想型——倾向超自然解释",
        empirical: "实证型——相信眼见为实",
      };
      const style = styleHints[state.archive.cognitiveStyle];
      if (style) lines.push(`认知方式：${style}`);
      // 恐惧
      if (state.archive.fearsAndTaboos.length > 0) {
        lines.push(`深层恐惧：${state.archive.fearsAndTaboos.join("；")}`);
      }
      return lines.join("\n");
    });

    if (parts.length === 0) return "";
    return emit("npc_personalities", `\n## 重要 NPC 人格状态\n${parts.join("\n\n")}`);
  };

  const buildAdjacentScenes = () => {
    const adj = scene?.connections
      .map((c: string) => {
        const s = getScene(world, c);
        return s ? `- [${c}] ${s.name} (${s.region})：${s.initialDescription.slice(0, 80)}...` : "";
      })
      .filter(Boolean)
      .join("\n") ?? "无";
    const routes = mapRoutes(world).filter(route => route.from === snapshot.currentSceneId);
    const nearby = new Set([snapshot.currentSceneId, ...routes.map(route => route.to)]);
    const notes = Object.entries(world.mapState.places).filter(([id]) => nearby.has(id)).map(([id, place]) => `- [${id}] ${place.note || '（无备注）'}`).join('\n');
    const routeInfo = routes.map(route => `- ${route.from} → ${route.to}: ${route.status}`).join('\n');
    const knownIds = new Set([snapshot.currentSceneId, ...snapshot.visitedScenes, ...Object.keys(world.mapState.places)]);
    const knownPlaces = Object.entries(mapScenes(world)).filter(([id]) => knownIds.has(id)).map(([id, place]) => `[${id}] ${place.name}`).join('、');
    const regions = Object.entries(world.regions).map(([id, region]) => `[${id}] ${region.name ?? id}`).join('、');
    return emit("adjacent_scenes", `\n## 相邻场景简介\n${adj}\n## 附近地图状态（hidden 不可直接告知玩家）\n${routeInfo}\n## 已知地点备注\n${notes || '无'}\n可用区域：${regions}\n已知地点索引（复用 ID，不重复创建）：${knownPlaces}`);
  };

  // ---- 半静态段（diffable: true，偶尔变化） ----

  const buildProtagonist = () => emit("protagonist", `
## 主人公状态
- 身体状态：${protagonistState?.health || "良好"} | 心情：${protagonistState?.mood || "平静"}
${protagonistState?.notes ? `- 备注：${protagonistState.notes}` : ""}`);

  const buildDiary = () => emit("diary", `
## 日记摘要（最近游戏日）
${diary.slice(-3).length > 0
    ? diary.slice(-3).map(d => `- 第${d.day}天：${d.summary}`).join("\n")
    : "（暂无）"}`);

  const buildRelationships = () => emit("relationships", `
## NPC 关系
${Object.entries(relationships).length > 0
    ? Object.entries(relationships)
        .sort(([, a], [, b]) => b.affinity - a.affinity)
        .slice(0, 10)
        .map(([name, r]) =>
          `- ${name}：好感 ${r.affinity} | 信任 ${r.trust}${r.tags.length > 0 ? ` | ${r.tags.join("、")}` : ""}${r.notes ? ` — ${r.notes}` : ""}`
        ).join("\n")
    : "（尚未建立深入关系）"}`);


  const buildEncyclopedia = () => {
    const encDesc = encyclopedia.length > 0
      ? encyclopedia.map((e) =>
          `- [${e.type}] ${e.name}：${e.description}${e.knowledge.length > 0 ? "（已知：" + e.knowledge.map((k: KnowledgeItem) => k.text).join("；") + "）" : ""}`
        ).join("\n")
      : "（空）";
    return emit("encyclopedia", `\n## 世界百科（玩家已知的人物、地点、物品）\n${encDesc}`);
  };

  const buildInventory = () => {
    const invDesc = inventory.length > 0
      ? inventory.map((i) =>
          `- [${i.id}] ${i.name}${i.quantity > 1 ? ` x${i.quantity}` : ""}：${i.description}（${i.category}）`
        ).join("\n")
      : "（空）";
    const opening = opts.initialObservation && !inventory.length
      ? '\n### 首次入场背包清点\n当前背包尚未登记，不代表角色没有随身物品。结合所选身份、开场叙事和当前情境，在同一次观察里确认角色原本携带的合理物品，通过 itemsGained 登记，并在正文自然交代。只登记有身份/开场依据且确实随身携带的物品；不得把场景里的物品视为已拥有，不凭空赠送装备或线索，没有依据时可保持空背包。'
      : '';
    return emit("inventory", `\n## 玩家背包\n${invDesc}${opening}`);
  };

  const buildClues = () => {
    const discovered = clues.filter((c) => c.discovered);
    const desc = discovered.length > 0
      ? discovered.map((c) => `- ${c.name}：${c.description}`).join("\n")
      : "无";
    return emit("clues", `\n## 已发现的线索\n${desc}`);
  };

  const buildSceneClues = () => {
    const sceneClues = clues.filter(
      (c) => c.sceneId === snapshot.currentSceneId && !c.discovered
    );
    return emit("scene_clues", `\n## 当前场景可发现的线索（尚未发现）
${sceneClues.length > 0
    ? sceneClues.map((c) => `- ${c.name}（需探索度≥${c.detailThreshold}）`).join("\n")
    : "无"}`);
  };

  // ---- 动态段（diffable: false，始终完整输出，放最后） ----

  const buildGameState = () => `
## 当前游戏状态
- 日期：${world.calendarEra || "新历"} ${cal.year}年${cal.month}月${cal.day}日 ${snapshot.currentGameTime.hour}:${String(snapshot.currentGameTime.minute).padStart(2, "0")}
- 天气：${weather}（${weatherEffect(weather as Weather)}）
- 玩家名称：${snapshot.playerName}
- 当前位置：${scene?.name ?? "未知"} (${scene?.region ?? "未知区域"})
- 场景探索度：${snapshot.sceneDetailLevels[snapshot.currentSceneId] ?? 10}/100
- 已触发世界事件：${Object.entries(snapshot.worldFlags).filter(([, v]) => v).map(([k]) => k).join("、") || "无"}`;

  const buildTimeline = () => {
    const nearby = world.timeline
      .filter((e) => {
        const diff = Math.abs(timeToMinutes(e.timePoint) - currentMins);
        return diff <= 180 && !snapshot.resolvedTimelineEvents.includes(e.id) && !snapshot.deviatedEvents[e.id];
      })
      .slice(0, 5);
    return `\n## 当前时间附近的推演事件
${nearby.length > 0
    ? nearby.map((e) =>
        `- [${e.timePoint.day}天${e.timePoint.hour}:${String(e.timePoint.minute).padStart(2, "0")}] ${e.title}：${e.description.slice(0, 150)}...${e.playerModifiable ? "（玩家可干预）" : ""}`
      ).join("\n")
    : "无"}`;
  };

  const buildCriticalFacts = () => `
## 关键信息
${criticalFacts.length > 0
    ? criticalFacts.map((f, i) => `${i + 1}. ${f.text}`).join("\n")
    : "（暂无）"}`;

  const buildCausalRipples = () => {
    const pendingRipples = causalProjections
      .flatMap(cp => cp.rippleEffects.filter(r => r.status === "pending" && r.confidence >= 0.5))
      .filter(r => {
        const estMins = timeToMinutes(r.estimatedTime);
        const diff = Math.abs(estMins - currentMins);
        return diff <= 48 * 60;
      })
      .sort((a, b) => {
        const aDiff = Math.abs(timeToMinutes(a.estimatedTime) - currentMins);
        const bDiff = Math.abs(timeToMinutes(b.estimatedTime) - currentMins);
        return aDiff - bDiff;
      })
      .slice(0, 3);
    if (pendingRipples.length === 0) return `\n## 因果涟漪（之前行动预测的连锁反应，时间接近的优先关注）\n（暂无活跃的因果预测）`;
    return `\n## 因果涟漪（之前行动预测的连锁反应，时间接近的优先关注）
${pendingRipples.map(r => {
      const estMins = timeToMinutes(r.estimatedTime);
      const diff = estMins - currentMins;
      const timeDesc = diff < -60 ? `${Math.floor(-diff / 60)}小时前（预测应已发生）`
        : diff < 0 ? "刚刚（预测应正发生）"
        : diff < 60 ? `${diff}分钟后`
        : diff < 24 * 60 ? `${Math.floor(diff / 60)}小时后`
        : `${Math.floor(diff / (24 * 60))}天后`;
      return `- [${r.status === "pending" ? "待验证" : r.status}] ${r.projectedOutcome}（${timeDesc}，置信度 ${Math.round(r.confidence * 100)}%）${r.involvedNpcs.length > 0 ? ` —— 涉及：${r.involvedNpcs.join("、")}` : ""}`;
    }).join("\n")}`;
  };

  // ============================================================
  // 段注册表 — 按稳定性排序：最稳定 → 最易变
  // 最大化 DeepSeek 前缀缓存命中率
  // ============================================================

  const buildWorldLine = () => {
    const wl = worldLineSummary;
    if (!wl) return "";
    const parts: string[] = [];
    parts.push(`- 当前节点：${wl.currentNodeId}（第 ${wl.stepNumber} 步，深度 ${wl.depth}）`);
    parts.push(`- 分支总数：${wl.branchCount}`);
    if (wl.rewindFailure) parts.push(`- 引擎确认：最近一次回溯未执行，世界没有因此恢复。失败结果：${JSON.stringify(wl.rewindFailure)}。此前正文中声称恢复、修改旧节点标签等内容不是操作凭证，以当前节点和实际历史记录为准。`);
    if (rewindPolicy(world) && !wl.backtrackableNodes.length) parts.push('- 当前没有列出定位参考。标签不是跳转白名单；可以检索历史原文寻找其他真实节点，不得猜测节点或虚构执行结果。');
    if (wl.backtrackableNodes.length > 0) {
      parts.push(`- 历史定位参考（仅列部分，标记不是目标白名单）：`);
      for (const n of wl.backtrackableNodes) {
        parts.push(`  [${n.id}] "${n.label}" (第${n.stepNumber}步): ${n.summary}`);
      }
    }
    if (wl.siblingBranches.length > 0 && !rewindPolicy(world)) {
      parts.push(`- 兄弟分支（同一决策点的其他选择——可能是"上一世"的经历）：`);
      for (const b of wl.siblingBranches) {
        const label = b.label ? `[${b.label}] ` : "";
        parts.push(`  ${label}${b.summary}`);
      }
    }
    return `\n## 世界线信息\n${parts.join("\n")}`;
  };

  // Only world definitions belong in the stable prefix. Scene/NPC selections depend on the snapshot.
  const segments: ContextSegment[] = [
    { stable: true, build: buildWorldOverview },
    { stable: !world.sourceArchive?.reconstruction, build: buildSourceConstraints },
    { stable: true, build: buildNarrativeStyle },
    { stable: true, build: () => emit('speech_seeds', formatNpcSpeechProfiles(worldSpeechProfiles)) },
    { stable: false, build: () => {
      const profiles = formatNpcSpeechProfiles(runtimeSpeechProfiles);
      return emit('speech_runtime', profiles ? '\n本分支言语档案与世界初始档案同名时，以本分支档案为准。\n' + profiles : '');
    } },
    { stable: false, build: () => {
      const profiles = Object.fromEntries(Object.entries(npcPersonalities).flatMap(([name, personality]) => personality.authoredProfile ? [[name, personality.authoredProfile.description]] : []));
      return Object.keys(profiles).length ? emit('npc_profile_overrides', '\n## 本分支已审核的人物设定\n以下是玩家明确改编后实际提交的设定，优先于该人物旧底稿；不代表人物在场，不把写入过程演成审批剧情。\n' + JSON.stringify(profiles)) : '';
    } },
    ...[buildCurrentScene, buildSceneNpcs, buildNpcPersonalities, buildAdjacentScenes,
      buildProtagonist, buildDiary, buildRelationships, buildEncyclopedia,
      buildInventory, buildClues, buildSceneClues, buildWorldLine, buildGameState, buildTimeline,
      buildCriticalFacts, buildCausalRipples].map(build => ({ stable: false, build })),
  ];

  // ============================================================
  // 组装输出
  // ============================================================

  const parts: string[] = [];

  // HTTP 请求互相独立，“未变化”不能代替本次请求的事实。
  const stableParts: string[] = [];
  for (const seg of segments) (seg.stable ? stableParts : parts).push(seg.build());
  parts.push(imageCatalogPrompt(world.id, opts.imageCatalog, snapshot.currentSceneId, scene?.npcs ?? []));
  const components = [{ id: 'world_static', label: '世界固定设定', text: stableParts.join('\n') }, { id: 'world_state', label: '当前世界、人物、库存与事实', text: parts.join('\n') }];
  if (opts.cardContext?.stablePrefix) components.push({ id: 'cards_static', label: '原卡固定设定', text: opts.cardContext.stablePrefix });
  if (opts.cardContext?.dynamicSuffix) components.push({ id: 'cards_dynamic', label: '原卡情境条目与变量', text: opts.cardContext.dynamicSuffix });
  if (opts.cardContext?.stablePrefix) stableParts.push(opts.cardContext.stablePrefix);
  if (opts.cardContext?.dynamicSuffix) parts.push(opts.cardContext.dynamicSuffix);
  let cardPreHistory = '';
  if (opts.cardContext?.behaviorPrefix) {
    const text = `\n## 原卡行为约定（仅约束来源角色或世界，不替换引擎提交协议）\n${opts.cardContext.behaviorPrefix}`;
    cardPreHistory = text + '\n'; components.push({ id: 'card_behavior', label: '原卡前置行为约定', text });
  }
  if (opts.cardContext?.examples) {
    const text = `\n## 语气与表现范例（参考，不是已发生历史）\n${opts.cardContext.examples}`;
    parts.push(text); components.push({ id: 'card_examples', label: '原卡表现范例', text });
  }
  const continuity = chapterNarrativeEnabled(world, snapshot) && snapshot.chapterState?.activeId ? '' : narrativeContinuityPrompt(snapshot.narrativeProgress);
  const chapters = chapterContextForModel(world, snapshot);
  if (chapters) { parts.push(chapters); components.push({ id: 'chapters', label: '篇章经历与编排', text: chapters }); }
  if (chapterNarrativeEnabled(world, snapshot)) { parts.push(CHAPTER_ALICE_PROTOCOL); components.push({ id: 'chapter_protocol', label: '篇章写作职责', text: CHAPTER_ALICE_PROTOCOL }); }
  const entry = entryContextPrompt(snapshot.entryContext, world.id);
  if (entry) { parts.push(entry); components.push({ id: 'world_entry', label: '本周目身份与开场', text: entry }); }
  if (continuity) { parts.push(continuity); components.push({ id: "narrative_continuity", label: "篇章衔接与读者记忆", text: continuity }); }
  const rewind = rewindPolicy(world);
  if (worldLineSummary || world.gameplayPlugins?.some(p=>p.ui?.presentation==='native-text' && isGameplayPluginActive(p,snapshot.worldFlags,snapshot.currentSceneId))) {
    parts.push(HISTORY_READ_PROTOCOL); components.push({ id: 'history-reader', label: '历史原文只读工具', text: HISTORY_READ_PROTOCOL });
  }
  if (rewind) {
    const text = `\n## 受限回溯能力\n回看原文是只读行为。依据已确认剧情、能力设定和真实历史目标，在本轮行动的 worldImpacts 提议 [BACKTRACK:目标引用] 发动原因。玩家要求不等于发动成功。可以选择未标记的过去节点；固定锚点只适用于作品确实声明该限制的能力，标签用于定位。\n${NODE_REFERENCE_GUIDE}\n只有缺少定位依据或旧细节时，才先只请求检索/读取历史原文，不同时结算行动，不猜测 ID。\n引擎执行时必须满足这些世界标记：${JSON.stringify(rewind.requires)}。标记可以已经满足，或由本轮有剧情依据、符合声明前提的 pluginEvents 许可规则设置；宿主先接受玩法规则再校验回溯，可在同轮提议许可与 BACKTRACK。缺失标记不能写成已置位，拟提交的许可也不是通过回执；其他缺少的前提不得靠正文补齐。没有合法满足条件的依据时说明阻碍，不输出回溯标记。\n正文只呈现发动前的行动与尝试，不宣称校验通过、恢复启动、已经到达或世界已被改写。引擎实际执行成功后才建立到达分支并恢复目标快照，失败回执优先于先前正文的成功说法。旁观镜头、内省和正文补写不发动能力。引擎独立保留主角经历，NPC、物品及世界恢复过去状态，不自行搬运旧未来状态，也不用兄弟分支猜主角记忆。\n${rewindMemoryPrompt(snapshot.rewindMemory)}`;
    parts.push(text); components.push({ id: 'rewind', label: '回溯能力与主角经历', text });
  }
  if (snapshot.presentationContext?.length) {
    const text = `\n## 原生演出执行回执（叙述者资料，不是角色知识）\n${JSON.stringify(snapshot.presentationContext)}\napplied 已执行，结果可能被后续组合覆盖；pending 尚待播放，cancelled 已撤销，errors 表示未执行。需要原文/当前显示、可直接编辑的 editRef 或演出前后对照时使用 historyRequest 的 view:both。当前宿主能力以本轮协议与回执为准，旧对话中的失败结论不代表当前权限。`;
    parts.push(text); components.push({ id: 'presentation', label: '原生演出回执', text });
  }
  const gameplay = snapshot.gameplayModState ? gameplayContextForModel(snapshot.gameplayModState) : snapshot.gameplayContext ?? [];
  if (gameplay.length) {
    const text = `\n## 已确认的玩法事实与结果\n${JSON.stringify(gameplay)}\n这是已接受的进度，不是未判定的行动请求；不要根据旧初始设定重置它。`;
    parts.push(text); components.push({ id: 'gameplay_facts', label: '已确认的模组事实与结果', text });
  }

  // 检索证据属于当前请求，不插入已经接受的历史前缀。
  if (longMemoryContext) {
    parts.push(`\n${longMemoryContext}`);
    components.push({ id: 'memory', label: '本轮检索的历史证据', text: `\n${longMemoryContext}` });
  }

  // historySummary 放在关键信息之前，动态段之后（保持语义连贯）
  if (historySummary) {

    components.push({ id: 'history', label: '最近行动记录', text: `\n${historySummary}` });
  }
  if (opts.cardContext?.behaviorSuffix) {
    const text = `\n## 原卡历史后行为约定（不改写已接受事实或执行协议）\n${opts.cardContext.behaviorSuffix}`;
    parts.push(text); components.push({ id: 'card_post_history', label: '原卡后置行为约定', text });
  }

  // 知识门禁段（动态，始终完整输出——每轮随玩家已知信息变化）
  const gate = buildKnowledgeGateContext({
    clues,
    encyclopedia,
    criticalFacts,
    world,
    snapshot,
  });
  const knowledge = formatKnowledgeGateContext(gate);
  parts.push(knowledge); components.push({ id: 'knowledge', label: '知情边界', text: knowledge });

  const stablePrefix = stableParts.join('\n');
  const recordText = (historySummary ? `\n${historySummary}\n` : '') + (opts.includeDirectorCue && snapshot.directorCueCandidate ? renderDirectorCue(snapshot.directorCueCandidate) : '');
  const currentText = parts.join('\n');
  return { stablePrefix, dynamicSuffix: cardPreHistory + recordText + currentText, components, blocks: [
    { id: 'world.edition', kind: 'edition' as const, stability: 'edition' as const, text: stablePrefix },
    { id: 'card_pre_history', kind: 'current' as const, stability: 'request' as const, text: cardPreHistory },
    { id: 'history', kind: 'record' as const, stability: 'record' as const, text: recordText },
    { id: 'world.current', kind: 'current' as const, stability: 'request' as const, text: currentText },
  ] };
}

// ============================================================
// 知识门禁构建器（文学控制层 v1）
// ============================================================

/** 构建 KnowledgeGate 的参数 */
export interface BuildKnowledgeGateOptions {
  clues: Clue[];
  encyclopedia: EncyclopediaEntry[];
  criticalFacts: CriticalFactEntry[];
  world: WorldDefinition;
  snapshot: WorldSnapshot;
}

/**
 * 从已有游戏数据构建最小知识门禁。
 *
 * 规则（按 Prompt 改造规格 §4.1）：
 * - playerKnownFacts 来自已发现 clues、criticalFacts、encyclopedia knowledge
 * - forbiddenFacts 来自未发现 clues 和当前场景未发现 secrets
 * - 关键：forbiddenFacts 写成约束形式（"不要解释 X"）而非完整真相，防止反向泄密
 * - playerHypotheses 本次为空（为假说系统预留）
 * - perspectiveLimits 写入视角限制规则
 */
export function buildKnowledgeGateContext(opts: BuildKnowledgeGateOptions): KnowledgeGate {
  const { clues, encyclopedia, criticalFacts, world, snapshot } = opts;

  // 玩家已知事实：已发现线索 + 关键信息 + 百科知识
  const playerKnownFacts: string[] = [];

  for (const clue of clues) {
    if (clue.discovered) {
      playerKnownFacts.push(`[线索] ${clue.name}：${clue.description}`);
    }
  }

  for (const fact of criticalFacts) {
    playerKnownFacts.push(`[关键信息] ${fact.text}`);
  }

  for (const entry of encyclopedia) {
    const knowledgeTexts = entry.knowledge.map((k) => k.text).join("；");
    playerKnownFacts.push(`[百科] ${entry.name}（${entry.type}）：${entry.description}${knowledgeTexts ? " — " + knowledgeTexts : ""}`);
  }

  // 禁止揭示的事实：未发现线索 + 当前场景未发现秘密
  const forbiddenFacts: string[] = [];

  for (const clue of clues) {
    if (!clue.discovered) {
      // 只写约束形式，不写完整真相（防止反向泄密到 prompt 中）
      forbiddenFacts.push(`不要直接揭示线索「${clue.name}」的内容`);
    }
  }

  // 获取当前场景
  const scene = getScene(world, snapshot.currentSceneId);
  if (scene) {
    const sceneSecrets = scene.secrets || [];
    const discovered = snapshot.discoveredSecrets[snapshot.currentSceneId] || [];
    for (const secret of sceneSecrets) {
      if (!discovered.includes(secret)) {
        forbiddenFacts.push(`不要直接解释秘密「${secret}」的真实含义`);
      }
    }
  }

  // 视角限制
  const perspectiveLimits = [
    "只能描述当前视角可观察、可推断的信息",
    "不能直接解释隐藏真相，除非它已进入玩家已知事实或下述明确保留的亲历记忆范围",
    "NPC 只能说出自己知道的信息，不能替其他角色解释动机",
  ];
  if (parseRewindMemory(snapshot.rewindMemory)) {
    perspectiveLimits.push(REWIND_KNOWLEDGE_RULE);
  }

  return {
    playerKnownFacts,
    playerHypotheses: [],
    forbiddenFacts,
    visibleSecrets: [],
    perspectiveLimits,
  };
}

/**
 * 将 KnowledgeGate 格式化为 ALICE prompt 上下文段落。
 * 返回已包含标题行的完整文本。
 */
export function formatKnowledgeGateContext(gate: KnowledgeGate): string {
  const parts: string[] = [];

  // 玩家已确认知识
  parts.push("## 玩家已确认知识");
  if (gate.playerKnownFacts.length > 0) {
    parts.push(gate.playerKnownFacts.map((f) => `- ${f}`).join("\n"));
  } else {
    parts.push("（暂无明确确认的知识）");
  }

  // 玩家假说
  if (gate.playerHypotheses && gate.playerHypotheses.length > 0) {
    parts.push("\n## 玩家可能猜测但尚未确认");
    parts.push(gate.playerHypotheses.map((h) => `- ${h}`).join("\n"));
  }

  // 本轮禁止泄露
  parts.push("\n## 本轮禁止泄露的信息");
  if (gate.forbiddenFacts.length > 0) {
    parts.push(gate.forbiddenFacts.map((f) => `- ${f}`).join("\n"));
  } else {
    parts.push("（本轮暂无特别禁止项——但仍需遵守知识门禁原则）");
  }

  // 视角限制
  parts.push("\n## 当前视角限制");
  if (gate.perspectiveLimits && gate.perspectiveLimits.length > 0) {
    parts.push(gate.perspectiveLimits.map((l) => `- ${l}`).join("\n"));
  }

  return parts.join("\n");
}
