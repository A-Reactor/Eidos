// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { expect, it } from 'vitest';
import { parseActionDocuments } from '@/lib/ai/document-response';
import { parseWorkspaceRequest, validateWorkspaceContext } from '@/lib/ai/workspace-tools';
import { createWorkspaceSession, runWorkspaceTool } from '@/lib/game/workspace/session';
import { workspacePromptContext } from '@/lib/game/workspace/context';
import { prepareActionArtifacts, validateActionArtifactCandidate } from '@/lib/game/documents/action-artifacts';
import { loadDocuments, mergeBranchDocuments, readDocument } from '@/lib/game/documents/repository';
import { collectDocumentBundle, restoreDocumentBundle } from '@/lib/game/documents/transfer';
import { documentScopeKey } from '@/lib/game/model-documents';
import { resolveInlineDocuments, inlineDocumentTokens } from '@/lib/game/documents/inline-links';

it('accepts Unicode document aliases without accepting path separators or object prototype names', () => {
  const keys = ['中文报告', '日本語_記録', '한글-기록', 'cafe\u0301', 'العربية', '𠮷'.repeat(80)];
  const docs = keys.map(key => ({ key, title: key, format: 'text', content: '正文' }));
  expect(parseActionDocuments(docs).map(doc => doc.key)).toEqual(keys);
  for (const key of ['../报告', '目录/报告', '__proto__', 'constructor', 'prototype', '𠮷'.repeat(81)]) {
    expect(() => parseActionDocuments([{ ...docs[0], key }])).toThrow('key');
  }
  expect(() => parseActionDocuments([docs[0], docs[0]])).toThrow('key');
});

it('reads, patches, publishes and restores a Chinese draft path through the real tool and paragraph channels', async () => {
  const scope = { worldId: crypto.randomUUID(), playthroughId: '中文周目' };
  const session = await createWorkspaceSession({ scope, actionId: '中文行动', parentNodeId: null, inputs: [] });
  const path = `${session.draftRoot}/中文目录/资料 é #100%（初稿）.md`;
  const call = (method: string, params: Record<string, unknown>) => runWorkspaceTool(session, parseWorkspaceRequest({ method, params }));
  const created = await call('files.write', { path, text: '# 测试报告\n进度：初稿', expectedVersion: null });
  expect(created).toMatchObject({ path, status: 'staged' });
  const listing = await call('files.list', { path: `${session.draftRoot}/中文目录` });
  expect(listing.entries?.map(entry => entry.path)).toEqual([path]);
  const read = await call('files.read', { path, version: created.afterVersion });
  expect(read.text).toBe('# 测试报告\n进度：初稿');
  expect(read.citations?.[0].path).toBe(path);
  const patched = await call('files.patch', { path, expectedVersion: created.afterVersion, oldText: '初稿', newText: '完成' });
  expect(patched.status).toBe('staged');
  expect((await call('files.search', { path: session.draftRoot, query: '中文目录' })).matches?.[0].path).toBe(path);
  const context = validateWorkspaceContext(JSON.parse(JSON.stringify(workspacePromptContext(session))))!;
  expect(context.mounts[0].path).toBe(path);
  expect(context.results.find(result => result.method === 'files.read')?.citations?.[0].path).toBe(path);

  const segments = [{ type: 'narration' as const, text: '读完[中文报告](document:中文报告)，继续向前。' }];
  const input = { scope, session, actionId: session.actionId, inputs: [], segments,
    documents: [{ key: '中文报告', title: '中文报告.md', format: 'markdown', artifactRef: { path, version: patched.afterVersion } }] };
  validateActionArtifactCandidate(input);
  const prepared = await prepareActionArtifacts(input);
  expect(await loadDocuments(scope)).toEqual([]);
  expect(prepared.branch?.outputs[0].path).toBe('outputs/中文行动/中文报告.md');
  const link = prepared.outputDocuments[0];
  expect(inlineDocumentTokens(resolveInlineDocuments(segments[0].text, prepared.byKey, []))[0].ref).toEqual({ documentId: link.documentId, revision: link.revision });
  await mergeBranchDocuments(scope, prepared.branch!.documents, []);
  expect((await readDocument(scope, link)).resource.text).toBe('# 测试报告\n进度：完成');
  const bundle = await collectDocumentBundle({ scopes: [scope] });
  const destination = { ...scope, playthroughId: '恢复后的中文周目' };
  await restoreDocumentBundle(bundle, new Map([[documentScopeKey(scope), destination]]));
  expect((await loadDocuments(destination))[0].title).toBe('中文报告.md');
  expect((await readDocument(destination, link)).resource.text).toBe('# 测试报告\n进度：完成');
});

it('keeps literal Unicode paths distinct and retains scope checks for Chinese directory names', async () => {
  const scope = { worldId: crypto.randomUUID(), playthroughId: '路径边界' };
  const session = await createWorkspaceSession({ scope, actionId: '中文', parentNodeId: null, inputs: [] });
  const paths = [`${session.draftRoot}/café.txt`, `${session.draftRoot}/cafe\u0301.txt`, `${session.draftRoot}/中文%20文件.txt`, `${session.draftRoot}/中文 文件.txt`];
  for (const [index, path] of paths.entries()) {
    expect((await runWorkspaceTool(session, parseWorkspaceRequest({ method: 'files.write', params: { path, text: `正文${index}`, expectedVersion: null } }))).status).toBe('staged');
  }
  for (const [index, path] of paths.entries()) {
    expect((await runWorkspaceTool(session, { method: 'files.read', params: { path } })).text).toBe(`正文${index}`);
  }
  expect(Object.keys(session.files)).toEqual(paths);
  const denied = await runWorkspaceTool(session, { method: 'files.write', params: { path: `${session.draftRoot}其他/报告.txt`, text: '越界', expectedVersion: null } });
  expect(denied.status).toBe('denied');
  for (const path of [`${session.draftRoot}/../报告.txt`, `${session.draftRoot}/中文/../../报告.txt`]) {
    expect(() => parseWorkspaceRequest({ method: 'files.read', params: { path } })).toThrow('相对路径');
  }
  expect(Object.keys(session.files)).toEqual(paths);
});
