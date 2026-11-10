// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { afterEach, expect, it } from 'vitest';
import { _resetDB } from '@/lib/game/storage';
import { importDocument } from '@/lib/game/documents/ingest';
import { createWorkspaceSession, runWorkspaceTool } from '@/lib/game/workspace/session';
import { workspacePromptContext } from '@/lib/game/workspace/context';
import { loadDocuments } from '@/lib/game/documents/repository';

afterEach(() => { _resetDB(); localStorage.clear(); });
const scope = () => ({ worldId: crypto.randomUUID(), playthroughId: 'session', archiveId: 'main' });

it('mounts only explicitly supplied versions and initially sends metadata without file bodies', async () => {
  const s = scope();
  const visible = await importDocument(s, new File(['事故时间：二十三点，最后的证据'], '调查.txt'));
  await importDocument(s, new File(['未选择的秘密'], '秘密.txt'));
  const session = await createWorkspaceSession({ scope: s, actionId: 'turn-one', parentNodeId: 'node', inputs: [visible] });
  const context = workspacePromptContext(session), path = context.mounts[0].path;
  expect(JSON.stringify(context)).not.toContain('事故时间');
  expect(JSON.stringify(context)).not.toContain('秘密');
  expect(context.draftRoot).toBe('drafts/turn-one');
  const found = await runWorkspaceTool(session, { method: 'files.search', params: { query: '二十三点' } });
  expect(found.matches?.[0].excerpt).toBe('事故时间：二十三点，最后的证据');
  const page = await runWorkspaceTool(session, { method: 'files.read', params: { path } });
  expect(page.text).toBe('事故时间：二十三点，最后的证据');
  expect(page.citations?.[0]).toMatchObject({ path, version: visible.revision, start: 0, end: 15 });
  expect((await runWorkspaceTool(session, { method: 'files.read', params: { path: 'inputs/unknown/secret.txt' } })).status).toBe('denied');
});

it('writes and rereads a model draft without publishing a document or editing an imported original', async () => {
  const s = scope(), original = await importDocument(s, new File(['不能覆盖'], '原件.md'));
  const session = await createWorkspaceSession({ scope: s, actionId: 'writing', parentNodeId: 'node', inputs: [original] });
  const source = workspacePromptContext(session).mounts[0].path;
  expect((await runWorkspaceTool(session, { method: 'files.write', params: { path: source, text: '改写', expectedVersion: original.revision } })).status).toBe('denied');
  const write = await runWorkspaceTool(session, { method: 'files.write', params: { path: 'drafts/writing/report.md', text: '# 自己的稿件', expectedVersion: null } });
  expect(write.status).toBe('staged');
  expect((await runWorkspaceTool(session, { method: 'files.read', params: { path: 'drafts/writing/report.md' } })).text).toBe('# 自己的稿件');
  expect(await loadDocuments(s)).toHaveLength(1);
  expect(session.initialFiles['drafts/writing/report.md']).toBeUndefined();
});

it('refuses late tool writes after cancellation and keeps the original version untouched', async () => {
  const s = scope(); let current = true;
  const session = await createWorkspaceSession({ scope: s, actionId: 'cancelled', parentNodeId: 'node', inputs: [], isCurrent: () => current });
  const writing = runWorkspaceTool(session, { method: 'files.write', params: { path: 'drafts/cancelled/late.txt', text: 'late', expectedVersion: null } });
  current = false;
  expect((await writing).status).toBe('failed');
  expect(session.files).toEqual({});
  expect(await loadDocuments(s)).toEqual([]);
});

it('marks explicit inputs and keeps initial/list pagination in the same order', async () => {
  const s = scope(), links = [];
  for (let i = 0; i < 10; i++) links.push(await importDocument(s, new File([`资料${i}`], `${i}.txt`)));
  const session = await createWorkspaceSession({ scope: s, actionId: 'paging', parentNodeId: null, inputs: links });
  session.actionInputs = [links[9]];
  const context = workspacePromptContext(session);
  expect(context.mounts[0]).toMatchObject({ name: '9.txt', selected: true });
  const first = await runWorkspaceTool(session, { method: 'files.list', params: { offset: 0 } });
  const next = await runWorkspaceTool(session, { method: 'files.list', params: { offset: context.nextOffset } });
  expect(first.entries).toEqual(context.mounts);
  expect(new Set([...context.mounts, ...next.entries!].map(entry => entry.path)).size).toBe(10);
});
