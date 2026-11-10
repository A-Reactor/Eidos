// ============================================================
// 人格推演引擎 — 审计日志测试（Phase 4）
// ============================================================

import { describe, it, expect } from "vitest";
import {
  recordAudit,
  getAuditLog,
  getNpcAuditLog,
  getLevelAuditLog,
  summarizeAuditLog,
  exportAuditLog,
  markRolledBack,
  clearAuditLog,
} from "@/lib/personality/audit";
import { PermissionLevel } from "@/lib/personality/permissions";
import type { PermissionRequest, PermissionDecision } from "@/lib/personality/permissions";

function makeRequest(overrides: Partial<PermissionRequest> = {}): PermissionRequest {
  return {
    applicantNpcId: "观测员埃琳娜",
    targetLevel: PermissionLevel.NARRATIVE,
    toolId: "narrative_express_anomaly",
    motivation: "测试动机",
    triggeringEvidence: ["玩家重复了之前的行动"],
    awarenessAtRequest: 1,
    requestedAt: Date.now(),
    ...overrides,
  };
}

function makeDecision(overrides: Partial<PermissionDecision> = {}): PermissionDecision {
  return {
    approved: true,
    reason: "测试通过",
    grantedLevel: PermissionLevel.NARRATIVE,
    cooldownMs: 300_000,
    requiresPlayerConfirmation: false,
    ...overrides,
  };
}

describe("Audit Log", () => {
  it("records approved requests", () => {
    const entry = recordAudit(makeRequest(), makeDecision(), {
      success: true,
      message: "ok",
      stateChanges: { test: true },
    });
    expect(entry.approved).toBe(true);
    expect(entry.toolId).toBe("narrative_express_anomaly");
  });

  it("records denied requests", () => {
    const entry = recordAudit(
      makeRequest(),
      makeDecision({ approved: false, reason: "权限不足" }),
    );
    expect(entry.approved).toBe(false);
    expect(entry.grantedLevel).toBeUndefined();
  });

  it("getAuditLog returns entries in reverse order", () => {
    clearAuditLog();
    recordAudit(makeRequest({ toolId: "tool_a" }), makeDecision());
    recordAudit(makeRequest({ toolId: "tool_b" }), makeDecision());

    const logs = getAuditLog();
    expect(logs.length).toBe(2);
    expect(logs[0].toolId).toBe("tool_b"); // newest first
  });

  it("filters by NPC", () => {
    clearAuditLog();
    recordAudit(makeRequest({ applicantNpcId: "埃琳娜" }), makeDecision());
    recordAudit(makeRequest({ applicantNpcId: "特雷弗" }), makeDecision());

    const elenaLogs = getNpcAuditLog("埃琳娜");
    expect(elenaLogs.length).toBe(1);
    expect(elenaLogs[0].applicantNpcId).toBe("埃琳娜");
  });

  it("filters by level", () => {
    clearAuditLog();
    recordAudit(makeRequest({ targetLevel: PermissionLevel.NARRATIVE }), makeDecision());
    recordAudit(makeRequest({ targetLevel: PermissionLevel.INTERFACE, toolId: "interface_text_overlay" }), makeDecision());

    const narrative = getLevelAuditLog(PermissionLevel.NARRATIVE);
    expect(narrative.length).toBe(1);
  });

  it("marks entries as rolled back", () => {
    clearAuditLog();
    const entry = recordAudit(makeRequest(), makeDecision());
    const success = markRolledBack(entry.id);
    expect(success).toBe(true);

    const logs = getAuditLog();
    expect(logs[0].rolledBack).toBe(true);
  });

  it("markRolledBack fails for unknown ID", () => {
    const success = markRolledBack("nonexistent");
    expect(success).toBe(false);
  });
});

describe("Audit Summary", () => {
  it("generates correct summary", () => {
    clearAuditLog();
    recordAudit(makeRequest(), makeDecision({ approved: true }));
    recordAudit(makeRequest({ toolId: "interface_text_overlay", targetLevel: PermissionLevel.INTERFACE }), makeDecision({ approved: false }));

    const summary = summarizeAuditLog();
    expect(summary.totalRequests).toBe(2);
    expect(summary.approvedCount).toBe(1);
    expect(summary.deniedCount).toBe(1);
    expect(summary.byNpc["观测员埃琳娜"].total).toBe(2);
  });

  it("summarizes by level", () => {
    clearAuditLog();
    recordAudit(makeRequest({ targetLevel: PermissionLevel.NARRATIVE }), makeDecision({ approved: true }));
    recordAudit(makeRequest({ targetLevel: PermissionLevel.NARRATIVE, toolId: "narrative_express_anomaly" }), makeDecision({ approved: false }));

    const summary = summarizeAuditLog();
    expect(summary.byLevel[PermissionLevel.NARRATIVE].total).toBe(2);
    expect(summary.byLevel[PermissionLevel.NARRATIVE].approved).toBe(1);
  });
});

describe("Export", () => {
  it("exports valid JSON", () => {
    clearAuditLog();
    recordAudit(makeRequest(), makeDecision());
    const json = exportAuditLog();
    const parsed = JSON.parse(json);
    expect(parsed.version).toBe("audit_v1");
    expect(parsed.entries.length).toBe(1);
    expect(parsed.summary).toBeDefined();
  });
});
