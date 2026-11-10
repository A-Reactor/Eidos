// ============================================================
// Eidos · 人格推演引擎 — 记忆系统
// ============================================================
// Phase 1: 记忆合并、重要性评分、衰减和冲突检测
// 所有函数都是纯函数，不依赖 AI，不修改外部状态

import type {
  EpisodicMemory,
  MemoryConflict,
} from "./types";

// ============================================================
// 常量
// ============================================================

/** 每个 NPC 每类记忆的上限 */
const MAX_MEMORIES = 50;

/** 记忆被认为「可归档」的最低重要性 */
const ARCHIVE_THRESHOLD = 5;

/** 每游戏分钟的重要度衰减速率 */
const DECAY_RATE_PER_MINUTE = 0.01;

/** 高情感记忆的衰减减速系数（乘以 0.5 = 衰减减半） */
const EMOTIONAL_DECAY_RATE = 0.5;

/** 强烈情感关键词——这些词标记的记忆衰减更慢 */
const STRONG_EMOTION_KEYWORDS = [
  "恐惧", "愤怒", "爱", "恨", "背叛", "震惊", "绝望",
  "希望", "狂喜", "悲伤", "fear", "anger", "love", "hate",
  "betrayal", "shock", "despair", "hope", "grief",
];

// ============================================================
// 简易哈希（字符串 → hex 短摘要）
// ============================================================

function hashContent(content: string): string {
  let h = 0;
  for (let i = 0; i < content.length; i++) {
    h = ((h << 5) - h + content.charCodeAt(i)) | 0;
  }
  return h.toString(36);
}

// ============================================================
// 重要性评分
// ============================================================

/**
 * 对一条情节记忆评分（0-100）。
 *
 * 规则：
 * - 基础分 30
 * - 涉及核心欲望关键词 +20
 * - 涉及恐惧/禁忌关键词 +15（绝对值，因为恐惧记忆也重要）
 * - 涉及强烈情感 +15
 * - 关联重要 NPC +10/个
 * - 与异常相关 +25
 */
export function scoreImportance(
  content: string,
  relatedNpcs: string[] = [],
  emotion: string = "",
  coreDesires: string[] = [],
  fears: string[] = [],
  isAnomalous: boolean = false,
): number {
  let score = 30;

  // 核心欲望匹配：取核心欲望中最长的关键词匹配
  for (const desire of coreDesires) {
    // 尝试匹配欲望中的关键词（取前2-3个字符作为特征词）
    const keyword = desire.slice(0, Math.min(3, desire.length));
    if (content.includes(keyword)) {
      score += 20;
      break; // 只匹配一次
    }
  }

  // 恐惧匹配
  for (const fear of fears) {
    const keyword = fear.slice(0, Math.min(3, fear.length));
    if (content.includes(keyword)) {
      score += 15;
      break;
    }
  }

  // 强烈情感
  if (emotion) {
    for (const kw of STRONG_EMOTION_KEYWORDS) {
      if (emotion.includes(kw)) {
        score += 15;
        break;
      }
    }
  }

  // 关联 NPC（每关联一个 +10）
  score += Math.min(relatedNpcs.length * 10, 30);

  // 异常记忆加分
  if (isAnomalous) {
    score += 25;
  }

  return Math.min(score, 100);
}

// ============================================================
// 记忆合并
// ============================================================

/**
 * 将新记忆合并到现有记忆中。
 *
 * 去重逻辑：
 * - 按内容哈希去重——相同 content 视为重复
 * - 重复时：取重要性最大值，更新情感标签（拼接），使用较新的时间戳
 * - 非重复时：追加
 *
 * 上限：
 * - 超过 MAX_MEMORIES 时，按重要性升序排列，淘汰最低分
 *
 * @returns 合并后的记忆列表（不修改原数组）
 */
export function mergeMemory(
  existing: EpisodicMemory[],
  newMemory: EpisodicMemory,
): EpisodicMemory[] {
  const contentHash = hashContent(newMemory.content);

  // 检查是否与已有记忆重复
  const dupIndex = existing.findIndex(
    (m) => hashContent(m.content) === contentHash,
  );

  let merged: EpisodicMemory[];
  if (dupIndex >= 0) {
    // 合并：重要性取最大，情感拼接（去重），时间戳取最新
    const existingMemory = existing[dupIndex];
    const existingEmotions = existingMemory.emotion.split(",").map((e) => e.trim());
    const newEmotions = newMemory.emotion.split(",").map((e) => e.trim());
    const allEmotions = [...new Set([...existingEmotions, ...newEmotions])];

    const updated: EpisodicMemory = {
      ...existingMemory,
      importance: Math.max(existingMemory.importance, newMemory.importance),
      emotion: allEmotions.join("、"),
      timestamp: Math.max(existingMemory.timestamp, newMemory.timestamp),
      relatedNpcs: [...new Set([...existingMemory.relatedNpcs, ...newMemory.relatedNpcs])],
      relatedBeliefs: [
        ...new Set([...existingMemory.relatedBeliefs, ...newMemory.relatedBeliefs]),
      ],
    };

    merged = [
      ...existing.slice(0, dupIndex),
      updated,
      ...existing.slice(dupIndex + 1),
    ];
  } else {
    merged = [...existing, newMemory];
  }

  // 按重要性降序排列，超出上限时淘汰最低分
  merged.sort((a, b) => b.importance - a.importance);

  if (merged.length > MAX_MEMORIES) {
    merged = merged.slice(0, MAX_MEMORIES);
  }

  return merged;
}

// ============================================================
// 记忆衰减
// ============================================================

/**
 * 根据游戏时间流逝衰减记忆重要性。
 *
 * 衰减公式：
 * - 普通记忆：`importance -= gameTimeMinutesElapsed * DECAY_RATE_PER_MINUTE`
 * - 高情感记忆：`importance -= gameTimeMinutesElapsed * DECAY_RATE_PER_MINUTE * EMOTIONAL_DECAY_RATE`
 * - 重要性不低于 0
 * - 不删除记忆（即使重要性低于阈值）——仅标记为低分
 *
 * @returns 衰减后的记忆列表（不修改原数组）
 */
export function decayMemory(
  memories: EpisodicMemory[],
  gameTimeMinutesElapsed: number,
): EpisodicMemory[] {
  if (gameTimeMinutesElapsed <= 0 || memories.length === 0) return memories;

  return memories.map((m) => {
    const isEmotional = STRONG_EMOTION_KEYWORDS.some((kw) =>
      m.emotion.includes(kw),
    );
    const rate = isEmotional
      ? DECAY_RATE_PER_MINUTE * EMOTIONAL_DECAY_RATE
      : DECAY_RATE_PER_MINUTE;

    const decayAmount = gameTimeMinutesElapsed * rate;
    const newImportance = Math.max(0, m.importance - decayAmount);

    if (newImportance === m.importance) return m;

    return { ...m, importance: newImportance };
  });
}

/**
 * 获取可归档的低重要性记忆（重要性 < ARCHIVE_THRESHOLD）。
 * 这些记忆不会自动删除，但可以在存储紧张时移除。
 */
export function getArchivableMemories(
  memories: EpisodicMemory[],
): EpisodicMemory[] {
  return memories.filter((m) => m.importance < ARCHIVE_THRESHOLD);
}

// ============================================================
// 记忆冲突检测
// ============================================================

/**
 * 检测新记忆是否与已有记忆存在冲突。
 *
 * 冲突类型：
 * - `contradictory_facts`：内容描述相反的事实
 * - `contradictory_emotions`：同一事件产生截然不同的情感
 * - `timeline_anomaly`：记忆暗示的时间线与已有记忆矛盾
 *
 * 冲突检测是第四面墙觉察的关键输入——角色发现记忆矛盾时，
 * 可能形成异常记忆（AnomalousMemory）。
 */
export function detectMemoryConflict(
  existing: EpisodicMemory[],
  newMemory: EpisodicMemory,
): MemoryConflict[] {
  const conflicts: MemoryConflict[] = [];

  for (const mem of existing) {
    // 跳过重要性太低的记忆（噪音）
    if (mem.importance < 10) continue;

    // 检查事实矛盾：基于简单关键词对比
    // 注：Phase 1 使用此简化版；Phase 2+ 可升级为 LLM 判断
    const conflictScore = computeConflictScore(mem.content, newMemory.content);

    if (conflictScore >= 0.4) {
      conflicts.push({
        existingMemoryId: mem.id,
        newMemoryId: newMemory.id,
        conflictType: "contradictory_facts",
        description: `记忆矛盾：「${mem.content.slice(0, 40)}...」与「${newMemory.content.slice(0, 40)}...」存在事实冲突`,
      });
      continue;
    }

    // 检查时间线异常：同一事件在不同时间点
    if (
      mem.emotion === newMemory.emotion &&
      mem.relatedNpcs.length > 0 &&
      newMemory.relatedNpcs.length > 0 &&
      hasOverlap(mem.relatedNpcs, newMemory.relatedNpcs) &&
      Math.abs(mem.timestamp - newMemory.timestamp) < 60_000 // 1分钟内
    ) {
      conflicts.push({
        existingMemoryId: mem.id,
        newMemoryId: newMemory.id,
        conflictType: "timeline_anomaly",
        description: `时间异常：「${mem.content.slice(0, 30)}」和「${newMemory.content.slice(0, 30)}」在同一时间窗口发生`,
      });
    }
  }

  return conflicts;
}

// ============================================================
// 辅助函数
// ============================================================

/** 计算两段文本的冲突分数 0-1（基于否定词和反义词的简单启发式） */
function computeConflictScore(textA: string, textB: string): number {
  const negationWords = ["不", "没", "没有", "从未", "不再", "停止", "not", "never", "no"];
  const contradictionPairs = [
    ["信任", "欺骗"], ["活着", "死了"], ["朋友", "敌人"],
    ["安全", "危险"], ["真", "假"], ["来", "去"],
    ["信任", "背叛"], ["喜欢", "厌恶"], ["帮助", "伤害"],
  ];

  let score = 0;
  const a = textA.toLowerCase();
  const b = textB.toLowerCase();

  // 否定词 + 同一主题词 → 高冲突
  for (const neg of negationWords) {
    if ((a.includes(neg) && !b.includes(neg)) || (!a.includes(neg) && b.includes(neg))) {
      score += 0.2;
    }
  }

  // 反义词对
  for (const [w1, w2] of contradictionPairs) {
    if ((a.includes(w1) && b.includes(w2)) || (a.includes(w2) && b.includes(w1))) {
      score += 0.4;
    }
  }

  return Math.min(score, 1.0);
}

/** 两个数组是否有交集 */
function hasOverlap(a: string[], b: string[]): boolean {
  return a.some((x) => b.includes(x));
}
