// ============================================================
// Eidos · Meta reality runtime pipeline tests
// ============================================================

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/ai/client", () => ({
  callAi: vi.fn(),
  callDeepSeek: vi.fn(),
  parseJSON: vi.fn((content: string) => JSON.parse(content)),
  setCurrentSettings: vi.fn(),
  getKeiConfig: vi.fn(() => ({ apiKey: "" })),
  pendingKeiTokens: [],
  _keiCorrectionSubscribers: new Set(),
}));

import { callAi, callDeepSeek } from "@/lib/ai/client";
import { processPlayerAction } from "@/lib/ai/action-handler";
import { buildRiftCityStartState } from "@/lib/test/fixtures";

const mockCallDeepSeek = vi.mocked(callDeepSeek);

describe("meta reality runtime pipeline", () => {
  beforeEach(() => {
    mockCallDeepSeek.mockReset(); vi.mocked(callAi).mockReset();
  });

  it("injects runtime boundary context into normal play prompts", async () => {
    const { world, snapshot } = buildRiftCityStartState();
    vi.mocked(callAi).mockResolvedValue({
      content: JSON.stringify({
        validity: { isPossible: true, fantasyResponse: null, reason: null },
        segments: [{ type: "narration", text: "门缝里传来纸张摩擦声。" }],
        sceneChanges: [],
        discoveredSecrets: [],
        npcsReacted: [],
        availableActions: ["检查密码文件"],
        summary: "发现文件",
        timeSpent: { day: 0, hour: 0, minute: 5 },
        itemsGained: [],
        itemsUsed: [],
        cluesDiscovered: [],
        worldImpacts: [],
      }),
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2, model: "alice" },
      elapsedMs: 1,
    });

    await processPlayerAction({
      playerInput: "把 password.txt 丢进游戏",
      snapshot,
      world,
      metaRealityContext: "## 现实边界材料\n- password.txt：玩家从游戏文件夹导入的密码文件摘要。",
    });

    const systemPrompt = vi.mocked(callAi).mock.calls[0]?.[0].systemPrompt as string;
    expect(systemPrompt).toContain("运行时现实边界上下文");
    expect(systemPrompt).toContain("password.txt");
    expect(systemPrompt).toContain("不得声称读取、扫描或修改未列出的真实文件");
  });

  it("injects runtime boundary context into introspection prompts", async () => {
    const { world, snapshot } = buildRiftCityStartState();
    mockCallDeepSeek.mockResolvedValue({
      content: JSON.stringify({
        narrative: "我只知道玩家交给了我一份名为 password.txt 的摘要。",
        summary: "文件记忆",
      }),
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2, model: "alice" },
      elapsedMs: 1,
    });

    await processPlayerAction({
      playerInput: "我知道刚才那个文件吗？",
      snapshot,
      world,
      introspection: true,
      metaRealityContext: "## 现实边界材料\n- password.txt：玩家从游戏文件夹导入的密码文件摘要。",
    });

    const systemPrompt = mockCallDeepSeek.mock.calls[0]?.[0] as string;
    expect(systemPrompt).toContain("运行时现实边界上下文");
    expect(systemPrompt).toContain("password.txt");
  });
});
