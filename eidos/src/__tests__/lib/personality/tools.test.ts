// ============================================================
// 人格推演引擎 — 工具注册表测试（Phase 4）
// ============================================================

import { describe, it, expect } from "vitest";
import {
  registerTool,
  getTool,
  listTools,
  executeTool,
  rollbackTool,
} from "@/lib/personality/tools";
import { PermissionLevel } from "@/lib/personality/permissions";

describe("Tool Registry", () => {
  it("registers and retrieves tools", () => {
    const tool = getTool("narrative_express_anomaly");
    expect(tool).toBeDefined();
    expect(tool!.level).toBe(PermissionLevel.NARRATIVE);
  });

  it("lists tools by level", () => {
    const narrative = listTools(PermissionLevel.NARRATIVE);
    const interfaces = listTools(PermissionLevel.INTERFACE);
    const state = listTools(PermissionLevel.STATE);
    const save = listTools(PermissionLevel.SAVE);

    expect(narrative.length).toBeGreaterThan(0);
    expect(interfaces.length).toBeGreaterThan(0);
    expect(state.length).toBeGreaterThan(0);
    expect(save.length).toBeGreaterThan(0);
  });

  it("lists all tools without level filter", () => {
    const all = listTools();
    expect(all.length).toBeGreaterThanOrEqual(7); // at least 7 initial tools
  });

  it("returns undefined for unregistered tool", () => {
    const tool = getTool("nonexistent_tool");
    expect(tool).toBeUndefined();
  });

  it("prevents duplicate registration", () => {
    expect(() =>
      registerTool({
        id: "narrative_express_anomaly",
        name: "duplicate",
        level: PermissionLevel.NARRATIVE,
        description: "dup",
        parameters: [],
        execute: () => ({ success: true, message: "" }),
        reversible: false,
      }),
    ).toThrow();
  });
});

describe("Tool Execution", () => {
  it("executes narrative tool successfully", () => {
    const result = executeTool("narrative_express_anomaly", {
      npcName: "测试NPC",
      expressionType: "deja_vu",
      intensity: "subtle",
    });
    expect(result.success).toBe(true);
    expect(result.stateChanges).toBeDefined();
    expect(result.stateChanges!._personality_tool).toBe("narrative_express_anomaly");
  });

  it("executes interface tool", () => {
    const result = executeTool("interface_text_overlay", {
      text: "测试文字",
      style: "flicker",
      duration: 3,
    });
    expect(result.success).toBe(true);
  });

  it("executes state tool", () => {
    const result = executeTool("state_write_world_flag", {
      flagName: "_test_flag",
      flagValue: true,
      npcName: "测试NPC",
    });
    expect(result.success).toBe(true);
  });

  it("executes save tool", () => {
    const result = executeTool("save_mark_archive", {
      npcName: "测试NPC",
      markText: "测试标记",
    });
    expect(result.success).toBe(true);
  });

  it("fails for unknown tool", () => {
    const result = executeTool("unknown_tool", {});
    expect(result.success).toBe(false);
  });
});

describe("Tool Rollback", () => {
  it("rolls back reversible tool", () => {
    const result = rollbackTool("narrative_express_anomaly", { npcName: "测试" });
    expect(result.success).toBe(true);
  });

  it("fails rollback for non-reversible tool", () => {
    const result = rollbackTool("interface_text_overlay", {});
    expect(result.success).toBe(false);
  });

  it("fails rollback for unknown tool", () => {
    const result = rollbackTool("unknown_tool", {});
    expect(result.success).toBe(false);
  });
});
