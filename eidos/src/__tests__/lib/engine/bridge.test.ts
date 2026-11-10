import { expect, it } from 'vitest';
import { buildRiftCityStartState } from '@/lib/test/fixtures';
import { buildEidosEngineWorld, engineCommandToPlayerInput } from '@/lib/game/engine-world';
import { createEngineSession, parseEngineWorld } from '@/lib/engine';

it('projects an existing Eidos world without private lore or unread prose', () => {
  const { world: original, snapshot } = buildRiftCityStartState(), world = structuredClone(original);
  world.systemPromptBase = '内部剧情真相'; snapshot.sceneNarrative = '尚未读到的未来正文';
  world.regions[Object.keys(world.regions)[0]].scenes[snapshot.currentSceneId].secrets = ['秘密答案'];
  snapshot.clues = [{ id: 'hidden', name: '隐藏证物', description: '不能公开', sceneId: snapshot.currentSceneId, discovered: false } as typeof snapshot.clues[number]];
  snapshot.inventory = [{ id: 'key', name: '铜钥匙', description: '公开物品', quantity: 1, category: 'key', value: 0, consumable: false, acquiredFrom: snapshot.currentSceneId, acquiredAt: snapshot.currentGameTime }];
  const projected = buildEidosEngineWorld({ world, snapshot });
  expect(parseEngineWorld(projected).currentSceneId).toBe(snapshot.currentSceneId);
  expect(projected.components['item/key'].state).toMatchObject({ quantity: 1, value: 0 });
  const text = JSON.stringify(projected);
  for (const hidden of ['内部剧情真相', '秘密答案', '尚未读到的未来正文', '隐藏证物']) expect(text).not.toContain(hidden);
});

it('validates a portable game command before translating it to the existing action pipeline', async () => {
  const { world, snapshot } = buildRiftCityStartState();
  const projected = buildEidosEngineWorld({ world, snapshot }), session = createEngineSession({ id: 'bridge', world: projected });
  const command = Object.values(projected.commands).find(c => c.id.startsWith('talk/'))!;
  expect(command).toBeDefined();
  const result = await session.requestCommands({ id: 'talk', expectedRevision: 0, commands: [{ commandId: command.id, args: { text: '你好' } }] });
  expect(engineCommandToPlayerInput(result.commands[0], { world, snapshot })).toContain('你好');
  expect(() => engineCommandToPlayerInput({ ...result.commands[0], commandId: 'unknown' }, { world, snapshot })).toThrow();
});
it('resolves dynamic current scenes from the accepted snapshot map', () => {
  const { world, snapshot } = buildRiftCityStartState(), originalScene = snapshot.currentSceneId;
  snapshot.currentSceneId = 'dynamic'; snapshot.visitedScenes.push('dynamic');
  snapshot.mapState = { places: { dynamic: { name: '临时营地', regionId: Object.keys(world.regions)[0], note: '程序建立的公开营地。' } }, routes: [{ from: originalScene, to: 'dynamic', status: 'open' }] };
  const projected = buildEidosEngineWorld({ world, snapshot });
  expect(projected.currentSceneId).toBe('dynamic');
  expect(projected.scenes.dynamic.description).toBe('程序建立的公开营地。');
});
