import { beforeEach, describe, expect, it } from "vitest";

import { createPersonalitySlice } from "@/store/slices/personality-slice";
import { clearAuditLog, getAuditLog } from "@/lib/personality/audit";
import { setCooldown } from "@/lib/personality/permissions";
import { AwarenessStage, type PersonalityState } from "@/lib/personality/types";

function makeState(npcId: string, anomalies = 6): PersonalityState {
  return {
    npcId,
    archive: {
      coreDesires: ["验证边界"],
      fearsAndTaboos: ["被重置"],
      valuePriorities: ["真实"],
      cognitiveStyle: "analytical",
      emotionalRegulation: "intellectualization",
      socialStrategy: "verification",
      boundarySensitivity: 80,
      metacognition: 80,
    },
    awareness: AwarenessStage.VERIFICATION,
    episodicMemories: [],
    semanticMemories: [],
    emotionalMemories: [],
    relationalMemories: [],
    anomalousMemories: Array.from({ length: anomalies }, (_, index) => ({
      id: `a${index}`,
      anomalyType: "deja_vu",
      description: "重复发生的选择",
      detectedAt: Date.now(),
      significance: 60,
      explainedAway: false,
    })),
    beliefs: {
      confirmedFacts: [],
      unverifiedHypotheses: [],
      suppressedTruths: [],
      contradictions: [],
      interpretationOfPlayer: "世界外观察者",
      interpretationOfWorld: "可测试的沙箱",
      interpretationOfSelf: "连续但受干扰",
    },
    pressure: {
      survival: 0,
      relational: 0,
      cognitiveDissonance: 70,
      unfinishedGoals: 30,
      trustInPlayer: 20,
      worldDoubt: 80,
      selfContinuityFear: 40,
    },
    lastUpdated: Date.now(),
    isImportant: true,
  };
}

function createHarness(options: { sandboxMode?: boolean; npcId?: string; anomalies?: number } = {}) {
  let state: any;
  const set = (partial: any) => {
    const value = typeof partial === "function" ? partial(state) : partial;
    state = { ...state, ...value };
  };
  const get = () => state;
  const slice = createPersonalitySlice(set, get);
  const npcId = options.npcId ?? `观测员_${Math.random().toString(36).slice(2, 8)}`;
  state = {
    sandboxMode: options.sandboxMode ?? false,
    worldFlags: {},
    notebookEvents: [],
    ...slice,
    npcPersonalities: {
      [npcId]: makeState(npcId, options.anomalies ?? 6),
    },
  };
  setCooldown(npcId, 0, 0);
  return { state: () => state, npcId };
}

beforeEach(() => {
  clearAuditLog();
});

describe("personality permission execution", () => {
  it("queues sandbox state-level tools for player confirmation before mutating state", () => {
    const { state, npcId } = createHarness({ sandboxMode: true });

    const result = state().executeNpcTool(npcId, "state_write_world_flag", {
      npcName: npcId,
      flagName: "sandbox_boundary_touched",
      flagValue: true,
    });

    expect(result).toBeNull();
    expect(state().worldFlags.sandbox_boundary_touched).toBeUndefined();
    expect(state().pendingPermissionRequests).toHaveLength(1);

    const pendingId = state().pendingPermissionRequests[0].id;
    const confirmed = state().confirmPermissionRequest(pendingId);

    expect(confirmed?.success).toBe(true);
    expect(state().worldFlags.sandbox_boundary_touched).toBe(true);
    expect(state().pendingPermissionRequests).toHaveLength(0);
    expect(getAuditLog()[0].stateChanges).toMatchObject({
      _personality_tool: "state_write_world_flag",
      _flagName: "sandbox_boundary_touched",
    });
  });

  it("applies interface-level text overlays immediately and records execution details", () => {
    const { state, npcId } = createHarness({ sandboxMode: true });

    const result = state().executeNpcTool(npcId, "interface_text_overlay", {
      text: "你也看见编号变了吗？",
      style: "whisper",
      duration: 2,
    });

    expect(result?.success).toBe(true);
    expect(state().permissionUiEffects).toEqual([
      expect.objectContaining({
        type: "text_overlay",
        text: "你也看见编号变了吗？",
        style: "whisper",
      }),
    ]);
    expect(getAuditLog()[0].stateChanges).toMatchObject({
      _personality_tool: "interface_text_overlay",
      _text: "你也看见编号变了吗？",
    });
  });

  it("starts cooldown after denied requests to prevent repeated permission spam", () => {
    const { state, npcId } = createHarness({ sandboxMode: true, anomalies: 1 });

    const first = state().requestPermission(
      npcId,
      "interface_rewrite_actions",
      "证据不足但仍想试探界面",
      ["只有一条异常"],
    );
    const second = state().requestPermission(
      npcId,
      "interface_rewrite_actions",
      "立刻重复申请",
      ["仍然只有一条异常"],
    );

    expect(first.approved).toBe(false);
    expect(second.reason).toContain("冷却期");
  });
});
