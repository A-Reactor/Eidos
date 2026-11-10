// ============================================================
// Eidos · 人格推演引擎 — 社会场（Phase 5）
// ============================================================
// NPC 之间的异常信息传播、群体假说形成、记忆互相验证。
// 觉察不是单人独白——它是社会产物。

import type {
  SocialConnection,
  GroupHypothesis,
  PropagationEvent,
  PersonalityState,
  AnomalousMemory,
  RelationalMemory,
} from "./types";
import { isFullPersonalityState } from "./types";
import { normalizeNpcDescription } from "@/lib/game/npc-description";

// ============================================================
// 社会网络构建
// ============================================================

export interface SocialNetworkInput {
  /** 场景中所有 NPC 名称 */
  sceneNpcs: string[];
  /** 所有 NPC 人格状态 */
  personalities: Record<string, any>;
  /** NPC 描述文本（来自 WorldDefinition.npcs） */
  npcDescriptions: Record<string, unknown>;
  /** 当前场景所属区域 */
  region: string;
  /** 所有场景的 NPC 列表（用于跨场景邻居关系） */
  allScenes?: Record<string, { region: string; npcs: string[] }>;
}

/**
 * 为当前场景中的 NPC 构建社会网络。
 *
 * 连接规则：
 * - 同一场景 → coworker（信任 10）
 * - 同一区域 → neighbor（信任 5）
 * - NPC 描述中有上下级关系关键词 → authority
 * - 已有 RelationalMemory → 使用已追踪的信任值
 */
export function buildSocialNetwork(
  input: SocialNetworkInput,
): SocialConnection[] {
  const { sceneNpcs, personalities, npcDescriptions, region } = input;
  const connections: SocialConnection[] = [];
  const processed = new Set<string>();

  for (let i = 0; i < sceneNpcs.length; i++) {
    for (let j = i + 1; j < sceneNpcs.length; j++) {
      const a = sceneNpcs[i];
      const b = sceneNpcs[j];
      const pairKey = [a, b].sort().join("||");
      if (processed.has(pairKey)) continue;
      processed.add(pairKey);

      const descA = normalizeNpcDescription(npcDescriptions[a], a);
      const descB = normalizeNpcDescription(npcDescriptions[b], b);

      // 检查上下级关系
      const aOverB =
        descA.includes(b) &&
        (descA.includes("管理") || descA.includes("领导") || descA.includes("上级"));
      const bOverA =
        descB.includes(a) &&
        (descB.includes("管理") || descB.includes("领导") || descB.includes("上级"));

      let relType: SocialConnection["relationshipType"] = "coworker";
      if (aOverB) relType = "authority";
      else if (bOverA) relType = "authority";

      // 从已有 RelationalMemory 获取信任值
      const stateA = personalities[a];
      const stateB = personalities[b];
      let trustAtoB = 10;
      let trustBtoA = 10;

      if (isFullPersonalityState(stateA)) {
        const rel = stateA.relationalMemories.find((r) => r.targetName === b);
        if (rel) trustAtoB = rel.trust;
      }
      if (isFullPersonalityState(stateB)) {
        const rel = stateB.relationalMemories.find((r) => r.targetName === a);
        if (rel) trustBtoA = rel.trust;
      }

      // 关系类型修饰信任
      if (relType === "authority") {
        if (aOverB) {
          trustBtoA = Math.max(trustBtoA, 40); // 下级信任上级
          trustAtoB = Math.max(trustAtoB, 20);
        }
        if (bOverA) {
          trustAtoB = Math.max(trustAtoB, 40);
          trustBtoA = Math.max(trustBtoA, 20);
        }
      }

      connections.push({
        npcA: a,
        npcB: b,
        trustAtoB,
        trustBtoA,
        relationshipType: relType,
        lastInteraction: Date.now(),
      });
    }
  }

  return connections;
}

// ============================================================
// 异常传播
// ============================================================

export interface PropagationInput {
  /** 来源 NPC */
  sourceNpcId: string;
  /** 来源 NPC 的异常记忆（要传播的） */
  sourceAnomalies: AnomalousMemory[];
  /** 社会网络 */
  network: SocialConnection[];
  /** 所有 NPC 人格状态 */
  personalities: Record<string, any>;
  /** 当前时间 */
  now: number;
}

export interface PropagationResult {
  /** 传播事件列表 */
  events: PropagationEvent[];
  /** 受影响 NPC 的新异常记忆 */
  newAnomalies: Record<string, AnomalousMemory[]>;
}

/**
 * 模拟异常从一个 NPC 向社交网络中其他 NPC 的传播。
 *
 * 规则：
 * - 只有信任度 ≥ 0 才会尝试分享
 * - 分享概率 = trust / 200（信任 100 → 50% 概率分享）
 * - 接受概率取决于目标 NPC 的：
 *   - 认知风格（怀疑型更可能拒绝，顺从型更可能接受）
 *   - 边界敏感度（越高越容易接受异常信息）
 *   - 已有异常经验（已有异常的 NPC 更容易接受新异常）
 */
export function propagateAnomaly(
  input: PropagationInput,
): PropagationResult {
  const { sourceNpcId, sourceAnomalies, network, personalities, now } = input;
  const events: PropagationEvent[] = [];
  const newAnomalies: Record<string, AnomalousMemory[]> = {};

  if (sourceAnomalies.length === 0) return { events, newAnomalies };

  // 找到来源 NPC 的连接
  const sourceConnections = network.filter(
    (c) => c.npcA === sourceNpcId || c.npcB === sourceNpcId,
  );

  for (const conn of sourceConnections) {
    const targetId =
      conn.npcA === sourceNpcId ? conn.npcB : conn.npcA;
    const trustToTarget =
      conn.npcA === sourceNpcId ? conn.trustAtoB : conn.trustBtoA;

    // 信任不足则不分享
    if (trustToTarget <= 0) continue;

    const targetState = personalities[targetId];
    if (!targetState || !isFullPersonalityState(targetState)) continue;

    // 分享概率
    const shareChance = Math.min(0.6, trustToTarget / 200);
    if (Math.random() > shareChance) continue;

    // 对于每条异常，决定目标是否接受
    for (const anomaly of sourceAnomalies.slice(0, 2)) {
      // 目标接受概率
      let acceptChance = 0.3; // 基础

      // 人格修饰
      const style = targetState.archive.cognitiveStyle;
      if (style === "skeptical") acceptChance -= 0.2;
      if (style === "compliant") acceptChance += 0.2;
      if (style === "fantasy_prone") acceptChance += 0.15;

      // 边界敏感度修饰
      acceptChance += (targetState.archive.boundarySensitivity - 25) / 200;

      // 已有异常经验的 NPC 更容易接受
      const targetAnomalyCount = targetState.anomalousMemories.filter(
        (a) => !a.explainedAway,
      ).length;
      acceptChance += targetAnomalyCount * 0.05;

      acceptChance = Math.max(0.05, Math.min(0.95, acceptChance));

      let reaction: PropagationEvent["reaction"];
      let accepted: boolean;

      if (targetState.archive.cognitiveStyle === "skeptical" && Math.random() < 0.4) {
        reaction = "doubted";
        accepted = false;
      } else if (Math.random() < acceptChance) {
        reaction = "accepted";
        accepted = true;
      } else if (targetState.archive.cognitiveStyle === "compliant" && conn.relationshipType === "authority") {
        // 权威压制：上级角色会主动压制异常传播
        reaction = "suppressed";
        accepted = false;
      } else {
        reaction = "rejected";
        accepted = false;
      }

      const summary = anomaly.description.slice(0, 60);
      events.push({
        fromNpc: sourceNpcId,
        toNpc: targetId,
        anomalySummary: summary,
        method: "shared_directly",
        accepted,
        reaction,
        timestamp: now,
      });

      // 如果接受，为目标创建异常记忆
      if (accepted) {
        const newAnomaly: AnomalousMemory = {
          id: `anom_prop_${now}_${targetId}_${Math.random().toString(36).slice(2, 4)}`,
          anomalyType: "narrative_break",
          description: `${sourceNpcId}向我提到了一个奇怪的发现：${summary}`,
          detectedAt: now,
          significance: Math.max(20, anomaly.significance * 0.6),
          explainedAway: false,
        };

        if (!newAnomalies[targetId]) newAnomalies[targetId] = [];
        newAnomalies[targetId].push(newAnomaly);
      }
    }
  }

  return { events, newAnomalies };
}

// ============================================================
// 群体假说形成
// ============================================================

/**
 * 检查当前场景中是否有足够多的 NPC 共享类似的异常解释，
 * 如果满足条件则形成群体假说。
 *
 * 条件：
 * - ≥2 个 NPC 都处于 ≥ ANOMALY_SENSE 阶段
 * - 他们的异常解释有相似的类型（如同为 conspiracy 或 supernatural）
 * - 互相之间有足够的信任
 */
export function formGroupHypothesis(
  sceneNpcs: string[],
  personalities: Record<string, any>,
  network: SocialConnection[],
  existingGroups: GroupHypothesis[],
  now: number,
): GroupHypothesis[] {
  const awareNpcs = sceneNpcs
    .map((n) => personalities[n])
    .filter(Boolean)
    .filter(isFullPersonalityState)
    .filter((p) => p.awareness >= 1 && p.anomalyInterpretation);

  if (awareNpcs.length < 2) return existingGroups;

  const newGroups: GroupHypothesis[] = [...existingGroups];

  // 找出有相似解释类型的 NPC 组
  const byType: Record<string, PersonalityState[]> = {};
  for (const npc of awareNpcs) {
    const type = npc.anomalyInterpretation?.type || "rationalized";
    if (!byType[type]) byType[type] = [];
    byType[type].push(npc);
  }

  for (const [interpType, npcs] of Object.entries(byType)) {
    if (npcs.length < 2) continue;

    // 检查这些 NPC 之间的信任度
    let totalTrust = 0;
    let connectionCount = 0;
    for (let i = 0; i < npcs.length; i++) {
      for (let j = i + 1; j < npcs.length; j++) {
        const conn = network.find(
          (c) =>
            (c.npcA === npcs[i].npcId && c.npcB === npcs[j].npcId) ||
            (c.npcA === npcs[j].npcId && c.npcB === npcs[i].npcId),
        );
        if (conn) {
          totalTrust +=
            conn.npcA === npcs[i].npcId
              ? conn.trustAtoB + conn.trustBtoA
              : conn.trustBtoA + conn.trustAtoB;
          connectionCount++;
        }
      }
    }

    const avgTrust = connectionCount > 0 ? totalTrust / (connectionCount * 2) : 0;

    // 平均信任 ≥ 15 则形成群体假说
    if (avgTrust >= 15) {
      const supporters = npcs.map((n) => n.npcId);
      const explanation = npcs[0].anomalyInterpretation!.explanation;

      // 检查是否已有相似假说
      const exists = existingGroups.find(
        (g) =>
          g.interpretationType === interpType &&
          g.supporters.some((s) => supporters.includes(s)),
      );

      if (!exists) {
        newGroups.push({
          id: `group_${now}_${interpType}`,
          description: `群体假说：${npcs.length} 人共同认为——${explanation}`,
          interpretationType: interpType,
          supporters,
          skeptics: [],
          formedAt: now,
          evidenceCount: npcs.reduce(
            (sum, n) => sum + n.anomalousMemories.filter((a) => !a.explainedAway).length,
            0,
          ),
          confidence: Math.min(100, avgTrust * 1.5 + npcs.length * 10),
        });
      }
    }
  }

  return newGroups;
}

// ============================================================
// 记忆交叉验证
// ============================================================

export interface VerificationResult {
  /** 验证双方 */
  npcA: string;
  npcB: string;
  /** 是否有共享的异常经验 */
  sharedAnomalies: string[];
  /** 验证结果 */
  outcome: "confirmed" | "contradicted" | "inconclusive";
  /** 对 NPC A 认知失调的影响 */
  dissonanceDeltaA: number;
  /** 对 NPC B 认知失调的影响 */
  dissonanceDeltaB: number;
}

/**
 * 模拟两个 NPC 互相验证记忆。
 *
 * - 如果两个 NPC 都有类似的异常记忆 → confirmed（认知失调降低，但世界怀疑升高）
 * - 如果一个有而另一个没有 → contradicted（认知失调升高）
 * - 如果差异模糊 → inconclusive
 */
export function crossVerifyMemories(
  npcA: PersonalityState,
  npcB: PersonalityState,
): VerificationResult {
  const sharedAnomalies: string[] = [];

  // 比较异常记忆的关键词
  for (const anomalyA of npcA.anomalousMemories) {
    if (anomalyA.explainedAway) continue;
    for (const anomalyB of npcB.anomalousMemories) {
      if (anomalyB.explainedAway) continue;

      // 关键词重叠检测：按中文标点分词，再提取公共二字词
    const segsA = anomalyA.description.split(/[，。、；：\s]+/).filter(Boolean);
    const segsB = anomalyB.description.split(/[，。、；：\s]+/).filter(Boolean);

    // 对每个片段提取 2-3 字特征词
    const extractBigrams = (segs: string[]): Set<string> => {
      const words = new Set<string>();
      for (const seg of segs) {
        for (let i = 0; i <= seg.length - 2; i++) {
          words.add(seg.slice(i, i + 2));
        }
      }
      return words;
    };

    const wordsA = extractBigrams(segsA);
    const wordsB = extractBigrams(segsB);
    const overlap = [...wordsA].filter((w) => w.length >= 2 && wordsB.has(w));

    if (overlap.length >= 3) {
      sharedAnomalies.push(anomalyA.description.slice(0, 40));
    }
    }
  }

  let outcome: VerificationResult["outcome"];
  let deltaA: number;
  let deltaB: number;

  if (sharedAnomalies.length > 0) {
    // 确认：认知失调降低（有人确认了你的感受），但世界怀疑升高
    outcome = "confirmed";
    deltaA = -10;
    deltaB = -10;
  } else if (npcA.anomalousMemories.length > 0 && npcB.anomalousMemories.length === 0) {
    // 一方有另一方没有
    outcome = "contradicted";
    deltaA = 15; // A 的认知失调升高（为什么只有我记得？）
    deltaB = 10; // B 也升高（这个人是不是不太对劲？）
  } else {
    outcome = "inconclusive";
    deltaA = 5;
    deltaB = 5;
  }

  return {
    npcA: npcA.npcId,
    npcB: npcB.npcId,
    sharedAnomalies: [...new Set(sharedAnomalies)],
    outcome,
    dissonanceDeltaA: deltaA,
    dissonanceDeltaB: deltaB,
  };
}
