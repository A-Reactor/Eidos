// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { webcrypto } from 'node:crypto';
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { GameScreen } from '@/components/game/GameScreen';
import { useGameStore } from '@/store/game-store';
import { buildRiftCityStartState } from '@/lib/test/fixtures';
import { loadSettings, saveSettings } from '@/lib/game/settings';
import { abortActiveStream } from '@/lib/game/stream-lifecycle';
import { speculativeEngine } from '@/lib/ai/speculation';
import { imageCatalogForState } from '@/lib/game/midori/image-context';
import { imageResourceId } from '@/lib/game/midori/image-resource';
import { makeResponse } from '../../lib/ai/kei-fixtures';
import { loadBlob } from '@/lib/game/cas-storage';
import type { StorySegment } from '@/lib/ai/types';

vi.mock('@/lib/game/momoi/use-momoi-playback', () => ({ useMomoiPlayback: () => ({ isPlaying: false, isGenerating: false, replay() {}, stop() {} }) }));
vi.mock('@/lib/game/momoi/service-status', () => ({ useVoiceServiceMonitor() {}, voiceStatusLabel: () => '关闭' }));
const fetcher = vi.fn();
beforeEach(async () => {
  localStorage.clear(); abortActiveStream(); speculativeEngine.cancel();
  vi.stubGlobal('crypto', webcrypto); vi.stubGlobal('fetch', fetcher); fetcher.mockReset();
  saveSettings({ ...loadSettings(), autoAdvance: false, autoSelect: false, enableSpeculation: false, aliceApiKey: '', keiApiKey: '' });
  const { world, snapshot } = buildRiftCityStartState(), initial = useGameStore.getInitialState();
  useGameStore.setState({ ...initial, phase: 'playing', currentWorld: world, currentPlaythroughId: `image-flow-${crypto.randomUUID()}`, currentScene: null,
    currentSceneId: snapshot.currentSceneId, gameTime: snapshot.currentGameTime, sceneNarrative: '', sandboxMode: false,
    history: [], availableActions: [], savedSegments: [], savedIsShowingSegments: false, worldLine: null, currentNode: null, allNodes: {} });
  await useGameStore.getState().initWorldLine(useGameStore.getState().currentPlaythroughId!, world.id);
  await useGameStore.getState().saveImageResource({ id: imageResourceId('/outfit.png'), worldId: world.id, type: 'character', targetId: '神秘猫',
    label: '神秘猫', imageUrl: '/outfit.png', tags: ['夜间礼服'], description: '蓝色围巾和月亮挂饰', source: 'uploaded', createdAt: 1, updatedAt: 1 });
});
afterEach(() => { cleanup(); abortActiveStream(); speculativeEngine.cancel(); vi.unstubAllGlobals(); });
const submit = () => {
  fireEvent.change(screen.getByRole('textbox', { name: '行动输入' }), { target: { value: '望向河面' } });
  fireEvent.click(screen.getByRole('button', { name: /发送/ }));
};

it('keeps the bound scene background when switching to and restoring the text layout', async () => {
  const state = useGameStore.getState();
  await state.bindMidoriAsset({ worldId: state.currentWorld!.id, targetType: 'scene', targetId: state.currentSceneId, slot: 'background', imageUrl: '/scene-background.png', source: 'uploaded' });
  const view = render(React.createElement(GameScreen));
  fireEvent.click(screen.getByRole('button', { name: '页面整理' }));
  fireEvent.click(screen.getByRole('menuitem', { name: '切换为经典纯文本布局' }));
  expect(useGameStore.getState().sceneImageUrl).toBe('/scene-background.png');
  expect(view.container.querySelector('[data-scene-image="true"] img[src="/scene-background.png"]')).toBeTruthy();
  expect(screen.queryByRole('region', { name: '当前对话读条' })).toBeNull();
  view.unmount();
  const restored = render(React.createElement(GameScreen));
  expect(restored.container.querySelector('[data-scene-image="true"] img[src="/scene-background.png"]')).toBeTruthy();
});

it.each([false, true])('carries tags to narrative requests and files accepted illustration plans, streaming=%s', async streaming => {
  localStorage.setItem('eidos_stream_mode', String(streaming));
  const imageId = imageResourceId('/outfit.png');
  const result = makeResponse({ segments: [{ type: 'dialogue', speaker: '神秘猫', text: '河面很安静。', imageId }],
    illustrations: [{ label: '河面的月亮', description: '钟楼与月亮的倒影，水面有一道船影。', tags: ['月夜'], sceneId: 'central_plaza' }] });
  fetcher.mockImplementation(async url => String(url).includes('/api/game/action') ? streaming ? new Response(`data: ${JSON.stringify({ type: 'segments', segments: result.segments })}\n\ndata: ${JSON.stringify({ type: 'done', ...result, segments: undefined })}\n\n`, { headers: { 'Content-Type': 'text/event-stream' } }) : Response.json(result) : Response.json({ cached: false }));
  render(React.createElement(GameScreen)); submit();
  await waitFor(() => expect(useGameStore.getState().history).toHaveLength(1));
  const state = useGameStore.getState();
  const body = JSON.parse(fetcher.mock.calls.find(([url]) => String(url).includes('/api/game/action'))![1].body);
  expect(body.imageCatalog).toContainEqual(expect.objectContaining({ id: imageId, tags: ['夜间礼服'], description: '蓝色围巾和月亮挂饰' }));
  expect(JSON.stringify(body.imageCatalog)).not.toContain('/outfit.png');
  expect(imageCatalogForState(state)).toContainEqual(expect.objectContaining({ label: '河面的月亮', type: 'illustration', available: false }));
  expect(state.encyclopedia.some(entry => entry.name === '河面的月亮')).toBe(false);
  await waitFor(() => expect(useGameStore.getState().currentNode?.segmentHash).toBeTruthy());
  const savedSnapshot=await loadBlob(useGameStore.getState().currentNode!.snapshotHash) as import('@/lib/game/types').WorldSnapshot;
  expect(Object.values(savedSnapshot.midoriAssetRegistry!.images ?? {})).toContainEqual(expect.objectContaining({label:'河面的月亮',type:'illustration'}));
  const segments = await loadBlob(useGameStore.getState().currentNode!.segmentHash) as StorySegment[];
  expect(segments[0].imageId).toBe(imageId);
});

it('does not file plans from a rejected action', async () => {
  localStorage.setItem('eidos_stream_mode', 'false');
  fetcher.mockImplementation(async url => String(url).includes('/api/game/action') ? Response.json(makeResponse({ validity: { isPossible: false, reason: '不可能', fantasyResponse: '未发生' },
    illustrations: [{ label: '不会发生的画面', description: '不应保存' }] })) : Response.json({ cached: false }));
  render(React.createElement(GameScreen)); submit();
  await screen.findByRole('heading', { name: '行动未执行' });
  expect(imageCatalogForState(useGameStore.getState()).some(image => image.type === 'illustration')).toBe(false);
});

it.each([false, true])('records a name-prefixed reaction against the existing NPC only, streaming=%s', async streaming => {
  const name = '蓝色大肥鱼', summary = '蓝色大肥鱼：一睁眼就向管理员讨饭吃';
  const current = useGameStore.getState().currentWorld!;
  useGameStore.setState({ currentWorld: { ...current, npcs: { ...current.npcs, [name]: '玩家创建的人物' } } });
  localStorage.setItem('eidos_stream_mode', String(streaming));
  const result = makeResponse({ segments: [{ type: 'narration', text: `${name}一睁眼就向管理员讨饭吃。` }, { type: 'dialogue', speaker: name, text: '有吃的吗？' }], npcsReacted: [summary],
    encyclopediaUpdates: [{ type: 'npc', name: summary, description: '玩家创建的人物', knowledge: '向管理员讨饭' }],
    relationshipUpdates: [{ npcName: summary, affinityDelta: 2 }] });
  fetcher.mockImplementation(async url => String(url).includes('/api/game/action') ? streaming ? new Response(`data: ${JSON.stringify({ type: 'done', ...result })}\n\n`, { headers: { 'Content-Type': 'text/event-stream' } }) : Response.json(result) : Response.json({ cached: false }));
  render(React.createElement(GameScreen)); submit();
  await waitFor(() => expect(useGameStore.getState().history).toHaveLength(1));
  const state = useGameStore.getState();
  expect(state.npcStates[name]).toBe('reacted');
  expect(state.npcStates[summary]).toBeUndefined();
  expect(state.relationships[summary]).toBeUndefined();
  expect(state.encyclopedia.filter(entry => entry.type === 'npc' && entry.name.startsWith(name)).map(entry => entry.name)).toEqual([name]);
  expect(state.encyclopedia.find(entry => entry.name === name)?.knowledge.some(item => item.text === '一睁眼就向管理员讨饭吃')).toBe(true);
});
