// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { expect, it } from 'vitest';
import { useGameStore } from '@/store/game-store';
import { buildRiftCityStartState } from '@/lib/test/fixtures';
import { currentDocumentScope } from '@/lib/game/model-documents';
import { saveLocalDocument } from '@/lib/game/documents/ingest';
import { loadDocuments, readDocument } from '@/lib/game/documents/repository';
import { createWorkspaceSession, runWorkspaceTool } from '@/lib/game/workspace/session';
import { prepareActionArtifacts } from '@/lib/game/documents/action-artifacts';
import { mergeWorkspaceBranchAt } from '@/lib/game/workspace/branch';
import { parseWorkspaceRequest, validateWorkspaceContext } from '@/lib/ai/workspace-tools';
import { workspacePromptContext } from '@/lib/game/workspace/context';
import { collectDocumentBundle, restoreDocumentBundle } from '@/lib/game/documents/transfer';
import { documentScopeKey } from '@/lib/game/model-documents';
import { assertFileOutcome } from '@/lib/game/action-tool-continuation';

it('versions a rename through playback, preserves old names/bytes/links, and restores its bundle', async () => {
  const { world } = buildRiftCityStartState();
  useGameStore.setState({ ...useGameStore.getInitialState(), currentWorld: world, currentPlaythroughId: crypto.randomUUID() });
  const state = useGameStore.getState(); await state.initWorldLine(state.currentPlaythroughId!, world.id);
  const scope = currentDocumentScope(useGameStore.getState())!;
  const doc = await saveLocalDocument(scope, { title: '旧名称.txt', content: '保持原文', format: 'text' });
  const session = await createWorkspaceSession({ scope, actionId: 'rename', parentNodeId: state.currentNode?.id ?? null, inputs: [], library: [doc], writableDocuments: [doc] });
  const path = `library/${doc.documentId}/source.txt`;
  const receipt = await runWorkspaceTool(session, parseWorkspaceRequest({ method: 'files.rename', params: { path, expectedVersion: doc.revision, newName: '新名称.txt' } }));
  expect(receipt.status).toBe('staged'); expect(receipt.afterVersion).not.toBe(doc.revision);
  expect(validateWorkspaceContext(workspacePromptContext(session))?.results.at(-1)?.resource?.revisionName).toBe('新名称.txt');
  const segments = [{ type: 'narration' as const, text: '拿起旧稿。' }, { type: 'narration' as const, text: '改好名称。', workspaceEffects: [receipt.operationId!] }];
  const prepared = await prepareActionArtifacts({ scope, actionId: 'rename', session, inputs: [], segments });
  const node = await useGameStore.getState().addActionNode({ id: 'rename', summary: '更名', worldImpacts: [], availableActions: [], sceneId: state.currentSceneId, sceneName: '', timestamp: Date.now(), playerInput: '改名', aiResponse: '', gameTime: state.gameTime, timeSpent: { day: 0, hour: 0, minute: 0 }, workspaceBranch: prepared.branch } as never, useGameStore.getState().createSnapshot(), segments);
  await mergeWorkspaceBranchAt(useGameStore, node.id, 0);
  expect((await loadDocuments(scope))[0].title).toBe('旧名称.txt');
  await mergeWorkspaceBranchAt(useGameStore, node.id, 1);
  expect((await loadDocuments(scope))[0]).toMatchObject({ id: doc.documentId, title: '新名称.txt', fileName: '新名称.txt' });
  expect((await readDocument(scope, doc)).record.title).toBe('旧名称.txt');
  expect((await readDocument(scope, { ...doc, revision: receipt.afterVersion! })).resource.text).toBe('保持原文');
  expect((await loadDocuments(scope, [doc]))[0].title).toBe('旧名称.txt');
  const bundle = await collectDocumentBundle({ scopes: [scope] }), destination = { ...scope, playthroughId: crypto.randomUUID() };
  await restoreDocumentBundle(bundle, new Map([[documentScopeKey(scope), destination]]));
  expect((await loadDocuments(destination))[0].title).toBe('新名称.txt');
});

it('denies ungranted renames, detects stale versions and rejects false success', async () => {
  const scope = { worldId: crypto.randomUUID(), playthroughId: 'readonly' };
  const doc = await saveLocalDocument(scope, { title: '原件', content: '正文', format: 'text' });
  const session = await createWorkspaceSession({ scope, actionId: 'rename-denied', parentNodeId: null, inputs: [], library: [doc] });
  const params = { path: `library/${doc.documentId}/source.txt`, expectedVersion: doc.revision, newName: '新名称' };
  expect((await runWorkspaceTool(session, { method: 'files.rename', params })).status).toBe('denied');
  expect(() => assertFileOutcome(session, {})).toThrow('文件操作未完成');
  session.writableDocuments.add(`${doc.documentId}:${doc.revision}`);
  expect((await runWorkspaceTool(session, { method: 'files.rename', params: { ...params, expectedVersion: 'material_0000000000000000' } })).error).toContain('版本');
  expect((await runWorkspaceTool(session, { method: 'files.rename', params: { ...params, newName: '../逃逸' } })).status).toBe('failed');
  expect((await loadDocuments(scope))[0].title).toBe('原件');
});
