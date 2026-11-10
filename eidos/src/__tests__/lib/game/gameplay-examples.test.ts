import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parsePluginFile } from '@/lib/game/plugins/manifest';
import { evaluateGameplayEvents } from '@/lib/game/plugins/runtime';
import { parseWorldImportFiles, finalizeImportedWorld } from '@/lib/game/import-records';
import { buildRiftCityStartState } from '@/lib/test/fixtures';

function world(file: string) {
  return { ...buildRiftCityStartState().world, gameplayPlugins: parsePluginFile(JSON.parse(readFileSync(`docs/examples/${file}.json`, 'utf8'))) };
}
describe('importable v2 gameplay examples', () => {
  it('can explore, gather and recover resources with declared costs in the survival example', () => {
    const w = world('gameplay-survival-resources'), pluginId = w.gameplayPlugins[0].id;
    const first = evaluateGameplayEvents(w, {}, undefined, [{ pluginId, ruleId: 'explore' }, { pluginId, ruleId: 'gather' }]);
    expect(first.resources).toEqual({ 'gameplay.survival-resources.stamina': 3, 'gameplay.survival-resources.supplies': 3 });
    const rested = evaluateGameplayEvents(w, first.flags, first.resources, [{ pluginId, ruleId: 'rest' }]);
    expect(rested.resources['gameplay.survival-resources.stamina']).toBe(5);
    expect(() => evaluateGameplayEvents(w, rested.flags, rested.resources, [{ pluginId, ruleId: 'rest' }])).toThrow();
    const safe = evaluateGameplayEvents(w, { ...first.flags, ...rested.flags }, rested.resources, [{ pluginId, ruleId: 'reach-shelter' }]);
    expect(safe.flags['gameplay.survival-resources.safe']).toBe(true);
  });
  it('requires two distinct pieces of evidence before unlocking the mystery conclusion', () => {
    const w = world('gameplay-mystery-investigation'), pluginId = w.gameplayPlugins[0].id;
    expect(() => evaluateGameplayEvents(w, {}, undefined, [{ pluginId, ruleId: 'compare-evidence' }])).toThrow();
    const first = evaluateGameplayEvents(w, {}, undefined, [{ pluginId, ruleId: 'inspect-scene' }]);
    expect(first.resources).toEqual({ 'gameplay.mystery-investigation.attempts': 2, 'gameplay.mystery-investigation.evidence': 1 });
    const replay = evaluateGameplayEvents(w, first.flags, first.resources, [{ pluginId, ruleId: 'inspect-scene' }]);
    expect(replay.resources['gameplay.mystery-investigation.evidence']).toBe(1);
    const second = evaluateGameplayEvents(w, first.flags, first.resources, [{ pluginId, ruleId: 'interview-witness' }, { pluginId, ruleId: 'compare-evidence' }]);
    expect(second.resources).toEqual({ 'gameplay.mystery-investigation.attempts': 1, 'gameplay.mystery-investigation.evidence': 2 });
    expect(second.flags['gameplay.mystery-investigation.solved']).toBe(true);
    expect(evaluateGameplayEvents(w, {}, undefined, [{ pluginId, ruleId: 'inspect-scene' }]).resources['gameplay.mystery-investigation.evidence']).toBe(1);
  });
  it.each(['gameplay-survival-resources', 'gameplay-mystery-investigation', 'gameplay-door-puzzle'])('preserves declarations in a world export/import: %s', file => {
    const w = world(file);
    const decoded = parseWorldImportFiles([{ path: 'world.json', content: JSON.stringify(w) }]);
    expect(finalizeImportedWorld(decoded.world, { existingWorldIds: new Set() }).gameplayPlugins).toEqual(w.gameplayPlugins);
  });
});
