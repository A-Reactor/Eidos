import { expect, it } from 'vitest';
import { parseGameplayPlugins } from '@/lib/game/plugins/manifest';
import { buildGameplayStaticPrompt, evaluateGameplayEvents } from '@/lib/game/plugins/runtime';
import { exportPluginFile, mergePluginLibrary } from '@/lib/game/plugins/library';
import { buildUzqGameplayPrompt } from '@/lib/ai/uzq-gameplay';
import { parseWorldImportFiles, finalizeImportedWorld } from '@/lib/game/import-records';
import { buildRiftCityStartState } from '@/lib/test/fixtures';
import { openPlugin } from './plugin-open-fixtures';

it.each([1, 2])('preserves free author data through file, library and world round trips on v%s', version => {
  const raw = version === 1 ? { ...openPlugin, version, resources: undefined, readouts: [openPlugin.readouts[0]] } : openPlugin;
  // v1 has no numeric declaration; omit the field rather than sending undefined over JSON.
  const plugins = parseGameplayPlugins(JSON.parse(JSON.stringify([raw])));
  const imported = parseGameplayPlugins([JSON.parse(exportPluginFile(plugins))]);
  expect(imported[0].data).toEqual({ deck: ['灯塔', '旧信'], clues: { signal: { notes: ['从不同方向探索'], discovered: false } }, arbitrary: [null, 0, false] });
  expect(imported[0].readouts?.[0]).toEqual({ id: 'signal', text: '寻找未知信号', requires: { found: false }, resourceRequires: {}, placement: 'left', tone: 'cyan' });
  expect(mergePluginLibrary(plugins, imported)).toHaveLength(1);
  const world = { ...buildRiftCityStartState().world, gameplayPlugins: imported };
  const restored = finalizeImportedWorld(parseWorldImportFiles([{ path: 'world.json', content: JSON.stringify(world) }]).world, { existingWorldIds: new Set() });
  expect(restored.gameplayPlugins?.[0].data).toEqual(imported[0].data);
});

it('delivers author data to all model phases but keeps readouts out of their prompts', () => {
  const plugins = parseGameplayPlugins([openPlugin]);
  const changed = parseGameplayPlugins([{ ...openPlugin, readouts: [{ id: 'different', text: '换一种提示', placement: 'right', tone: 'coral' }] }]);
  for (const phase of ['creation', 'action', 'review'] as const) {
    const prompt = buildGameplayStaticPrompt({ gameplayPlugins: plugins }, phase);
    expect(prompt).toContain('"deck":["灯塔","旧信"]');
    expect(prompt).not.toContain('寻找未知信号');
    expect(prompt).toBe(buildGameplayStaticPrompt({ gameplayPlugins: changed }, phase));
    expect(prompt).not.toBe(buildGameplayStaticPrompt({ gameplayPlugins: parseGameplayPlugins([{ ...openPlugin, data: { different: '另一个世界' } }]) }, phase));
  }
  const uzq = buildUzqGameplayPrompt(plugins).stablePrefix;
  expect(uzq).toContain('"deck":["灯塔","旧信"]');
  expect(uzq).not.toContain('寻找未知信号');
  expect(uzq).toBe(buildUzqGameplayPrompt(changed).stablePrefix);
});

it('permits a guide-only plugin without injecting unrelated event restrictions or changing state', () => {
  const plugins = parseGameplayPlugins([{ ...openPlugin, resources: {}, readouts: [] }]);
  const flags = { 'gameplay.open-story.found': false };
  expect(buildGameplayStaticPrompt({ gameplayPlugins: plugins }, 'action')).not.toContain('resourceChanges');
  expect(buildGameplayStaticPrompt({ gameplayPlugins: plugins }, 'review')).not.toContain('pluginEvents');
  expect(evaluateGameplayEvents({ gameplayPlugins: plugins }, flags, {}, undefined)).toEqual({ flags: {}, resources: {} });
  expect(flags).toEqual({ 'gameplay.open-story.found': false });
});

it.each([
  [], 5, { amount: Infinity }, { broken: undefined }, { nested: JSON.parse('{"__proto__":true}') },
])('rejects non-JSON author data %j', data => {
  expect(() => parseGameplayPlugins([{ ...openPlugin, data }])).toThrow();
});

it.each([
  [{ id: 'same', text: '一' }, { id: 'same', text: '二' }],
  [{ id: 'status', text: '' }], [{ id: 'status', text: '提示', requires: { found: 1 } }],
  [{ id: 'status', text: '提示', resourceRequires: { missing: { min: 1 } } }],
  [{ id: 'status', text: '提示', placement: ['left'] }], [{ id: 'status', text: '提示', tone: 'url(js)' }],
  [{ id: 'status', text: '提示', script: 'execute()' }],
].map(readouts => ({ readouts })))('rejects broken readout declarations %j', ({ readouts }) => {
  expect(() => parseGameplayPlugins([{ ...openPlugin, readouts }])).toThrow();
});
