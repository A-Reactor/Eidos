import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, it, vi } from 'vitest';

it('serves newly written player media and rejects paths outside the media directory', async () => {
  const data = await mkdtemp(path.join(tmpdir(), 'eidos-media-'));
  const root = path.join(data, 'generated');
  vi.stubEnv('EIDOS_MEDIA_DIR', root);
  vi.resetModules();
  try {
    const route = import.meta.glob<typeof import('@/app/generated/[...asset]/route')>(
      '/src/app/generated/*/route.ts',
    )['/src/app/generated/[...asset]/route.ts'];
    expect(route, 'dynamic production media route').toBeDefined();
    const { GET } = await route();
    const get = (asset: string[]) => GET(new Request('http://localhost:3000/generated'), { params: Promise.resolve({ asset }) });
    const uploads = path.join(root, '测试世界', 'uploads');
    await mkdir(uploads, { recursive: true });
    await writeFile(path.join(uploads, 'upload.png'), 'new media');
    await writeFile(path.join(data, 'private.png'), 'private');
    await symlink(path.join(data, 'private.png'), path.join(uploads, 'escaped.png'), 'file');

    const image = await get(['测试世界', 'uploads', 'upload.png']);
    expect(image.status).toBe(200);
    expect(image.headers.get('content-type')).toBe('image/png');
    expect(await image.text()).toBe('new media');
    expect((await get(['..', 'private.png'])).status).toBe(404);
    expect((await get(['测试世界', 'uploads', 'escaped.png'])).status).toBe(404);
  } finally {
    vi.unstubAllEnvs();
    await rm(data, { recursive: true, force: true });
  }
});
