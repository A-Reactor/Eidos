// @vitest-environment jsdom
import React from "react";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { VisualNovelCanvas } from "@/components/game/VisualNovelCanvas";
import { CharacterLayer } from "@/components/game/CharacterLayer";
import { useGameStore } from "@/store/game-store";
import { buildRiftCityStartState } from "@/lib/test/fixtures";
import { createEmptyMidoriAssetRegistry } from "@/lib/game/midori/asset-registry";
import { buildDialogueReadoutModel } from '@/components/game/DialogueReadout';
import { imageResourceId, type ImageResource } from '@/lib/game/midori/image-resource';

const fetcher = vi.fn();
beforeEach(() => {
  localStorage.clear();
  const { world } = buildRiftCityStartState();
  useGameStore.setState({ currentWorld: world, currentSceneId: 'central_plaza', currentScene: null,
    sceneImageUrl: null, examineState: null, midoriAssetRegistry: createEmptyMidoriAssetRegistry(),
    midoriSettings: { ...useGameStore.getState().midoriSettings, enabled: true, autoGenerate: true } });
  fetcher.mockReset().mockResolvedValue(Response.json({ cached: false }));
  vi.stubGlobal('fetch', fetcher);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it('uses an uploaded scene binding even when legacy generation switches are enabled', async () => {
  await useGameStore.getState().bindMidoriAsset({ worldId: useGameStore.getState().currentWorld!.id,
    targetType: 'scene', targetId: 'central_plaza', slot: 'background', imageUrl: '/uploaded.png', source: 'uploaded' });
  render(React.createElement(VisualNovelCanvas));
  await waitFor(() => expect(useGameStore.getState().sceneImageUrl).toBe('/uploaded.png'));
  expect(fetcher).not.toHaveBeenCalled();
});

it('clears the previous background and ignores late cache responses after changing scenes', async () => {
  const world = useGameStore.getState().currentWorld!;
  const scenes = Object.values(world.regions).flatMap(region => Object.keys(region.scenes));
  const other = scenes.find(id => id !== 'central_plaza')!;
  useGameStore.setState({ currentWorld: { ...world, visualConfig: { artDirection: { styleKeywords: [], colorPalette: [], moodReference: '' }, scenePrompts: { central_plaza: { basePrompt: 'legacy', negativePrompt: '', composition: '', regions: [] } }, npcAppearances: {}, regionOverviews: {} } } });
  let resolveFirst!: (response: Response) => void;
  fetcher.mockImplementationOnce(() => new Promise<Response>(resolve => { resolveFirst = resolve; }));
  useGameStore.setState({ sceneImageUrl: '/previous.png' });
  render(React.createElement(VisualNovelCanvas));
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
  expect(useGameStore.getState().sceneImageUrl).toBeNull();
  act(() => useGameStore.setState({ currentSceneId: other }));
  await act(async () => { resolveFirst(Response.json({ cached: true, url: '/stale.png' })); });
  expect(useGameStore.getState().sceneImageUrl).toBeNull();
  expect(fetcher.mock.calls.every(([url]) => url === '/api/midori/check-image')).toBe(true);
});

it('displays an uploaded speaker portrait without image generation', async () => {
  const worldId = useGameStore.getState().currentWorld!.id;
  await useGameStore.getState().bindMidoriAsset({ worldId, targetType: 'character', targetId: '林', slot: 'portrait', imageUrl: '/portrait.png', source: 'uploaded' });
  const view = render(React.createElement(CharacterLayer, { currentSegment: { type: 'dialogue', speaker: '林', text: '你好', emotion: 'neutral' } }));
  expect(view.getByRole('img', { name: '林' }).getAttribute('src')).toBe('/portrait.png');
  expect(fetcher).not.toHaveBeenCalled();
});

it('shares an annotated character portrait between the resource target, stage and dialogue avatar', async () => {
  const world = useGameStore.getState().currentWorld!;
  const segment = { type: 'dialogue' as const, speaker: '神秘猫（再次出现）', text: '喵' };
  await useGameStore.getState().bindMidoriAsset({ worldId: world.id, targetType: 'character', targetId: '神秘猫', slot: 'portrait', imageUrl: '/cat.png', source: 'uploaded' });
  const view = render(React.createElement(CharacterLayer, { currentSegment: segment }));
  expect(view.getByRole('img', { name: segment.speaker }).getAttribute('src')).toBe('/cat.png');
  expect(buildDialogueReadoutModel({ currentSegment: segment, displayedText: '喵', sceneName: '', hasSceneImage: false,
    world, worldId: world.id, assetRegistry: useGameStore.getState().midoriAssetRegistry })?.imageUrl).toBe('/cat.png');
  expect(fetcher).not.toHaveBeenCalled();
});

it('uses the same expression and custom image references in the stage and avatar', async () => {
  const world = useGameStore.getState().currentWorld!;
  const resource = (url: string, tags: string[]): ImageResource => ({ id: imageResourceId(url), worldId: world.id, type: 'character', targetId: '神秘猫', label: '神秘猫',
    tags, imageUrl: url, description: '', source: 'uploaded', createdAt: 1, updatedAt: 1 });
  await useGameStore.getState().saveImageResource(resource('/neutral.png', ['平静']));
  await useGameStore.getState().saveImageResource(resource('/happy.png', ['开心', '晚礼服']));
  const segment = { type: 'dialogue' as const, speaker: '神秘猫', text: '喵', emotion: 'happy' as const };
  const view = render(React.createElement(CharacterLayer, { currentSegment: segment }));
  expect(view.getByRole('img', { name: '神秘猫' }).getAttribute('src')).toBe('/happy.png');
  expect(buildDialogueReadoutModel({ currentSegment: segment, displayedText: '喵', sceneName: '', hasSceneImage: false,
    world, worldId: world.id, assetRegistry: useGameStore.getState().midoriAssetRegistry })?.imageUrl).toBe('/happy.png');
  view.rerender(React.createElement(CharacterLayer, { currentSegment: { ...segment, emotion: 'sad', imageId: imageResourceId('/happy.png') } }));
  expect(view.getByRole('img', { name: '神秘猫' }).getAttribute('src')).toBe('/happy.png');
  expect(fetcher).not.toHaveBeenCalled();
});

it('shows only valid scoped illustrations and honors the image visibility switch', async () => {
  const world = useGameStore.getState().currentWorld!;
  const image: ImageResource = { id: 'illustration:local', worldId: world.id, type: 'illustration', targetId: 'central_plaza', label: '月下相遇',
    tags: ['月夜'], imageUrl: '/moon.png', description: '水中的月亮', source: 'uploaded', createdAt: 1, updatedAt: 1 };
  await useGameStore.getState().saveImageResource(image);
  const segment = { type: 'narration' as const, text: '水面映出月光。', imageId: image.id };
  const view = render(React.createElement(VisualNovelCanvas, { currentSegment: segment }));
  expect(view.getByRole('img', { name: '月下相遇' }).getAttribute('src')).toBe('/moon.png');
  view.rerender(React.createElement(VisualNovelCanvas, { currentSegment: segment, imagesEnabled: false }));
  expect(view.queryByRole('img', { name: '月下相遇' })).toBeNull();
  act(() => useGameStore.setState({ currentWorld: { ...world, id: 'other' } }));
  view.rerender(React.createElement(VisualNovelCanvas, { currentSegment: segment }));
  expect(view.queryByRole('img', { name: '月下相遇' })).toBeNull();
});
