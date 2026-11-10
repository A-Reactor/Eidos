// ============================================================
// Eidos · 人格推演引擎 — 异常检测
// ============================================================
// Phase 2: 检测可能触发异常记忆的世界事件。
// 所有检测都是确定性代码——基于玩家行为模式、WorldLine 状态和记忆对比。

import type { AnomalousMemory } from "./types";
import type { WorldLineSummary } from "@/lib/ai/context-builder";

// ============================================================
// 异常检测输入
// ============================================================

export interface AnomalyDetectionInput {
  /** 当前玩家输入文本 */
  playerInput: string;
  /** NPC 当前人格状态的所有情节记忆 */
  episodicMemories: Array<{ id: string; content: string; timestamp: number }>;
  /** WorldLine 树摘要（含兄弟分支信息） */
  worldLineSummary?: WorldLineSummary;
  /** 当前行动是否是回档后的重试（通过 WorldLine 检测） */
  isWorldLineBacktrack?: boolean;
  /** 玩家是否做出了超越世界规则的行为 */
  playerInputIsMetagaming?: boolean;
  /** 当前时间戳 */
  now: number;
}

// ============================================================
// 检测函数
// ============================================================

/**
 * 检测本轮是否应触发异常记忆。
 *
 * 返回新检测到的异常记忆列表（可能为空）。
 * 这些异常记忆会存入 NPC 的 anomalousMemories 数组，
 * 累积到一定数量后可能触发觉察阶段推进。
 */
export function detectAnomalies(
  input: AnomalyDetectionInput,
): AnomalousMemory[] {
  const anomalies: AnomalousMemory[] = [];
  const { playerInput, episodicMemories, worldLineSummary, now } = input;

  // 1. 似曾相识检测：WorldLine 有兄弟分支 → 暗示这是重复/回档
  if (worldLineSummary && worldLineSummary.siblingBranches.length > 0) {
    anomalies.push({
      id: `anom_dejavu_${now}`,
      anomalyType: "deja_vu",
      description: `感觉到某种重复——似乎这个选择之前已经做过，但记不清具体是什么`,
      detectedAt: now,
      significance: 40 + worldLineSummary.siblingBranches.length * 10,
      explainedAway: false,
    });
  }

  // 2. 回档检测：玩家明确回档
  if (input.isWorldLineBacktrack) {
    anomalies.push({
      id: `anom_backtrack_${now}`,
      anomalyType: "timeline_jump",
      description: `世界似乎重置了——记忆中有之前发生过但现在「从未发生」的事`,
      detectedAt: now,
      significance: 60,
      explainedAway: false,
    });
  }

  // 3. 玩家越界发言检测：玩家说出的内容包含「系统」「存档」「游戏」等元词汇
  if (detectMetagaming(playerInput) || input.playerInputIsMetagaming) {
    anomalies.push({
      id: `anom_meta_${now}`,
      anomalyType: "player_knows_too_much",
      description: `玩家说出了不该知道的事——像是来自世界之外的词汇`,
      detectedAt: now,
      significance: 55,
      explainedAway: false,
    });
  }

  // 4. 叙事断裂检测：最近记忆中有互相矛盾的描述
  if (episodicMemories.length >= 3) {
    const recent = episodicMemories.slice(-3);
    // 检查最近的记忆是否有时间线不连续感
    const timeJumps = detectMemoryGap(recent);
    if (timeJumps) {
      anomalies.push({
        id: `anom_gap_${now}`,
        anomalyType: "memory_gap",
        description: `记忆似乎有不连续的地方——有些事情的发生顺序不对`,
        detectedAt: now,
        significance: 35,
        explainedAway: false,
      });
    }
  }

  return anomalies;
}

// ============================================================
// 辅助检测函数
// ============================================================

/**
 * 检测玩家输入是否包含「元游戏」词汇。
 *
 * 这些词汇暗示玩家知道这是一个游戏/模拟：
 * - 直接元词汇：存档、读档、回档、重来、选项、系统、代码
 * - 间接元词汇：上一次、重新来过、回到那个时间点
 *
 * 注意：此检测限于玩家明确越界的发言，不检测正常对话。
 */
function detectMetagaming(input: string): boolean {
  const metaKeywords = [
    "存档", "读档", "回档", "重来一次", "重开",
    "系统", "代码", "程序", "游戏", "模拟",
    "回到之前", "重新来过", "再来一次",
    "save", "load", "reset", "restart", "reload",
  ];

  const lower = input.toLowerCase();
  return metaKeywords.some((kw) => lower.includes(kw));
}

/**
 * 检测近期记忆中是否存在时间线不连续。
 *
 * 启发式：如果连续 3 条记忆的时间戳存在大幅跳跃
 * （时间不递增或跳跃过大），标记为记忆缺口。
 */
function detectMemoryGap(
  recentMemories: Array<{ content: string; timestamp: number }>,
): boolean {
  if (recentMemories.length < 2) return false;

  // 时间戳应递增。如果后面的记忆时间戳比前面早，说明时间线有问题
  for (let i = 1; i < recentMemories.length; i++) {
    if (recentMemories[i].timestamp < recentMemories[i - 1].timestamp) {
      return true;
    }
  }

  return false;
}

// ============================================================
// Phase 3 扩展：更多异常类型
// ============================================================

export interface ExtendedAnomalyInput extends AnomalyDetectionInput {
  /** 玩家是否说出了 NPC 尚未透露的信息（预知） */
  playerHasPreknowledge?: boolean;
  /** 场景状态是否被非物理方式改变 */
  sceneStateRewritten?: boolean;
  /** NPC 之间是否有互相矛盾的叙述 */
  npcsContradicting?: Array<{ npcA: string; npcB: string; topic: string }>;
}

/**
 * Phase 3 扩展检测：在 Phase 2 的四类异常基础上，
 * 增加预知、场景改写和叙事矛盾检测。
 */
export function detectExtendedAnomalies(
  input: ExtendedAnomalyInput,
): AnomalousMemory[] {
  const base = detectAnomalies(input);
  const { now } = input;
  const extended: AnomalousMemory[] = [...base];

  // 5. 预知检测：玩家说出了 NPC 尚未透露的信息
  if (input.playerHasPreknowledge) {
    extended.push({
      id: `anom_preknow_${now}`,
      anomalyType: "player_knows_too_much",
      description: `玩家说出了尚未公开的信息——他不应该知道这个`,
      detectedAt: now,
      significance: 50,
      explainedAway: false,
    });
  }

  // 6. 场景状态非物理改写
  if (input.sceneStateRewritten) {
    extended.push({
      id: `anom_rewrite_${now}`,
      anomalyType: "narrative_break",
      description: `场景状态被非物理方式改变——世界的规则似乎不是绝对的`,
      detectedAt: now,
      significance: 65,
      explainedAway: false,
    });
  }

  // 7. NPC 之间叙事矛盾
  if (input.npcsContradicting && input.npcsContradicting.length > 0) {
    for (const c of input.npcsContradicting) {
      extended.push({
        id: `anom_narrcon_${now}_${c.npcA}_${c.npcB}`,
        anomalyType: "narrative_break",
        description: `${c.npcA}和${c.npcB}关于「${c.topic}」的叙述互相矛盾`,
        detectedAt: now,
        significance: 45,
        explainedAway: false,
      });
    }
  }

  return extended;
}

/**
 * 对异常列表执行合理化检查。
 * 如果角色认知风格为 compliant/empirical 且元认知低，
 * 会尝试将异常「解释掉」。
 *
 * @returns 更新后的异常列表（部分可能被标记为 explainedAway）
 */
export function rationalizeAnomalies(
  anomalies: AnomalousMemory[],
  cognitiveStyle: string,
  metacognition: number,
): AnomalousMemory[] {
  // 只有 compliant/empirical + 低元认知才会主动合理化
  const shouldRationalize =
    ["compliant", "empirical"].includes(cognitiveStyle) && metacognition < 30;

  if (!shouldRationalize) return anomalies;

  return anomalies.map((a) => {
    // 低显著性异常更可能被合理化
    if (!a.explainedAway && a.significance < 40 && Math.random() < 0.4) {
      return { ...a, explainedAway: true };
    }
    return a;
  });
}
