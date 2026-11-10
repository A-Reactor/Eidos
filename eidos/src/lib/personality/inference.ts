// ============================================================
// Eidos · 人格推演引擎 — 推演循环
// ============================================================
// Phase 2: 从 ALICE 叙事输出中提取观察信号，更新 NPC 人格状态。
// 所有推演都是确定性代码——不额外调用 AI。

import type {
  PersonalityState,
  EpisodicMemory,
  EmotionalMemory,
  RelationalMemory,
  AnomalousMemory,
  PersonalityPressure,
} from "./types";
import { AwarenessStage, isFullPersonalityState } from "./types";
import { mergeMemory, scoreImportance } from "./memory";
import type { PersonalityObservations } from "@/lib/ai/types";

// ============================================================
// 压力计算
// ============================================================

/**
 * 从当前人格状态重新计算压力。
 * 纯函数——输入状态，输出压力值。
 */
export function computePressure(state: PersonalityState): PersonalityPressure {
  const { anomalousMemories, beliefs, episodicMemories, emotionalMemories } =
    state;

  // 未解释的异常 → 认知失调 + 世界怀疑
  const unexplainedAnomalies = anomalousMemories.filter((a) => !a.explainedAway);
  const cognitiveDissonance = Math.min(
    100,
    unexplainedAnomalies.length * 20 + beliefs.contradictions.length * 15,
  );
  const worldDoubt = Math.min(
    100,
    unexplainedAnomalies.reduce((sum, a) => sum + a.significance, 0) / 2,
  );

  // 高重要性记忆 → 未完成目标驱动
  const highImportanceMemories = episodicMemories.filter(
    (m) => m.importance >= 50,
  );
  const unfinishedGoals = Math.min(100, highImportanceMemories.length * 10);

  // 情感记忆中负面情绪 → 关系压力
  const negativeEmotions = emotionalMemories.filter((e) =>
    ["fear", "anger", "distrust", "betrayal", "恐惧", "愤怒", "不信任", "背叛"].includes(
      e.emotionalResidue,
    ),
  );
  const relational = Math.min(100, negativeEmotions.length * 20);

  // 负面情感记忆中对玩家的不信任 → trustInPlayer
  const playerNegative = emotionalMemories.filter(
    (e) =>
      e.npcName === "玩家" &&
      ["distrust", "fear", "anger", "不信任", "恐惧", "愤怒"].includes(
        e.emotionalResidue,
      ),
  );
  const trustInPlayer = Math.max(-100, -playerNegative.length * 25);

  // 连续性恐惧：阶段 ≥ ANOMALY_SENSE 时出现
  const selfContinuityFear =
    state.awareness >= AwarenessStage.ANOMALY_SENSE
      ? Math.min(100, state.awareness * 15 + unexplainedAnomalies.length * 10)
      : 0;

  // 生存压力（基础值，后续可根据健康状态调整）
  const survival = 0;

  return {
    survival,
    relational,
    cognitiveDissonance,
    unfinishedGoals,
    trustInPlayer,
    worldDoubt,
    selfContinuityFear,
  };
}

// ============================================================
// 从 ALICE 观察信号更新 NPC 状态
// ============================================================

export interface InferenceInput {
  /** 当前 NPC 人格状态 */
  state: PersonalityState;
  /** ALICE 输出的人格观察信号 */
  observations: PersonalityObservations;
  /** 当前时间戳 */
  now: number;
}

export interface InferenceOutput {
  /** 更新后的人格状态 */
  state: PersonalityState;
  /** 新增的情节记忆 */
  newEpisodicMemories: EpisodicMemory[];
  /** 是否产生了新的异常记忆 */
  newAnomalies: AnomalousMemory[];
  /** 压力是否显著变化 */
  pressureChanged: boolean;
}

/**
 * 从本轮 ALICE 观察信号更新一个 NPC 的人格状态。
 *
 * 流程：
 * 1. 提取该 NPC 相关的记忆事件 → 创建情节记忆
 * 2. 提取该 NPC 的情感反应 → 更新情感记忆
 * 3. 提取该 NPC 与其他 NPC 的互动 → 更新关系记忆
 * 4. 重新计算压力
 * 5. 检查是否有触发觉察阶段推进的条件
 */
export function inferPersonalityUpdate(
  input: InferenceInput,
): InferenceOutput {
  const { state, observations, now } = input;
  const updated = { ...state };
  const newEpisodicMemories: EpisodicMemory[] = [];
  const newAnomalies: AnomalousMemory[] = [];

  // 1. 处理 memoryWorthyEvents — 创建情节记忆
  if (observations.memoryWorthyEvents) {
    for (const event of observations.memoryWorthyEvents) {
      if (event.npcName !== state.npcId) continue;

      const importanceScore = scoreImportance(
        event.event,
        [], // relatedNpcs filled below
        event.emotion || "",
        state.archive.coreDesires,
        state.archive.fearsAndTaboos,
        false,
      );

      const importanceMap: Record<string, number> = {
        low: 30,
        medium: 50,
        high: 80,
      };
      const baseImportance = importanceMap[event.importanceHint] || 40;
      const finalImportance = Math.max(baseImportance, importanceScore);

      const memory: EpisodicMemory = {
        id: `ep_${now}_${Math.random().toString(36).slice(2, 6)}`,
        timestamp: now,
        content: event.event,
        importance: finalImportance,
        emotion: event.emotion || "",
        relatedNpcs: [],
        relatedBeliefs: [],
      };

      updated.episodicMemories = mergeMemory(
        updated.episodicMemories,
        memory,
      );
      newEpisodicMemories.push(memory);
    }
  }

  // 2. 处理 npcsInvolved — 更新情感记忆
  if (observations.npcsInvolved) {
    for (const involved of observations.npcsInvolved) {
      if (involved.npcName !== state.npcId) continue;

      if (involved.emotion) {
        const existingIdx = updated.emotionalMemories.findIndex(
          (e) => e.npcName === involved.npcName,
        );

        const emotionMem: EmotionalMemory = {
          npcName: involved.npcName,
          eventType: involved.touchesCoreConcern ? "revelation" : "interaction",
          emotionalResidue: involved.emotion,
          intensity: involved.touchesCoreConcern ? 70 : 40,
          lastTriggered: now,
        };

        if (existingIdx >= 0) {
          const updatedList = [...updated.emotionalMemories];
          updatedList[existingIdx] = emotionMem;
          updated.emotionalMemories = updatedList;
        } else {
          updated.emotionalMemories = [
            ...updated.emotionalMemories,
            emotionMem,
          ];
        }
      }
    }
  }

  // 3. 处理 npcInteractions — 更新关系记忆
  if (observations.npcInteractions) {
    for (const interaction of observations.npcInteractions) {
      const otherNpc =
        interaction.npcA === state.npcId
          ? interaction.npcB
          : interaction.npcB === state.npcId
            ? interaction.npcA
            : null;
      if (!otherNpc) continue;

      const existingIdx = updated.relationalMemories.findIndex(
        (r) => r.targetName === otherNpc,
      );

      const relMem: RelationalMemory = {
        targetName: otherNpc,
        role: "unknown",
        trust: interaction.emotionalTone === "positive" ? 20 : interaction.emotionalTone === "negative" ? -20 : 0,
        history: [interaction.interaction],
      };

      if (existingIdx >= 0) {
        const updatedList = [...updated.relationalMemories];
        const existing = updatedList[existingIdx];
        relMem.history = [...existing.history, ...relMem.history].slice(-10);
        relMem.trust = Math.max(-100, Math.min(100, existing.trust + relMem.trust));
        updatedList[existingIdx] = relMem;
        updated.relationalMemories = updatedList;
      } else {
        updated.relationalMemories = [
          ...updated.relationalMemories,
          relMem,
        ];
      }
    }
  }

  // 4. 重新计算压力
  const oldPressure = updated.pressure;
  updated.pressure = computePressure(updated);
  const pressureChanged =
    Math.abs(oldPressure.cognitiveDissonance - updated.pressure.cognitiveDissonance) > 10 ||
    Math.abs(oldPressure.worldDoubt - updated.pressure.worldDoubt) > 10 ||
    Math.abs(oldPressure.relational - updated.pressure.relational) > 10;

  // 5. 检查觉察阶段推进条件
  // 不在此处自动推进——由 personality-slice 的 advanceAwareness 守卫控制
  // 仅提供条件检查结果供调用方使用

  updated.lastUpdated = now;

  return {
    state: updated,
    newEpisodicMemories,
    newAnomalies,
    pressureChanged,
  };
}

// ============================================================
// 批量推演：从一轮 ALICE 响应更新所有涉及的 NPC
// ============================================================

export interface BatchInferenceResult {
  /** 更新后的 NPC 人格状态映射 */
  updated: Record<string, PersonalityState>;
  /** 每个 NPC 的推演摘要（供调试/审计） */
  summaries: Array<{
    npcId: string;
    memoriesAdded: number;
    pressureChanged: boolean;
    awarenessEligible: boolean;
  }>;
}

/**
 * 对 ALICE 响应涉及的所有重要 NPC 执行人格推演。
 *
 * @param personalities 当前所有 NPC 人格状态
 * @param observations ALICE 输出的观察信号
 * @param now 当前时间戳
 * @returns 批量更新结果
 */
export function batchInfer(
  personalities: Record<string, any>,
  observations: PersonalityObservations | undefined,
  now: number,
): BatchInferenceResult {
  const updated: Record<string, PersonalityState> = {};
  const summaries: BatchInferenceResult["summaries"] = [];

  if (!observations) {
    return { updated, summaries };
  }

  // 收集本轮涉及的所有 NPC
  const involvedNpcNames = new Set<string>();
  if (observations.npcsInvolved) {
    for (const n of observations.npcsInvolved) {
      involvedNpcNames.add(n.npcName);
    }
  }
  if (observations.memoryWorthyEvents) {
    for (const e of observations.memoryWorthyEvents) {
      involvedNpcNames.add(e.npcName);
    }
  }
  if (observations.npcInteractions) {
    for (const i of observations.npcInteractions) {
      involvedNpcNames.add(i.npcA);
      involvedNpcNames.add(i.npcB);
    }
  }

  // 对每个涉及的 NPC 执行推演
  for (const npcName of involvedNpcNames) {
    const state = personalities[npcName];
    if (!state || !isFullPersonalityState(state)) continue;

    const result = inferPersonalityUpdate({
      state,
      observations,
      now,
    });

    updated[npcName] = result.state;

    // 检查是否满足觉察推进条件
    const unexplainedCount = result.state.anomalousMemories.filter(
      (a) => !a.explainedAway,
    ).length;
    const awarenessEligible =
      unexplainedCount >= 1 &&
      result.state.awareness < AwarenessStage.HYPOTHESIS &&
      result.state.archive.boundarySensitivity >= 25;

    summaries.push({
      npcId: npcName,
      memoriesAdded: result.newEpisodicMemories.length,
      pressureChanged: result.pressureChanged,
      awarenessEligible,
    });
  }

  return { updated, summaries };
}
