// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import React from 'react';
import { webcrypto } from 'node:crypto';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react';
import { AuthorLab } from '@/components/game/AuthorLab';
import { useGameStore } from '@/store/game-store';
import { buildRiftCityStartState } from '@/lib/test/fixtures';
import { captureAuthorRepro } from '@/lib/game/author-repro';
import { parsePluginFile } from '@/lib/game/plugins/manifest';
import { commitGameplayOperation } from '@/lib/game/plugins/gameplay-commit';
import { getPendingActionNodeSave } from '@/lib/game/action-node-commit';
const plugin = { format: 'eidos-gameplay-plugin', version: 1, id: 'lab-demo', name: '实验模组', description: '测试', tags: [], prompts: { creation: '', action: '', review: '' }, rules: [], ui: { html: '<main>作者场景</main>', reading: 'replace', initialState: { phase: 'opening' } } };
beforeEach(() => { vi.stubGlobal('crypto', webcrypto); const { world, snapshot } = buildRiftCityStartState(); useGameStore.setState({ ...useGameStore.getInitialState(), currentWorld: { ...world, gameplayPlugins: parsePluginFile(plugin) } }); useGameStore.getState().restoreSnapshot({ ...snapshot, gameplayModState: { 'lab-demo': { phase: 'opening' } } }); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it('jumps to validated author state and restores a named checkpoint without model calls', async () => {
  const network = vi.spyOn(globalThis, 'fetch');
  render(React.createElement(AuthorLab, { initial: await captureAuthorRepro(useGameStore) }));
  fireEvent.change(screen.getByLabelText('检查点名称'), { target: { value: '开场' } }); fireEvent.click(screen.getByRole('button', { name: '保存检查点' }));
  await screen.findByRole('button', { name: '恢复开场' });
  fireEvent.change(screen.getByLabelText('当前模组状态'), { target: { value: '{"phase":"ending"}' } }); fireEvent.click(screen.getByRole('button', { name: '应用实验状态' }));
  expect(useGameStore.getState().gameplayModState['lab-demo'].phase).toBe('ending');
  fireEvent.click(screen.getByRole('button', { name: '恢复开场' }));
  expect(useGameStore.getState().gameplayModState['lab-demo'].phase).toBe('opening');
  expect(network).not.toHaveBeenCalled(); network.mockRestore();
});
it('retains the live stage when an edited state is invalid', async () => {
  render(React.createElement(AuthorLab, { initial: await captureAuthorRepro(useGameStore) }));
  const before = useGameStore.getState();
  fireEvent.change(screen.getByLabelText('当前模组状态'), { target: { value: '{"_eidosGameplay":{"revision":-1,"last":{"id":"bad","revision":-1,"summary":"bad","createdAt":1,"narration":"none"},"facts":{}}}' } }); fireEvent.click(screen.getByRole('button', { name: '应用实验状态' }));
  expect(screen.getByRole('alert').textContent).toMatch(/账本/); expect(useGameStore.getState()).toBe(before);
});
it('imports a reproduction file through the real drop zone', async () => {
  const repro = await captureAuthorRepro(useGameStore); repro.label = '证词第二句';
  render(React.createElement(AuthorLab, { initial: repro }));
  const file = new File([''], 'scene.json'); Object.defineProperty(file, 'text', { value: () => Promise.resolve(JSON.stringify(repro)) });
  fireEvent.drop(screen.getByRole('button', { name: '导入复现场景' }), { dataTransfer: { files: [file] } });
  await waitFor(() => expect(screen.getByRole('status').textContent).toContain('已载入：证词第二句'));
});
it('ignores a source response if an author has already switched the experiment state', async () => {
  let finish!: (data: unknown) => void;
  const loadSource = () => new Promise(resolve => { finish = resolve; });
  render(React.createElement(AuthorLab, { initial: await captureAuthorRepro(useGameStore), sources: ['demo'], loadSource }));
  fireEvent.change(screen.getByLabelText('源码模组'), { target: { value: 'demo' } });
  fireEvent.change(screen.getByLabelText('当前模组状态'), { target: { value: '{"phase":"new"}' } }); fireEvent.click(screen.getByRole('button', { name: '应用实验状态' }));
  finish({ ...plugin, ui: { ...plugin.ui, html: '<main>迟到的代码</main>' } });
  await waitFor(() => expect(useGameStore.getState().gameplayModState['lab-demo'].phase).toBe('new'));
  expect(useGameStore.getState().currentWorld!.gameplayPlugins![0].ui!.html).not.toContain('迟到');
});
it('refuses a delayed scene file after a real gameplay operation has completed', async () => {
  const repro = await captureAuthorRepro(useGameStore);
  render(React.createElement(AuthorLab, { initial: repro }));
  let finish!: (json: string) => void;
  const file = new File([''], 'scene.json'); Object.defineProperty(file, 'text', { value: () => new Promise(resolve => { finish = resolve; }) });
  fireEvent.drop(screen.getByRole('button', { name: '导入复现场景' }), { dataTransfer: { files: [file] } });
  await act(async () => { await commitGameplayOperation(useGameStore, 'lab-demo', { id: 'new-operation', expectedRevision: 0, summary: '新操作已经完成', state: { phase: 'new' }, facts: { new: true } }); });
  const node = useGameStore.getState().currentNode!.id;
  await act(async () => { finish(JSON.stringify(repro)); });
  await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/现场.*变化/));
  expect(useGameStore.getState().currentNode?.id).toBe(node); expect(useGameStore.getState().gameplayModState['lab-demo'].phase).toBe('new');
});
it('offers write-only retry after an accepted operation fails to save, then unblocks the lab', async () => {
  render(React.createElement(AuthorLab, { initial: await captureAuthorRepro(useGameStore) }));
  const actual = useGameStore.getState().addActionNode, saving = vi.fn(actual).mockRejectedValueOnce(new Error('disk unavailable'));
  useGameStore.setState({ addActionNode: saving });
  await act(async () => { await commitGameplayOperation(useGameStore, 'lab-demo', { id: 'accepted', expectedRevision: 0, summary: '已确认', state: { phase: 'accepted' }, facts: { accepted: true } }); });
  fireEvent.click(await screen.findByRole('button', { name: '重试保存' }));
  await waitFor(() => expect(getPendingActionNodeSave(useGameStore)).toBeNull());
  expect(useGameStore.getState().history).toHaveLength(1); expect(saving).toHaveBeenCalledTimes(2);
  expect(useGameStore.getState().gameplayModState['lab-demo'].phase).toBe('accepted');
  expect(screen.queryByRole('button', { name: '重试保存' })).toBeNull();
});
it('reloads only the selected source directory when a different mod changes', async () => {
  let changed!: (name?: string) => void;
  const loadSource = vi.fn(async () => plugin), subscribeSource = (fn: (name?: string) => void) => { changed = fn; return () => {}; };
  render(React.createElement(AuthorLab, { initial: await captureAuthorRepro(useGameStore), sources: ['demo'], loadSource, subscribeSource }));
  fireEvent.change(screen.getByLabelText('源码模组'), { target: { value: 'demo' } });
  await screen.findByText(/已重载 实验模组/);
  await act(async () => { changed('other-mod'); }); expect(loadSource).toHaveBeenCalledTimes(1);
  await act(async () => { changed('demo'); }); expect(loadSource).toHaveBeenCalledTimes(2);
});

it('replaces a large experimental package while keeping compatible progress', async () => {
  render(React.createElement(AuthorLab, { initial: await captureAuthorRepro(useGameStore) }));
  const html = '<main>' + '完整剧场'.repeat(70000) + '</main>', source = JSON.stringify({ ...plugin, ui: { ...plugin.ui, html } });
  const file = new File([source], 'large-lab.json'); Object.defineProperty(file, 'text', { value: async () => source });
  fireEvent.change(screen.getByLabelText('实验模组文件'), { target: { files: [file] } });
  await waitFor(() => expect(useGameStore.getState().currentWorld!.gameplayPlugins![0].ui!.html).toBe(html));
  expect(useGameStore.getState().gameplayModState['lab-demo'].phase).toBe('opening');
});
