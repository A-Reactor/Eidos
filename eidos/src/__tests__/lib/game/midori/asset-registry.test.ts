import { describe, expect, it } from "vitest";

import {
  bindMidoriAsset,
  createEmptyMidoriAssetRegistry,
  findMidoriAsset,
  makeMidoriAssetKey,
  normalizeMidoriAssetRegistry,
  removeMidoriAsset,
  updateMidoriAssetDisplay,
} from "@/lib/game/midori/asset-registry";

describe("MIDORI asset registry", () => {
  it("binds one active image to a scene slot and can replace it", () => {
    const first = bindMidoriAsset(createEmptyMidoriAssetRegistry(), {
      worldId: "rift-city",
      targetType: "scene",
      targetId: "central_plaza",
      slot: "background",
      imageUrl: "/generated/rift-city/scenes/central_plaza_晴_9h.png",
      source: "generated",
      label: "中央广场",
    });

    const replaced = bindMidoriAsset(first, {
      worldId: "rift-city",
      targetType: "scene",
      targetId: "central_plaza",
      slot: "background",
      imageUrl: "/generated/rift-city/uploads/central-plaza-custom.png",
      source: "uploaded",
      label: "中央广场",
    });

    const asset = findMidoriAsset(replaced, {
      targetType: "scene",
      targetId: "central_plaza",
      slot: "background",
    });

    expect(Object.keys(replaced.bindings)).toEqual([
      makeMidoriAssetKey("scene", "central_plaza", "background"),
    ]);
    expect(asset?.imageUrl).toBe("/generated/rift-city/uploads/central-plaza-custom.png");
    expect(asset?.source).toBe("uploaded");
  });

  it("stores display crop separately from the image file", () => {
    const registry = bindMidoriAsset(createEmptyMidoriAssetRegistry(), {
      worldId: "rift-city",
      targetType: "character",
      targetId: "小明",
      slot: "portrait",
      imageUrl: "/generated/rift-city/uploads/xiaoming.png",
      source: "uploaded",
      label: "小明",
    });

    const updated = updateMidoriAssetDisplay(registry, {
      targetType: "character",
      targetId: "小明",
      slot: "portrait",
      display: { fit: "contain", positionX: 48, positionY: 42, zoom: 1.35 },
    });

    expect(findMidoriAsset(updated, {
      targetType: "character",
      targetId: "小明",
      slot: "portrait",
    })?.display).toEqual({ fit: "contain", positionX: 48, positionY: 42, zoom: 1.35 });
  });

  it("normalizes old or missing registry data for save compatibility", () => {
    expect(normalizeMidoriAssetRegistry(null)).toEqual(createEmptyMidoriAssetRegistry());

    const registry = normalizeMidoriAssetRegistry({
      bindings: {
        "scene:central_plaza:background": {
          worldId: "rift-city",
          targetType: "scene",
          targetId: "central_plaza",
          slot: "background",
          imageUrl: "/generated/rift-city/scenes/central.png",
          source: "generated",
        },
      },
    });

    expect(registry.version).toBe(1);
    expect(registry.bindings["scene:central_plaza:background"].display.fit).toBe("cover");
  });

  it("removes a binding without affecting other targets", () => {
    const registry = bindMidoriAsset(
      bindMidoriAsset(createEmptyMidoriAssetRegistry(), {
        worldId: "rift-city",
        targetType: "scene",
        targetId: "central_plaza",
        slot: "background",
        imageUrl: "/generated/rift-city/scenes/central.png",
        source: "generated",
      }),
      {
        worldId: "rift-city",
        targetType: "character",
        targetId: "小明",
        slot: "portrait",
        imageUrl: "/generated/rift-city/uploads/xiaoming.png",
        source: "uploaded",
      },
    );

    const updated = removeMidoriAsset(registry, {
      targetType: "scene",
      targetId: "central_plaza",
      slot: "background",
    });

    expect(findMidoriAsset(updated, {
      targetType: "scene",
      targetId: "central_plaza",
      slot: "background",
    })).toBeNull();
    expect(findMidoriAsset(updated, {
      targetType: "character",
      targetId: "小明",
      slot: "portrait",
    })?.imageUrl).toContain("xiaoming");
  });
});
