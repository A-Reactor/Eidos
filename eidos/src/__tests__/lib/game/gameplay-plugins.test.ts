import { describe, expect, it } from 'vitest';
import { parseGameplayPlugins, validateGameModeConfig } from '@/lib/game/plugins/manifest';
import { resolveGameplayPlugins } from '@/lib/game/plugins/builtins';
import { buildGameplayPrompt, evaluatePluginEvents } from '@/lib/game/plugins/runtime';
import { buildQualityPrompt } from '@/lib/ai/kei-review';
import { buildRiftCityStartState } from '@/lib/test/fixtures';
import { parseWorldImportFiles, finalizeImportedWorld } from '@/lib/game/import-records';

const plugin = {
  format: 'eidos-gameplay-plugin', version: 1, id: 'door-puzzle', name: '门锁谜题', description: '找到钥匙后才能开门', tags: ['谜题'],
  prompts: { creation: '准备钥匙的获取路径', action: '只在找到钥匙后开门', review: '核对开门证据' },
  rules: [
    { id: 'find-key', description: '找到钥匙', requires: {}, sets: { key: true } },
    { id: 'open-door', description: '开门', requires: { key: true }, sets: { open: true } },
  ],
};
const world = () => ({ ...buildRiftCityStartState().world, gameplayPlugins: parseGameplayPlugins([plugin]), gameModeConfig: { mode: 'puzzle' } });
describe('data-only gameplay plugins', () => {
  it('preserves phase-specific guides in the actual KEI review prompt', () => {
    expect(buildQualityPrompt(world(), '打开门', '')).toContain('核对开门证据');
    expect(buildGameplayPrompt(world(), 'action')).toContain('只在找到钥匙后开门');
    expect(buildGameplayPrompt(world(), 'creation')).toContain('准备钥匙的获取路径');
  });
  it('includes the real current rule state in the KEI prompt', () => {
    expect(buildQualityPrompt(world(), '打开门', '', { 'gameplay.door-puzzle.key': true })).toContain('"gameplay.door-puzzle.key":true');
  });
  it('round trips the complete declaration and validates imported worlds', () => {
    const decoded = parseWorldImportFiles([{ path: 'world.json', content: JSON.stringify(world()) }]).world;
    const imported = finalizeImportedWorld(decoded, { existingWorldIds: new Set() });
    expect(imported.gameplayPlugins).toEqual(world().gameplayPlugins);
    expect(imported.gameModeConfig).toEqual({ mode: 'puzzle' });
    expect(() => parseWorldImportFiles([{ path: 'world.json', content: JSON.stringify({ ...world(), gameplayPlugins: [{ ...plugin, version: 99 }] }) }])).toThrow();
  });
  it('rejects prototype keys even in nested world configuration', () => {
    expect(() => validateGameModeConfig(JSON.parse('{"mystery":{"__proto__":{"enabled":true}}}'))).toThrow();
  });
  it('can resolve imported plugins without adding executable code to the registry', () => {
    expect(resolveGameplayPlugins(['door-puzzle'], [plugin]).map(p => p.id)).toEqual(['door-puzzle']);
  });
  it.each([
    { ...plugin, version: 2 }, { ...plugin, id: '../outside' }, { ...plugin, script: 'fetch("secret")' },
    { ...plugin, rules: [{ ...plugin.rules[0], sets: JSON.parse('{"__proto__":true}') }] },
    { ...plugin, rules: [{ id: 'open-door', description: '开门', require: { key: true }, sets: { open: true } }] },
    { ...plugin, prompts: { ...plugin.prompts, scripts: 'execute()' } },
  ])('rejects invalid or executable plugin declarations', invalid => {
    expect(() => parseGameplayPlugins([invalid])).toThrow();
  });
  it('rejects duplicates and built-in overrides', () => {
    expect(() => parseGameplayPlugins([plugin, plugin])).toThrow();
    expect(() => resolveGameplayPlugins(['tree-ops'], [{ ...plugin, id: 'tree-ops' }])).toThrow();
  });
  it('checks prerequisites atomically without changing input flags', () => {
    const flags = {};
    expect(() => evaluatePluginEvents(world(), flags, [{ pluginId: 'door-puzzle', ruleId: 'open-door' }])).toThrow();
    expect(flags).toEqual({});
    const patch = evaluatePluginEvents(world(), flags, [{ pluginId: 'door-puzzle', ruleId: 'find-key' }, { pluginId: 'door-puzzle', ruleId: 'open-door' }]);
    expect(patch).toMatchObject({ 'gameplay.door-puzzle.key': true, 'gameplay.door-puzzle.open': true });
    expect(Object.keys(patch).every(key => key.startsWith('gameplay.door-puzzle.'))).toBe(true);
  });
  it('does not repeat a once-only event, but permits it after restoring the old snapshot', () => {
    const events = [{ pluginId: 'door-puzzle', ruleId: 'find-key' }];
    const patch = evaluatePluginEvents(world(), {}, [...events, ...events]);
    expect(evaluatePluginEvents(world(), patch, events)).toEqual({});
    expect(evaluatePluginEvents(world(), {}, events)).toMatchObject({ 'gameplay.door-puzzle.key': true });
  });
  it('rejects events referencing unknown rules or plugins', () => {
    expect(() => evaluatePluginEvents(world(), {}, [{ pluginId: 'door-puzzle', ruleId: 'erase-files' }])).toThrow();
    expect(() => evaluatePluginEvents(world(), {}, [{ pluginId: 'other', ruleId: 'find-key' }])).toThrow();
  });
});
