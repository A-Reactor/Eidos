import { describe, it, expect } from 'vitest';
import { buildPlayerMap } from '@/lib/game/player-map';
import { buildRiftCityStartState } from '@/lib/test/fixtures';
import type { Scene, WorldDefinition } from '@/lib/game/types';

export function mapWorld(): WorldDefinition {
  const scene = (id: string, name: string, connections: string[]) => ({ id, name, connections, region: 'region_main', initialDescription: '未读房间秘密', secrets: ['隐藏机关'], npcs: [], detailLevel: 0, discoveredSecrets: [] }) as Scene;
  return { ...buildRiftCityStartState().world, regions: { region_main: { id: 'region_main', description: '秘密区域描述', scenes: {
    a: scene('a', '宿舍房间', ['b']), b: scene('b', '集合厅', ['secret', 'c']), c: scene('c', '旧庭院', ['a']), secret: scene('secret', '隐藏密室', []),
  } } } };
}
describe('player map visibility', () => {
  it('uses outgoing routes for reachability and hides unknown routes and payloads', () => {
    const map = buildPlayerMap(mapWorld(), 'a', ['a', 'c']);
    expect(map.places.map(p => [p.id, p.reachable])).toEqual([['a', false], ['b', true], ['c', false]]);
    expect(map.paths).toEqual([{ from: 'a', to: 'b' }, { from: 'c', to: 'a' }]);
    expect(JSON.stringify(map)).not.toMatch(/隐藏密室|未读房间秘密|隐藏机关|秘密区域描述/);
    expect(map.places[0].regionName).toBe('区域 01');
  });
  it('handles missing world, dangling links and a missing current scene safely', () => {
    expect(buildPlayerMap(null, 'a', [])).toEqual({ places: [], paths: [] });
    const world = mapWorld(); world.regions.region_main.scenes.a.connections.push('missing');
    expect(buildPlayerMap(world, 'a', []).places).toHaveLength(2);
    expect(buildPlayerMap(world, 'missing', ['c']).places[0].reachable).toBe(false);
  });
});
