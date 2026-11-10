// @vitest-environment jsdom
import React from 'react';
import 'fake-indexeddb/auto';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { DocumentMarkdown } from '@/components/ui/DocumentMarkdown';
import { DocumentLibrary } from '@/components/game/DocumentLibrary';
import { storeResource } from '@/lib/game/workspace/resources';
import { bytesToBase64 } from '@/lib/game/documents/file-bytes';
import { imageDocumentUrl } from '@/lib/game/midori/image-documents';
import { loadDocuments } from '@/lib/game/documents/repository';
import { useGameStore } from '@/store/game-store';
import { buildRiftCityStartState } from '@/lib/test/fixtures';
import { TWO_FRAME_GIF } from '@/lib/test/image-fixtures';
import { _resetDB } from '@/lib/game/storage';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); _resetDB(); localStorage.clear(); });

it('plays the document version’s local original while remote and unrelated image references remain links', async () => {
  const image = await storeResource({ name: 'dance.gif', mimeType: 'image/gif', base64: bytesToBase64(TWO_FRAME_GIF) });
  render(React.createElement(DocumentMarkdown, { image, content: `![跳舞](${imageDocumentUrl(image.id)})\n\n![远程](https://example.com/private.png)\n\n![其他](eidos-image:material_other)` }));
  const shown = await screen.findByRole('img', { name: '跳舞' });
  expect(shown.getAttribute('src')).toBe(`data:image/gif;base64,${bytesToBase64(TWO_FRAME_GIF)}`);
  expect(screen.getAllByRole('img')).toHaveLength(1);
  expect(screen.getByRole('link', { name: '远程' }).getAttribute('href')).toBe('https://example.com/private.png');
});

it('imports the same GIF through documents, registers it for narrative use, and lets players explicitly reference it', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ imageUrl: '/generated/library/uploads/dance.gif', relativePath: 'uploads/dance.gif' })));
  const { world } = buildRiftCityStartState(), scope = { worldId: world.id, playthroughId: crypto.randomUUID(), archiveId: 'main' };
  useGameStore.setState({ ...useGameStore.getInitialState(), currentWorld: world, currentPlaythroughId: scope.playthroughId });
  const onReference = vi.fn();
  render(React.createElement(DocumentLibrary, { scope, onReference }));
  await screen.findByText('还没有文档。');
  fireEvent.change(screen.getByLabelText('导入文档'), { target: { files: [new File([TWO_FRAME_GIF], '舞蹈.gif', { type: 'image/gif' })] } });
  fireEvent.click(await screen.findByRole('button', { name: /舞蹈/ }));
  await screen.findByRole('img', { name: '图片原件' });
  expect(screen.getByRole('button', { name: '导出原件' })).toBeTruthy();
  const images = Object.values(useGameStore.getState().midoriAssetRegistry.images ?? {});
  expect(images).toEqual([expect.objectContaining({ type: 'illustration', imageUrl: '/generated/library/uploads/dance.gif' })]);
  fireEvent.click(screen.getByRole('button', { name: '引用到行动' }));
  const [doc] = await loadDocuments(scope);
  expect(onReference).toHaveBeenCalledWith({ documentId: doc.id, revision: doc.currentRevision, title: '舞蹈' });
  await waitFor(() => expect(screen.getByLabelText('文档正文').textContent).toContain(images[0].id));
});

it('adapts an older uploaded GIF binding into a document without replacing its narrative binding or uploading it again', async () => {
  const { world } = buildRiftCityStartState(), scope = { worldId: world.id, playthroughId: crypto.randomUUID(), archiveId: 'main' };
  const url = `/generated/${world.id}/uploads/legacy-cat.gif`;
  const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(TWO_FRAME_GIF, { headers: { 'Content-Type': 'image/gif' } }));
  vi.stubGlobal('fetch', fetcher);
  useGameStore.setState({ ...useGameStore.getInitialState(), currentWorld: world, currentPlaythroughId: scope.playthroughId });
  await useGameStore.getState().bindMidoriAsset({ worldId: world.id, targetType: 'character', targetId: '神秘猫', slot: 'portrait', source: 'uploaded', imageUrl: url, label: '旧动态图' });
  const library = render(React.createElement(DocumentLibrary, { scope }));
  await screen.findByText('还没有文档。');
  expect(screen.queryByRole('button', { name: /旧动态图/ })).toBeNull();
  const [doc] = await loadDocuments(scope);
  library.unmount();
  render(React.createElement(DocumentLibrary, { scope, initialId: doc.id }));
  await screen.findByRole('img', { name: '图片原件' });
  expect(fetcher).toHaveBeenCalledWith(url, expect.objectContaining({ signal: undefined }));
  expect(fetcher.mock.calls.every(([input]) => !String(input).includes('/upload-image'))).toBe(true);
  expect(useGameStore.getState().midoriAssetRegistry.bindings['character:神秘猫:portrait'].imageUrl).toBe(url);
});
