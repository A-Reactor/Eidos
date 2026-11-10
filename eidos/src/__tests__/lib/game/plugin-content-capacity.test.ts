// @vitest-environment jsdom
import { beforeEach, expect, it } from 'vitest';
import { parsePluginFile } from '@/lib/game/plugins/manifest';
import { exportPluginFile, savePluginLibrary, loadPluginLibrary } from '@/lib/game/plugins/library';
import { parseGlobalPluginFile } from '@/lib/game/global-plugins/manifest';
import { exportGlobalPlugins, installGlobalPlugins, getGlobalPluginLibrary } from '@/lib/game/global-plugins/library';
import { normalizeGameplayModState, acceptModCommand } from '@/lib/game/plugins/mod-ui';
import { parseGameplayOperation } from '@/lib/game/plugins/gameplay-state';
import { applyGameplayPatches } from '@/lib/game/plugins/json-patch';
import { applyGameplayRuleEffects } from '@/lib/game/plugins/rule-effects';
import { gameplayLedger } from '@/lib/game/plugins/gameplay-state';
import { normalizeModPreferences, settingValue } from '@/lib/game/plugins/preferences';
const raw = { format: 'eidos-gameplay-plugin', version: 1, id: 'large-story', name: '长篇插件', description: '完整长篇', tags: [], prompts: { creation: '', action: '', review: '' }, rules: [] };
beforeEach(() => localStorage.clear());
it('imports long manifest text, source, story data and initial state without character caps', () => {
  const prose = '完整故事'.repeat(20000), script = '<main>' + '舞台源码'.repeat(50000) + '</main>', history = '状态'.repeat(300000);
  const [plugin] = parsePluginFile({ ...raw, description: prose, prompts: { creation: prose, action: prose, review: prose }, data: { book: prose }, ui: { html: script, reading: 'replace', initialState: { history } } });
  expect(plugin.prompts.action).toBe(prose); expect(plugin.ui?.html).toBe(script); expect(plugin.data?.book).toBe(prose);
  expect(normalizeGameplayModState({ gameplayPlugins: [plugin] })[plugin.id].history).toBe(history);
  const operation = { id: 'large-operation', expectedRevision: 0, summary: '保存长篇', state: { history }, facts: { excerpt: prose } };
  expect(parseGameplayOperation(operation).state.history).toBe(history);
  expect(acceptModCommand({ channel: 'eidos-mod', token: 't', scope: 's', command: 'state', state: { history } }, { token: 't', scope: 's', busy: false })).toMatchObject({ state: { history } });
  expect(applyGameplayPatches({}, [{ op: 'add', path: '/history', value: history }]).history).toBe(history);
});
it('round-trips a larger Unicode library with more than sixteen plugins without discarding or shortening content', () => {
  const plugins = parsePluginFile(Array.from({ length: 24 }, (_, i) => ({ ...raw, id: `story-${i}`, prompts: { creation: '文'.repeat(13000), action: '', review: '' } })));
  savePluginLibrary(plugins); const loaded = loadPluginLibrary(); expect(loaded.error).toBeUndefined(); expect(loaded.plugins).toEqual(plugins);
  const source = exportPluginFile(loaded.plugins); expect(new TextEncoder().encode(source).length).toBeGreaterThan(200000);
  expect(parsePluginFile(JSON.parse(source))).toEqual(plugins);
});
it('imports, installs and exports global source past both former package and library limits', () => {
  const script = '/*' + '完整源码'.repeat(140000) + '*/';
  const source = JSON.stringify(Array.from({ length: 3 }, (_, i) => ({ format: 'eidos-global-plugin', version: 1, id: `global-${i}`, name: `完整插件 ${i}`, release: '1', description: '说明'.repeat(3000), script })));
  expect(new TextEncoder().encode(source).length).toBeGreaterThan(2 * 1024 * 1024);
  const plugins = parseGlobalPluginFile(source); installGlobalPlugins(plugins);
  expect(getGlobalPluginLibrary().entries.map(e => e.plugin.script)).toEqual([script, script, script]);
  expect(parseGlobalPluginFile(exportGlobalPlugins(plugins))).toEqual(plugins);
});
it('does not treat the number of stored global plugins as a library capacity cap', () => {
  const plugins = parseGlobalPluginFile(JSON.stringify(Array.from({ length: 40 }, (_, i) => ({ format: 'eidos-global-plugin', version: 1, id: `tool-${i}`, name: `工具 ${i}`, release: '1', description: '', css: 'body{}' }))));
  installGlobalPlugins(plugins); expect(getGlobalPluginLibrary().entries).toHaveLength(40);
});
it('preserves long declared display labels, preferences and rule text instead of silently truncating them', () => {
  const content = '字'.repeat(15000);
  const [plugin] = parsePluginFile({ ...raw, name: content, tags: [content], settings: [{ id: 'story', type: 'string', label: content, description: content, default: content }], readouts: [{ id: 'note', text: content }], rules: [{ id: 'begin', description: content, sets: { began: true }, effects: { state: [{ op: 'add', path: '/began', value: true }] } }] });
  const state = applyGameplayRuleEffects({ world: { gameplayPlugins: [plugin] }, state: {}, flags: {}, events: [{ pluginId: plugin.id, ruleId: 'begin' }], receiptId: 'receipt', createdAt: 1 });
  expect(gameplayLedger(state[plugin.id])?.last?.summary).toBe(content);
  expect(plugin.settings![0].default).toBe(content); expect(plugin.readouts![0].text).toBe(content);
  expect(settingValue(plugin.settings![0], content)).toBe(content);
  expect(normalizeModPreferences({ 'large-story': { story: content } })['large-story'].story).toBe(content);
});
it('still rejects malformed data, unsupported fields and polluted objects', () => {
  expect(() => parsePluginFile({ ...raw, unknown: 'field' })).toThrow();
  expect(() => parsePluginFile({ ...raw, ui: { reading: 'replace', html: 12 } })).toThrow();
  expect(() => parsePluginFile({ ...raw, data: { bad: Infinity } })).toThrow();
  expect(() => parsePluginFile({ ...raw, data: JSON.parse('{"__proto__":{}}') })).toThrow();
});
