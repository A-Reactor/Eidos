import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { NextRequest } from 'next/server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { TWO_FRAME_GIF } from '@/lib/test/image-fixtures';

let root: string;
let routes: {
  list: typeof import('@/app/api/midori/list-images/route');
  upload: typeof import('@/app/api/midori/upload-image/route');
  remove: typeof import('@/app/api/midori/delete-image/route');
  check: typeof import('@/app/api/midori/check-image/route');
  cache: typeof import('@/lib/game/midori/cache');
};
let restoreCwd: () => void;
const worldId = '世界_测试';
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a6X8AAAAASUVORK5CYII=', 'base64');
const jsonRequest = (route: string, body: unknown) => new NextRequest(`http://localhost/api/midori/${route}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});
const key = (sceneId: string, regionId?: string) => ({ worldId, sceneId, weather: '晴', timeOfDay: '12:00', ...(regionId ? { regionId } : {}) });
async function file(relativePath: string) {
  const target = path.join(root, 'public/generated', worldId, relativePath);
  await fs.mkdir(path.dirname(target), { recursive: true }); await fs.writeFile(target, png);
  return target;
}
async function upload(options: { world?: string; type?: string; slot?: string; bytes?: Buffer; name?: string; mimeType?: string } = {}) {
  const form = new FormData();
  form.set('worldId', options.world ?? worldId); form.set('targetType', options.type ?? 'character');
  form.set('targetId', options.name ?? '阿林'); form.set('slot', options.slot ?? 'portrait');
  form.set('file', new File([new Uint8Array(options.bytes ?? png)], 'image', { type: options.mimeType ?? 'image/png' }));
  return routes.upload.POST(new NextRequest('http://localhost/api/midori/upload-image', { method: 'POST', body: form }));
}

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'eidos-images-'));
  const spy = vi.spyOn(process, 'cwd').mockReturnValue(root); restoreCwd = () => spy.mockRestore();
  routes = { list: await import('@/app/api/midori/list-images/route'), upload: await import('@/app/api/midori/upload-image/route'),
    remove: await import('@/app/api/midori/delete-image/route'), check: await import('@/app/api/midori/check-image/route'), cache: await import('@/lib/game/midori/cache') };
});
beforeEach(async () => { await fs.rm(path.join(root, 'public'), { recursive: true, force: true }); });
afterAll(async () => { restoreCwd(); await fs.rm(root, { recursive: true, force: true }); });

describe('image resource file contracts', () => {
  it('preserves every animated GIF frame on upload and accepts only a matching GIF signature', async () => {
    const response = await upload({ bytes: Buffer.from(TWO_FRAME_GIF), mimeType: 'image/gif' });
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.imageUrl.endsWith('.gif')).toBe(true);
    expect(result.mimeType).toBe('image/gif');
    expect(await fs.readFile(path.join(root, 'public/generated', worldId, result.relativePath))).toEqual(Buffer.from(TWO_FRAME_GIF));
    expect((await upload({ bytes: png, mimeType: 'image/gif' })).status).toBe(415);
  });

  it('lists, finds and deletes an existing GIF through the same legacy image locations', async () => {
    const target = await file('npcs/老朋友.gif'); await fs.writeFile(target, TWO_FRAME_GIF);
    const listing = await (await routes.list.GET(new NextRequest(`http://localhost/api/midori/list-images?worldId=${encodeURIComponent(worldId)}`))).json();
    expect(listing.npcImages).toEqual([expect.objectContaining({ name: '老朋友', relativePath: 'npcs/老朋友.gif' })]);
    const checked = await routes.check.POST(jsonRequest('check-image', { cacheKey: key('npcs', '老朋友_neutral') }));
    expect(await checked.json()).toMatchObject({ cached: true, url: expect.stringContaining('.gif') });
    expect((await routes.remove.POST(jsonRequest('delete-image', { cacheKey: key('npcs', '老朋友_neutral') }))).status).toBe(200);
    await expect(fs.access(target)).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('lists legacy portraits and regions separately and preserves nested file paths', async () => {
    await Promise.all(['scenes/versions/town_square_晴_1200.PNG', 'details/icon_npc_阿_林_neutral.png',
      'details/npcs_另一个人_happy.png', 'npcs/老朋友.png', 'details/regions_旧城区.png', 'regions/中心区_overview.png',
      'details/town_square_region_with_underscores.png', 'details/icon_item_钥匙.png'].map(file));
    const response = await routes.list.GET(new NextRequest(`http://localhost/api/midori/list-images?worldId=${encodeURIComponent(worldId)}`));
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.sceneImages).toEqual([expect.objectContaining({ sceneId: 'town_square', relativePath: 'scenes/versions/town_square_晴_1200.PNG' })]);
    expect(data.sceneImages[0].url).toContain(encodeURIComponent(worldId));
    expect(data.npcImages.map((image: { name: string }) => image.name).sort()).toEqual(['另一个人_happy', '老朋友', '阿_林_neutral'].sort());
    expect(data.regionImages.map((image: { regionId: string }) => image.regionId).sort()).toEqual(['中心区', '旧城区']);
    expect(data.detailImages).toHaveLength(1);
    expect(data.detailImages[0].relativePath).toBe('details/town_square_region_with_underscores.png');
  });

  it('uses the same clock normalization and portrait locations for lookup and deletion', async () => {
    const scene = await file('scenes/town_square_晴_1200.png');
    await file('details/icon_npc_阿_林_neutral.png');
    await file('npcs/老朋友.png');
    for (const cacheKey of [key('town_square'), key('npcs', '阿_林_neutral'), key('npcs', '老朋友_neutral')]) {
      const checked = await routes.check.POST(jsonRequest('check-image', { cacheKey }));
      expect(await checked.json()).toMatchObject({ cached: true, url: expect.stringContaining('/generated/') });
      expect((await routes.remove.POST(jsonRequest('delete-image', { cacheKey }))).status).toBe(200);
      expect(await (await routes.check.POST(jsonRequest('check-image', { cacheKey }))).json()).toMatchObject({ cached: false });
    }
    await expect(fs.access(scene)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('deletes the listed file exactly, including ambiguous underscores and nested paths', async () => {
    const exact = await file('details/revisions/town_square_region_with_id.png');
    const other = await file('details/town_square_region.png');
    const request = { cacheKey: key('town_square', 'region_with_id'), relativePath: 'details/revisions/town_square_region_with_id.png' };
    expect(await (await routes.remove.POST(jsonRequest('delete-image', request))).json()).toMatchObject({ ok: true });
    await expect(fs.access(exact)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(fs.access(other)).resolves.toBeUndefined();
    expect(await (await routes.remove.POST(jsonRequest('delete-image', request))).json()).toEqual({ ok: true, deleted: false });
  });

  it('rejects traversal and malformed cache keys before file operations', async () => {
    for (const world of ['../escape', '..', 'bad\\world']) {
      expect((await upload({ world })).status).toBe(400);
      expect((await routes.list.GET(new NextRequest(`http://localhost/api/midori/list-images?worldId=${encodeURIComponent(world)}`))).status).toBe(400);
      expect((await routes.check.POST(jsonRequest('check-image', { cacheKey: { ...key('town'), worldId: world } }))).status).toBe(400);
    }
    for (const relativePath of ['../other.png', 'details/../../other.png', '/details/a.png', 'uploads/bad.txt']) {
      expect((await routes.remove.POST(jsonRequest('delete-image', { cacheKey: key('town'), relativePath }))).status).toBe(400);
    }
  });

  it('preserves Unicode worlds and produces different upload names even for the same target', async () => {
    const first = await upload(), second = await upload(), third = await upload({ name: '阿蓝' });
    expect([first.status, second.status, third.status]).toEqual([200, 200, 200]);
    const urls = await Promise.all([first, second, third].map(async response => (await response.json()).imageUrl as string));
    expect(new Set(urls).size).toBe(3);
    for (const url of urls) {
      expect(url).toContain(`/generated/${encodeURIComponent(worldId)}/uploads/character_`);
      expect(await fs.readFile(path.join(root, 'public', decodeURIComponent(url)))).toEqual(png);
    }
  });

  it('validates the upload target, nonempty bytes, format and size', async () => {
    expect((await upload({ type: 'unknown' })).status).toBe(400);
    expect((await upload({ slot: 'background' })).status).toBe(400);
    expect((await upload({ bytes: Buffer.alloc(0) })).status).toBe(400);
    expect((await upload({ bytes: Buffer.from('pretend png') })).status).toBe(415);
    expect((await upload({ bytes: Buffer.alloc(32 * 1024 * 1024 + 1) })).status).toBe(413);
  });

  it('accepts an image at the new 32 MiB boundary', async () => {
    const bytes = Buffer.alloc(32 * 1024 * 1024); png.copy(bytes);
    const response = await upload({ bytes });
    expect(response.status).toBe(200);
    const image = await response.json();
    expect(image.sizeBytes).toBe(bytes.length);
    expect(image.relativePath).toMatch(/^uploads\/character_/u);
    expect((await fs.stat(path.join(root, 'public/generated', worldId, image.relativePath))).size).toBe(bytes.length);
  });

  it('reports I/O failures instead of returning a misleading empty directory', async () => {
    const denied = vi.spyOn(fs, 'readdir').mockRejectedValueOnce(Object.assign(new Error('denied'), { code: 'EACCES' }));
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect((await routes.list.GET(new NextRequest(`http://localhost/api/midori/list-images?worldId=${encodeURIComponent(worldId)}`))).status).toBe(500);
    } finally { denied.mockRestore(); log.mockRestore(); }
  });

  it('never evicts uploaded artwork as expendable generated cache', async () => {
    const uploaded = await file('uploads/player-art.png');
    // Sparse size triggers the former eviction bug without allocating hundreds of MB.
    await fs.truncate(uploaded, 600 * 1024 * 1024);
    await file('scenes/square_晴_12h.png');
    expect(await routes.cache.ensureStorageLimit()).toBeNull();
    expect((await fs.stat(uploaded)).size).toBe(600 * 1024 * 1024);
  });
});
