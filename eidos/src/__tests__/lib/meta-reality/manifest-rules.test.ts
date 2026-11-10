// ============================================================
// Eidos · Meta channel manifest runtime rules
// ============================================================

import { describe, expect, it } from "vitest";
import { createRealityArtifact } from "@/lib/meta-reality/artifacts";
import {
  buildMetaChannelDeniedBoundaryEvent,
  evaluateRealityArtifactAgainstManifest,
} from "@/lib/meta-reality/manifest-rules";
import type { MetaChannelManifest, RealityArtifact } from "@/lib/meta-reality/types";

function makeArtifact(overrides: Partial<RealityArtifact> = {}): RealityArtifact {
  return {
    ...createRealityArtifact({
      kind: "text",
      label: "password.txt",
      summary: "一份来自边界外的密码摘要。",
      introducedAtWorldLineNodeId: "node_1",
      createdAt: 100,
    }),
    ...overrides,
  };
}

function makeManifest(): MetaChannelManifest {
  return {
    id: "manifest_gentle",
    title: "温柔同行",
    tone: "gentle",
    forbiddenMoves: ["不得读取未授权桌面"],
    channels: [
      {
        id: "external_letter",
        kind: "text",
        promptToPlayer: "把外部信件拖入行动输入框。",
        worldInterpretation: "边界外递来的信件或密码。",
        allowedConsumers: ["Niko", "观测员"],
        consequenceTemplate: "信件在桌面上显形。",
        refusalFallback: "信件没有找到合适的收信人。",
      },
    ],
  };
}

describe("evaluateRealityArtifactAgainstManifest", () => {
  it("allows explicitly dropped artifacts when no creator manifest exists", () => {
    const artifact = makeArtifact({ visibleTo: ["Niko"] });

    const result = evaluateRealityArtifactAgainstManifest({
      artifact,
      manifest: null,
      requestedConsumers: ["Niko"],
    });

    expect(result.allowed).toBe(true);
    if (!result.allowed) throw new Error("expected manifest evaluation to allow artifact");
    expect(result.channel).toBeNull();
    expect(result.visibleTo).toEqual(["Niko"]);
  });

  it("matches a channel by artifact kind and uses channel consumers when none were declared", () => {
    const artifact = makeArtifact({ visibleTo: [] });

    const result = evaluateRealityArtifactAgainstManifest({
      artifact,
      manifest: makeManifest(),
      requestedConsumers: ["Niko"],
    });

    expect(result.allowed).toBe(true);
    if (!result.allowed) throw new Error("expected manifest evaluation to allow artifact");
    expect(result.channel?.id).toBe("external_letter");
    expect(result.visibleTo).toEqual(["Niko", "观测员"]);
    expect(result.promptRule).toContain("边界外递来的信件");
  });

  it("denies artifacts whose kind is not declared by the manifest", () => {
    const artifact = makeArtifact({ kind: "image", label: "sea.png" });

    const result = evaluateRealityArtifactAgainstManifest({
      artifact,
      manifest: makeManifest(),
      requestedConsumers: ["Niko"],
    });

    expect(result.allowed).toBe(false);
    if (result.allowed) throw new Error("expected manifest evaluation to deny artifact");
    expect(result.reason).toContain("未声明 image 通道");
    expect(result.refusalFallback).toContain("不接受 image");
  });

  it("denies artifacts when current consumers are outside the channel allowlist", () => {
    const artifact = makeArtifact();

    const result = evaluateRealityArtifactAgainstManifest({
      artifact,
      manifest: makeManifest(),
      requestedConsumers: ["Stanley"],
    });

    expect(result.allowed).toBe(false);
    if (result.allowed) throw new Error("expected manifest evaluation to deny artifact");
    expect(result.reason).toContain("当前对象不在通道允许名单");
    expect(result.refusalFallback).toBe("信件没有找到合适的收信人。");
  });
});

describe("buildMetaChannelDeniedBoundaryEvent", () => {
  it("turns a manifest denial into an auditable permission_denied boundary event", () => {
    const artifact = makeArtifact({
      kind: "file_name",
      label: "C:\\Users\\alice\\Desktop\\seal.bin",
    });
    const result = evaluateRealityArtifactAgainstManifest({
      artifact,
      manifest: makeManifest(),
      requestedConsumers: ["Niko"],
    });
    expect(result.allowed).toBe(false);
    if (result.allowed) throw new Error("expected manifest evaluation to deny artifact");

    const event = buildMetaChannelDeniedBoundaryEvent({
      artifact,
      evaluation: result,
      worldLineNodeId: "node_9",
      createdAt: 200,
    });

    expect(event.type).toBe("permission_denied");
    expect(event.actor).toBe("creator_rule");
    expect(event.artifactId).toBe(artifact.id);
    expect(event.worldLineNodeId).toBe("node_9");
    expect(event.visibleConsequences[0]).toContain("seal.bin");
    expect(event.visibleConsequences[0]).not.toContain("C:\\Users");
    expect(event.hiddenAudit.join("\n")).toContain("manifest_gentle");
  });
});
