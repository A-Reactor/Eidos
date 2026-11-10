import { describe, expect, it } from "vitest";

import {
  buildSandboxToolProtocolContext,
  normalizeSandboxToolRequests,
} from "@/lib/ai/sandbox-tool-pipeline";

describe("sandbox tool pipeline", () => {
  it("keeps the tool protocol out of ordinary archive prompts", () => {
    expect(buildSandboxToolProtocolContext({ enabled: false })).toBe("");
  });

  it("describes the sandbox tool contract and recent real executor results", () => {
    const context = buildSandboxToolProtocolContext({
      enabled: true,
      recentAudit: [
        {
          id: "audit_1",
          npcId: "观测员",
          toolId: "memory.erase",
          result: "success",
          afterSummary: "personalities=2",
          createdAt: 10,
        },
      ],
    });

    expect(context).toContain("sandboxToolRequests");
    expect(context).toContain("ui.inject_action");
    expect(context).toContain("memory.erase");
    expect(context).toContain("不得叙述工具已经成功");
    expect(context).toContain("最近沙箱工具执行");
    expect(context).toContain("memory.erase / success");
  });

  it("normalizes executable requests and rejects unknown or protected tool attempts", () => {
    const normalized = normalizeSandboxToolRequests(
      [
        {
          toolId: "ui.inject_action",
          npcId: "观测员",
          params: { action: "问她为什么知道屏幕外有人" },
          requestedPaths: ["state/actions"],
          evidenceRefs: ["ev_ui"],
        },
        {
          toolId: "shell.exec",
          npcId: "观测员",
          params: { cmd: "rm -rf /" },
          requestedPaths: ["/shell"],
        },
        {
          toolId: "memory.erase",
          npcId: "观测员",
          params: { npcId: "观测员" },
          requestedPaths: ["/sandbox/snapshots/root"],
        },
        {
          toolId: "save.mark_corrupted",
          npcId: "观测员",
          params: { text: "这个分支被她碰过" },
        },
      ],
      { maxRequests: 5 },
    );

    expect(normalized.accepted).toEqual([
      {
        toolId: "ui.inject_action",
        npcId: "观测员",
        params: { action: "问她为什么知道屏幕外有人" },
        requestedPaths: ["/state/actions"],
        evidenceRefs: ["ev_ui"],
      },
      {
        toolId: "save.mark_corrupted",
        npcId: "观测员",
        params: { text: "这个分支被她碰过" },
        requestedPaths: ["/save/playthroughs/current"],
        evidenceRefs: [],
      },
    ]);
    expect(normalized.rejected).toEqual([
      expect.objectContaining({ toolId: "shell.exec", reason: "unknown_tool" }),
      expect.objectContaining({ toolId: "memory.erase", reason: "protected_path" }),
    ]);
  });
});
