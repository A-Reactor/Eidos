// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { afterEach, expect, it, vi } from 'vitest';
import { _resetDB, saveMeta, saveToDB } from '@/lib/game/storage';
import { WORKSPACE_KEY, authorState, readModResource, workspaceOf } from '@/lib/game/plugins/workspace';
import { workspaceOperation, withWorkspace, type WorkspaceAccess } from '@/lib/game/plugins/workspace-operations';
import { collectArchiveRecovery, restoreArchiveRecovery } from '@/lib/game/archive-transfer';
import { buildRiftCityStartState } from '@/lib/test/fixtures';
import { useGameStore } from '@/store/game-store';
import { parsePluginFile } from '@/lib/game/plugins/manifest';
import { snapshotForModel, worldForModel } from '@/lib/game/plugins/model-manifest';

import { collectModMail } from '@/lib/game/plugins/mailbox';

afterEach(() => { _resetDB(); vi.unstubAllGlobals(); localStorage.clear(); });
it('keeps presentation files and raw author HTML out of model transport without changing local saves', () => {
  const snapshot = { currentSceneId: 'scene', gameplayModState: { desk: { privateProse: 'local file' } } };
  expect(snapshotForModel(snapshot)).toEqual({ currentSceneId: 'scene' });
  expect(snapshot.gameplayModState.desk.privateProse).toBe('local file');
  const world = { ...buildRiftCityStartState().world, gameplayPlugins: parsePluginFile({ format: 'eidos-gameplay-plugin', version: 1, id: 'desk', name: 'desk', description: 'test', tags: [], prompts: { creation: '', action: '', review: '' }, rules: [], ui: { html: '<p>private author markup</p>', reading: 'replace' } }) };
  expect(JSON.stringify(worldForModel(world))).not.toContain('private author markup');
  expect(world.gameplayPlugins[0].ui?.html).toContain('private author markup');
});
function session(mailbox = 'test', initial: Record<string, unknown> = {}) {
  let state = initial, current = true;
  const access: WorkspaceAccess = { scope: 'node-one', mailbox, current: () => current, state: () => state, commit: workspace => { state = withWorkspace(state, workspace); } };
  return { access, get state() { return state; }, switchAway() { current = false; } };
}
it('keeps immutable originals, rejects stale edits, and restores a file reference after later writes', async () => {
  const s = session();
  const original = await workspaceOperation('files.write', { path: 'letter.txt', text: 'first', expectedVersion: null }, s.access) as { id: string };
  const snapshot = JSON.parse(JSON.stringify(s.state));
  const current = await workspaceOperation('files.write', { path: 'letter.txt', text: 'second', expectedVersion: original.id }, s.access) as { id: string };
  await expect(workspaceOperation('files.write', { path: 'letter.txt', text: 'stale', expectedVersion: original.id }, s.access)).rejects.toThrow('版本');
  expect((await workspaceOperation('files.read', { path: 'letter.txt' }, s.access) as { text: string }).text).toBe('second');
  expect((await workspaceOperation('files.read', { path: 'letter.txt' }, session('test', snapshot).access) as { text: string }).text).toBe('first');
  expect(original.id).not.toBe(current.id);
  expect(authorState(s.state, { custom: 1, [WORKSPACE_KEY]: {} })[WORKSPACE_KEY]).toEqual(s.state[WORKSPACE_KEY]);
});
it('carries only explicitly published files across branches of the same author', async () => {
  const a = session('same-author'), b = session('same-author'), foreign = session('other-author');
  await workspaceOperation('files.write', { path: 'letter.txt', text: 'from branch A' }, a.access);
  await expect(workspaceOperation('files.receive', { path: 'incoming.txt', key: 'mail' }, b.access)).rejects.toThrow('没有');
  await workspaceOperation('files.publish', { path: 'letter.txt', key: 'mail' }, a.access);
  const received = await workspaceOperation('files.receive', { path: 'incoming.txt', key: 'mail' }, b.access) as { origin: string };
  expect(received.origin).toBe('node-one');
  expect((await workspaceOperation('files.read', { path: 'incoming.txt' }, b.access) as { text: string }).text).toBe('from branch A');
  await expect(workspaceOperation('files.receive', { path: 'incoming.txt', key: 'mail' }, foreign.access)).rejects.toThrow('没有');
});
it('cannot mutate an old branch after asynchronous resource persistence', async () => {
  const s = session();
  const write = workspaceOperation('files.write', { path: 'old.txt', text: 'stale' }, s.access);
  s.switchAway();
  await expect(write).rejects.toThrow('切换');
  expect(s.state).toEqual({});
  await expect(workspaceOperation('files.read', { path: '../outside.txt' }, session().access)).rejects.toThrow('相对路径');
});
it('records real stage lifecycle and separates auxiliary HTML from author state', async () => {
  const s = session();
  await workspaceOperation('stages.open', { id: 'letter', title: 'letter', html: '<p>letter</p>' }, s.access);
  await workspaceOperation('stages.update', { id: 'letter', x: 140, y: 60 }, s.access);
  expect(workspaceOf(s.state).stages[0]).toMatchObject({ x: 140, y: 60, html: '<p>letter</p>' });
  await workspaceOperation('stages.close', { id: 'letter' }, s.access);
  expect(workspaceOf(s.state).stages).toEqual([]);
  expect(workspaceOf(s.state).events.map(e => e.type)).toEqual(['stage_opened', 'stage_updated', 'stage_closed']);
});
it('round trips host-owned files through actual save and snapshot serializers', async () => {
  const plugin = parsePluginFile({ format: 'eidos-gameplay-plugin', version: 1, id: 'desk', name: 'desk', description: 'test', tags: [], prompts: { creation: '', action: '', review: '' }, rules: [], ui: { html: '<p>test</p>', reading: 'replace' } });
  const world = { ...buildRiftCityStartState().world, gameplayPlugins: plugin };
  useGameStore.setState(useGameStore.getInitialState()); useGameStore.getState().setCurrentWorld(world);
  const s = session(); await workspaceOperation('files.write', { path: 'saved.txt', text: 'saved original' }, s.access);
  useGameStore.setState({ gameplayModState: { desk: s.state } });
  const snapshot = useGameStore.getState().createSnapshot(), save = useGameStore.getState().serializeState();
  useGameStore.setState({ gameplayModState: { desk: {} } });
  useGameStore.getState().restoreSnapshot(snapshot);
  expect(workspaceOf(useGameStore.getState().gameplayModState.desk).files['saved.txt']).toBeDefined();
  useGameStore.getState().deserializeState(JSON.parse(JSON.stringify(save)), world);
  const ref = workspaceOf(useGameStore.getState().gameplayModState.desk).files['saved.txt'];
  expect((await readModResource(ref)).text).toBe('saved original');
});
it('backs up originals and mail, then restores them into fresh playthrough identities', async () => {
  const world = buildRiftCityStartState().world, ptId = 'workspace-backup';
  const s = session(JSON.stringify([world.id, ptId, 'desk']));
  await workspaceOperation('files.write', { path: 'memo.txt', text: 'backup original' }, s.access);
  await workspaceOperation('files.publish', { path: 'memo.txt', key: 'letter' }, s.access);
  const meta = { id: 'workspace-save', worldId: world.id, playthroughId: ptId, name: 'test' };
  await saveToDB('save_data_workspace-save', { meta, world, state: { gameplayModState: { desk: s.state } } });
  await saveMeta(`worldline_index_${world.id}`, []);
  const recovery = await collectArchiveRecovery(world.id, [{ id: ptId, worldId: world.id, worldLineId: '', saves: [meta] }] as never, {});
  expect(Object.values(recovery.modResources!)[0].text).toBe('backup original');
  const restored = await restoreArchiveRecovery(recovery, world, {});
  const next = session(JSON.stringify([world.id, restored.playthroughs[0].id, 'desk']));
  await workspaceOperation('files.receive', { path: 'received.txt', key: 'letter' }, next.access);
  expect((await workspaceOperation('files.read', { path: 'received.txt' }, next.access) as { text: string }).text).toBe('backup original');
});

it('includes the latest fallback mail when the IndexedDB write did not commit', async () => {
  const key = 'mod_mail:["world","playthrough","desk"]:letter';
  const old = { resource: { id: 'material_0000000000000000', name: 'old.txt', mimeType: 'text/plain', size: 3 }, origin: 'old' };
  const latest = { ...old, origin: 'latest' };
  await saveMeta(key, old);
  localStorage.setItem(`meta_${key}`, JSON.stringify(latest));
  expect((await collectModMail('world', 'playthrough', {})).desk.letter.origin).toBe('latest');
  vi.stubGlobal('indexedDB', undefined);
  expect((await collectModMail('world', 'playthrough', {})).desk.letter.origin).toBe('latest');
});

it('preserves window updates committed while a file is being persisted', async () => {
  const s = session();
  const writing = workspaceOperation('files.write', { path: 'letter.txt', text: 'in flight' }, s.access);
  await workspaceOperation('stages.open', { id: 'paper', title: 'paper', html: '<p>paper</p>', x: 80 }, s.access);
  await workspaceOperation('stages.update', { id: 'paper', x: 240 }, s.access);
  await writing;
  expect(workspaceOf(s.state).stages[0].x).toBe(240);
  expect(workspaceOf(s.state).files['letter.txt']).toBeDefined();
  expect(workspaceOf(s.state).events.map(e => e.type)).toEqual(['stage_opened', 'stage_updated', 'file_written']);
});
