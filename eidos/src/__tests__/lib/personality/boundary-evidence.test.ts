import { describe, expect, it } from "vitest";

import {
  buildBoundaryEvidenceInference,
  buildBoundaryEventPersonalityObservations,
} from "@/lib/personality/boundary-evidence";
import type { BoundaryEvent, RealityArtifact } from "@/lib/meta-reality/types";

function makeArtifact(): RealityArtifact {
  return {
    id: "ra_1",
    kind: "text",
    label: "password.txt",
    consent: { grantedAt: 100, scope: "summary_only", revocable: true },
    summary: "玩家主动递交现实边界材料「password.txt」，作为文本证据进入世界。",
    visibleTo: [],
    introducedAtWorldLineNodeId: "node_1",
    creatorIntent: "我把找到的密码交给门后的孩子。",
    safetyNotes: [],
    createdAt: 100,
  };
}

function makeBoundaryEvent(): BoundaryEvent {
  return {
    id: "be_1",
    type: "artifact_introduced",
    actor: "player",
    artifactId: "ra_1",
    worldLineNodeId: "node_1",
    visibleConsequences: ["现实边界材料「password.txt」进入世界边界。"],
    hiddenAudit: [],
    createdAt: 101,
  };
}

describe("buildBoundaryEventPersonalityObservations", () => {
  it("turns a boundary event into local personality evidence for current-scene NPCs", () => {
    const observations = buildBoundaryEventPersonalityObservations({
      event: makeBoundaryEvent(),
      artifact: makeArtifact(),
      npcNames: ["观测员埃琳娜", "前观测员特雷弗"],
    });

    expect(observations.npcsInvolved).toHaveLength(2);
    expect(observations.npcsInvolved?.[0]).toMatchObject({
      npcName: "观测员埃琳娜",
      emotion: "警觉",
      touchesCoreConcern: true,
    });
    expect(observations.memoryWorthyEvents?.[0].event).toContain("password.txt");
    expect(observations.memoryWorthyEvents?.[0].event).not.toContain("玩家主动递交现实边界材料");
  });

  it.each(["snapshot_restored","file_imported","file_exported"] as const)("ignores host maintenance event %s when inferring NPC memories", type => {
    const observations = buildBoundaryEventPersonalityObservations({
      event: {
        id: "be_restore",
        type,
        actor: "system",
        worldLineNodeId: "node_restored",
        visibleConsequences: ["沙箱卷宗恢复到快照「恢复点 A」。"],
        hiddenAudit: [],
        createdAt: 200,
      },
      npcNames: ["观测员埃琳娜"],
    });

    expect(observations).toEqual({});
  });
});

describe("buildBoundaryEvidenceInference", () => {
  it("marks boundary material as explicit metagaming evidence without exposing raw contents", () => {
    const input = buildBoundaryEvidenceInference({
      records: [{ artifact: makeArtifact(), event: makeBoundaryEvent() }],
      npcNames: ["观测员埃琳娜"],
    });

    expect(input.playerInputIsMetagaming).toBe(true);
    expect(input.playerInput).toContain("现实边界材料进入世界");
    expect(input.playerInput).toContain("password.txt");
    expect(input.playerInput).not.toContain("文本证据进入世界");
    expect(input.observations?.memoryWorthyEvents?.[0].npcName).toBe("观测员埃琳娜");
  });
});
