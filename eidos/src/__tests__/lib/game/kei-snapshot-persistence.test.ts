// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useGameStore } from '@/store/game-store';
import { buildRiftCityStartState } from '@/lib/test/fixtures';
import { persistKeiReviewSnapshot } from '@/lib/game/kei-snapshot-persistence';
import * as cas from '@/lib/game/cas-storage';
import type { ActionRecord, WorldSnapshot } from '@/lib/game/types';
import type { KeiReviewOrigin, DirectorFrame } from '@/lib/ai/types';
const initial = useGameStore.getInitialState();
const frame: DirectorFrame = { beatFunction: 'recognition', tensionTarget: 'lower', narrativeFocus: [], revealBudget: { allowNewSecret: false, maxFactsToReveal: 0, forbiddenFacts: [] }, successCriteria: ['认知边界明确'] };
beforeEach(async () => {
  vi.stubGlobal('crypto', webcrypto);
  const { world, snapshot } = buildRiftCityStartState();
  useGameStore.setState({ ...initial, currentWorld: world, currentPlaythroughId: crypto.randomUUID() });
  useGameStore.getState().restoreSnapshot(snapshot);
  await useGameStore.getState().initWorldLine(useGameStore.getState().currentPlaythroughId!, world.id);
  await add('parent');
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function origin(actionId: string): KeiReviewOrigin {
  const s = useGameStore.getState();
  return { worldId: s.currentWorld!.id, playthroughId: s.currentPlaythroughId, worldLineId: s.worldLine!.id,
    archiveScope: 'ordinary', parentNodeId: s.currentNode!.id, actionId };
}
function add(actionId: string) {
  const s = useGameStore.getState();
  const record: ActionRecord = { id: actionId, timestamp: Date.now(), playerInput: actionId, aiResponse: '原文', summary: '',
    gameTime: s.gameTime, sceneId: s.currentSceneId, sceneName: '', timeSpent: { day: 0, hour: 0, minute: 1 }, worldImpacts: [], snapshot: null };
  s.addToHistory(record);
  return s.addActionNode(record, s.createSnapshot(), [{ type: 'narration', text: '原文' }]);
}
function delayNextHash() {
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const original = cas.hashAndStore;
  let intercepted = false;
  vi.spyOn(cas, 'hashAndStore').mockImplementation(async (...args) => {
    if (!intercepted && args[0] === 'snapshot') { intercepted = true; await held; }
    return original(...args);
  });
  return { release, started: () => intercepted };
}
describe('reviewed action snapshot persistence', () => {
  it('waits for a pending child without overwriting its parent snapshot', async () => {
    const o = origin('pending_child');
    const parentHash = useGameStore.getState().currentNode!.snapshotHash;
    const delay = delayNextHash();
    const saving = add(o.actionId);
    useGameStore.getState().setDirectorFrame(frame);
    const reviewed = persistKeiReviewSnapshot(useGameStore, o, useGameStore.getState().createSnapshot());
    delay.release();
    const child = await saving;
    await reviewed;
    expect(await cas.loadBlob(useGameStore.getState().allNodes[child.id].snapshotHash)).toMatchObject({ lastDirectorFrame: frame });
    expect(useGameStore.getState().allNodes[o.parentNodeId!].snapshotHash).toBe(parentHash);
  });
  it('preserves sequential quality and causal corrections in the final snapshot', async () => {
    const o = origin('dual_review'); const node = await add(o.actionId);
    useGameStore.getState().setDirectorFrame(frame);
    const first = persistKeiReviewSnapshot(useGameStore, o, useGameStore.getState().createSnapshot());
    useGameStore.getState().addCriticalFact('新因果证据');
    const second = persistKeiReviewSnapshot(useGameStore, o, useGameStore.getState().createSnapshot());
    await Promise.all([first, second]);
    const snapshot = await cas.loadBlob(useGameStore.getState().allNodes[node.id].snapshotHash) as WorldSnapshot;
    expect(snapshot.lastDirectorFrame).toEqual(frame);
    expect(snapshot.criticalFacts.some(f => f.text === '新因果证据')).toBe(true);
  });
  it('saves the captured correction to its action when backtracking during CAS writing', async () => {
    const o = origin('backtrack_review'); const node = await add(o.actionId);
    const parentHash = useGameStore.getState().allNodes[o.parentNodeId!].snapshotHash;
    const delay = delayNextHash();
    useGameStore.getState().setDirectorFrame(frame);
    const writing = persistKeiReviewSnapshot(useGameStore, o, useGameStore.getState().createSnapshot());
    await vi.waitFor(() => expect(delay.started()).toBe(true));
    await useGameStore.getState().backtrackToNode(o.parentNodeId!);
    delay.release(); await writing;
    expect(useGameStore.getState().currentNode?.id).toBe(o.parentNodeId);
    expect(useGameStore.getState().currentDirectorFrame).toBeNull();
    expect(useGameStore.getState().allNodes[o.parentNodeId!].snapshotHash).toBe(parentHash);
    expect(await cas.loadBlob(useGameStore.getState().allNodes[node.id].snapshotHash)).toMatchObject({ lastDirectorFrame: frame });
  });
  it('discards a write after switching archive scope', async () => {
    const o = origin('old_scope'); const node = await add(o.actionId);
    const delay = delayNextHash();
    useGameStore.getState().setDirectorFrame(frame);
    const writing = persistKeiReviewSnapshot(useGameStore, o, useGameStore.getState().createSnapshot());
    await vi.waitFor(() => expect(delay.started()).toBe(true));
    useGameStore.setState({ sandboxMode: true, sandboxDossierId: '002' });
    delay.release(); await writing;
    expect(useGameStore.getState().allNodes[node.id].snapshotHash).toBe(node.snapshotHash);
  });
  it('keeps the previous blob if metadata persistence fails', async () => {
    const o = origin('failed_write'); const node = await add(o.actionId);
    vi.spyOn(useGameStore.getState(), 'persistWorldLineData').mockResolvedValue();
    useGameStore.getState().setDirectorFrame(frame);
    await expect(persistKeiReviewSnapshot(useGameStore, o, useGameStore.getState().createSnapshot())).rejects.toThrow('审核快照未写入世界线');
    expect(await cas.loadBlob(node.snapshotHash)).not.toBeNull();
  });
});
