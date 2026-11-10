// ============================================================
// Eidos · Meta Reality artifact helpers
// ============================================================

import { describe, expect, it } from "vitest";
import {
  buildBoundaryEvent,
  buildMetaRealityPromptContext,
  createRealityArtifact,
  redactRealityLabel,
} from "@/lib/meta-reality/artifacts";

describe("redactRealityLabel", () => {
  it("redacts POSIX local paths before labels are exposed to AI", () => {
    expect(redactRealityLabel("/Users/alice/Desktop/secret.txt")).toBe("secret.txt");
  });

  it("redacts Windows local paths before labels are exposed to AI", () => {
    expect(redactRealityLabel("C:\\Users\\alice\\Desktop\\secret.txt")).toBe("secret.txt");
  });

  it("uses a neutral label when the input has no usable filename", () => {
    expect(redactRealityLabel("   ")).toBe("现实材料");
  });
});

describe("createRealityArtifact", () => {
  it("creates summary-only artifacts without exposing source content", () => {
    const artifact = createRealityArtifact({
      kind: "text",
      label: "/Users/alice/Desktop/origin.md",
      summary: "一段来自边界外的蓝色天空描写。",
      sourceExcerpt: "full private text",
      scope: "summary_only",
      visibleTo: ["Niko"],
      introducedAtWorldLineNodeId: "node_1",
      createdAt: 100,
    });

    expect(artifact.id).toMatch(/^ra_100_text_/);
    expect(artifact.label).toBe("origin.md");
    expect(artifact.consent).toEqual({
      grantedAt: 100,
      scope: "summary_only",
      revocable: true,
    });
    expect(artifact.summary).toContain("蓝色天空");
    expect(artifact.sourceExcerpt).toBeUndefined();
  });

  it("keeps full text only when full_text consent is explicit", () => {
    const artifact = createRealityArtifact({
      kind: "text",
      label: "letter.txt",
      summary: "外部信件摘要。",
      sourceExcerpt: "外部信件全文",
      scope: "full_text",
      visibleTo: ["alice"],
      introducedAtWorldLineNodeId: "node_1",
      createdAt: 100,
    });

    expect(artifact.sourceExcerpt).toBe("外部信件全文");
  });

  it("defaults to summary-only consent", () => {
    const artifact = createRealityArtifact({
      kind: "image",
      label: "sea.png",
      summary: "一张海面图像。",
      introducedAtWorldLineNodeId: "node_1",
      createdAt: 100,
    });

    expect(artifact.consent.scope).toBe("summary_only");
  });
});

describe("buildBoundaryEvent", () => {
  it("creates auditable boundary events with visible consequences", () => {
    const event = buildBoundaryEvent({
      type: "artifact_introduced",
      actor: "player",
      artifactId: "ra_1",
      worldLineNodeId: "node_1",
      visibleConsequences: ["Niko 第一次看见了海。"],
      hiddenAudit: ["由玩家拖入图片创建。"],
      createdAt: 101,
    });

    expect(event.id).toMatch(/^be_101_artifact_introduced_/);
    expect(event.hiddenAudit).toEqual(["由玩家拖入图片创建。"]);
  });
});

describe("buildMetaRealityPromptContext", () => {
  it.each(['snapshot_restored','file_imported','file_exported'] as const)('does not present %s maintenance as story context',type=>{
    const event=buildBoundaryEvent({type,actor:'system',worldLineNodeId:'library',visibleConsequences:['程序维护操作'],createdAt:1});
    expect(buildMetaRealityPromptContext({boundaryEvents:[event]})).toBe('');
  });

  it("returns empty string when there are no artifacts or events", () => {
    expect(buildMetaRealityPromptContext({})).toBe("");
  });

  it("formats concise prompt context for authorized artifacts and boundary events", () => {
    const artifact = createRealityArtifact({
      kind: "image",
      label: "/Users/alice/Desktop/sea.png",
      summary: "一张来自边界外的海面图像。",
      scope: "summary_only",
      visibleTo: ["Niko"],
      introducedAtWorldLineNodeId: "node_1",
      createdAt: 100,
    });
    const event = buildBoundaryEvent({
      type: "artifact_introduced",
      actor: "player",
      artifactId: artifact.id,
      worldLineNodeId: "node_1",
      visibleConsequences: ["Niko 第一次看见了海。"],
      createdAt: 101,
    });

    const context = buildMetaRealityPromptContext({
      artifacts: [artifact],
      boundaryEvents: [event],
      maxArtifacts: 4,
      maxEvents: 4,
    });

    expect(context).toContain("现实边界材料");
    expect(context).toContain("sea.png");
    expect(context).toContain("Niko 第一次看见了海");
    expect(context).not.toContain("/Users");
  });

  it("includes full text excerpts only for full_text artifacts", () => {
    const summaryOnly = createRealityArtifact({
      kind: "text",
      label: "summary.md",
      summary: "摘要。",
      sourceExcerpt: "不能进入 prompt 的全文",
      scope: "summary_only",
      introducedAtWorldLineNodeId: "node_1",
      createdAt: 100,
    });
    const fullText = createRealityArtifact({
      kind: "text",
      label: "full.md",
      summary: "摘要。",
      sourceExcerpt: "允许进入 prompt 的摘录",
      scope: "full_text",
      introducedAtWorldLineNodeId: "node_2",
      createdAt: 101,
    });

    const context = buildMetaRealityPromptContext({
      artifacts: [summaryOnly, fullText],
    });

    expect(context).not.toContain("不能进入 prompt 的全文");
    expect(context).toContain("允许进入 prompt 的摘录");
  });
});
