// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { afterEach, expect, it, vi } from 'vitest';
import { inspectResource } from '@/lib/game/plugins/workspace-host';
import { workspaceOperation, withWorkspace, type WorkspaceAccess } from '@/lib/game/plugins/workspace-operations';
import { saveSettings } from '@/lib/game/settings';
import { DEFAULT_SETTINGS } from '@/lib/game/types';
import { workspaceOf } from '@/lib/game/plugins/workspace';
import { nativeWorkspaceFile } from '@/lib/game/plugins/native-workspace';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function session() {
  let state: Record<string, unknown> = {}, valid = true;
  const access: WorkspaceAccess = { scope: 'scope', mailbox: 'author', current: () => valid, state: () => state, commit: w => { state = withWorkspace(state, w); } };
  return { access, get state() { return state; }, switchAway: () => { valid = false; } };
}
it('reuses only successful version/task/model matches and records usage once', async () => {
  saveSettings({ ...DEFAULT_SETTINGS, uzqApiKey: 'do-not-expose', uzqProviderId: 'openai' });
  const s = session(), account = vi.fn();
  await workspaceOperation('files.write', { path: 'evidence.txt', text: 'actual original' }, s.access);
  const fetch = vi.fn(async () => Response.json({ content: 'observed', usage: { totalTokens: 18 } })); vi.stubGlobal('fetch', fetch);
  expect(await inspectResource({ path: 'evidence.txt', task: 'describe' }, s.access, new AbortController().signal, account)).toMatchObject({ cached: false });
  expect(await inspectResource({ path: 'evidence.txt', task: 'describe' }, s.access, new AbortController().signal, account)).toMatchObject({ cached: true });
  expect(fetch).toHaveBeenCalledTimes(1); expect(account).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(s.state)).not.toContain('do-not-expose');
  await workspaceOperation('files.write', { path: 'evidence.txt', text: 'changed original' }, s.access);
  await inspectResource({ path: 'evidence.txt', task: 'describe' }, s.access, new AbortController().signal, account);
  expect(fetch).toHaveBeenCalledTimes(2);
});
it('accounts for a late response but does not save it to another branch', async () => {
  const s = session(), account = vi.fn();
  await workspaceOperation('files.write', { path: 'late.txt', text: 'original' }, s.access);
  let release!: (response: Response) => void;
  let started!: () => void; const began = new Promise<void>(resolve => { started = resolve; });
  vi.stubGlobal('fetch', vi.fn(() => { started(); return new Promise<Response>(resolve => { release = resolve; }); }));
  const pending = inspectResource({ path: 'late.txt', task: 'describe' }, s.access, new AbortController().signal, account);
  await began; s.switchAway(); release(Response.json({ content: 'late', usage: { totalTokens: 10 } }));
  await expect(pending).rejects.toThrow('切换');
  expect(account).toHaveBeenCalledOnce(); expect(workspaceOf(s.state).interpretations).toEqual({});
});
it('does not start analysis if the stage pauses while its original material is being read', async () => {
  const s = session(), account = vi.fn();
  await workspaceOperation('files.write', { path: 'pause.txt', text: 'original' }, s.access);
  const get = IDBObjectStore.prototype.get;
  vi.spyOn(IDBObjectStore.prototype, 'get').mockImplementation(function (this: IDBObjectStore, key) {
    const request = get.call(this, key);
    if (String(key).startsWith('material_')) request.addEventListener('success', s.switchAway, { once: true });
    return request;
  });
  const fetch = vi.fn(async () => Response.json({ content: 'must not run' })); vi.stubGlobal('fetch', fetch);
  await expect(inspectResource({ path: 'pause.txt', task: 'describe' }, s.access, new AbortController().signal, account)).rejects.toThrow('切换');
  expect(fetch).not.toHaveBeenCalled(); expect(account).not.toHaveBeenCalled();
  expect(workspaceOf(s.state).interpretations).toEqual({});
});
it('selects a labeled text fragment while retaining the complete original', async () => {
  const s = session(); await workspaceOperation('files.write', { path: 'long.txt', text: 'before SECTION after' }, s.access);
  const bodies: unknown[] = [];
  vi.stubGlobal('fetch', vi.fn(async (_url, options) => { bodies.push(JSON.parse(options.body)); return Response.json({ content: 'SECTION' }); }));
  await inspectResource({ path: 'long.txt', task: 'describe', offset: 7, length: 7 }, s.access, new AbortController().signal, vi.fn());
  expect(bodies[0]).toMatchObject({ resource: { text: 'SECTION' }, task: expect.stringContaining('不要声称已读全文') });
  expect(await workspaceOperation('files.read', { path: 'long.txt' }, s.access)).toMatchObject({ text: 'before SECTION after' });
});
it('reports absence of a desktop bridge instead of pretending to write a real file', async () => {
  await expect(nativeWorkspaceFile('aaaaaaaaaaaaaaaa', 'letter.txt', 'text')).rejects.toThrow('没有桌面');
});
