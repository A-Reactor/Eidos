import { expect, it, vi } from 'vitest';
import { reviewWorldCreation, verifyWorldCreation } from '@/lib/ai/source-reconstruction/acceptance';
import { briefFromConcept } from '@/lib/game/world-creation-brief';
import { buildRiftCityStartState } from '@/lib/test/fixtures';
import type { WorldForm } from '@/lib/game/creation-materials';
const brief = briefFromConcept({ form: { name: '', overview: '', culture: '', regions: '', npcs: '林必须是医师', contradictions: '', history: '', clues: '', opening: '', narrativeStyle: 'balanced' } as WorldForm });
brief.fields.npcs.required = true;
it('rejects a structurally valid concept world when semantic review finds a required condition missing', async () => {
  const call = vi.fn().mockResolvedValue(JSON.stringify({ issues: [{ code: 'required', message: '缺少医师林', blocking: true }] }));
  await expect(verifyWorldCreation({ brief }, buildRiftCityStartState().world, { call })).rejects.toThrow('缺少医师林');
  expect(call.mock.calls[0][0].userMessage).toContain('林必须是医师');
});
it('retains nonblocking review findings as visible creation warnings', async () => {
  const world = buildRiftCityStartState().world;
  await verifyWorldCreation({ brief }, world, { call: async () => JSON.stringify({ issues: [{ code: 'scope', message: '次要地名仍需补充', blocking: false }] }) });
  expect(world.creationWarnings).toContain('次要地名仍需补充');
});
it('makes at most one targeted repair and rechecks the repaired result', async () => {
  const world = structuredClone(buildRiftCityStartState().world);
  const call = vi.fn().mockResolvedValueOnce(JSON.stringify({ issues: [{ code: 'required', message: '缺少医师林', blocking: true }] })).mockResolvedValueOnce(JSON.stringify({ fields: { npcs: { ...world.npcs, 林: '医师' } } })).mockResolvedValueOnce(JSON.stringify({ issues: [] }));
  await verifyWorldCreation({ brief }, world, { call });
  expect(world.npcs.林).toBe('医师');
  expect(call).toHaveBeenCalledTimes(3);
});
it('preserves valid routes when a personality-only repair replaces a region field', async () => {
  const world = structuredClone(buildRiftCityStartState().world);
  const scenes = Object.values(world.regions).flatMap(r => Object.values(r.scenes));
  const scene = scenes.find(s => s.connections.length > 0)!;
  const original = [...scene.connections], regions = structuredClone(world.regions);
  for (const region of Object.values(regions)) for (const s of Object.values(region.scenes)) s.connections = [];
  const call = vi.fn().mockResolvedValueOnce(JSON.stringify({ issues: [{ code: 'npc_identity', message: '人物职业应为医师', blocking: true }] })).mockResolvedValueOnce(JSON.stringify({ fields: { regions, npcs: { ...world.npcs, 林: '医师' } } })).mockResolvedValueOnce(JSON.stringify({ issues: [] }));
  await verifyWorldCreation({ brief }, world, { call });
  expect(Object.values(world.regions).flatMap(r => Object.values(r.scenes)).find(s => s.id === scene.id)!.connections).toEqual(original);
});

it('scopes the one-shot creation review to explicit constraints and does not buy a schema repair', async () => {
  const call = vi.fn().mockResolvedValue('invalid review JSON');
  await expect(reviewWorldCreation({ brief }, buildRiftCityStartState().world, { call, maxRepairs: 0, verificationScope: 'constraints' })).rejects.toThrow('结构验证');
  expect(call).toHaveBeenCalledOnce();
  expect(call.mock.calls[0][0].systemPrompt).toContain('只核对本次世界的明确约束');
  expect(call.mock.calls[0][0].systemPrompt).toContain('不要要求再次全面自检');
});
