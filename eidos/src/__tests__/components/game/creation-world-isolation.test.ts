// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { WorldCreateScreen } from '@/components/game/WorldCreateScreen';
import { useGameStore, META_PLAYTHROUGHS_KEY } from '@/store/game-store';
import * as storage from '@/lib/game/storage';
import { buildRiftCityStartState } from '@/lib/test/fixtures';
import { buildWorldLibraryItems } from '@/components/library/world-library-model';
import type { PlaythroughMeta } from '@/lib/game/types';
import { savePluginLibrary } from '@/lib/game/plugins/library';
import { parseGameplayPlugins } from '@/lib/game/plugins/manifest';

const { loadFromDB, loadMeta, saveToDB } = storage;

function makeDraft(status: 'complete' | 'paused' = 'complete') {
  return {
    concept: '裂隙城市',
    form: { name: '同一份材料', overview: '', culture: '', regions: '', npcs: '', contradictions: '', history: '', clues: '', opening: '', narrativeStyle: 'balanced' },
    creationMode: 'concept', selectedSkills: [],
    sourceDraft: { title: '资料 1', content: '' }, sourceDocuments: [],
    sourceCorpus: null, sourceEvidence: [], sourceLedger: null,
    raw: { world: '{"name":"裂隙之城"}', timeline: 'partial timeline' },
    completed: status === 'complete' ? [0, 1] : [0],
    world: { ...buildRiftCityStartState().world, id: 'original_world', isPlayerCreated: true },
    startedAt: 100, updatedAt: 100, status,
  };
}

beforeEach(async () => {
  localStorage.clear();
  useGameStore.setState(useGameStore.getInitialState());
  await saveToDB('world-creation-draft:main:presets', []);
  vi.stubGlobal('fetch', vi.fn());
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it('regenerates independent library worlds from the same completed input preset', async () => {
  const draft = { ...makeDraft(), label: '原始输入预设' };
  await saveToDB('world-creation-draft:main:presets', [draft]);
  useGameStore.getState().addPlayerWorld(draft.world);
  const originalPlaythroughId = await useGameStore.getState().createPlaythrough(draft.world.id);
  const worldIds = [draft.world.id];

  for (let index = 0; index < 2; index++) {
    const world = { ...draft.world, id: `regenerated_${index}` };
    vi.mocked(fetch).mockResolvedValueOnce(new Response(`data: ${JSON.stringify({ type: 'done', world })}\n\n`));
    const view = render(React.createElement(WorldCreateScreen));
    fireEvent.click(screen.getByRole('button', { name: '生成预设' }));
    fireEvent.click(await screen.findByRole('button', { name: '填充预设：原始输入预设' }));
    expect(screen.queryByRole('button', { name: '查看已生成世界' })).toBeNull();
    expect(screen.queryByRole('button', { name: '继续上次生成' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '生成' }));
    await screen.findByRole('button', { name: '进入这个世界' });
    fireEvent.click(screen.getByRole('button', { name: '进入这个世界' }));
    await waitFor(() => expect(useGameStore.getState().phase).toBe('identity'));
    const state = useGameStore.getState();
    expect(worldIds).not.toContain(state.currentWorld!.id);
    worldIds.push(state.currentWorld!.id);
    expect(state.worldLine!.worldId).toBe(state.currentWorld!.id);
    view.unmount();
    useGameStore.getState().setPhase('world_create');
  }

  const state = useGameStore.getState();
  const items = buildWorldLibraryItems(state.playerWorlds, state.cachedPlaythroughs, []);
  expect(items.map(item => item.continuityCount)).toEqual([1, 1, 1]);
  expect(items[0].continuities[0].id).toBe(originalPlaythroughId);
  expect(await loadFromDB('world-creation-draft:main:presets')).toEqual(expect.arrayContaining([draft]));
  expect(fetch).toHaveBeenCalledTimes(2);
  for (const [url, init] of vi.mocked(fetch).mock.calls) {
    if (url !== '/api/world/create/stream') continue;
    const request = JSON.parse(init!.body as string);
    expect(request.conversation.pendingText).toBe('');
    expect(request.conversation.fields).toEqual({});
    expect(request.concept).toContain('同一份材料');
    expect(request.concept).not.toContain('partial timeline');
  }
});

it('gives an imported partial world a new identity while retaining its unfinished timeline', async () => {
  const draft = makeDraft('paused');
  vi.mocked(fetch).mockImplementation(async (_url, init) => new Response(`data: ${JSON.stringify({ type: 'done', world: { ...draft.world, id: JSON.parse(init!.body as string).conversation.worldId } })}\n\n`));
  render(React.createElement(WorldCreateScreen));
  await waitFor(() => expect(screen.getByRole('button', { name: '生成' })).toHaveProperty('disabled', false));
  fireEvent.click(screen.getByRole('button', { name: '生成预设' }));
  fireEvent.change(screen.getByLabelText('导入生成材料'), { target: { files: [{ name: 'material.json', text: async () => JSON.stringify({ format: 'eidos_creation_preset_v1', draft }) }] } });
  fireEvent.click(await screen.findByRole('button', { name: '恢复草稿：同一份材料' }));
  fireEvent.click(screen.getByRole('button', { name: '继续上次生成' }));
  await screen.findByRole('button', { name: '进入这个世界' });
  const request = JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string);
  expect(request.conversation.worldId).not.toBe('original_world');
  expect(request.conversation.messages[0].content).toContain('partial timeline');
  expect(request.conversation.fields.name).toBe(draft.world.name);
  expect(fetch).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: '进入这个世界' }));
  await waitFor(() => expect(useGameStore.getState().phase).toBe('identity'));
  expect(useGameStore.getState().currentWorld!.id).toBe(request.conversation.worldId);
});

it('can switch to a local plugin version after filling old generation materials', async () => {
  const [old] = parseGameplayPlugins([{ format: 'eidos-gameplay-plugin', version: 1, id: 'courtyard', name: '庭院插件',
    release: '1.0', description: '旧庭院', tags: [], prompts: { creation: '', action: '', review: '' } }]);
  const next = { ...old, release: '2.0', description: '新庭院' };
  savePluginLibrary([next]);
  const draft = { ...makeDraft(), selectedSkills: [old.id], gameplayPlugins: [old] };
  vi.mocked(fetch).mockResolvedValueOnce(new Response(`data: ${JSON.stringify({ type: 'done', world: draft.world })}\n\n`));
  render(React.createElement(WorldCreateScreen));
  await waitFor(() => expect(screen.getByRole('button', { name: '生成' })).toHaveProperty('disabled', false));
  fireEvent.click(screen.getByRole('button', { name: '生成预设' }));
  fireEvent.change(screen.getByLabelText('导入生成材料'), { target: { files: [{ name: 'old.json', text: async () => JSON.stringify({ format: 'eidos_creation_preset_v1', draft }) }] } });
  fireEvent.click(await screen.findByRole('button', { name: '填充预设：同一份材料' }));
  const skills = () => screen.getByRole('button', { name: /玩法与模组/ });
  fireEvent.click(skills());
  const versions = () => screen.getAllByRole('button', { name: /^庭院插件/ });
  const oldTile = screen.getByRole('button', { name: /^庭院插件.*v1\.0$/ });
  const nextTile = screen.getByRole('button', { name: /^庭院插件.*v2\.0$/ });
  const initial = versions();
  expect(oldTile.getAttribute('aria-pressed')).toBe('true');
  fireEvent.click(nextTile);
  expect(versions()).toEqual(initial);
  expect(oldTile.getAttribute('aria-pressed')).toBe('false');
  expect(nextTile.getAttribute('aria-pressed')).toBe('true');
  fireEvent.click(screen.getByRole('button', { name: /世界信息/ }));
  fireEvent.click(skills());
  expect(versions().map(button => button.getAttribute('aria-pressed'))).toEqual(initial.map(button => button.getAttribute('aria-pressed')));
  fireEvent.click(screen.getByRole('button', { name: '生成' }));
  await screen.findByRole('button', { name: '进入这个世界' });
  const request = JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string);
  expect(request.gameplayPlugins).toEqual([next]);
  expect(request.skillIds).toEqual([old.id]);
});

it('retains the identity of a local unfinished draft when resuming it', async () => {
  const draft = makeDraft('paused');
  await saveToDB('world-creation-draft:main:presets', [draft]);
  vi.mocked(fetch).mockResolvedValue(new Response(`data: ${JSON.stringify({ type: 'done', world: draft.world })}\n\n`));
  render(React.createElement(WorldCreateScreen));
  fireEvent.click(screen.getByRole('button', { name: '生成预设' }));
  fireEvent.click(await screen.findByRole('button', { name: '恢复草稿：同一份材料' }));
  fireEvent.click(screen.getByRole('button', { name: '继续上次生成' }));
  await screen.findByRole('button', { name: '进入这个世界' });
  const request = JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string);
  expect(request.conversation.worldId).toBe('original_world');
  expect(request.conversation.messages[0].content).toContain('partial timeline');
  expect(fetch).toHaveBeenCalledTimes(1);
});

it('keeps the generation screen open until the completed draft is saved', async () => {
  const draft = makeDraft();
  await saveToDB('world-creation-draft:main:presets', [draft]);
  vi.mocked(fetch).mockResolvedValueOnce(new Response(`data: ${JSON.stringify({ type: 'done', world: draft.world })}\n\n`));
  let releaseSave!: () => void;
  const allowSave = new Promise<void>(resolve => { releaseSave = resolve; });
  const saving = vi.fn();
  vi.spyOn(storage, 'saveToDB').mockImplementation(async (key, data) => {
    if (key === 'world-creation-draft:main:presets' && Array.isArray(data) && data[0]?.status === 'complete') {
      saving();
      await allowSave;
    }
    await saveToDB(key, data);
  });
  render(React.createElement(WorldCreateScreen));
  fireEvent.click(screen.getByRole('button', { name: '生成预设' }));
  fireEvent.click(await screen.findByRole('button', { name: '填充预设：同一份材料' }));
  fireEvent.click(screen.getByRole('button', { name: '生成' }));
  try {
    await waitFor(() => expect(saving).toHaveBeenCalledOnce());
    expect(screen.queryByRole('button', { name: '进入这个世界' })).toBeNull();
  } finally {
    releaseSave();
    await screen.findByRole('button', { name: '进入这个世界' });
  }
});

it('reuses the same world and playthrough when entering is retried after a storage failure', async () => {
  const draft = makeDraft();
  await saveToDB('world-creation-draft:main:presets', [draft]);
  vi.mocked(fetch).mockResolvedValueOnce(new Response(`data: ${JSON.stringify({ type: 'done', world: { ...draft.world, id: 'new_world' } })}\n\n`));
  const initWorldLine = useGameStore.getState().initWorldLine;
  useGameStore.setState({ initWorldLine: vi.fn().mockRejectedValueOnce(new Error('存储暂时不可用')).mockImplementation(initWorldLine) });
  render(React.createElement(WorldCreateScreen));
  fireEvent.click(screen.getByRole('button', { name: '生成预设' }));
  fireEvent.click(await screen.findByRole('button', { name: '填充预设：同一份材料' }));
  fireEvent.click(screen.getByRole('button', { name: '生成' }));
  await screen.findByRole('button', { name: '进入这个世界' });
  fireEvent.click(screen.getByRole('button', { name: '进入这个世界' }));
  await screen.findByText('存储暂时不可用');
  const worldId = useGameStore.getState().currentWorld!.id;
  const playthroughId = useGameStore.getState().currentPlaythroughId;
  fireEvent.click(screen.getByRole('button', { name: '进入这个世界' }));
  await waitFor(() => expect(useGameStore.getState().phase).toBe('identity'));
  const state = useGameStore.getState();
  expect(state.playerWorlds.map(world => world.id)).toEqual([worldId]);
  expect(state.cachedPlaythroughs.map(pt => pt.id)).toEqual([playthroughId]);
  expect(state.worldLine!.worldId).toBe(worldId);
});

it('keeps other worlds playthroughs when creating a world and when continuing an existing world', async () => {
  const first = await useGameStore.getState().createPlaythrough('first_world');
  const second = await useGameStore.getState().createPlaythrough('second_world');
  const third = await useGameStore.getState().createPlaythrough('first_world');
  const playthroughs = useGameStore.getState().cachedPlaythroughs;
  expect(playthroughs.map(pt => pt.id)).toEqual([first, second, third]);
  expect(playthroughs.map(pt => pt.name)).toEqual(['世界树 #1', '世界树 #1', '世界树 #2']);
  expect(await loadMeta<PlaythroughMeta[]>(META_PLAYTHROUGHS_KEY)).toEqual(playthroughs);
});
