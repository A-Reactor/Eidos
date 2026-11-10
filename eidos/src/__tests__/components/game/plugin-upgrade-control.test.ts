// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import React from 'react';
import { webcrypto } from 'node:crypto';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { SettingsScreen } from '@/components/game/SettingsScreen';
import { useGameStore } from '@/store/game-store';
import { buildRiftCityStartState } from '@/lib/test/fixtures';
import { parseGameplayPlugins } from '@/lib/game/plugins/manifest';
import { abortActiveStream } from '@/lib/game/stream-lifecycle';
import { savePluginLibrary } from '@/lib/game/plugins/library';
const old = { format: 'eidos-gameplay-plugin', version: 1, id: 'reader', name: '阅读器', description: '测试', tags: [], prompts: { creation: '', action: '', review: '' }, rules: [], ui: { html: '<p>reader</p>', reading: 'replace' } };
const updated = { ...old, release: '2.0', stateVersion: 2, migrations: [{ from: 1, to: 2, patches: [{ op: 'move', from: '/state/page', path: '/state/bookmark' }] }] };
beforeEach(async () => {
  localStorage.clear();
  vi.stubGlobal('crypto', webcrypto); abortActiveStream();
  const { world } = buildRiftCityStartState();
  useGameStore.setState({ ...useGameStore.getInitialState(), phase: 'settings', previousPhase: 'playing', navigationStack: ['playing'], currentWorld: { ...world, gameplayPlugins: parseGameplayPlugins([old]) }, currentPlaythroughId: crypto.randomUUID(), gameplayModState: { reader: { page: 7 } } });
  await useGameStore.getState().initWorldLine(useGameStore.getState().currentPlaythroughId!, world.id);
});
it('finds a same-ID package in the local library and requires an explicit compatibility preview', async () => {
  savePluginLibrary(parseGameplayPlugins([updated, { ...old, id: 'unrelated', name: '其他模组' }]));
  render(React.createElement(SettingsScreen)); fireEvent.click(screen.getByRole('button', { name: '阅读器' }));
  expect(screen.getByText(/本机插件库 · 2.0/)).toBeTruthy();
  expect(useGameStore.getState().currentWorld!.gameplayPlugins![0].release).toBeUndefined();
  expect(screen.queryByText('其他模组')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '预览本机插件库版本' }));
  await screen.findByRole('button', { name: '应用此更新' });
  expect(useGameStore.getState().history).toEqual([]); expect(useGameStore.getState().gameplayModState.reader.page).toBe(7);
  fireEvent.click(screen.getByRole('button', { name: '取消' }));
  expect(screen.queryByRole('button', { name: '应用此更新' })).toBeNull();
});
it('shows read-only details and installs externally edited introduction metadata only through an explicit package update', async () => {
  render(React.createElement(SettingsScreen)); fireEvent.click(screen.getByRole('button', { name: '阅读器' }));
  expect(screen.queryByText('编辑作者声明')).toBeNull();
  expect(screen.queryByLabelText('上传阅读器介绍图片')).toBeNull();
  const introduction = { impacts: ['narrative'], images: [{ src: 'data:image/png;base64,iVBORw0KGgo=', alt: '介绍' }] };
  const authored = { ...old, release: '1.1', introduction };
  drop(authored);
  expect(useGameStore.getState().currentWorld!.gameplayPlugins![0].introduction).toBeUndefined();
  await screen.findByRole('button', { name: '应用此更新' });
  fireEvent.click(screen.getByRole('button', { name: '取消' }));
  expect(screen.queryByRole('button', { name: '应用此更新' })).toBeNull();
  expect(useGameStore.getState().currentWorld!.gameplayPlugins![0].introduction).toBeUndefined();
  drop(authored);
  fireEvent.click(await screen.findByRole('button', { name: '应用此更新' }));
  await screen.findByText('模组已更新，进度已保存。');
  expect(useGameStore.getState().currentWorld!.gameplayPlugins![0].introduction).toEqual(introduction);
  expect(screen.getByRole('img', { name: '介绍' })).toBeDefined();
  expect(useGameStore.getState().gameplayModState.reader.page).toBe(7);
});
afterEach(() => { cleanup(); abortActiveStream(); vi.unstubAllGlobals(); });
function drop(value: unknown) {
  const file = new File([JSON.stringify(value)], 'reader.json', { type: 'application/json' });
  Object.defineProperty(file, 'text', { value: async () => JSON.stringify(value) });
  fireEvent.drop(screen.getByRole('button', { name: '更新阅读器' }), { dataTransfer: { files: [file] } });
}
it('previews a dropped update in mod settings and applies only after the player chooses it', async () => {
  render(React.createElement(SettingsScreen));
  fireEvent.click(screen.getByRole('button', { name: '阅读器' })); drop(updated);
  const apply = await screen.findByRole('button', { name: '应用此更新' });
  expect(useGameStore.getState().gameplayModState.reader.page).toBe(7);
  const before=useGameStore.getState();
  fireEvent.click(apply);
  await screen.findByText('模组已更新，进度已保存。');
  expect(useGameStore.getState().gameplayModState.reader.bookmark).toBe(7);
  expect(useGameStore.getState().currentWorld!.gameplayPlugins![0].release).toBe('2.0');
  expect(useGameStore.getState().history).toEqual(before.history);
  expect(useGameStore.getState().currentNode!.id).toBe(before.currentNode!.id);
  expect(useGameStore.getState().worldLine!.allNodeIds).toEqual(before.worldLine!.allNodeIds);
});
it('reports incompatible files and lets the player cancel a valid preview without changing progress', async () => {
  render(React.createElement(SettingsScreen));
  fireEvent.click(screen.getByRole('button', { name: '阅读器' })); drop({ ...updated, migrations: [] });
  await screen.findByRole('alert'); expect(screen.queryByRole('button', { name: '应用此更新' })).toBeNull();
  await waitFor(() => expect(screen.getByRole('button', { name: '更新阅读器' }).getAttribute('aria-busy')).toBe('false'));
  drop(updated); fireEvent.click(await screen.findByRole('button', { name: '取消' }));
  expect(useGameStore.getState().gameplayModState.reader.page).toBe(7);
  expect(useGameStore.getState().history).toEqual([]);
});

it('previews and applies large replacement source without the former file or HTML limit', async () => {
  render(React.createElement(SettingsScreen)); fireEvent.click(screen.getByRole('button', { name: '阅读器' }));
  const html = '<main>' + '完整代码'.repeat(60000) + '</main>'; drop({ ...updated, ui: { ...old.ui, html } });
  fireEvent.click(await screen.findByRole('button', { name: '应用此更新' }));
  await screen.findByText('模组已更新，进度已保存。');
  expect(useGameStore.getState().currentWorld!.gameplayPlugins![0].ui!.html).toBe(html);
  expect(useGameStore.getState().gameplayModState.reader.bookmark).toBe(7);
});
