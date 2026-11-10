import { afterEach, expect, it } from "vitest";
import { useGameStore } from "@/store/game-store";
import { buildRiftCityStartState, buildTestSaveState } from "@/lib/test/fixtures";
import { bindMidoriAsset, createEmptyMidoriAssetRegistry } from "@/lib/game/midori/asset-registry";

const initial = useGameStore.getInitialState();
afterEach(() => useGameStore.setState(initial));

it("restores uploaded bindings from old saves while disabling old generation switches", () => {
  const { world } = buildRiftCityStartState();
  const registry = bindMidoriAsset(createEmptyMidoriAssetRegistry(), { worldId: world.id,
    targetType: "scene", targetId: "central_plaza", slot: "background", imageUrl: "/uploaded.png", source: "uploaded" });
  const saved = buildTestSaveState(world, { midoriAssetRegistry: registry,
    midoriSettings: { ...initial.midoriSettings, enabled: true, autoGenerate: true } });
  useGameStore.getState().deserializeState(saved, world);
  expect(useGameStore.getState().midoriSettings).toMatchObject({ enabled: false, autoGenerate: false });
  expect(useGameStore.getState().midoriAssetRegistry.bindings['scene:central_plaza:background'].imageUrl).toBe('/uploaded.png');
  expect(useGameStore.getState().serializeState().midoriAssetRegistry).toEqual(registry);
});

it("does not allow legacy callers to re-enable image generation", () => {
  useGameStore.getState().setMidoriSettings({ enabled: true, autoGenerate: true });
  expect(useGameStore.getState().midoriSettings).toMatchObject({ enabled: false, autoGenerate: false });
});
