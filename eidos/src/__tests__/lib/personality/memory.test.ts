// ============================================================
// 人格推演引擎 — 记忆系统测试
// ============================================================

import { describe, it, expect } from "vitest";
import {
  mergeMemory,
  scoreImportance,
  decayMemory,
  detectMemoryConflict,
  getArchivableMemories,
} from "@/lib/personality/memory";
import type { EpisodicMemory } from "@/lib/personality/types";

// ============================================================
// 测试夹具
// ============================================================

function makeMemory(overrides: Partial<EpisodicMemory> = {}): EpisodicMemory {
  return {
    id: `ep_test_${Math.random().toString(36).slice(2, 8)}`,
    timestamp: Date.now(),
    content: "测试记忆内容",
    importance: 50,
    emotion: "",
    relatedNpcs: [],
    relatedBeliefs: [],
    ...overrides,
  };
}

// ============================================================
// scoreImportance
// ============================================================

describe("scoreImportance", () => {
  it("returns base score (30) for mundane content", () => {
    const score = scoreImportance("普通的一天", [], "");
    expect(score).toBe(30);
  });

  it("scores higher when content matches core desires", () => {
    const score = scoreImportance(
      "找到真想——裂隙的本质被揭开了",
      [],
      "",
      ["找到真相", "理解世界"],
    );
    expect(score).toBeGreaterThanOrEqual(50);
  });

  it("scores higher when content matches fears", () => {
    const score = scoreImportance(
      "差点变成空壳",
      [],
      "",
      [],
      ["变成空壳", "失去自我"],
    );
    expect(score).toBeGreaterThanOrEqual(45);
  });

  it("scores higher for anomalous memories", () => {
    const normalScore = scoreImportance("普通记忆");
    const anomalousScore = scoreImportance("普通记忆", [], "", [], [], true);
    expect(anomalousScore).toBeGreaterThan(normalScore);
  });

  it("scores higher with more related NPCs", () => {
    const score1 = scoreImportance("一次对话", ["NPC_A"]);
    const score2 = scoreImportance("一次对话", ["NPC_A", "NPC_B", "NPC_C"]);
    expect(score2).toBeGreaterThan(score1);
  });

  it("caps at 100", () => {
    const score = scoreImportance(
      "找到真相避免变成空壳",
      ["A", "B", "C", "D", "E"],
      "恐惧",
      ["找到真相", "理解世界"],
      ["变成空壳", "失去自我"],
      true,
    );
    expect(score).toBeLessThanOrEqual(100);
  });
});

// ============================================================
// mergeMemory
// ============================================================

describe("mergeMemory", () => {
  it("appends new memories", () => {
    const existing = [makeMemory({ content: "第一段记忆" })];
    const newMem = makeMemory({ content: "第二段不同的记忆" });
    const result = mergeMemory(existing, newMem);
    expect(result.length).toBe(2);
  });

  it("deduplicates by content hash", () => {
    const content = "完全相同的记忆内容";
    const existing = [makeMemory({ content, importance: 40 })];
    const newMem = makeMemory({ content, importance: 60 });
    const result = mergeMemory(existing, newMem);
    expect(result.length).toBe(1);
    expect(result[0].importance).toBe(60); // takes max
  });

  it("merges emotions on deduplication", () => {
    const content = "重复的事件";
    const existing = [makeMemory({ content, emotion: "好奇" })];
    const newMem = makeMemory({ content, emotion: "恐惧" });
    const result = mergeMemory(existing, newMem);
    expect(result.length).toBe(1);
    expect(result[0].emotion).toContain("好奇");
    expect(result[0].emotion).toContain("恐惧");
  });

  it("caps at 50 entries and evicts lowest importance", () => {
    const existing = Array.from({ length: 50 }, (_, i) =>
      makeMemory({ content: `记忆_${i}`, importance: i + 1 })
    );
    const newMem = makeMemory({ content: "新高重要性记忆", importance: 100 });
    const result = mergeMemory(existing, newMem);
    expect(result.length).toBe(50);
    // The highest importance memories should survive
    const importances = result.map((m) => m.importance);
    expect(Math.min(...importances)).toBeGreaterThan(1);
  });

  it("preserves newer timestamps on merge", () => {
    const content = "时间戳冲突";
    const old = makeMemory({ content, timestamp: 1000 });
    const newer = makeMemory({ content, timestamp: 2000 });
    const result = mergeMemory([old], newer);
    expect(result[0].timestamp).toBe(2000);
  });
});

// ============================================================
// decayMemory
// ============================================================

describe("decayMemory", () => {
  it("reduces importance over game time", () => {
    const memories = [makeMemory({ importance: 80, emotion: "" })];
    const decayed = decayMemory(memories, 1000); // 1000 game minutes
    expect(decayed[0].importance).toBeLessThan(80);
  });

  it("decays emotional memories slower", () => {
    const normalMem = makeMemory({ id: "a", content: "普通记忆", importance: 80, emotion: "平静" });
    const emotionalMem = makeMemory({ id: "b", content: "情感记忆", importance: 80, emotion: "恐惧" });

    const normalDecayed = decayMemory([normalMem], 1000);
    const emotionalDecayed = decayMemory([emotionalMem], 1000);

    // Emotional memory should retain more importance
    expect(emotionalDecayed[0].importance).toBeGreaterThan(normalDecayed[0].importance);
  });

  it("does not reduce importance below 0", () => {
    const memories = [makeMemory({ importance: 1 })];
    const decayed = decayMemory(memories, 10000);
    expect(decayed[0].importance).toBeGreaterThanOrEqual(0);
  });

  it("handles empty array", () => {
    const result = decayMemory([], 100);
    expect(result).toEqual([]);
  });

  it("handles zero elapsed time", () => {
    const memories = [makeMemory({ importance: 50 })];
    const decayed = decayMemory(memories, 0);
    expect(decayed[0].importance).toBe(50);
  });
});

// ============================================================
// getArchivableMemories
// ============================================================

describe("getArchivableMemories", () => {
  it("returns memories below archive threshold", () => {
    const memories = [
      makeMemory({ id: "a", content: "高分", importance: 80 }),
      makeMemory({ id: "b", content: "低分", importance: 3 }),
      makeMemory({ id: "c", content: "中分", importance: 50 }),
    ];
    const archivable = getArchivableMemories(memories);
    expect(archivable.length).toBe(1);
    expect(archivable[0].id).toBe("b");
  });
});

// ============================================================
// detectMemoryConflict
// ============================================================

describe("detectMemoryConflict", () => {
  it("detects contradictory facts", () => {
    const existing = [
      makeMemory({ id: "a", content: "管家信任玩家", importance: 80, emotion: "信任" }),
    ];
    const newMem = makeMemory({
      id: "b",
      content: "管家欺骗了玩家",
      importance: 70,
      emotion: "愤怒",
      relatedNpcs: ["管家"],
    });
    const conflicts = detectMemoryConflict(existing, newMem);
    expect(conflicts.length).toBeGreaterThan(0);
    expect(conflicts[0].conflictType).toBe("contradictory_facts");
  });

  it("returns empty for consistent memories", () => {
    const existing = [
      makeMemory({ id: "a", content: "天气很晴朗", importance: 80 }),
    ];
    const newMem = makeMemory({ id: "b", content: "太阳很大" });
    const conflicts = detectMemoryConflict(existing, newMem);
    expect(conflicts.length).toBe(0);
  });

  it("ignores low importance memories in conflict detection", () => {
    const existing = [
      makeMemory({ id: "a", content: "不重要", importance: 5, emotion: "" }),
    ];
    const newMem = makeMemory({ id: "b", content: "不涉及冲突", importance: 50 });
    const conflicts = detectMemoryConflict(existing, newMem);
    // Low importance memory is skipped
    expect(conflicts.filter((c) => c.conflictType !== "timeline_anomaly").length).toBe(0);
  });

  it("returns empty for empty existing memories", () => {
    const newMem = makeMemory({ content: "新记忆" });
    const conflicts = detectMemoryConflict([], newMem);
    expect(conflicts).toEqual([]);
  });
});
