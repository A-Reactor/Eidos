// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { expect, it } from 'vitest';
import { actionInputIdentity, matchesActionInput } from '@/lib/game/documents/action-draft';
import { missingSpeculationActions } from '@/lib/ai/speculation';
const a = { documentId: 'a', revision: 'v1' }, b = { documentId: 'b', revision: 'v1' };
it('freezes file versions and ignores reference ordering, duplicates and unrelated library edits', () => {
  expect(actionInputIdentity('  核对资料 ', [a, b, a], 'mounted-v1')).toBe(actionInputIdentity('核对资料', [b, a], 'mounted-v1'));
  expect(actionInputIdentity('核对资料', [a])).not.toBe(actionInputIdentity('核对资料', [b]));
  expect(actionInputIdentity('核对资料', [a])).not.toBe(actionInputIdentity('核对资料', [{ ...a, revision: 'v2' }]));
  expect(actionInputIdentity('核对资料', [], 'mounted-v1')).not.toBe(actionInputIdentity('核对资料', [], 'mounted-v2'));
});
it('reuses legacy plain text only without file inputs on both sides', () => {
  const plain = { playerInput: '核对资料' }, linked = { ...plain, inputDocuments: [{ ...a, title: '原件' }] };
  expect(matchesActionInput(plain, '核对资料')).toBe(true);
  expect(matchesActionInput(linked, '核对资料')).toBe(false);
  expect(matchesActionInput(plain, '核对资料', actionInputIdentity('核对资料', [a]))).toBe(false);
  expect(matchesActionInput({ ...linked, inputIdentity: actionInputIdentity('核对资料', [a]) }, '核对资料', actionInputIdentity('核对资料', [a]))).toBe(true);
  expect(missingSpeculationActions(['核对资料'], [linked], 1)).toEqual(['核对资料']);
});

it('keeps same-text file branches distinct and restores their reference history through the actual store', async () => {
  const { useGameStore } = await import('@/store/game-store');
  const { buildRiftCityStartState } = await import('@/lib/test/fixtures');
  const { hashAndStore } = await import('@/lib/game/cas-storage');
  const { world } = buildRiftCityStartState();
  useGameStore.setState(useGameStore.getInitialState()); useGameStore.getState().setCurrentWorld(world);
  const playthroughId = crypto.randomUUID(); useGameStore.setState({ currentPlaythroughId: playthroughId });
  await useGameStore.getState().initWorldLine(playthroughId, world.id);
  const state = useGameStore.getState(), snapshot = state.createSnapshot(), parent = { ...state.currentNode!, snapshotHash: await hashAndStore('snapshot', snapshot) };
  useGameStore.setState({ currentNode: parent, allNodes: { [parent.id]: parent } });
  const base = { timestamp: 1, gameTime: snapshot.currentGameTime, sceneId: snapshot.currentSceneId, sceneName: '', playerInput: '核对资料', aiResponse: '核对完成', summary: '核对', timeSpent: { day: 0, hour: 0, minute: 0 }, worldImpacts: [], snapshot: null };
  const first = await useGameStore.getState().addActionNode({ ...base, id: 'first', inputDocuments: [{ ...a, title: 'A' }], inputIdentity: actionInputIdentity(base.playerInput, [a]) }, snapshot, []);
  await useGameStore.getState().backtrackToNode(parent.id);
  const second = await useGameStore.getState().addActionNode({ ...base, id: 'second', inputDocuments: [{ ...b, title: 'B' }], inputIdentity: actionInputIdentity(base.playerInput, [b]) }, snapshot, []);
  expect(first.id).not.toBe(second.id); expect(useGameStore.getState().allNodes[parent.id].childIds).toHaveLength(2);
  await useGameStore.getState().backtrackToNode(parent.id);
  expect((await useGameStore.getState().tryMatchChildNode(base.playerInput, actionInputIdentity(base.playerInput, [a])))?.id).toBe(first.id);
  expect(useGameStore.getState().history[0]?.inputDocuments).toEqual([{ ...a, title: 'A' }]);
  const { createActionWorkspace } = await import('@/lib/game/workspace/action-session');
  const { createStreamRequestScope } = await import('@/lib/game/stream-lifecycle');
  await useGameStore.getState().backtrackToNode(parent.id);
  const current = useGameStore.getState();
  const session = await createActionWorkspace(current, [], createStreamRequestScope(current), () => true);
  expect(Object.keys(session!.files)).toEqual([]);
});
