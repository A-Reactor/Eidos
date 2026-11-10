// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { afterEach, expect, it } from 'vitest';
import { _resetDB } from '@/lib/game/storage';
import { readResource, storeResource } from '@/lib/game/workspace/resources';
import { runFileOperation } from '@/lib/game/workspace/operations';
import type { WorkspaceFiles, WorkspaceFileAccess } from '@/lib/game/workspace/types';

afterEach(() => { _resetDB(); localStorage.clear(); });

function workspace() {
  let files: WorkspaceFiles = {}, current = true;
  const access: WorkspaceFileAccess = {
    files: () => files, replaceFiles: next => { files = next; }, current: () => current,
    canAccess: () => true,
  };
  return { access, get files() { return files; }, leave() { current = false; } };
}

it('shares immutable resource versions without overwriting the original text', async () => {
  const a = await storeResource({ name: 'first.txt', mimeType: 'text/plain', text: '原文\n最后🙂' });
  const b = await storeResource({ name: 'copy.txt', mimeType: 'text/plain', text: '原文\n最后🙂' });
  const c = await storeResource({ name: 'first.txt', mimeType: 'text/plain', text: '新版本' });
  expect(a.id).toBe(b.id);
  expect(c.id).not.toBe(a.id);
  expect((await readResource(a)).text).toBe('原文\n最后🙂');
});

it('requires an explicit version before creating or replacing model files', async () => {
  const s = workspace();
  await expect(runFileOperation({ method: 'files.write', params: { path: 'drafts/a.txt', text: 'first' } }, s.access)).rejects.toThrow('expectedVersion');
  await runFileOperation({ method: 'files.write', params: { path: 'drafts/a.txt', text: 'first', expectedVersion: null } }, s.access);
  const version = s.files['drafts/a.txt'].id;
  await expect(runFileOperation({ method: 'files.write', params: { path: 'drafts/a.txt', text: 'stale', expectedVersion: null } }, s.access)).rejects.toThrow('版本');
  await runFileOperation({ method: 'files.write', params: { path: 'drafts/a.txt', text: 'second', expectedVersion: version } }, s.access);
  expect((await readResource(s.files['drafts/a.txt'])).text).toBe('second');
});

it('patches a unique literal only against the exact version', async () => {
  const s = workspace();
  await runFileOperation({ method: 'files.write', params: { path: 'drafts/letter.md', text: '# 信\n日期：周一', expectedVersion: null } }, s.access);
  const version = s.files['drafts/letter.md'].id;
  const result = await runFileOperation({ method: 'files.patch', params: { path: 'drafts/letter.md', oldText: '周一', newText: '周二', expectedVersion: version } }, s.access);
  expect(result).toMatchObject({ status: 'staged', beforeVersion: version, afterVersion: s.files['drafts/letter.md'].id });
  expect((await readResource(s.files['drafts/letter.md'])).text).toBe('# 信\n日期：周二');
  await expect(runFileOperation({ method: 'files.patch', params: { path: 'drafts/letter.md', oldText: '不存在', newText: 'x', expectedVersion: result.afterVersion } }, s.access)).rejects.toThrow('唯一');
});

it('rejects escaped paths and denied mounts without mutating files', async () => {
  const s = workspace();
  for (const path of ['../outside.txt', '/host/secret', 'drafts/../secret', 'drafts\\secret']) {
    await expect(runFileOperation({ method: 'files.write', params: { path, text: 'x', expectedVersion: null } }, s.access)).rejects.toThrow('相对路径');
  }
  s.access.canAccess = () => false;
  await expect(runFileOperation({ method: 'files.write', params: { path: 'inputs/source.txt', text: 'x', expectedVersion: null } }, s.access)).rejects.toThrow('访问');
  expect(s.files).toEqual({});
});

it('does not publish files after the request has left its scope', async () => {
  const s = workspace();
  const writing = runFileOperation({ method: 'files.write', params: { path: 'drafts/late.txt', text: 'late', expectedVersion: null } }, s.access);
  s.leave();
  await expect(writing).rejects.toThrow('变化');
  expect(s.files).toEqual({});
});

it('checks versions again after asynchronous persistence so concurrent writes cannot both replace a file', async () => {
  const s = workspace();
  const requests = ['one', 'two'].map(text => runFileOperation({ method: 'files.write', params: { path: 'drafts/race.txt', text, expectedVersion: null } }, s.access));
  const results = await Promise.allSettled(requests);
  expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
  expect(results.filter(r => r.status === 'rejected')).toHaveLength(1);
});

it('returns bounded original text and metadata-only directory pages', async () => {
  const s = workspace(), content = '证据'.repeat(7000) + '尾声';
  await runFileOperation({ method: 'files.write', params: { path: 'drafts/long.txt', text: content, expectedVersion: null } }, s.access);
  const page = await runFileOperation({ method: 'files.read', params: { path: 'drafts/long.txt', offset: 0 } }, s.access);
  expect(page.text).toBe(content.slice(0, 12000));
  expect(page.nextOffset).toBe(12000);
  const last = await runFileOperation({ method: 'files.read', params: { path: 'drafts/long.txt', offset: 12000 } }, s.access);
  expect(page.text! + last.text!).toBe(content);
  const listing = await runFileOperation({ method: 'files.list', params: {} }, s.access);
  expect(listing.entries).toHaveLength(1);
  expect(JSON.stringify(listing)).not.toContain('证据');
});
