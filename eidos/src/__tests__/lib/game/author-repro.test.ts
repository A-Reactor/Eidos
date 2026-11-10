// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { webcrypto } from 'node:crypto';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { useGameStore } from '@/store/game-store';
import { buildRiftCityStartState } from '@/lib/test/fixtures';
import { hashAndStore } from '@/lib/game/cas-storage';
import { captureAuthorRepro, parseAuthorRepro, enterAuthorRepro } from '@/lib/game/author-repro';
import { parsePluginFile } from '@/lib/game/plugins/manifest';
import { commitGameplayOperation } from '@/lib/game/plugins/gameplay-commit';
import * as cas from '@/lib/game/cas-storage';

beforeEach(async () => {
  vi.stubGlobal('crypto', webcrypto);
  const { world, snapshot } = buildRiftCityStartState();
  useGameStore.setState({ ...useGameStore.getInitialState(), currentWorld: world, currentPlaythroughId: crypto.randomUUID() });
  useGameStore.getState().restoreSnapshot(snapshot);
  await useGameStore.getState().initWorldLine(useGameStore.getState().currentPlaythroughId!, world.id);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it('captures actual CAS prose rather than stale navigation fields and restores a separate sandbox checkpoint', async () => {
  const segments = [{ type: 'narration', text: '真正的当前正文' }], segmentHash = await hashAndStore('segments', segments);
  useGameStore.setState(s => ({ currentNode: { ...s.currentNode!, segmentHash }, savedSegments: [{ type: 'narration', text: '旧正文' }] }));
  localStorage.setItem('eidos_settings', JSON.stringify({ aliceApiKey: 'never-export-the-key' }));
  const repro = await captureAuthorRepro(useGameStore), old = useGameStore.getState().currentPlaythroughId;
  expect(repro.segments).toEqual(segments);
  expect(JSON.stringify(repro)).not.toContain('never-export-the-key');
  enterAuthorRepro(useGameStore, repro);
  expect(useGameStore.getState().sandboxMode).toBe(true);
  expect(useGameStore.getState().currentPlaythroughId).not.toBe(old);
  expect(useGameStore.getState().savedSegments).toEqual(segments);
  expect(useGameStore.getState().currentNode?.parentId).toBeNull();
});
it('rejects invalid input before replacing the live scene and makes imports independent clones', async () => {
  const repro = await captureAuthorRepro(useGameStore), live = useGameStore.getState();
  expect(() => enterAuthorRepro(useGameStore, { ...repro, snapshot: { ...repro.snapshot, currentSceneId: 'missing' } })).toThrow();
  expect(useGameStore.getState()).toBe(live);
  expect(() => parseAuthorRepro({ ...repro, format: 'future' })).toThrow();
  const parsed = parseAuthorRepro(repro); parsed.snapshot.worldFlags.changed = true;
  expect(repro.snapshot.worldFlags.changed).toBeUndefined();
});
it('rejects missing current prose instead of exporting an apparently complete scene', async () => {
  useGameStore.setState(s => ({ currentNode: { ...s.currentNode!, segmentHash: 'missing' } }));
  await expect(captureAuthorRepro(useGameStore)).rejects.toThrow(/正文/);
});
it('accepts optional omitted fields using the same JSON representation as a saved scene file', async () => {
  const repro = await captureAuthorRepro(useGameStore);
  const imported = enterAuthorRepro(useGameStore, { ...repro, world: { ...repro.world, gameplayPluginHistory: undefined }, snapshot: { ...repro.snapshot, gameplayModState: undefined } });
  expect(imported.world.gameplayPluginHistory).toBeUndefined();
  expect(useGameStore.getState().currentSceneId).toBe(repro.snapshot.currentSceneId);
});
it('preserves the imported dialogue segments when rewinding the first local experiment operation', async () => {
  const plugin = parsePluginFile({ format: 'eidos-gameplay-plugin', version: 1, id: 'repro', name: '复现', description: '测试', tags: [], prompts: { creation: '', action: '', review: '' }, rules: [], ui: { html: '<p>scene</p>', reading: 'replace' } });
  useGameStore.setState(s => ({ currentWorld: { ...s.currentWorld!, gameplayPlugins: plugin }, savedSegments: [{ type: 'narration', text: '开门前。' }, { type: 'dialogue', speaker: '白槿', text: '请等一等。' }] }));
  const repro = await captureAuthorRepro(useGameStore); enterAuthorRepro(useGameStore, repro);
  const root = useGameStore.getState().currentNode!.id;
  await commitGameplayOperation(useGameStore, 'repro', { id: 'open', expectedRevision: 0, summary: '已经开门', state: { open: true }, facts: { open: true } });
  await useGameStore.getState().backtrackToNode(root);
  expect(useGameStore.getState().savedSegments).toEqual(repro.segments);
});
it('rejects an export if accepted state changes while the original node prose is loading', async () => {
  const segments = [{ type: 'narration', text: '操作前的正文' }], hash = await hashAndStore('segments', segments);
  useGameStore.setState(s => ({ currentNode: { ...s.currentNode!, segmentHash: hash } }));
  let finish!: (data: unknown) => void;
  vi.spyOn(cas, 'loadBlob').mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const exporting = captureAuthorRepro(useGameStore);
  await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
  useGameStore.setState({ worldFlags: { newlyAccepted: true }, sceneNarrative: '新操作已经接受，但原节点尚在写入' });
  finish(segments);
  await expect(exporting).rejects.toThrow(/现场.*变化/);
});
it('preserves plugins larger than the former 16 MB scene limit', async () => {
  const repro = await captureAuthorRepro(useGameStore);
  const html = '<main>' + 'x'.repeat(16_000_001) + '</main>';
  const [plugin] = parsePluginFile({ format: 'eidos-gameplay-plugin', version: 1, id: 'large-repro', name: '完整现场', description: '完整内容', tags: [], prompts: { creation: '', action: '', review: '' }, ui: { html, reading: 'replace' } });
  expect(parseAuthorRepro({ ...repro, world: { ...repro.world, gameplayPlugins: [plugin] } }).world.gameplayPlugins![0].ui!.html).toBe(html);
});
