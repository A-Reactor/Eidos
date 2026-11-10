import { describe, expect, it } from "vitest";

import { buildDialogueReadoutModel } from "@/components/game/DialogueReadout";
import {
  bindMidoriAsset,
  createEmptyMidoriAssetRegistry,
} from "@/lib/game/midori/asset-registry";
import type { ImageResource } from '@/lib/game/midori/image-resource';

describe("DialogueReadout model", () => {
  it.each(['猫猫脸2', 'love'])('shows a matching custom expression instead of the default avatar: %s', emotion => {
    const registry = bindMidoriAsset(createEmptyMidoriAssetRegistry(), {
      worldId: 'custom-world', targetType: 'character', targetId: '蓝色大肥鱼', slot: 'avatar', imageUrl: '/default.png', source: 'uploaded',
    });
    const image: ImageResource = { id: 'custom-expression', worldId: 'custom-world', type: 'character', targetId: '蓝色大肥鱼', slot: 'portrait',
      label: emotion, tags: [emotion], description: '', imageUrl: '/expression.gif', source: 'uploaded', createdAt: 1, updatedAt: 1 };
    registry.images = { [image.id]: image };
    const input = { currentSegment: { type: 'dialogue' as const, speaker: '蓝色大肥鱼', text: '米饭很软。', emotion }, displayedText: '米饭很软。',
      assetRegistry: registry, worldId: 'custom-world', sceneName: '测试场景', hasSceneImage: false };
    expect(buildDialogueReadoutModel(input)?.imageUrl).toBe('/expression.gif');
    expect(buildDialogueReadoutModel({ ...input, currentSegment: { ...input.currentSegment, emotion: '没有的表情' } })?.imageUrl).toBe('/default.png');
    expect(buildDialogueReadoutModel({ ...input, currentSegment: { ...input.currentSegment, emotion: '没有的表情', imageId: image.id } })?.imageUrl).toBe('/expression.gif');
    expect(buildDialogueReadoutModel({ ...input, currentSegment: { ...input.currentSegment, emotion: undefined } })?.imageUrl).toBe('/default.png');
    registry.images.avatar = { ...image, id: 'avatar-expression', slot: 'avatar', tags: ['另一表情'], imageUrl: '/avatar-expression.png' };
    expect(buildDialogueReadoutModel({ ...input, currentSegment: { ...input.currentSegment, emotion: '另一表情', imageId: image.id } })?.imageUrl).toBe('/expression.gif');
    expect(buildDialogueReadoutModel({ ...input, currentSegment: { ...input.currentSegment, speaker: '另一角色', imageId: image.id } })?.imageUrl).toBeNull();
  });

  it("uses a bound character image for dialogue portraits", () => {
    const registry = bindMidoriAsset(createEmptyMidoriAssetRegistry(), {
      worldId: "rift-city",
      targetType: "character",
      targetId: "丽兹",
      slot: "portrait",
      imageUrl: "/uploads/liz.png",
      source: "uploaded",
    });

    const model = buildDialogueReadoutModel({
      currentSegment: {
        type: "dialogue",
        speaker: "丽兹",
        text: "小声点，我不确定墙外有没有人。",
      },
      displayedText: "小声点",
      sceneName: "上城区",
      hasSceneImage: false,
      assetRegistry: registry,
    });

    expect(model?.tone).toBe("dialogue");
    expect(model?.speakerName).toBe("丽兹");
    expect(model?.text).toBe("小声点");
    expect(model?.imageUrl).toBe("/uploads/liz.png");
  });

  it("hides narration by default, and uses a text-only readout when the player enables it", () => {
    const segment = {
      type: "narration" as const,
      text: "你放轻脚步，走到铁门前。",
    };

    expect(buildDialogueReadoutModel({
      currentSegment: segment,
      displayedText: "",
      sceneName: "中央广场",
      hasSceneImage: false,
      assetRegistry: createEmptyMidoriAssetRegistry(),
    })).toBeNull();

    const model = buildDialogueReadoutModel({
      currentSegment: segment,
      displayedText: "你放轻脚步",
      sceneName: "中央广场",
      hasSceneImage: true,
      hideNarration: false,
      assetRegistry: createEmptyMidoriAssetRegistry(),
    });

    expect(model?.tone).toBe("narration");
    expect(model?.speakerName).toBe("");
    expect(model?.text).toBe("你放轻脚步");
    expect(model?.imageUrl).toBeNull();
  });
});
