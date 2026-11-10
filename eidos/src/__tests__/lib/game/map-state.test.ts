import { describe, it, expect, beforeEach } from 'vitest';
import { applyMapUpdates, mappedScene, validateMapRegions, validateInitialMapRoutes } from '@/lib/game/map-state';
import { buildPlayerMap } from '@/lib/game/player-map';
import { buildRiftCityStartState } from '@/lib/test/fixtures';
import { buildWorldContext } from '@/lib/ai/context-builder';
import { useGameStore } from '@/store/game-store';
import type { Scene } from '@/lib/game/types';

function worldFixture() {
  const scene = (id: string, connections: string[]): Scene => ({ id, name: id, region: 'r', initialDescription: '', connections, npcs: [], secrets: [], discoveredSecrets: [], detailLevel: 10 });
  return { ...buildRiftCityStartState().world, regions: { r: { id: 'r', name: '旧城区', description: '', scenes: { a: scene('a', ['b', 'secret']), b: scene('b', ['a']), secret: scene('secret', []) } } }, mapRoutes: [{ from: 'a', to: 'secret', status: 'hidden' as const }] };
}
const discovery = { places: [{ id: 'cellar', name: '地下室', regionId: 'r', note: '书架后的入口已找到。' }], routes: [{ from: 'a', to: 'cellar', status: 'open' as const, bidirectional: true }] };

describe('small map updates', () => {
  it('discovers a place and two-way route without changing the world definition', () => {
    const original = worldFixture();
    const world = applyMapUpdates(original, discovery);
    expect(mappedScene(world, 'cellar')?.connections).toEqual(['a']);
    expect(mappedScene(world, 'a')?.connections).toEqual(['b', 'cellar']);
    expect(original.mapState).toBeUndefined();
    expect(Object.keys(original.regions.r.scenes)).toEqual(['a', 'b', 'secret']);
    expect(buildPlayerMap(world, 'a', ['a']).places.find(p => p.id === 'cellar')).toMatchObject({ note: '书架后的入口已找到。', visited: false, reachable: true });
  });
  it('hides secrets and preserves blocked routes without allowing travel', () => {
    const world = applyMapUpdates(worldFixture(), { routes: [{ from: 'a', to: 'b', status: 'blocked', bidirectional: true }], places: [{ id: 'b', note: '桥梁损坏，暂时无法通行。' }] });
    const map = buildPlayerMap(world, 'a', ['a']);
    expect(map.places.map(p => p.id)).toEqual(['a', 'b']);
    expect(map.paths).toEqual([{ from: 'a', to: 'b', blocked: true }]);
    expect(map.places[1].reachable).toBe(false);
    expect(mappedScene(world, 'a')?.connections).toEqual([]);
    const reopened = applyMapUpdates(world, { routes: [{ from: 'a', to: 'b', status: 'open', bidirectional: true }] });
    expect(buildPlayerMap(reopened, 'a', ['a']).places[1].reachable).toBe(true);
  });
  it('replaces and clears notes; a rumour reveals no passage', () => {
    let world = applyMapUpdates(worldFixture(), { places: [{ id: 'b', note: '传闻：有人在附近看到暗门。' }] });
    world = applyMapUpdates(world, { places: [{ id: 'b', note: '已确认只是普通墙面。' }] });
    expect(world.mapState?.places.b.note).toBe('已确认只是普通墙面。');
    world = applyMapUpdates(world, { places: [{ id: 'b', note: '' }] });
    expect(buildPlayerMap(world, 'a', ['a']).places.find(p => p.id === 'b')?.note).toBeUndefined();
    expect(world.mapState?.routes).toEqual([]);
  });
  it('rejects invalid batches atomically and unsafe identifiers', () => {
    const original = worldFixture();
    expect(() => applyMapUpdates(original, { ...discovery, routes: [{ from: 'a', to: 'missing', status: 'open', bidirectional: true }] })).toThrow();
    expect(original.mapState).toBeUndefined();
    expect(() => applyMapUpdates(original, { routes: [{ from: 'a', to: 'b', status: 'hidden', bidirectional: false }] })).toThrow();
    expect(() => applyMapUpdates(original, { places: [{ id: '__proto__', note: 'x' }] })).toThrow();
    expect(() => applyMapUpdates(original, { places: [{ id: 'new', name: '新点', regionId: 'missing', note: '' }] })).toThrow();
  });
  it('validates generated IDs and links without inventing reverse roads', () => {
    const world = worldFixture();
    expect(validateMapRegions(world.regions)).toBe(world.regions);
    expect(validateInitialMapRoutes(world.regions, world.mapRoutes)).toEqual(world.mapRoutes);
    expect(() => validateInitialMapRoutes(world.regions, [{ from: 'a', to: 'missing', status: 'hidden' }])).toThrow();
    world.regions.r.scenes.b.connections = ['unknown'];
    expect(() => validateMapRegions(world.regions)).toThrow();
  });
});

describe('map branch and save integration', () => {
  beforeEach(() => {
    const world = worldFixture();
    useGameStore.setState({ currentWorld: world, currentSceneId: 'a', currentScene: world.regions.r.scenes.a, visitedScenes: ['a'], history: [], phase: 'map', isLoading: false, mapTravelRequest: null });
  });
  it('restores topology and notes across branches, including legacy snapshots', () => {
    const before = useGameStore.getState().createSnapshot();
    expect(useGameStore.getState().applyMapUpdates(discovery)).toBe(true);
    const after = useGameStore.getState().createSnapshot();
    useGameStore.getState().restoreSnapshot(before);
    expect(mappedScene(useGameStore.getState().currentWorld!, 'cellar')).toBeNull();
    useGameStore.getState().restoreSnapshot(after);
    expect(mappedScene(useGameStore.getState().currentWorld!, 'cellar')?.name).toBe('地下室');
    delete before.mapState;
    useGameStore.getState().restoreSnapshot(before);
    expect(mappedScene(useGameStore.getState().currentWorld!, 'cellar')).toBeNull();
    expect(after.mapState?.places.cellar.note).toBe('书架后的入口已找到。');
  });
  it('starts a new world without carrying over the previous playthrough map', () => {
    useGameStore.getState().applyMapUpdates(discovery);
    const previous = useGameStore.getState().currentWorld!;
    useGameStore.getState().setCurrentWorld(previous);
    expect(mappedScene(useGameStore.getState().currentWorld!, 'cellar')).toBeNull();
    expect(mappedScene(previous, 'cellar')?.name).toBe('地下室');
  });
  it('round-trips the current branch through save JSON and resolves new scene', () => {
    useGameStore.getState().applyMapUpdates(discovery);
    useGameStore.setState({ currentSceneId: 'cellar' });
    const save = JSON.parse(JSON.stringify(useGameStore.getState().serializeState()));
    useGameStore.getState().deserializeState(save, worldFixture());
    expect(useGameStore.getState().currentScene?.name).toBe('地下室');
    expect(useGameStore.getState().currentScene?.connections).toEqual(['a']);
    delete save.mapState;
    useGameStore.getState().deserializeState(save, useGameStore.getState().currentWorld!);
    expect(mappedScene(useGameStore.getState().currentWorld!, 'cellar')).toBeNull();
  });
  it('refuses blocked map requests and sends current notes and routes to the model', () => {
    useGameStore.getState().applyMapUpdates({ routes: [{ from: 'a', to: 'b', status: 'blocked', bidirectional: true }], places: [{ id: 'b', note: '桥梁损坏。' }] });
    expect(useGameStore.getState().requestMapTravel('b')).toBe(false);
    useGameStore.getState().navigateToScene('b');
    expect(useGameStore.getState().currentSceneId).toBe('a');
    const world = useGameStore.getState().currentWorld!;
    const snapshot = useGameStore.getState().createSnapshot();
    const context = buildWorldContext({ world, snapshot, forceFull: true });
    expect(context).toContain('a → b: blocked');
    expect(context).toContain('桥梁损坏。');
    const old = buildWorldContext({ world, snapshot: { ...snapshot, mapState: undefined }, forceFull: true });
    expect(old).not.toContain('桥梁损坏。');
  });
});
