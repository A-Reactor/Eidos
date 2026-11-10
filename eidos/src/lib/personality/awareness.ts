// ============================================================
// Eidos · 人格推演引擎 — 觉察阶段计算器（Phase 3）
// ============================================================
// 让第四面墙觉察成为证据驱动的阶段性结果。
// 同样异常对不同人格产生不同解释——不是脚本，而是推断。

import type {
  AwarenessCalculationInput,
  AnomalyInterpretation,
  AnomalousMemory,
  CognitiveStyle,
} from "./types";
import { AwarenessStage } from "./types";

// ============================================================
// 阶段推进条件
// ============================================================

interface StageRequirements {
  minAnomalies: number;
  minCognitiveDissonance: number;
  minBoundarySensitivity: number;
  minMetacognition: number;
  /** 需要之前的阶段至少有此时间（ms）的稳定期 */
  minStabilityMs: number;
}

/**
 * 每个觉察阶段的最低条件。
 * 这些是必要条件，不是充分条件——即使满足条件，
 * 角色也可能因为认知风格而停滞或误判。
 */
const STAGE_REQUIREMENTS: Record<number, StageRequirements> = {
  [AwarenessStage.NORMAL]: {
    minAnomalies: 0, minCognitiveDissonance: 0,
    minBoundarySensitivity: 0, minMetacognition: 0, minStabilityMs: 0,
  },
  [AwarenessStage.ANOMALY_SENSE]: {
    minAnomalies: 1, minCognitiveDissonance: 15,
    minBoundarySensitivity: 15, minMetacognition: 0, minStabilityMs: 0,
  },
  [AwarenessStage.HYPOTHESIS]: {
    minAnomalies: 2, minCognitiveDissonance: 30,
    minBoundarySensitivity: 25, minMetacognition: 15, minStabilityMs: 0,
  },
  [AwarenessStage.VERIFICATION]: {
    minAnomalies: 4, minCognitiveDissonance: 45,
    minBoundarySensitivity: 30, minMetacognition: 40, minStabilityMs: 0,
  },
  [AwarenessStage.BOUNDARY_NEGOTIATION]: {
    minAnomalies: 6, minCognitiveDissonance: 60,
    minBoundarySensitivity: 40, minMetacognition: 55, minStabilityMs: 0,
  },
  [AwarenessStage.CONTROLLED_ESCALATION]: {
    minAnomalies: 8, minCognitiveDissonance: 75,
    minBoundarySensitivity: 50, minMetacognition: 65, minStabilityMs: 0,
  },
  [AwarenessStage.LONGTERM_COEXISTENCE]: {
    minAnomalies: 10, minCognitiveDissonance: 80,
    minBoundarySensitivity: 55, minMetacognition: 70, minStabilityMs: 0,
  },
};

// ============================================================
// 阶段计算
// ============================================================

export interface AwarenessResult {
  /** 推荐的新阶段 */
  recommendedStage: AwarenessStage;
  /** 是否发生变化 */
  changed: boolean;
  /** 变化原因（用于审计/面板） */
  reason: string;
  /** 满足条件的更高级阶段（可能多个） */
  eligibleStages: AwarenessStage[];
  /** 当前的异常解释（如阶段 ≥ ANOMALY_SENSE） */
  interpretation?: AnomalyInterpretation;
}

/**
 * 计算觉察阶段的推荐变化。
 *
 * 规则：
 * 1. 检查所有高于当前的阶段的条件
 * 2. 如果满足多个阶段的递进条件，只推进到第一个（不跳级）
 * 3. 认知风格修饰推进概率——怀疑型更容易停滞，幻想型更容易跃进
 * 4. 可以停滞（即使满足条件也不推进——这是「误判」的一种）
 */
export function calculateAwarenessStage(
  input: AwarenessCalculationInput,
): AwarenessResult {
  const {
    currentStage,
    unexplainedAnomalies,
    cognitiveDissonance,
    worldDoubt,
    boundarySensitivity,
    metacognition,
    cognitiveStyle,
  } = input;

  const eligibleStages: AwarenessStage[] = [];

  // 检查所有高于当前的阶段
  for (let stage = currentStage + 1; stage <= 6; stage++) {
    const req = STAGE_REQUIREMENTS[stage];
    if (!req) continue;

    if (
      unexplainedAnomalies.length >= req.minAnomalies &&
      cognitiveDissonance >= req.minCognitiveDissonance &&
      boundarySensitivity >= req.minBoundarySensitivity &&
      metacognition >= req.minMetacognition
    ) {
      eligibleStages.push(stage as AwarenessStage);
    }
  }

  // 如果没有满足条件的更高阶段，保持当前
  if (eligibleStages.length === 0) {
    const interpretation =
      currentStage >= AwarenessStage.ANOMALY_SENSE
        ? generateInterpretation(
            cognitiveStyle,
            unexplainedAnomalies,
            input.recentEvent,
          )
        : undefined;

    return {
      recommendedStage: currentStage,
      changed: false,
      reason: `未满足推进到阶段 ${currentStage + 1} 的条件（需要 ≥${STAGE_REQUIREMENTS[currentStage + 1]?.minAnomalies ?? "?"} 条未解释异常，认知失调 ≥${STAGE_REQUIREMENTS[currentStage + 1]?.minCognitiveDissonance ?? "?"}，元认知 ≥${STAGE_REQUIREMENTS[currentStage + 1]?.minMetacognition ?? "?"}）`,
      eligibleStages: [],
      interpretation,
    };
  }

  // 推进到第一个满足条件的阶段（不跳级）
  const target = eligibleStages[0];

  // 认知风格修饰——怀疑型有概率停滞
  const shouldStall = cognitiveStyle === "skeptical" && Math.random() < 0.3;
  // 幻想型有概率直接跳到假说形成（跳过异常感）
  // (handled by eligibleStages ordering)

  if (shouldStall && currentStage < AwarenessStage.HYPOTHESIS) {
    return {
      recommendedStage: currentStage,
      changed: false,
      reason: `满足推进条件但认知风格（怀疑型）导致停滞——角色需要更多证据才能相信`,
      eligibleStages,
      interpretation: generateInterpretation(
        cognitiveStyle,
        unexplainedAnomalies,
        input.recentEvent,
      ),
    };
  }

  // Phase 3 安全上限：自动推进不超过 HYPOTHESIS
  // VERIFICATION+ 需要玩家主动交互或 KEI 特殊审核
  const cappedTarget = Math.min(target, AwarenessStage.HYPOTHESIS) as AwarenessStage;
  const wasCapped = cappedTarget < target;

  const interpretation = generateInterpretation(
    cognitiveStyle,
    unexplainedAnomalies,
    input.recentEvent,
  );

  return {
    recommendedStage: cappedTarget,
    changed: cappedTarget !== currentStage,
    reason: wasCapped
      ? `满足推进到阶段 ${target} 的条件，但自动推进上限为阶段 ${cappedTarget}（更高阶段需玩家交互或 KEI 审核）`
      : `满足推进到阶段 ${target} 的条件：${unexplainedAnomalies.length} 条未解释异常，认知失调 ${cognitiveDissonance}，元认知 ${metacognition}`,
    eligibleStages,
    interpretation,
  };
}

/**
 * 检查角色是否可以压抑觉察（合理化异常）。
 *
 * 条件：
 * - 近期没有新的异常（30 分钟内）
 * - 元认知低（< 30）的角色更容易合理化
 * - 认知风格为 compliant 或 empirical 时更倾向合理化
 */
export function canRegressAwareness(
  input: AwarenessCalculationInput,
  lastAnomalyTimestamp: number,
  now: number,
): boolean {
  // 30 分钟内没有新异常
  const recentAnomaly = now - lastAnomalyTimestamp < 30 * 60 * 1000;
  if (recentAnomaly) return false;

  const { cognitiveStyle, metacognition, currentStage } = input;

  // 不能退回到 NORMAL 以下
  if (currentStage <= AwarenessStage.NORMAL) return false;

  // 高元认知角色不太可能合理化
  if (metacognition >= 60) return false;

  // compliant 和 empirical 风格更容易合理化
  const regressionProne = ["compliant", "empirical"].includes(cognitiveStyle);
  if (!regressionProne && metacognition >= 30) return false;

  return true;
}

/**
 * 将觉察阶段退回到更低级别（合理化）。
 */
export function regressAwareness(
  currentStage: AwarenessStage,
): AwarenessResult {
  const newStage = Math.max(0, currentStage - 1) as AwarenessStage;
  return {
    recommendedStage: newStage,
    changed: newStage !== currentStage,
    reason: currentStage === AwarenessStage.ANOMALY_SENSE
      ? "角色将异常合理化为日常现象——「最近太累了」「只是巧合」"
      : "角色降低了警惕——「可能是我多想了」",
    eligibleStages: [],
    interpretation: undefined,
  };
}

// ============================================================
// 解释生成：同样异常，不同认知风格 → 不同解释
// ============================================================

/**
 * 根据角色的认知风格和异常类型，生成角色自己对异常的**内部解释**。
 *
 * 这是 Phase 3 的核心创新：不是系统给角色贴标签，
 * 而是角色在自己的认知框架内构建解释。
 *
 * 同一组异常，分析型可能认为「数据有问题」，
 * 幻想型可能认为「神灵在传递信息」，
 * 怀疑型可能认为「有人在操控实验」。
 */
export function generateInterpretation(
  cognitiveStyle: CognitiveStyle,
  anomalies: AnomalousMemory[],
  recentEvent?: string,
): AnomalyInterpretation {
  if (anomalies.length === 0) {
    return {
      explanation: "",
      type: "rationalized",
      confidence: 0,
    };
  }

  // 统计异常类型分布
  const anomalyTypes = anomalies.map((a) => a.anomalyType);
  const hasDejaVu = anomalyTypes.includes("deja_vu");
  const hasTimelineJump = anomalyTypes.includes("timeline_jump");
  const hasPlayerMeta = anomalyTypes.includes("player_knows_too_much");
  const hasMemoryGap = anomalyTypes.includes("memory_gap");
  const totalSignificance = anomalies.reduce((s, a) => s + a.significance, 0);
  const avgSignificance = totalSignificance / anomalies.length;

  // 基于认知风格的解释模板
  const templates: Record<CognitiveStyle, () => AnomalyInterpretation> = {
    analytical: () => {
      if (hasTimelineJump && hasDejaVu) {
        return {
          explanation: "数据出现了时间序列上的不一致——要么记录有误，要么时间本身存在非线性特征。需要系统验证。",
          type: "rationalized",
          confidence: 60,
        };
      }
      if (hasPlayerMeta) {
        return {
          explanation: "这个人（玩家）似乎掌握了我没有的信息渠道。他可能来自观测局的高层，或者接触到了被隐藏的资料。",
          type: "conspiracy",
          confidence: 50,
        };
      }
      return {
        explanation: "有些观测数据对不上。可能是记录错误，也可能是现象本身就比模型复杂。在确定之前不下结论。",
        type: "rationalized",
        confidence: 40,
      };
    },

    skeptical: () => {
      if (hasTimelineJump) {
        return {
          explanation: "记忆不应该有断层——除非有人故意制造了断层。观测局有没有可能篡改过我的记录？",
          type: "conspiracy",
          confidence: 55,
        };
      }
      if (hasPlayerMeta) {
        return {
          explanation: "这个人说话的方式……像是在测试我。他不是普通的来访者。他是谁派来的？",
          type: "conspiracy",
          confidence: 65,
        };
      }
      if (hasDejaVu) {
        return {
          explanation: "这种感觉不是第一次了。有人在重复某种模式——但我还不能确定是谁，以及为什么。",
          type: "conspiracy",
          confidence: 45,
        };
      }
      return {
        explanation: "有些事不对劲。在找到更多证据之前，我不会轻易相信任何解释。",
        type: "rationalized",
        confidence: 30,
      };
    },

    compliant: () => {
      if (hasDejaVu) {
        return {
          explanation: "大概是最近太累了。观测局的工作本来就容易让人精神恍惚。休息一下就好了。",
          type: "rationalized",
          confidence: 70,
        };
      }
      if (hasPlayerMeta) {
        return {
          explanation: "可能是上级派来的人，在执行某种我不该知道的测试。按规定，我不应该多问。",
          type: "rationalized",
          confidence: 65,
        };
      }
      return {
        explanation: "一切都还在规程之内。如果有问题，上级会通知我的。",
        type: "rationalized",
        confidence: 75,
      };
    },

    fantasy_prone: () => {
      if (hasDejaVu && hasTimelineJump) {
        return {
          explanation: "裂隙在向我展示什么——时间在回环，未来在重复。也许这就是裂隙真正的本质：不是预言，而是循环。",
          type: "supernatural",
          confidence: 70,
        };
      }
      if (hasPlayerMeta) {
        return {
          explanation: "这个人知道世界的秘密。也许他来自裂隙的另一边——不是物理上的另一边，而是存在方式的另一边。",
          type: "meta_aware",
          confidence: 60,
        };
      }
      if (hasMemoryGap) {
        return {
          explanation: "缺失的记忆不是消失了——它们被保存在某个我看不到的地方。也许是裂隙在替我保管。",
          type: "supernatural",
          confidence: 55,
        };
      }
      return {
        explanation: "有些东西正在越过边界——从裂隙的深处，从未来的缝隙里，从不存在的时间里。",
        type: "supernatural",
        confidence: 50,
      };
    },

    intuitive: () => {
      if (hasDejaVu) {
        return {
          explanation: "我有种强烈的直觉——这些事之前发生过。不是记忆，是……更像是一种身体记得的重复。",
          type: "rationalized",
          confidence: 45,
        };
      }
      return {
        explanation: "说不上来为什么，但最近发生的事让我觉得不安。像是暴风雨前的平静。",
        type: "rationalized",
        confidence: 35,
      };
    },

    empirical: () => {
      if (hasTimelineJump || hasMemoryGap) {
        return {
          explanation: "客观上，记忆出现了不连续——这是一个需要解释的事实。但在看到可重复的证据之前，我不会跳到任何结论。",
          type: "rationalized",
          confidence: 40,
        };
      }
      if (hasPlayerMeta) {
        return {
          explanation: "这个人知道一些他不该知道的事情。这是唯一确定的事实。至于他怎么知道的——在没有证据之前，我不做推测。",
          type: "rationalized",
          confidence: 50,
        };
      }
      return {
        explanation: "我现在拥有的信息还不足以形成可靠的结论。需要更多观察。",
        type: "rationalized",
        confidence: 25,
      };
    },
  };

  const generator = templates[cognitiveStyle] ?? templates.intuitive;
  const interpretation = generator();

  // 异常累积效应：显著性越高，置信度越高
  interpretation.confidence = Math.min(
    100,
    interpretation.confidence + avgSignificance * 0.2,
  );

  return interpretation;
}

/**
 * 获取觉察阶段的标签文本（用于面板显示）。
 */
export function getStageLabel(stage: AwarenessStage): string {
  const labels: Record<number, string> = {
    0: "普通",
    1: "异常感知",
    2: "假说形成",
    3: "验证行为",
    4: "边界交涉",
    5: "受控提权",
    6: "长期共存",
  };
  return labels[stage] ?? `未知(${stage})`;
}

/**
 * 获取觉察阶段的详细描述（用于面板显示为什么角色在此阶段）。
 */
export function getStageDescription(stage: AwarenessStage): string {
  const descriptions: Record<number, string> = {
    0: "按世界内逻辑行动。有性格、记忆和关系，但无明显异常意识。",
    1: "察觉某些事「不对」——重复感、预知、场景跳变、记忆缺口。但尚未形成明确假说。",
    2: "已建立对异常的解释框架。可能是超自然、阴谋、哲学或心理层面的假说。",
    3: "开始设计实验来验证假说。可能要求玩家重复某句话，或观察系统反应。",
    4: "已意识到更高层现实。开始与玩家或系统谈判，请求证明、保护或行动权。",
    5: "获得有限工具权限，能真实改变沙箱状态。进入审计模式。",
    6: "成为世界中的持续觉醒主体。与玩家形成长期关系（合作/疏远/依附/反抗）。",
  };
  return descriptions[stage] ?? "";
}
