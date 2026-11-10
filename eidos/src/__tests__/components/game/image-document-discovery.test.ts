// @vitest-environment jsdom
import React from 'react';
import { afterEach, expect, it } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { DocumentLibrary } from '@/components/game/DocumentLibrary';
import { DocumentPicker } from '@/components/game/DocumentPicker';
import { saveImageDocument } from '@/lib/game/midori/image-documents';
import { saveLocalDocument } from '@/lib/game/documents/ingest';
import { saveDocument, readDocument } from '@/lib/game/documents/repository';
import { storeResource } from '@/lib/game/workspace/resources';
import { createWorkspaceSession, runWorkspaceTool } from '@/lib/game/workspace/session';
import { workspacePromptContext } from '@/lib/game/workspace/context';
import { validateWorkspaceContext } from '@/lib/ai/workspace-tools';
import { TWO_FRAME_GIF } from '@/lib/test/image-fixtures';
import { bytesToBase64 } from '@/lib/game/documents/file-bytes';

afterEach(cleanup);

it('hides gallery descriptors from lists and picker while keeping search, direct references and explicit image documents', async () => {
  const scope = { worldId: crypto.randomUUID(), playthroughId: 'discovery' };
  const originalResource = await storeResource({ name: '表情.gif', mimeType: 'image/gif', base64: bytesToBase64(TWO_FRAME_GIF) });
  const hidden = await saveImageDocument(scope, { id: 'gallery-expression', worldId: scope.worldId, type: 'illustration', targetId: '',
    label: '图库表情', description: '这是得意表情的详细内容', tags: ['得意'], source: 'uploaded', originalResource, createdAt: 1, updatedAt: 1 });
  await saveLocalDocument(scope, { title: '调查正文', content: '保留正文' });
  await saveDocument(scope, { title: '主动导入的图像', resource: (await readDocument(scope, hidden)).record.versions[hidden.revision].resource,
    origin: 'imported', originalResource, libraryVisibility: 'visible' });
  const ui = render(React.createElement(DocumentLibrary, { scope }));
  const list = await screen.findByRole('list', { name: '已保存文档' });
  await screen.findByText('调查正文');
  expect(within(list).queryByText('图库表情')).toBeNull();
  expect(within(list).getByText('主动导入的图像')).toBeTruthy();
  ui.unmount();
  render(React.createElement(DocumentPicker, { scope, selected: [], onChange() {}, onClose() {} }));
  await screen.findByRole('button', { name: '调查正文' });
  expect(screen.queryByRole('button', { name: '图库表情' })).toBeNull();

  const session = await createWorkspaceSession({ scope, actionId: 'discover', parentNodeId: null, inputs: [], library: [hidden] });
  expect(workspacePromptContext(session).mounts).toEqual([]);
  expect((await runWorkspaceTool(session, { method: 'files.list', params: {} })).entries).toEqual([]);
  const found = await runWorkspaceTool(session, { method: 'files.search', params: { query: '得意' } });
  const match = found.matches![0];
  expect(match).toMatchObject({ name: '图库表情', writable: false, version: hidden.revision });
  expect((await runWorkspaceTool(session, { method: 'files.read', params: { path: match.path } })).text).toContain('详细内容');
  expect(validateWorkspaceContext(workspacePromptContext(session))?.results.at(-2)?.matches?.[0]).toMatchObject(match);
  const selected = await createWorkspaceSession({ scope, actionId: 'selected', parentNodeId: null, inputs: [hidden], library: [hidden] });
  expect(workspacePromptContext(selected).mounts).toContainEqual(expect.objectContaining({ selected: true, name: '图库表情' }));
  expect((await readDocument(scope, hidden)).record.versions[hidden.revision].originalResource).toEqual(originalResource);
});
