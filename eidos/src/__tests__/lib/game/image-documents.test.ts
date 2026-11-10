// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { afterEach, expect, it, vi } from 'vitest';
import { importDocument, saveLocalDocument } from '@/lib/game/documents/ingest';
import { loadDocuments, readDocument } from '@/lib/game/documents/repository';
import { readResource } from '@/lib/game/workspace/resources';
import { collectDocumentBundle, restoreDocumentBundle } from '@/lib/game/documents/transfer';
import { documentScopeKey } from '@/lib/game/model-documents';
import { _resetDB } from '@/lib/game/storage';
import { TWO_FRAME_GIF } from '@/lib/test/image-fixtures';
import { saveImageDocument } from '@/lib/game/midori/image-documents';
import { uploadImageResource } from '@/lib/game/midori/upload-image';
import { createWorkspaceSession, runWorkspaceTool } from '@/lib/game/workspace/session';

afterEach(() => { vi.unstubAllGlobals(); _resetDB(); localStorage.clear(); });

it('imports an animated image as a referenceable versioned document, keeping its entire original through export and restore', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ imageUrl: '/generated/world/uploads/cat.gif', relativePath: 'uploads/cat.gif', mimeType: 'image/gif' })));
  const scope = { worldId: crypto.randomUUID(), playthroughId: 'one', archiveId: 'main' };
  const link = await importDocument(scope, new File([TWO_FRAME_GIF], '跳舞.gif', { type: 'image/gif' }));
  const shown = await readDocument(scope, link), version = shown.record.versions[link.revision];
  expect(version.format).toBe('markdown');
  expect(shown.resource.text).toContain('eidos-image');
  expect(shown.resource.text).toContain('imageId');
  expect(shown.resource.text).not.toContain('base64');
  const session = await createWorkspaceSession({ scope, actionId: 'inspect-image', parentNodeId: null, inputs: [link] });
  const source = Object.keys(session.files)[0];
  const cited = await runWorkspaceTool(session, { method: 'files.read', params: { path: source } });
  expect(cited.status).toBe('committed');
  expect(cited.text).toContain('imageId');
  expect(cited.text).not.toContain('base64');
  const original = await readResource(version.originalResource!);
  expect(original.mimeType).toBe('image/gif');
  expect(Uint8Array.from(atob(original.base64!), c => c.charCodeAt(0))).toEqual(TWO_FRAME_GIF);
  const edited = await saveLocalDocument(scope, { title: '舞蹈参考', content: shown.resource.text!, previous: link });
  expect((await readDocument(scope, edited)).record.versions[edited.revision].originalResource?.id).toBe(original.id);
  const bundle = await collectDocumentBundle({ scopes: [scope] });
  const target = { ...scope, playthroughId: 'restored' };
  await restoreDocumentBundle(bundle, new Map([[documentScopeKey(scope), target]]));
  const [restored] = await loadDocuments(target);
  const restoredImage = await readResource(restored.versions[restored.currentRevision].originalResource!);
  expect(restoredImage.base64).toBe(original.base64);
  expect((await loadDocuments({ ...scope, archiveId: 'sandbox:other' })).length).toBe(0);
});

it('updates one image document without duplicating entries or changing a previously pinned version', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ imageUrl: '/cat.gif' })));
  const scope = { worldId: crypto.randomUUID(), playthroughId: 'one' };
  const image = await uploadImageResource(scope.worldId, new File([TWO_FRAME_GIF], 'cat.gif', { type: 'image/gif' }), { type: 'character', targetId: '猫', label: '猫', tags: ['平静'] });
  const first = await saveImageDocument(scope, image);
  const [second, duplicate] = await Promise.all([saveImageDocument(scope, { ...image, tags: ['开心'] }), saveImageDocument(scope, { ...image, tags: ['开心'] })]);
  expect(second.documentId).toBe(first.documentId); expect(second.revision).not.toBe(first.revision);
  expect(duplicate).toEqual(second); expect(await loadDocuments(scope)).toHaveLength(1);
  expect((await readDocument(scope, first)).resource.text).toContain('平静');
  expect((await readDocument(scope, second)).resource.text).toContain('开心');
  const note = await saveLocalDocument(scope, { title: '我的图像笔记', content: '保留玩家补充的注释。', previous: second });
  const preserved = await saveImageDocument(scope, { ...image, tags: ['思考'] });
  expect(preserved.revision).toBe(note.revision);
  expect((await readDocument(scope, preserved)).resource.text).toBe('保留玩家补充的注释。');
});
