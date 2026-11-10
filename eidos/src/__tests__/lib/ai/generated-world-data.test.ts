import { describe, expect, it } from 'vitest';
import { parseGeneratedWorldData, parseGeneratedTimeline, assembleGeneratedWorld } from '@/lib/ai/generated-world-data';
import { buildRiftCityStartState } from '@/lib/test/fixtures';
import { validateMapRegions } from '@/lib/game/map-state';

function fixture() {
  const world = structuredClone(buildRiftCityStartState().world);
  for (const [id, region] of Object.entries(world.regions)) {
    region.id = id;
    for (const scene of Object.values(region.scenes)) { scene.detailLevel ??= 10; scene.discoveredSecrets ??= []; }
  }
  return world;
}
describe('creation map normalization', () => {
  it('accepts region and scene lists without losing descriptions, roads or clues', () => {
    const world = fixture();
    const regions = Object.values(world.regions).map(region => ({ ...region, scenes: Object.values(region.scenes) }));
    const parsed = parseGeneratedWorldData(JSON.stringify({ ...world, regions }));
    expect(parsed.regions).toEqual(world.regions);
    expect(parsed.clues).toEqual(world.clues);
    expect(validateMapRegions(parsed.regions)).toBe(parsed.regions);
  });
  it('canonicalizes keys and unambiguous references together without inventing reverse roads', () => {
    const world = fixture();
    const scene = Object.values(Object.values(world.regions)[0].scenes)[0];
    const raw = { ...world, clues: [{ ...world.clues[0], sceneId: '门口', prerequisiteClues: [], unlocksClues: [] }],
      identityOptions: [{ id: 'gatekeeper', name: '守门人', description: '守着旧镇大门', openingNarrative: '你扶住被风吹动的门。', startingScene: '门口' }],
      regions: { 'old town': { id: 'original', name: '旧镇', scenes: {
        'town/gate': { ...scene, id: 'gate', name: '门口', region: '旧镇', connections: ['harbour'] },
        harbour: { ...scene, id: 'harbour', name: '码头', region: 'original', connections: [] },
      } } }, mapRoutes: [{ from: 'gate', to: 'harbour', status: 'blocked' }] };
    const parsed = parseGeneratedWorldData(JSON.stringify(raw));
    expect(parsed.regions.old_town.scenes.town_gate).toMatchObject({ id: 'town_gate', region: 'old_town', connections: ['harbour'] });
    expect(parsed.regions.old_town.scenes.harbour.connections).toEqual([]);
    expect(parsed.clues[0].sceneId).toBe('town_gate');
    expect(parsed.mapRoutes).toEqual([{ from: 'town_gate', to: 'harbour', status: 'blocked' }]);
    const event = { ...world.timeline[0], sceneId: 'gate' };
    const complete = assembleGeneratedWorld(JSON.stringify({ ...raw, timeline: [event], systemPromptBase: '不可信提示', sourceArchive: { injected: true } }), { id: 'host-owned-id', plugins: [], includeTimeline: true });
    expect(complete.timeline[0]).toMatchObject({ sceneId: 'town_gate', region: 'old_town' });
    expect(complete.identityOptions).toEqual([{ ...raw.identityOptions[0], startingScene: 'town_gate' }]);
    expect(complete.id).toBe('host-owned-id');
    expect(complete.systemPromptBase).not.toBe('不可信提示');
    expect(complete.sourceArchive).toBeUndefined();
  });
  it('leaves missing geography and ambiguous aliases to explicit repair', () => {
    const world = fixture();
    expect(() => parseGeneratedWorldData(JSON.stringify({ ...world, regions: { r: { description: '没有地点' } } }))).toThrow('区域 r 的地点');
    const scenes = Object.values(Object.values(world.regions)[0].scenes);
    scenes[0].connections.push('不存在的地点');
    expect(() => parseGeneratedWorldData(JSON.stringify(world))).toThrow('不存在');
    scenes[0].connections = [];
    scenes[0].name = scenes[1].name = '重复名称';
    scenes[0].connections.push('重复名称');
    expect(() => parseGeneratedWorldData(JSON.stringify(world))).toThrow('歧义');
  });
  it('does not merge canonical ID collisions or unsafe identifiers', () => {
    const world = fixture(), region = Object.values(world.regions)[0];
    expect(() => parseGeneratedWorldData(JSON.stringify({ ...world, regions: { 'old town': region, old_town: region } }))).toThrow('ID 重复');
    expect(() => parseGeneratedWorldData(JSON.stringify({ ...world, regions: JSON.parse('{"__proto__":{}}') }))).toThrow('安全');
  });
  it('rejects incomplete required world fields after map normalization', () => {
    expect(() => parseGeneratedWorldData(JSON.stringify({ ...fixture(), npcs: ['wrong shape'] }))).toThrow('必要字段');
  });
  it('keeps an explicitly empty identity list and rejects broken identity content or scene references', () => {
    const source = fixture();
    const options = { id: 'test-world', plugins: [] };
    expect(assembleGeneratedWorld(JSON.stringify({ ...source, identityOptions: [] }), options).identityOptions).toEqual([]);
    const role = { id: 'visitor', name: '访客', description: '一位旅人', openingNarrative: '你停在门口。', startingScene: 'missing-place' };
    expect(() => assembleGeneratedWorld(JSON.stringify({ ...source, identityOptions: [role] }), options)).toThrow('不存在');
    expect(() => assembleGeneratedWorld(JSON.stringify({ ...source, identityOptions: [{ ...role, openingNarrative: 123 }] }), options)).toThrow('身份');
    expect(() => assembleGeneratedWorld(JSON.stringify({ ...source, identityOptions: {} }), options)).toThrow('身份');
  });
});

it('validates timeline content and resolves actual scene ownership', () => {
  const world = fixture();
  const region = Object.values(world.regions)[0], scene = Object.values(region.scenes)[0];
  const event = { id: 'wt_1', timePoint: { day: 0, hour: 8, minute: 0 }, title: '日出', region: '区域的展示名', sceneId: scene.name,
    description: '有人来到门前', defaultOutcome: '门被推开', npcsInvolved: [], worldFlags: [], playerModifiable: true, rippleEffects: [] };
  expect(parseGeneratedTimeline(JSON.stringify({ timeline: [event] }), world)[0]).toMatchObject({ sceneId: scene.id, region: region.id });
  expect(() => parseGeneratedTimeline('{"timeline":[]}', world)).toThrow('事件列表');
  expect(() => parseGeneratedTimeline(JSON.stringify({ timeline: [{ ...event, sceneId: 'missing' }] }), world)).toThrow('不存在');
  expect(() => parseGeneratedTimeline(JSON.stringify({ timeline: [{ ...event, timePoint: { day: 0, hour: 24, minute: 0 } }] }), world)).toThrow('时间无效');
});
