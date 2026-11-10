// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { webcrypto } from 'node:crypto';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { useGameStore } from '@/store/game-store';
import { buildRiftCityStartState } from '@/lib/test/fixtures';
import { parseGameplayPlugins } from '@/lib/game/plugins/manifest';
import { previewPluginUpgrade, applyPluginUpgrade } from '@/lib/game/plugins/upgrade';
import { gameplayLedger } from '@/lib/game/plugins/gameplay-state';
import { worldForModel, snapshotForModel } from '@/lib/game/plugins/model-manifest';
import { loadBlob } from '@/lib/game/cas-storage';
import { buildWorldLineExport, importWorldLineExport } from '@/lib/game/worldline-export';
import { abortActiveStream, setActiveStream, createStreamRequestScope } from '@/lib/game/stream-lifecycle';
import { getPendingActionNodeSave } from '@/lib/game/action-node-commit';
import * as storage from '@/lib/game/storage';
import { scopeStorageKey } from '@/lib/game/archive-scope';
import { commitGameplayOperation } from '@/lib/game/plugins/gameplay-commit';
import type { WorldSnapshot } from '@/lib/game/types';

const base = { format: 'eidos-gameplay-plugin', version: 2, id: 'case', name: '案卷', description: '旧案卷', tags: [], prompts: { creation: '', action: '沿用案情', review: '' }, rules: [], resources: { focus: { name: '专注', initial: 5, min: 0, max: 10 } }, ui: { html: '<p>旧案卷</p>', reading: 'replace' } };
const next = { ...base, release: '2.0', description: '新案卷', stateVersion: 2, resources: { attention: { name: '专注', initial: 5, min: 0, max: 10 } }, ui: { ...base.ui, html: '<p>新案卷</p>' }, migrations: [{ from: 1, to: 2, patches: [
  { op: 'add', path: '/state/investigation', value: {} }, { op: 'move', from: '/state/found', path: '/state/investigation/found' },
  { op: 'move', from: '/facts/evidence', path: '/facts/confirmed' }, { op: 'move', from: '/resources/focus', path: '/resources/attention' },
] }] };
const initial = useGameStore.getState();
beforeEach(async () => {
  vi.stubGlobal('crypto', webcrypto); abortActiveStream();
  const { world } = buildRiftCityStartState();
  useGameStore.setState({ ...initial, currentWorld: { ...world, gameplayPlugins: parseGameplayPlugins([base]) }, currentPlaythroughId: crypto.randomUUID(), worldLine: null, currentNode: null, allNodes: {}, history: [], sandboxMode: false,
    gameplayModState: { case: { found: ['wick'], _eidosWorkspace: { files: {}, stages: [], interpretations: {}, events: [] }, _eidosGameplay: { revision: 2, facts: { evidence: ['wick'] }, last: { id: 'original', revision: 2, summary: '找到灯芯', createdAt: 1, narration: 'complete' } } } },
    worldFlags: { 'gameplay.case.done:inspect': true, unrelated: true }, gameplayResources: { 'gameplay.case.focus': 3 } });
  await useGameStore.getState().initWorldLine(useGameStore.getState().currentPlaythroughId!, world.id);
});
afterEach(() => { abortActiveStream(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function storyStep() {
 const state=useGameStore.getState();
 return commitGameplayOperation(useGameStore,'case',{id:crypto.randomUUID(),expectedRevision:gameplayLedger(state.gameplayModState.case)!.revision,summary:'走进档案室。',state:state.gameplayModState.case,facts:gameplayLedger(state.gameplayModState.case)!.facts,narrate:false});
}
it('previews migration without changing progress and applies it once with the same accepted receipt and files', async () => {
  const before = useGameStore.getState(), preview = await previewPluginUpgrade(useGameStore, next);
  expect(useGameStore.getState().gameplayModState).toBe(before.gameplayModState);
  expect(preview.migrationCount).toBe(1);
  const receipt = await applyPluginUpgrade(useGameStore, preview);
  expect(receipt.persistence).toBe('saved');
  const s = useGameStore.getState();
  expect(s.gameplayModState.case.investigation).toEqual({ found: ['wick'] });
  expect(s.gameplayModState.case.found).toBeUndefined();
  expect(s.gameplayModState.case._eidosWorkspace).toEqual(before.gameplayModState.case._eidosWorkspace);
  expect(gameplayLedger(s.gameplayModState.case)).toMatchObject({ revision: 2, facts: { confirmed: ['wick'] }, last: { id: 'original' } });
  expect(s.gameplayResources).toEqual({ 'gameplay.case.attention': 3 });
  expect(s.worldFlags.unrelated).toBe(true); expect(s.worldFlags['gameplay.case.done:inspect']).toBe(true);
  await expect(applyPluginUpgrade(useGameStore, preview)).rejects.toThrow(/变化|相同/);
  expect(useGameStore.getState().history).toEqual(before.history);
  expect(s.currentNode!.id).toBe(before.currentNode!.id);
  expect(s.worldLine!.allNodeIds).toEqual(before.worldLine!.allNodeIds);
  expect(s.worldLine!.totalSteps).toBe(before.worldLine!.totalSteps);
  expect(s.currentNode!.aiResponse).toBe(before.currentNode!.aiResponse);
});
it('retains package references for real past actions without adding an upgrade action', async () => {
  const root = useGameStore.getState().currentNode!.id;
  await storyStep();
  await applyPluginUpgrade(useGameStore, await previewPluginUpgrade(useGameStore, next));
  const updated = useGameStore.getState().currentNode!.id;
  const snapshot = await loadBlob(useGameStore.getState().currentNode!.snapshotHash) as Record<string, unknown>;
  expect(snapshot.gameplayPluginSet).toMatch(/^[a-f0-9]{16}$/); expect(JSON.stringify(snapshot)).not.toContain('<p>新案卷</p>');
  await useGameStore.getState().backtrackToNode(root);
  expect(useGameStore.getState().currentWorld!.gameplayPlugins![0].ui!.html).toBe('<p>旧案卷</p>');
  expect(useGameStore.getState().gameplayModState.case.found).toEqual(['wick']);
  await useGameStore.getState().backtrackToNode(updated);
  expect(useGameStore.getState().currentWorld!.gameplayPlugins![0].ui!.html).toBe('<p>新案卷</p>');
  expect(useGameStore.getState().gameplayModState.case.investigation).toEqual({ found: ['wick'] });
});
it('preserves technical package references through save/load and portable import', async () => {
  const root = useGameStore.getState().currentNode!.id;
  await storyStep();
  await applyPluginUpgrade(useGameStore, await previewPluginUpgrade(useGameStore, next));
  const s = useGameStore.getState(), saved = s.serializeState(), world = s.currentWorld!;
  const portable = await buildWorldLineExport({ meta: s.worldLine!, allNodes: s.allNodes, world, playerName: '旅客', rootNodeId: root,
    loadSnapshot: hash => loadBlob(hash) as Promise<WorldSnapshot | null>, loadSegments: hash => loadBlob(hash) as Promise<unknown[] | null> });
  useGameStore.getState().deserializeState(saved, world);
  expect(useGameStore.getState().gameplayModState.case.investigation).toEqual({ found: ['wick'] });
  const imported = await importWorldLineExport(portable, world.id, s.currentPlaythroughId!);
  useGameStore.setState({ worldLine: imported.meta, allNodes: imported.allNodes });
  await useGameStore.getState().backtrackToNode(root);
  expect(useGameStore.getState().gameplayModState.case.found).toEqual(['wick']);
  expect(useGameStore.getState().currentWorld!.gameplayPlugins![0].release).toBeUndefined();
});
it.each([
  { ...next, migrations: [] },
  { ...next, migrations: [{ from: 1, to: 2, patches: [{ op: 'add', path: '/state/_eidosWorkspace', value: {} }] }] },
  { ...next, migrations: [{ from: 1, to: 2, patches: [{ op: 'move', from: '/state/missing', path: '/state/found' }] }] },
  { ...next, resources: { attention: { name: '专注', initial: 0, min: 0, max: 2 } } },
])('rejects an incompatible update atomically', async incoming => {
  const before = JSON.stringify(useGameStore.getState().createSnapshot());
  await expect(previewPluginUpgrade(useGameStore, incoming)).rejects.toThrow();
  expect(JSON.stringify(useGameStore.getState().createSnapshot())).toBe(before);
});
it('rejects a stale preview and an update while generation owns the pipeline', async () => {
  const preview = await previewPluginUpgrade(useGameStore, next);
  useGameStore.setState(s => ({ gameplayModState: { ...s.gameplayModState, case: { ...s.gameplayModState.case, found: ['wick', 'bell'] } } }));
  await expect(applyPluginUpgrade(useGameStore, preview)).rejects.toThrow(/变化/);
  const fresh = await previewPluginUpgrade(useGameStore, next);
  setActiveStream(new AbortController(), createStreamRequestScope(useGameStore.getState()));
  await expect(applyPluginUpgrade(useGameStore, fresh)).rejects.toThrow(/等待/);
  expect(useGameStore.getState().currentWorld!.gameplayPlugins![0].release).toBeUndefined();
});
it.each(['worldline_data_','worldline_index_'])('rejects a failed %s write without accepting the update or inventing a retry action',async checkpoint=>{
 const before=useGameStore.getState(),preview=await previewPluginUpgrade(useGameStore,next);
 const save=storage.saveMeta;let fail=true;
 vi.spyOn(storage,'saveMeta').mockImplementation(async(key,value)=>{if(fail && key.includes(checkpoint)) {fail=false;throw new Error('disk full');}return save(key,value);});
 await expect(applyPluginUpgrade(useGameStore,preview)).rejects.toThrow('disk full');
 expect(useGameStore.getState().currentWorld).toBe(before.currentWorld);
 expect(useGameStore.getState().gameplayModState).toBe(before.gameplayModState);
 expect(useGameStore.getState().history).toEqual(before.history);expect(getPendingActionNodeSave(useGameStore)).toBeNull();
 const saved=await storage.loadMeta<{meta:{currentNodeId:string};nodes:typeof before.allNodes}>(scopeStorageKey(before,'worldline_data_'+before.worldLine!.id));
 expect(saved!.nodes[before.currentNode!.id].snapshotHash).toBe(before.currentNode!.snapshotHash);
 const result=await applyPluginUpgrade(useGameStore,preview);
 expect(result.persistence).toBe('saved');expect(result.nodeId).toBe(before.currentNode!.id);
 expect(useGameStore.getState().history).toEqual(before.history);
 expect(useGameStore.getState().gameplayModState.case.investigation).toEqual({found:['wick']});
});
it('excludes old code and migration scripts from model transport', async () => {
  await applyPluginUpgrade(useGameStore, await previewPluginUpgrade(useGameStore, next));
  const world = worldForModel(useGameStore.getState().currentWorld!);
  expect(JSON.stringify(world)).not.toContain('旧案卷</p>'); expect(world.gameplayPluginHistory).toBeUndefined();
  expect(world.gameplayPlugins![0].migrations).toBeUndefined();
  expect(snapshotForModel(useGameStore.getState().createSnapshot())).not.toHaveProperty('gameplayPluginSet');
});
it('keeps the current node prose when live navigation fields have not yet captured it', async () => {
  const state = useGameStore.getState().gameplayModState.case;
  await commitGameplayOperation(useGameStore, 'case', { id: 'prose', expectedRevision: 2, summary: '一页已经生成的正文。', state, facts: { evidence: ['wick'] }, narrate: false });
  useGameStore.setState({ savedSegments: [] });
  const before=useGameStore.getState();
  await applyPluginUpgrade(useGameStore, await previewPluginUpgrade(useGameStore, next));
  const text = await loadBlob(useGameStore.getState().currentNode!.segmentHash);
  expect(text).toEqual([{ type: 'narration', text: '一页已经生成的正文。' }]);
  expect(useGameStore.getState().currentNode).toMatchObject({id:before.currentNode!.id,aiResponse:'一页已经生成的正文。',playerInput:before.currentNode!.playerInput,stepNumber:before.currentNode!.stepNumber,segmentHash:before.currentNode!.segmentHash});
  expect(useGameStore.getState().history).toEqual(before.history);
  expect(useGameStore.getState().worldLine!.allNodeIds).toEqual(before.worldLine!.allNodeIds);
});
it('loads a manual save from before the update and can still visit later nodes with their newer packages', async () => {
  const s = useGameStore.getState(), root = s.currentNode!.id;
  const scene = Object.values(Object.values(s.currentWorld!.regions)[0].scenes)[0];
  useGameStore.setState({ playerName: '测试者', currentSceneId: scene.id, currentScene: scene });
  const save = await useGameStore.getState().saveGame('更新前'); expect(save).toBeTruthy();
  await storyStep();
  await applyPluginUpgrade(useGameStore, await previewPluginUpgrade(useGameStore, next));
  const updated = useGameStore.getState().currentNode!.id;
  expect(await useGameStore.getState().loadGame(save)).toBe(true);
  expect(useGameStore.getState().currentWorld!.gameplayPlugins![0].release).toBeUndefined();
  expect(useGameStore.getState().currentNode!.id).toBe(root);
  await useGameStore.getState().backtrackToNode(updated);
  expect(useGameStore.getState().currentWorld!.gameplayPlugins![0].release).toBe('2.0');
  expect(useGameStore.getState().gameplayModState.case.investigation).toEqual({ found: ['wick'] });
});
it.each(['prompt', 'resource', 'flag'])('updates a valid %s plugin without manufacturing an author state entry', async kind => {
  const { ui: _ui, resources: _resources, ...plain } = base;
  const old = kind === 'resource' ? { ...base, ui: undefined } : { ...plain, version: 1, rules: kind === 'flag' ? [{ id: 'inspect', description: '记录', sets: { inspected: true } }] : [] };
  const resources: Record<string, number> = kind === 'resource' ? { 'gameplay.case.focus': 3 } : {};
  useGameStore.setState(s => ({ currentWorld: { ...s.currentWorld!, gameplayPlugins: parseGameplayPlugins([old]) }, gameplayModState: {}, gameplayResources: resources }));
  await applyPluginUpgrade(useGameStore, await previewPluginUpgrade(useGameStore, { ...old, release: '1.1', description: '更新指南' }));
  expect(useGameStore.getState().currentWorld!.gameplayPlugins![0].release).toBe('1.1');
  expect(useGameStore.getState().gameplayModState).toEqual({});
});

it.each(['worldline_data_','worldline_index_'])('does not apply a late upgrade after leaving its scope during %s',async checkpoint=>{
 const before=useGameStore.getState(),preview=await previewPluginUpgrade(useGameStore,next);
 const save=storage.saveMeta;let moved=false;
 vi.spyOn(storage,'saveMeta').mockImplementation(async(key,value)=>{await save(key,value);if(!moved && key.includes(checkpoint)) {moved=true;useGameStore.setState({currentPlaythroughId:'other-run'});}});
 await expect(applyPluginUpgrade(useGameStore,preview)).rejects.toThrow('变化');
 expect(useGameStore.getState().currentPlaythroughId).toBe('other-run');
 expect(useGameStore.getState().currentWorld).toBe(before.currentWorld);expect(useGameStore.getState().history).toEqual(before.history);
 const saved=await storage.loadMeta<{meta:typeof before.worldLine;nodes:typeof before.allNodes}>(scopeStorageKey(before,'worldline_data_'+before.worldLine!.id));
 expect(saved!.nodes[before.currentNode!.id].snapshotHash).toBe(before.currentNode!.snapshotHash);
});
