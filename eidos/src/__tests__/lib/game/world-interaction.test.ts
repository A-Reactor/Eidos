import { expect, it } from 'vitest';
import { buildRiftCityStartState } from '@/lib/test/fixtures';
import { buildModScene, worldInteractionInput } from '@/lib/game/plugins/world-interaction';
const state = () => { const { world, snapshot } = buildRiftCityStartState(); return { currentWorld: world, currentSceneId: snapshot.currentSceneId, visitedScenes: snapshot.visitedScenes, availableActions: ['观察旧灯', '调查树下的纸条'], questLog: snapshot.questLog, clues: snapshot.clues }; };
it('exposes only the current public scene, present NPC names, discovered clues and known doors', () => {
 const s = state(), scene = buildModScene(s)!;
 expect(scene.id).toBe(s.currentSceneId); expect(scene.npcs.length).toBeGreaterThan(0);
 expect(JSON.stringify(scene)).not.toContain('personality'); expect(scene).not.toHaveProperty('secrets');
 expect(scene.exits.every(e => !!e.name)).toBe(true); expect(scene.actions).toEqual(s.availableActions);
});
it('routes talking, real inventory use, existing actions and exits to the ordinary narrative input', () => {
 const scene = buildModScene(state())!, npc = scene.npcs[0];
 expect(worldInteractionInput({ kind: 'talk', targetId: npc.id }, scene, [])).toBe(`与${npc.name}交谈。`);
 expect(worldInteractionInput({ kind: 'action', targetId: scene.actions[0] }, scene, [])).toBe(scene.actions[0]);
 expect(worldInteractionInput({ kind: 'use', targetId: npc.id, itemId: 'key' }, scene, [{ id: 'key', name: '旧钥匙', quantity: 1 }])).toContain('旧钥匙');
 expect(() => worldInteractionInput({ kind: 'use', itemId: 'invented' }, scene, [])).toThrow();
 expect(() => worldInteractionInput({ kind: 'talk', targetId: 'unseen-npc' }, scene, [])).toThrow();
 expect(() => worldInteractionInput({ kind: 'travel', targetId: 'unknown' }, scene, [])).toThrow();
});
it('rejects a blocked door, stale action, empty input and unknown interaction fields', () => {
 const scene = buildModScene(state())!; scene.exits = [{ id: 'closed', name: '封闭之门', blocked: true }];
 expect(() => worldInteractionInput({ kind: 'travel', targetId: 'closed' }, scene, [])).toThrow();
 expect(() => worldInteractionInput({ kind: 'action', targetId: '旧的行动' }, scene, [])).toThrow();
 expect(() => worldInteractionInput({ kind: 'custom', text: '' }, scene, [])).toThrow();
 expect(() => worldInteractionInput({ kind: 'custom', text: '环顾', flags: { forged: true } }, scene, [])).toThrow();
});
