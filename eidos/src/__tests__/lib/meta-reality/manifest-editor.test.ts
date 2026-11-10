import { describe, expect, it } from "vitest";

import {
  createDefaultMetaChannel,
  createDefaultMetaChannelManifest,
  normalizeMetaChannelManifest,
} from "@/lib/meta-reality/manifest-editor";

describe("meta reality manifest editor helpers", () => {
  it("creates a playable default manifest with one declared channel", () => {
    const manifest = createDefaultMetaChannelManifest({ worldName: "裂隙之城", now: 100 });

    expect(manifest.id).toBe("manifest_100");
    expect(manifest.title).toBe("裂隙之城边界通道");
    expect(manifest.tone).toBe("mysterious");
    expect(manifest.channels).toEqual([
      expect.objectContaining({
        id: "reality_offering",
        kind: "text",
        allowedConsumers: ["ALICE", "UZQ"],
      }),
    ]);
    expect(manifest.forbiddenMoves.length).toBeGreaterThan(0);
  });

  it("normalizes loose form data into a safe manifest shape", () => {
    const manifest = normalizeMetaChannelManifest({
      id: "",
      title: "  ",
      tone: "noisy",
      channels: [
        {
          id: "  ",
          kind: "unknown",
          promptToPlayer: 12,
          worldInterpretation: "现实里的纸条被放进了世界。",
          allowedConsumers: "ALICE, UZQ, ",
          consequenceTemplate: null,
          refusalFallback: "材料无法被识别。",
        },
      ],
      forbiddenMoves: "读取桌面\n\n修改系统文件",
    }, { worldName: "测试世界", now: 200 });

    expect(manifest).toMatchObject({
      id: "manifest_200",
      title: "测试世界边界通道",
      tone: "mysterious",
      forbiddenMoves: ["读取桌面", "修改系统文件"],
    });
    expect(manifest.channels[0]).toMatchObject({
      id: "channel_1",
      kind: "text",
      promptToPlayer: "",
      worldInterpretation: "现实里的纸条被放进了世界。",
      allowedConsumers: ["ALICE", "UZQ"],
      consequenceTemplate: "",
      refusalFallback: "材料无法被识别。",
    });
  });

  it("creates deterministic channels for editor add actions", () => {
    expect(createDefaultMetaChannel(3)).toMatchObject({
      id: "reality_offering_3",
      kind: "text",
    });
  });
});
