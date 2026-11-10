import { describe, expect, it } from 'vitest';
import { createCourtyardGame, restoreCourtyardGame } from '../../../../dev/engine-game/game';
import { projectNpcMemoryState } from '@/lib/game/npc-memory-save';

function travel(game: ReturnType<typeof createCourtyardGame>, to: string) {
  const { world } = game.getSnapshot().engine;
  return Object.values(world.commands).find(c => c.target.kind === 'mapEdge' && world.map.edges[c.target.id].to === to)!.id;
}

describe('independent courtyard game using shared RPG settlement', () => {
  it('reports a failed door interaction without consuming resources or moving time', async () => {
    const game = createCourtyardGame(), before = game.getSnapshot().game.snapshot;
    const result = await game.interact('unlock-door');
    expect(result.result.status).toBe('failed');
    expect(game.getSnapshot().game.snapshot).toEqual(before);
    expect(result.narration.segments[0].text).toContain('钥匙');
    expect(game.getSnapshot().engine.receipts.at(-1)?.status).toBe('failed');
  });

  it('connects pickup, rule resources, door state and real map movement', async () => {
    const game = createCourtyardGame();
    await expect(game.interact(travel(game, 'garden'))).rejects.toThrow();
    await game.interact('take-key');
    expect(game.getSnapshot().game.snapshot.inventory).toMatchObject([{ id: 'brass-key', quantity: 1 }]);
    expect(game.getSnapshot().game.snapshot.gameplayResources?.['gameplay.courtyard.keys']).toBe(1);
    await game.interact('unlock-door');
    const opened = game.getSnapshot();
    expect(opened.game.snapshot.inventory).toEqual([]);
    expect(opened.game.snapshot.gameplayResources?.['gameplay.courtyard.keys']).toBe(0);
    expect(opened.engine.world.components['courtyard-door'].state.locked).toBe(false);
    expect(Object.values(opened.engine.world.map.edges).some(e => e.from === 'hall' && e.to === 'garden' && !e.blocked)).toBe(true);
    await game.interact(travel(game, 'garden'));
    expect(game.getSnapshot().game.snapshot.currentSceneId).toBe('garden');
    expect(game.getSnapshot().engine.world.currentSceneId).toBe('garden');
    expect(game.getSnapshot().game.history.at(-1)?.sceneId).toBe('garden');
  });

  it('uses the same dialogue and canonical NPC memory as the production RPG', async () => {
    const game = createCourtyardGame(), world = game.getSnapshot().engine.world;
    const talk = Object.values(world.commands).find(c => c.target.kind === 'component' && world.components[c.target.id].kind === 'npc')!;
    const result = await game.interact(talk.id);
    expect(result.narration.segments[0].text).toContain('守门人');
    expect(projectNpcMemoryState(game.getSnapshot().game.snapshot.npcMemory).relationships.守门人.trust).toBe(2);
  });

  it('persists compact checkpoints and resumes a staged pickup without granting the item twice', async () => {
    let disk: ReturnType<ReturnType<typeof createCourtyardGame>['exportSave']> | undefined;
    const game = createCourtyardGame((save, previous) => {
      expect(previous).toBe(disk?.revision ?? null);
      disk = JSON.parse(JSON.stringify(save));
    });
    await game.persist();
    await game.request('take-key');
    await game.executePending();
    expect(disk).toMatchObject({ revision: 3, engine: { format: 'eidos-engine-compact', revision: 1 } });
    expect(disk!.engine).not.toHaveProperty('pending');

    const restored = restoreCourtyardGame(disk);
    expect(restored.getSnapshot().engine.pending).toHaveLength(1);
    await restored.resumePending();
    await restored.resumePending();
    expect(restored.getSnapshot().executions).toHaveLength(1);
    expect(restored.getSnapshot().engine.pending).toEqual([]);
    expect(restored.getSnapshot().game.snapshot.inventory).toMatchObject([{ id: 'brass-key', quantity: 1 }]);
    expect(restored.getSnapshot().game.snapshot.historyLength).toBe(1);
    expect(restored.getSnapshot().engine.world.components['item/brass-key'].state.quantity).toBe(1);
  });

  it('restores a legacy demo save with executed but unreported work', async () => {
    const game = createCourtyardGame();
    await game.request('take-key');
    await game.executePending();
    const { game: state, engine, executions } = game.getSnapshot();
    const legacy = { format: 'eidos-courtyard-demo', version: 1, sequence: 1, ...state, engine, executions };
    const restored = restoreCourtyardGame(JSON.parse(JSON.stringify(legacy)));
    await restored.resumePending();
    expect(restored.getSnapshot().game.snapshot.inventory[0].quantity).toBe(1);
    expect(restored.getSnapshot().executions).toHaveLength(1);
  });

  it('restores unexecuted pending work and keeps imported save data isolated', async () => {
    const original = createCourtyardGame();
    await original.request('take-key');
    const save = original.exportSave(), restored = restoreCourtyardGame(save);
    save.game.snapshot.playerName = '外部改写';
    await restored.resumePending();
    expect(restored.getSnapshot().engine.pending).toEqual([]);
    expect(restored.getSnapshot().game.snapshot.playerName).not.toBe('外部改写');
    expect(restored.getSnapshot().game.snapshot.inventory).toHaveLength(1);
  });

  it('rejects illegal command arguments at the game boundary', async () => {
    const game = createCourtyardGame(), before = game.getSnapshot().game;
    const outcome = await game.interact('take-key', { injected: true });
    expect(outcome.result.status).toBe('failed');
    expect(game.getSnapshot().game).toEqual(before);
  });

  it('recovers a staged result after a failed report save', async () => {
    let disk: ReturnType<ReturnType<typeof createCourtyardGame>['exportSave']> | undefined;
    const game = createCourtyardGame(save => {
      if (save.revision === 3) throw new Error('磁盘不可写');
      disk = save;
    });
    await expect(game.interact('take-key')).rejects.toThrow('磁盘不可写');
    expect(disk?.revision).toBe(2);
    expect(game.getSnapshot().engine.pending).toHaveLength(1);
    const restored = restoreCourtyardGame(disk);
    await restored.resumePending();
    expect(restored.getSnapshot().executions).toHaveLength(1);
    expect(restored.getSnapshot().game.snapshot.inventory[0].quantity).toBe(1);
  });

  it('rejects a save whose host snapshot differs from its command/result journal', () => {
    const save = createCourtyardGame().exportSave();
    save.game.snapshot.currentGameTime.minute = 15;
    expect(() => restoreCourtyardGame(save)).toThrow(/projection/i);
  });
});
