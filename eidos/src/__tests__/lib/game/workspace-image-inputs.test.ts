// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { afterEach, expect, it, vi } from 'vitest';
import { saveLocalDocument } from '@/lib/game/documents/ingest';
import { saveDocument } from '@/lib/game/documents/repository';
import { storeResource } from '@/lib/game/workspace/resources';
import { createWorkspaceSession, runWorkspaceTool } from '@/lib/game/workspace/session';
import { workspaceImageInputs } from '@/lib/game/workspace/image-inputs';
import { modelImageInput } from '@/lib/game/midori/model-image-input';
import { _resetDB } from '@/lib/game/storage';
import { TWO_FRAME_GIF } from '@/lib/test/image-fixtures';
import { bytesToBase64 } from '@/lib/game/documents/file-bytes';

const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aJmUAAAAASUVORK5CYII=';
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); _resetDB(); });
async function fixture() {
  const scope = { worldId: crypto.randomUUID(), playthroughId: 'images' };
  const originalResource = await storeResource({ name: '白点.png', mimeType: 'image/png', base64: png });
  const resource = await storeResource({ name: 'image.md', mimeType: 'text/markdown', text: '版本一的图像说明' });
  const link = await saveDocument(scope, { title: '第一版', origin: 'imported', resource, originalResource, format: 'markdown' });
  const next = await saveLocalDocument(scope, { title: '第二版', content: '后续描述', previous: link });
  const unrelated = await saveLocalDocument(scope, { title: '普通文档', content: '普通文本' });
  return { scope, link, next, unrelated, originalResource, resource };
}
it('sends a selected pinned image version, with its bytes and title, without including other library images', async () => {
  const f = await fixture();
  const session = await createWorkspaceSession({ scope: f.scope, actionId: 'one', parentNodeId: null, inputs: [f.link, f.unrelated], library: [f.next] });
  const images = await workspaceImageInputs(session);
  expect(images).toHaveLength(1);
  expect(images![0]).toMatchObject({ name: '第一版', version: f.resource.id, mimeType: 'image/png', data: png });
  expect(images![0].path).toContain(f.link.revision);
  session.closed = true;
  await expect(workspaceImageInputs(session)).rejects.toThrow('取消');
});
it('adds pixels after an assistant file read, but not after listing, a denied read, or a character-only read', async () => {
  const f = await fixture();
  const session = await createWorkspaceSession({ scope: f.scope, actionId: 'two', parentNodeId: null, inputs: [], library: [f.next] });
  expect(await workspaceImageInputs(session)).toBeUndefined();
  await runWorkspaceTool(session, { method: 'files.list', params: {} });
  await runWorkspaceTool(session, { method: 'files.read', params: { path: '../invalid' } });
  expect(await workspaceImageInputs(session)).toBeUndefined();
  const path = Object.keys(session.files)[0];
  const receipt = await runWorkspaceTool(session, { method: 'files.read', params: { path } });
  expect((await workspaceImageInputs(session))![0]).toMatchObject({ name: '第二版', path, data: png });
  session.receipts = [{ ...receipt, actor: { kind: 'character', npcId: 'other', channelId: 'private' } }];
  expect(await workspaceImageInputs(session)).toBeUndefined();
});
it('flattens a GIF model copy to its first frame without changing or dropping any original animation bytes', async () => {
  const close = vi.fn(), bitmap = { width: 1, height: 1, close };
  const decode = vi.fn(async () => bitmap); vi.stubGlobal('createImageBitmap', decode);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ fillRect: vi.fn(), drawImage: vi.fn() } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/jpeg;base64,/9j/');
  const base64 = bytesToBase64(TWO_FRAME_GIF);
  const resource = { id: 'gif', name: 'motion.gif', mimeType: 'image/gif', size: TWO_FRAME_GIF.length, base64 };
  expect(await modelImageInput(resource)).toEqual({ mimeType: 'image/jpeg', data: '/9j/' });
  expect(resource.base64).toBe(base64); expect(close).toHaveBeenCalledOnce(); expect(decode).toHaveBeenCalledOnce();
});
