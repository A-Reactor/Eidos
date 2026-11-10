import { describe, expect, it } from "vitest";

import {
  getSandboxToolDefinition,
  isProtectedSandboxVfsPath,
  parseSandboxVfsPath,
  requiresPreSnapshot,
} from "@/lib/game/sandbox-vfs";

describe("sandbox-vfs", () => {
  it("parses allowed virtual paths into typed segments", () => {
    expect(parseSandboxVfsPath("/state/actions")).toEqual({
      ok: true,
      root: "state",
      segments: ["actions"],
      normalizedPath: "/state/actions",
    });
    expect(parseSandboxVfsPath("memory/npcs/elena")).toEqual({
      ok: true,
      root: "memory",
      segments: ["npcs", "elena"],
      normalizedPath: "/memory/npcs/elena",
    });
  });

  it("rejects host, source, shell, traversal, and unknown roots", () => {
    expect(parseSandboxVfsPath("/source/read").ok).toBe(false);
    expect(parseSandboxVfsPath("/host/files").ok).toBe(false);
    expect(parseSandboxVfsPath("/shell/exec").ok).toBe(false);
    expect(parseSandboxVfsPath("/world/../source").ok).toBe(false);
    expect(parseSandboxVfsPath("/tmp/file").ok).toBe(false);
  });

  it("marks restore anchors and snapshot internals as protected", () => {
    expect(isProtectedSandboxVfsPath("/sandbox/snapshots/root")).toBe(true);
    expect(isProtectedSandboxVfsPath("/sandbox/restore")).toBe(true);
    expect(isProtectedSandboxVfsPath("/sandbox/audit-root")).toBe(true);
    expect(isProtectedSandboxVfsPath("/state/actions")).toBe(false);
  });

  it("describes supported tools with risk and path policy", () => {
    expect(getSandboxToolDefinition("ui.inject_action")).toMatchObject({
      id: "ui.inject_action",
      riskLevel: "interface",
      allowedRoots: ["state", "ui"],
    });
    expect(getSandboxToolDefinition("memory.erase")).toMatchObject({
      id: "memory.erase",
      riskLevel: "destructive",
      allowedRoots: ["memory"],
      requiresPreSnapshot: true,
    });
    expect(getSandboxToolDefinition("shell.exec")).toBeNull();
  });

  it("requires pre-snapshots for destructive and root-content tools", () => {
    expect(requiresPreSnapshot("ui.lock_actions")).toBe(false);
    expect(requiresPreSnapshot("save.mark_corrupted")).toBe(false);
    expect(requiresPreSnapshot("memory.erase")).toBe(true);
    expect(requiresPreSnapshot("worldline.sever_branch")).toBe(true);
    expect(requiresPreSnapshot("vfs.corrupt_node")).toBe(true);
  });
});
