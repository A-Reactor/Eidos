// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { beforeEach, expect, it } from 'vitest';
import { parsePluginFile } from '@/lib/game/plugins/manifest';
import { buildGameplayStaticPrompt } from '@/lib/game/plugins/runtime';
import { normalizeGameplayModState, acceptModCommand } from '@/lib/game/plugins/mod-ui';
import { useGameStore } from '@/store/game-store';
import { buildRiftCityStartState } from '@/lib/test/fixtures';

export const mod = { format: 'eidos-gameplay-plugin', version: 1, id: 'test-mod', name: '阅读模组', description: '自定义操作', tags: [], prompts: { creation: '', action: '连续阅读', review: '' }, rules: [], data: { setting: '港口' }, ui: { html: '<button>秘密代码</button>', reading: 'replace', initialState: { found: [], count: 0 } } };
const world = () => ({ ...buildRiftCityStartState().world, gameplayPlugins: parsePluginFile(mod) });
beforeEach(() => { useGameStore.setState(useGameStore.getInitialState()); useGameStore.getState().setCurrentWorld(world()); });

it('imports and shares executable presentation without adding it to model prompts', () => {
  const plugins = parsePluginFile(JSON.parse(JSON.stringify(mod)));
  expect(plugins[0].ui?.html).toContain('秘密代码');
  expect(buildGameplayStaticPrompt({ gameplayPlugins: plugins }, 'action')).toContain('连续阅读');
  expect(buildGameplayStaticPrompt({ gameplayPlugins: plugins }, 'action')).not.toContain('秘密代码');
  expect(parsePluginFile({ ...mod, ui: undefined })[0].ui).toBeUndefined();
  expect(() => parsePluginFile({ ...mod, ui: { ...mod.ui, initialState: { count: Infinity } } })).toThrow();
});
it('snapshots and saves independent mod state, restores defaults for old records and resets between worlds', () => {
  useGameStore.setState({ gameplayModState: { 'test-mod': { found: ['letter'], count: 0 } } });
  const snap = useGameStore.getState().createSnapshot(), save = useGameStore.getState().serializeState();
  useGameStore.setState({ gameplayModState: { 'test-mod': { found: ['lamp'] } } });
  useGameStore.getState().restoreSnapshot(snap);
  expect(useGameStore.getState().gameplayModState['test-mod']).toEqual({ found: ['letter'], count: 0 });
  snap.gameplayModState!['test-mod'].found = [];
  expect(useGameStore.getState().gameplayModState['test-mod'].found).toEqual(['letter']);
  useGameStore.getState().deserializeState(JSON.parse(JSON.stringify(save)), world());
  expect(useGameStore.getState().gameplayModState['test-mod'].found).toEqual(['letter']);
  delete save.gameplayModState;
  useGameStore.getState().deserializeState(save, world());
  expect(useGameStore.getState().gameplayModState['test-mod']).toEqual(mod.ui.initialState);
  useGameStore.getState().setCurrentWorld(buildRiftCityStartState().world);
  expect(useGameStore.getState().gameplayModState).toEqual({});
});
it('rejects corrupt or foreign state before changing the world', () => {
  const snap = useGameStore.getState().createSnapshot();
  expect(() => useGameStore.getState().restoreSnapshot({ ...snap, currentGameTime: { day: 90, hour: 0, minute: 0 }, gameplayModState: { 'other-mod': {} } })).toThrow();
  expect(useGameStore.getState().gameTime.day).not.toBe(90);
  expect(normalizeGameplayModState(world(), undefined)['test-mod']).toEqual(mod.ui.initialState);
});
it('checks frame session and branch before accepting commands and rejects actions while busy', () => {
  const session = { token: 'frame-a', scope: 'world:node', busy: false };
  expect(acceptModCommand({ channel: 'eidos-mod', token: 'old', scope: session.scope, command: 'state', state: {} }, session)).toBeNull();
  expect(acceptModCommand({ channel: 'eidos-mod', token: session.token, scope: 'old-branch', command: 'submit', action: '看信' }, session)).toBeNull();
  expect(acceptModCommand({ channel: 'eidos-mod', token: session.token, scope: session.scope, command: 'submit', action: '看信', state: { read: true } }, session)).toEqual({ command: 'submit', action: '看信', state: { read: true } });
  expect(acceptModCommand({ channel: 'eidos-mod', token: session.token, scope: session.scope, command: 'submit', action: '看信' }, { ...session, busy: true })).toBeNull();
  expect(acceptModCommand({ channel: 'eidos-mod', token: session.token, scope: session.scope, command: 'state', state: [] }, session)).toBeNull();
});
