import { expect, it } from 'vitest';
import { parsePluginFile } from '@/lib/game/plugins/manifest';
import { isGameplayPluginActive } from '@/lib/game/plugins/activation';
import { buildGameplayRuntimePrompt, buildGameplayStaticPrompt, evaluatePluginEvents } from '@/lib/game/plugins/runtime';
import { mergeModPreferenceDraft, normalizeModPreferences, pluginPreferences } from '@/lib/game/plugins/preferences';
import { gameplayPluginForModel } from '@/lib/game/plugins/model-manifest';
import { activeGameplayReadouts } from '@/lib/game/plugins/readouts';
const raw = { format: 'eidos-gameplay-plugin', version: 1, id: 'trial', name: '庭审', description: '条件庭审测试', tags: [], prompts: { creation: '', action: '庭审中质询', review: '' }, activation: { requires: { trial: true }, scenes: ['court'] }, rules: [{ id: 'enter', description: '开庭', requires: { trial: false }, sets: { trial: true } }, { id: 'leave', description: '休庭', requires: { trial: true }, sets: { trial: false }, once: false }], settings: [{ id: 'speed', label: '速度', type: 'number', default: 2, min: 1, max: 4 }, { id: 'hints', label: '提示', type: 'boolean', default: true }], readouts: [{ id: 'notice', text: '请质询', placement: 'left', tone: 'cyan', requires: {}, resourceRequires: {} }] };
const plugin = () => parsePluginFile(raw)[0];
it('activates only on accepted story flags and the declared scene, without disabling entry and exit rules', () => {
  const p = plugin(), world = { gameplayPlugins: [p] };
  expect(isGameplayPluginActive(p, {}, 'court')).toBe(false);
  const flags = evaluatePluginEvents(world, {}, [{ pluginId: 'trial', ruleId: 'enter' }]);
  expect(isGameplayPluginActive(p, flags, 'court')).toBe(true);
  expect(isGameplayPluginActive(p, flags, 'street')).toBe(false);
  expect(activeGameplayReadouts([p], flags, {}, 'street')).toEqual([]);
  expect(activeGameplayReadouts([p], flags, {}, 'court')).toHaveLength(1);
  const exit = evaluatePluginEvents(world, flags, [{ pluginId: 'trial', ruleId: 'leave' }]);
  expect(isGameplayPluginActive(p, { ...flags, ...exit }, 'court')).toBe(false);
});
it('keeps lifecycle changes in the runtime suffix and excludes player preferences from model manifests', () => {
  const p = plugin(), world = { gameplayPlugins: [p] };
  const prefix = buildGameplayStaticPrompt(world, 'action');
  expect(buildGameplayRuntimePrompt(world, {}, {}, 'court')).toContain('"active":false');
  expect(buildGameplayRuntimePrompt(world, { 'gameplay.trial.trial': true }, {}, 'court')).toContain('"active":true');
  expect(buildGameplayStaticPrompt(world, 'action')).toBe(prefix);
  expect(gameplayPluginForModel(p).settings).toBeUndefined();
  expect(buildGameplayStaticPrompt({ gameplayPlugins: [{ ...p, settings: [{ ...p.settings![0], label: '新标签' }] }] }, 'action')).toBe(prefix);
});
it('validates author setting defaults and merges independent preferences across windows', () => {
  expect(() => parsePluginFile({ ...raw, settings: [{ ...raw.settings[0], default: 9 }] })).toThrow('默认值');
  expect(pluginPreferences(plugin(), { trial: { speed: 99, hints: false }, foreign: { key: 'secret' } })).toEqual({ speed: 4, hints: false });
  expect(mergeModPreferenceDraft({ trial: { speed: 3, hints: true }, other: { sound: false } }, { trial: { speed: 2, hints: true } }, { trial: { speed: 2, hints: false } })).toEqual({ trial: { speed: 3, hints: false }, other: { sound: false } });
  expect(normalizeModPreferences(JSON.parse('{"__proto__":{"bad":true},"trial":{"nested":{"x":1},"speed":3}}'))).toEqual({ trial: { speed: 3 } });
});
