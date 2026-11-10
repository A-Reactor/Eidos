// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useGameStore } from '@/store/game-store';
import { buildRiftCityStartState } from '@/lib/test/fixtures';
import { parseGameplayPlugins } from '@/lib/game/plugins/manifest';
import { gameplayLedger, preserveGameplayLedger } from '@/lib/game/plugins/gameplay-state';
import { commitGameplayOperation, commitGameplayRule } from '@/lib/game/plugins/gameplay-commit';
import { createStreamRequestScope, abortActiveStream } from '@/lib/game/stream-lifecycle';
import * as cas from '@/lib/game/cas-storage';
import { getPendingActionNodeSave } from '@/lib/game/action-node-commit';
import { resourcePluginDraft } from './gameplay-resource-fixtures';

const initial = useGameStore.getState();
const operation = { id: 'explore-one', expectedRevision: 0, summary: '用两点体力探索，发现了一处路标。',
  state: { progress: ['road-sign'] }, facts: { discovered: 'road-sign' }, events: [{ pluginId: 'supplies', ruleId: 'explore' }] };
beforeEach(async () => {
  vi.stubGlobal('crypto', webcrypto); abortActiveStream();
  const { world, snapshot } = buildRiftCityStartState();
  useGameStore.setState({ ...initial, phase: 'playing', currentWorld: { ...world, gameplayPlugins: parseGameplayPlugins([{ ...resourcePluginDraft, ui: { html: '<p>author</p>', reading: 'inherit' } }]) },
    currentPlaythroughId: crypto.randomUUID(), currentSceneId: snapshot.currentSceneId, gameTime: snapshot.currentGameTime,
    history: [], worldFlags: {}, gameplayResources: { 'gameplay.supplies.stamina': 3, 'gameplay.supplies.food': 1, 'gameplay.supplies.secret': 0 },
    gameplayModState: { supplies: { selected: 'clock' } }, worldLine: null, currentNode: null, allNodes: {}, sandboxMode: false });
  await useGameStore.getState().initWorldLine(useGameStore.getState().currentPlaythroughId!, world.id);
});
afterEach(() => { abortActiveStream(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it('commits one formal result, a worldline checkpoint and its explicit facts without a model', async () => {
  const root = useGameStore.getState().currentNode!.id;
  const receipt = await commitGameplayOperation(useGameStore, 'supplies', operation);
  const state = useGameStore.getState();
  expect(receipt).toMatchObject({ id: 'explore-one', revision: 1, narration: 'pending' });
  expect(state.gameplayResources['gameplay.supplies.stamina']).toBe(1);
  expect(state.history).toHaveLength(1);
  expect(state.currentNode?.summary).toBe(operation.summary);
  expect(gameplayLedger(state.gameplayModState.supplies)?.facts).toEqual({ discovered: 'road-sign' });
  const child = state.currentNode!.id;
  await state.backtrackToNode(root);
  expect(useGameStore.getState().gameplayResources['gameplay.supplies.stamina']).toBe(3);
  expect(gameplayLedger(useGameStore.getState().gameplayModState.supplies)).toBeUndefined();
  await useGameStore.getState().backtrackToNode(child);
  expect(useGameStore.getState().gameplayResources['gameplay.supplies.stamina']).toBe(1);
  expect(gameplayLedger(useGameStore.getState().gameplayModState.supplies)?.last.id).toBe('explore-one');
});
it('performs a declared rule with the same author effects and spends once on a repeated request', async () => {
  const s = useGameStore.getState(), plugin = s.currentWorld!.gameplayPlugins![0];
  useGameStore.setState({ currentWorld: { ...s.currentWorld!, gameplayPlugins: parseGameplayPlugins([{ ...plugin, rules: plugin.rules.map(r => r.id === 'explore' ? { ...r, effects: { state: [{ op: 'add', path: '/found', value: 'wick' }], facts: [{ op: 'add', path: '/wick', value: true }] } } : r) }]) } });
  const first = await commitGameplayRule(useGameStore, 'supplies', { ruleId: 'explore', id: 'button-one', expectedRevision: 0, narrate: false });
  expect(first).toMatchObject({ id: 'button-one', revision: 1, narration: 'none' });
  await commitGameplayRule(useGameStore, 'supplies', { ruleId: 'explore', id: 'button-one', expectedRevision: 0 });
  expect(useGameStore.getState().gameplayResources['gameplay.supplies.stamina']).toBe(1);
  expect(useGameStore.getState().gameplayModState.supplies.found).toBe('wick');
  expect(gameplayLedger(useGameStore.getState().gameplayModState.supplies)?.facts).toEqual({ wick: true });
});
it('returns the same receipt after a lost acknowledgment without spending or advancing twice', async () => {
  const first = await commitGameplayOperation(useGameStore, 'supplies', operation);
  const node = useGameStore.getState().currentNode!.id;
  const retry = await commitGameplayOperation(useGameStore, 'supplies', operation);
  expect(retry.id).toBe(first.id); expect(retry.revision).toBe(1);
  expect(useGameStore.getState().gameplayResources['gameplay.supplies.stamina']).toBe(1);
  expect(useGameStore.getState().currentNode?.id).toBe(node);
  expect(useGameStore.getState().history).toHaveLength(1);
});
it('accepts authored dialogue with facts once and preserves the exact prose through CAS, export and rewind', async () => {
  const root = useGameStore.getState().currentNode!.id, segments = [{ type: 'narration', text: '  邮车已经离开。\n纸上的日期没有改变。' }, { type: 'dialogue', speaker: '阿澄', text: '请让它迟到，也让它抵达。' }];
  const result = await commitGameplayOperation(useGameStore, 'supplies', { ...operation, segments });
  const node = useGameStore.getState().currentNode!;
  expect(await cas.loadBlob(node.segmentHash)).toEqual(segments);
  expect(node.aiResponse).toContain('阿澄'); expect(node.aiResponse).toContain('  邮车');
  const exported = await useGameStore.getState().exportWorldLine(root);
  expect(exported.segments[node.segmentHash]).toEqual(segments);
  await commitGameplayOperation(useGameStore, 'supplies', { ...operation, segments });
  expect(useGameStore.getState().currentNode?.id).toBe(result.nodeId);
  await useGameStore.getState().backtrackToNode(root);
  await useGameStore.getState().backtrackToNode(node.id);
  expect(useGameStore.getState().savedSegments).toEqual(segments);
  expect(gameplayLedger(useGameStore.getState().gameplayModState.supplies)?.facts).toEqual(operation.facts);
});
it.each([[], [{ type: 'unknown', text: '无效' }], [{ type: 'narration', text: '' }], [{ type: 'dialogue', text: '没有说话人' }]].map(segments => ({ segments })))('rejects invalid authored prose before changing progress: %j', async ({ segments }) => {
  const before = useGameStore.getState();
  await expect(commitGameplayOperation(useGameStore, 'supplies', { ...operation, segments })).rejects.toThrow(/正文|说话人/);
  expect(useGameStore.getState()).toBe(before);
});
it('rejects stale or impossible proposals without partially saving author progress', async () => {
  await commitGameplayOperation(useGameStore, 'supplies', operation);
  await expect(commitGameplayOperation(useGameStore, 'supplies', { ...operation, id: 'stale' })).rejects.toThrow(/版本/);
  await expect(commitGameplayOperation(useGameStore, 'supplies', { ...operation, id: 'no-stamina', expectedRevision: 1, state: { progress: ['impossible'] } })).rejects.toThrow(/资源/);
  expect(useGameStore.getState().gameplayModState.supplies.progress).toEqual(['road-sign']);
  expect(useGameStore.getState().history).toHaveLength(1);
});
it('serializes two panels so they cannot both consume the same accepted revision', async () => {
  const results = await Promise.allSettled([commitGameplayOperation(useGameStore, 'supplies', operation), commitGameplayOperation(useGameStore, 'supplies', { ...operation, id: 'second' })]);
  expect(results.map(r => r.status)).toEqual(['fulfilled', 'rejected']);
  expect(useGameStore.getState().gameplayResources['gameplay.supplies.stamina']).toBe(1);
});
it('discards a preparation if another world is selected while its first checkpoint is being written', async () => {
  const actual = cas.hashAndStore; let finish!: () => void;
  vi.spyOn(cas, 'hashAndStore').mockImplementationOnce(async (...args) => { await new Promise<void>(resolve => { finish = resolve; }); return actual(...args); });
  const scope = createStreamRequestScope(useGameStore.getState());
  const work = commitGameplayOperation(useGameStore, 'supplies', operation, scope);
  await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
  useGameStore.setState({ currentWorld: { ...useGameStore.getState().currentWorld!, id: 'other-world' } });
  finish(); await expect(work).rejects.toThrow(/变化/);
  expect(useGameStore.getState().gameplayResources['gameplay.supplies.stamina']).toBe(3);
  expect(useGameStore.getState().history).toEqual([]);
});
it('does not allow a presentation edit to erase or forge the accepted ledger', async () => {
  await commitGameplayOperation(useGameStore, 'supplies', operation);
  const current = useGameStore.getState().gameplayModState.supplies;
  const next = preserveGameplayLedger(current, { selected: 'new', _eidosGameplay: { revision: 99 } });
  expect(next.selected).toBe('new'); expect(gameplayLedger(next)?.revision).toBe(1);
});
it('retains a failed checkpoint until the same accepted operation is saved, without accepting a later result', async () => {
  const authored = { ...operation, segments: [{ type: 'narration', text: '写入失败也不应丢失的作者正文。' }] };
  const actual = useGameStore.getState().addActionNode;
  const save = vi.fn(actual).mockRejectedValueOnce(new Error('disk unavailable'));
  useGameStore.setState({ addActionNode: save });
  expect(await commitGameplayOperation(useGameStore, 'supplies', authored)).toMatchObject({ persistence: 'pending', revision: 1 });
  await expect(commitGameplayOperation(useGameStore, 'supplies', { ...operation, id: 'later', expectedRevision: 1, events: [] })).rejects.toThrow(/保存/);
  expect(getPendingActionNodeSave(useGameStore)?.action.id).toBe('gameplay:supplies:explore-one');
  expect(useGameStore.getState().history).toHaveLength(1);
  expect(await commitGameplayOperation(useGameStore, 'supplies', authored)).toMatchObject({ persistence: 'saved', revision: 1 });
  expect(await cas.loadBlob(useGameStore.getState().currentNode!.segmentHash)).toEqual(authored.segments);
  expect(getPendingActionNodeSave(useGameStore)).toBeNull();
  expect(useGameStore.getState().gameplayResources['gameplay.supplies.stamina']).toBe(1);
  expect(save).toHaveBeenCalledTimes(2);
});
