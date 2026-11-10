// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { beforeEach, expect, it } from 'vitest';
import { useGameStore } from '@/store/game-store';
import { buildRiftCityStartState } from '@/lib/test/fixtures';
import { stageEngineOperation, selectActionOperations } from '@/lib/game/action-operations';

beforeEach(async () => {
  const { world, snapshot } = buildRiftCityStartState();
  useGameStore.setState({ ...useGameStore.getInitialState(), currentWorld: { ...world, gameModeConfig: { rewind: { requires: { ready: true } } } }, currentPlaythroughId: crypto.randomUUID() });
  useGameStore.getState().restoreSnapshot(snapshot);
  const s = useGameStore.getState(); await s.initWorldLine(s.currentPlaythroughId!, world.id);
  const record = { id: crypto.randomUUID(), timestamp: Date.now(), playerInput: '调查', aiResponse: '走到街角。', summary: '调查', sceneId: s.currentSceneId, sceneName: '街角', gameTime: s.gameTime,
    timeSpent: { day: 0, hour: 0, minute: 1 }, worldImpacts: [], availableActions: [], snapshot: null };
  await useGameStore.getState().addActionNode(record, useGameStore.getState().createSnapshot(), [{ type: 'narration', text: '走到街角。' }]);
  await useGameStore.getState().addActionNode({ ...record, id: crypto.randomUUID(), playerInput: '继续走', aiResponse: '走到桥边。' }, useGameStore.getState().createSnapshot(), [{ type: 'narration', text: '走到桥边。' }]);
});
it('returns a staged rewind receipt without restoring the world and requires its real id for final selection', async () => {
  useGameStore.setState({ worldFlags: { ready: true } });
  const source = useGameStore.getState(), target = source.currentNode!.parentId!;
  const receipt = await stageEngineOperation({ method: 'worldline.backtrack', params: { target, reason: '作品能力条件成立' } }, source);
  expect(receipt.status).toBe('staged');
  expect(useGameStore.getState().currentNode?.id).toBe(source.currentNode!.id);
  expect(useGameStore.getState().rewindMemory).toBeNull();
  expect(selectActionOperations({ operationEffects: [receipt.operationId!], segments: [] }, [receipt]).worldImpacts).toEqual([`[BACKTRACK:${target}] 作品能力条件成立`]);
  expect(() => selectActionOperations({ operationEffects: ['invented'] }, [receipt])).toThrow('真实回执');
});
it('does not let structured operations bypass missing game conditions or undeclared methods', async () => {
  const s = useGameStore.getState();
  const receipt = await stageEngineOperation({ method: 'worldline.backtrack', params: { target: s.currentNode!.parentId!, reason: '玩家希望回去' } }, s);
  expect(receipt.status).toBe('failed'); expect(receipt.error).toContain('发动条件');
  const invalid = await stageEngineOperation({ method: 'gameplay.validate', params: { events: [{ pluginId: 'unknown', ruleId: 'grant' }] } }, s);
  expect(invalid.status).toBe('failed'); expect(useGameStore.getState().worldFlags).toEqual(s.worldFlags);
});
