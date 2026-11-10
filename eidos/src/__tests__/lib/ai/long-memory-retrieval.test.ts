import { describe, expect, it } from "vitest";

import {
  buildLongMemoryRetrievalContext,
  retrieveLongMemoryContext,
  shouldRunLongMemoryRetrieval,
} from "@/lib/ai/long-memory-retrieval";
import type { InventoryItem, WorldLineNode } from "@/lib/game/types";

function node(
  stepNumber: number,
  summary: string,
  aiResponse: string,
  playerInput = `行动 ${stepNumber}`,
): WorldLineNode {
  return {
    id: `node_${stepNumber}`,
    parentId: stepNumber === 0 ? null : `node_${stepNumber - 1}`,
    stepNumber,
    playerInput,
    aiResponse,
    summary,
    snapshotHash: "",
    segmentHash: "",
    childIds: [],
    createdAt: stepNumber,
    gameTime: { day: 1, hour: 8, minute: stepNumber },
    sceneId: "plaza",
    sceneName: "中央广场",
    dayNumber: 1,
    timeSpent: { day: 0, hour: 0, minute: 1 },
    worldImpacts: [],
    generationComplete: true,
  };
}

describe("long memory retrieval", () => {
  it("recognizes player inputs that ask ALICE to recall old details", () => {
    expect(shouldRunLongMemoryRetrieval("之前那张纸条上到底写了什么？")).toBe(true);
    expect(shouldRunLongMemoryRetrieval("我要读取第65步上下5步的信息")).toBe(true);
    expect(shouldRunLongMemoryRetrieval("向北走")).toBe(false);
  });

  it("uses current inventory evidence before reading worldline history", () => {
    const inventory: InventoryItem[] = [{
      id: "note_1",
      name: "旧纸条",
      description: "纸条正文：别相信钟楼十二点的影子。",
      quantity: 1,
      acquiredFrom: "clocktower",
      acquiredAt: { day: 1, hour: 8, minute: 0 },
      category: "document",
      consumable: false,
      value: 0,
    }];

    const result = retrieveLongMemoryContext({
      playerInput: "之前那张纸条上到底写了什么？",
      inventory,
      allNodes: [
        node(0, "游戏开始", ""),
        node(1, "在广场听到了风声", "没有提到纸条。"),
      ],
      currentNodeId: "node_1",
    });

    expect(result.strategy).toBe("current_state");
    expect(result.entries).toHaveLength(0);
    expect(result.currentStateMatches[0]?.source).toBe("inventory");
    expect(buildLongMemoryRetrievalContext(result)).toContain("优先使用当前完整状态");
  });

  it("selects an explicit step window when the player names a step range", () => {
    const nodes = Array.from({ length: 8 }, (_, i) =>
      node(i, `第 ${i} 步摘要`, `第 ${i} 步完整叙事。`)
    );

    const result = retrieveLongMemoryContext({
      playerInput: "我要读取第4步上下2步的信息",
      allNodes: nodes,
      currentNodeId: "node_7",
    });

    expect(result.strategy).toBe("explicit_step_window");
    expect(result.selectedRange).toMatchObject({ centerStep: 4, fromStep: 2, toStep: 6 });
    expect(result.entries.map((entry) => entry.stepNumber)).toEqual([2, 3, 4, 5, 6]);
    expect(buildLongMemoryRetrievalContext(result)).toContain("第4步上下2步");
  });

  it("locates likely history by compressed node summaries and injects full nearby text", () => {
    const nodes = [
      node(0, "游戏开始", ""),
      node(1, "进入广场", "钟声响起。"),
      node(2, "发现红色纸条", "你展开红色纸条，上面写着：门后的人在数你的脚步。"),
      node(3, "离开广场", "你把纸条收好。"),
      node(4, "遇见观测员", "观测员避开了你的视线。"),
    ];

    const result = retrieveLongMemoryContext({
      playerInput: "我想找之前红色纸条上写了什么",
      allNodes: nodes,
      currentNodeId: "node_4",
      windowRadius: 1,
    });

    const context = buildLongMemoryRetrievalContext(result);

    expect(result.strategy).toBe("summary_locator_window");
    expect(result.selectedRange).toMatchObject({ centerStep: 2, fromStep: 1, toStep: 3 });
    expect(context).toContain("门后的人在数你的脚步");
    expect(context).toContain("压缩节点定位");
  });

  it("keeps ALICE from fabricating old details when no evidence can be found", () => {
    const result = retrieveLongMemoryContext({
      playerInput: "之前纸条上写了什么？",
      allNodes: [node(0, "游戏开始", ""), node(1, "去了酒馆", "只听见酒杯碰撞。")],
      currentNodeId: "node_1",
    });

    const context = buildLongMemoryRetrievalContext(result);

    expect(result.strategy).toBe("no_match");
    expect(context).toContain("没有找到可靠证据");
    expect(context).toContain("不要编造");
  });
});

it('never searches unrelated branches when the current node is absent or unknown', () => {
  const allNodes = [node(0, '开场', '秘密分支正文')];
  for (const currentNodeId of [null, 'missing']) {
    const result = retrieveLongMemoryContext({ playerInput: '读取第0步', allNodes, currentNodeId });
    expect(result.entries).toEqual([]);
    expect(buildLongMemoryRetrievalContext(result)).not.toContain('秘密分支正文');
  }
});

it('identifies clipped readback as excerpts and uses player-visible text rather than hidden raw prose', () => {
  const source = node(1, '找到纸条', '隐藏原始正文');
  source.playerVisibleText = '已经读到的文字。'.repeat(200);
  const result = retrieveLongMemoryContext({ playerInput: '读取第1步上下0步', allNodes: [source], currentNodeId: source.id });
  const context = buildLongMemoryRetrievalContext(result);
  expect(context).toContain('已经读到的文字');
  expect(context).toContain('不保证全文');
  expect(context).not.toContain('隐藏原始正文');
  expect(context).not.toContain('完整回读');
  expect(result.entries[0].excerpt.length).toBeLessThan(source.playerVisibleText.length);
});
