// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { useGameStore } from '@/store/game-store';
import { buildRiftCityStartState } from '@/lib/test/fixtures';
import { resourceWorld } from './gameplay-resource-fixtures';

const initial = useGameStore.getInitialState();
const world = () => ({ ...buildRiftCityStartState().world, ...resourceWorld() });
beforeEach(() => {
  useGameStore.setState({ ...initial });
  useGameStore.getState().setCurrentWorld(world());
});
describe('gameplay resource persistence', () => {
  it('starts at declared values and snapshots a copy of zero', () => {
    expect(useGameStore.getState().gameplayResources['gameplay.supplies.stamina']).toBe(3);
    useGameStore.setState({ gameplayResources: { ...useGameStore.getState().gameplayResources, 'gameplay.supplies.stamina': 0 } });
    const snapshot = useGameStore.getState().createSnapshot();
    expect(snapshot.gameplayResources?.['gameplay.supplies.stamina']).toBe(0);
    useGameStore.getState().gameplayResources['gameplay.supplies.stamina'] = 4;
    expect(snapshot.gameplayResources?.['gameplay.supplies.stamina']).toBe(0);
    useGameStore.getState().restoreSnapshot(snapshot);
    expect(useGameStore.getState().gameplayResources['gameplay.supplies.stamina']).toBe(0);
    snapshot.gameplayResources!['gameplay.supplies.stamina'] = 5;
    expect(useGameStore.getState().gameplayResources['gameplay.supplies.stamina']).toBe(0);
  });
  it('round trips a saved ledger without shared references', () => {
    useGameStore.setState({ gameplayResources: { ...useGameStore.getState().gameplayResources, 'gameplay.supplies.food': 0 } });
    const save = useGameStore.getState().serializeState();
    expect(save.gameplayResources?.['gameplay.supplies.food']).toBe(0);
    useGameStore.getState().deserializeState(JSON.parse(JSON.stringify(save)), world());
    expect(useGameStore.getState().gameplayResources['gameplay.supplies.food']).toBe(0);
    save.gameplayResources!['gameplay.supplies.food'] = 5;
    expect(useGameStore.getState().gameplayResources['gameplay.supplies.food']).toBe(0);
  });
  it('restores old snapshots and saves using initial values instead of current-world leftovers', () => {
    const snapshot = useGameStore.getState().createSnapshot();
    delete snapshot.gameplayResources;
    useGameStore.setState({ gameplayResources: { 'gameplay.supplies.stamina': 0 } });
    useGameStore.getState().restoreSnapshot(snapshot);
    expect(useGameStore.getState().gameplayResources['gameplay.supplies.stamina']).toBe(3);
    const save = useGameStore.getState().serializeState();
    delete save.gameplayResources;
    useGameStore.setState({ gameplayResources: { 'gameplay.supplies.stamina': 0 } });
    useGameStore.getState().deserializeState(save, world());
    expect(useGameStore.getState().gameplayResources['gameplay.supplies.stamina']).toBe(3);
  });
  it('resets the ledger when switching world and rejects foreign/corrupted restore before mutation', () => {
    const snapshot = useGameStore.getState().createSnapshot(), time = useGameStore.getState().gameTime;
    expect(() => useGameStore.getState().restoreSnapshot({ ...snapshot, currentGameTime: { day: 99, hour: 0, minute: 0 }, gameplayResources: { 'gameplay.supplies.food': -1 } })).toThrow();
    expect(useGameStore.getState().gameTime).toEqual(time);
    const save = useGameStore.getState().serializeState();
    expect(() => useGameStore.getState().deserializeState({ ...save, gameplayResources: { 'gameplay.other.food': 1 } }, world())).toThrow();
    expect(useGameStore.getState().gameplayResources['gameplay.supplies.food']).toBe(1);
    useGameStore.getState().setCurrentWorld(buildRiftCityStartState().world);
    expect(useGameStore.getState().gameplayResources).toEqual({});
  });
});
