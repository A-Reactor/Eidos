// ============================================================
// Eidos · Reality offering file tests
// ============================================================

import { describe, expect, it } from "vitest";
import {
  applyMetaChannelRulesToOffering,
  createRealityOfferingFromFile,
  inferRealityArtifactKind,
} from "@/lib/meta-reality/offering-files";
import type { MetaChannelManifest } from "@/lib/meta-reality/types";

function makeFileLike(overrides: {
  name: string;
  type?: string;
  size?: number;
  text?: string;
}) {
  return {
    name: overrides.name,
    type: overrides.type ?? "",
    size: overrides.size ?? overrides.text?.length ?? 0,
    text: overrides.text === undefined
      ? undefined
      : async () => overrides.text ?? "",
  };
}

describe("inferRealityArtifactKind", () => {
  it("recognizes text, image, audio, and filename tokens", () => {
    expect(inferRealityArtifactKind(makeFileLike({ name: "letter.md", type: "text/markdown" }))).toBe("text");
    expect(inferRealityArtifactKind(makeFileLike({ name: "sea.png", type: "image/png" }))).toBe("image");
    expect(inferRealityArtifactKind(makeFileLike({ name: "voice.wav", type: "audio/wav" }))).toBe("audio");
    expect(inferRealityArtifactKind(makeFileLike({ name: "seal.bin", type: "application/octet-stream" }))).toBe("file_name");
  });
});

describe("createRealityOfferingFromFile", () => {
  it('does not present media metadata as decoded image or audio content', async () => {
    for (const [name, type, phrase] of [['seal.png', 'image/png', '只知道文件名'], ['voice.wav', 'audio/wav', '不能据此编造声音或对白']]) {
      const { artifact } = await createRealityOfferingFromFile({ file: makeFileLike({ name, type }), worldLineNodeId: 'node' });
      expect(artifact.summary).toContain(phrase);
    }
  });
  it("turns a dropped text file into an auditable runtime artifact", async () => {
    const { artifact, event } = await createRealityOfferingFromFile({
      file: makeFileLike({
        name: "/Users/alice/Desktop/password.txt",
        type: "text/plain",
        text: "密码是：HORIZON-17。请把它交给门后的孩子。",
      }),
      worldLineNodeId: "node_42",
      creatorIntent: "这是玩家从游戏文件夹找到的密码文件。",
      createdAt: 1000,
    });

    expect(artifact.id).toMatch(/^ra_1000_text_/);
    expect(artifact.kind).toBe("text");
    expect(artifact.label).toBe("password.txt");
    expect(artifact.summary).toContain("HORIZON-17");
    expect(artifact.summary).toContain("游戏文件夹找到的密码文件");
    expect(artifact.summary).not.toContain("/Users/alice");
    expect(artifact.sourceExcerpt).toBeUndefined();
    expect(event.type).toBe("artifact_introduced");
    expect(event.artifactId).toBe(artifact.id);
    expect(event.worldLineNodeId).toBe("node_42");
    expect(event.visibleConsequences[0]).toContain("password.txt");
    expect(event.hiddenAudit[0]).toContain("text/plain");
  });

  it("keeps image offerings metadata-only unless the player describes them", async () => {
    const { artifact } = await createRealityOfferingFromFile({
      file: makeFileLike({
        name: "C:\\Users\\alice\\Pictures\\sea.png",
        type: "image/png",
        size: 2048,
      }),
      worldLineNodeId: "node_1",
      creatorIntent: "外部天空与海。",
      createdAt: 1001,
    });

    expect(artifact.kind).toBe("image");
    expect(artifact.label).toBe("sea.png");
    expect(artifact.summary).toContain("外部天空与海");
    expect(artifact.summary).toContain("不读取本地路径、EXIF");
    expect(artifact.summary).not.toContain("C:\\Users");
  });




});

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
        worldInterpretation: "边界外递来的信件。",
        allowedConsumers: ["Niko"],
        consequenceTemplate: "信件在桌面上显形。",
        refusalFallback: "信件没有找到合适的收信人。",
      },
    ],
  };
}

describe("applyMetaChannelRulesToOffering", () => {
  it("accepts an offering through a matching manifest channel and applies channel visibility", async () => {
    const record = await createRealityOfferingFromFile({
      file: makeFileLike({
        name: "letter.txt",
        type: "text/plain",
        text: "给 Niko 的信。",
      }),
      worldLineNodeId: "node_3",
      createdAt: 1100,
    });

    const result = applyMetaChannelRulesToOffering({
      record,
      manifest: makeManifest(),
      requestedConsumers: ["Niko"],
    });

    expect(result.status).toBe("accepted");
    if (result.status !== "accepted") return;
    expect(result.record.artifact.visibleTo).toEqual(["Niko"]);
    expect(result.evaluation.promptRule).toContain("边界外递来的信件");
  });

  it("blocks an offering that has no declared manifest channel", async () => {
    const record = await createRealityOfferingFromFile({
      file: makeFileLike({
        name: "sea.png",
        type: "image/png",
        size: 2048,
      }),
      worldLineNodeId: "node_3",
      createdAt: 1200,
    });

    const result = applyMetaChannelRulesToOffering({
      record,
      manifest: makeManifest(),
      requestedConsumers: ["Niko"],
      createdAt: 1300,
    });

    expect(result.status).toBe("blocked");
    if (result.status !== "blocked") return;
    expect(result.denialEvent.type).toBe("permission_denied");
    expect(result.denialEvent.visibleConsequences[0]).toContain("sea.png");
    expect(result.denialEvent.hiddenAudit[0]).toContain("manifest_gentle");
  });
});
