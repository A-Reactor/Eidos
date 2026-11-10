import { open, realpath } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { GENERATED_ROOT, isImagePathSegment } from '@/lib/game/midori/image-paths';

const mediaTypes = new Map([
  ['.png', 'image/png'], ['.jpg', 'image/jpeg'], ['.jpeg', 'image/jpeg'],
  ['.gif', 'image/gif'], ['.webp', 'image/webp'], ['.wav', 'audio/wav'],
]);

export async function GET(_request: Request, { params }: { params: Promise<{ asset: string[] }> }) {
  const { asset } = await params;
  const type = mediaTypes.get(path.extname(asset.at(-1) ?? '').toLowerCase());
  if (asset.length < 3 || !type || !asset.every(isImagePathSegment)) return new Response(null, { status: 404 });

  // Next indexes public files at startup. Serve assets added during play from the live media directory.
  try {
    const root = await realpath(GENERATED_ROOT);
    const file = path.join(root, ...asset);
    if (await realpath(file) !== file) return new Response(null, { status: 404 });
    const handle = await open(file, 'r');
    try {
      const stat = await handle.stat();
      if (stat.isFile()) {
        return new Response(Readable.toWeb(handle.createReadStream()) as ReadableStream<Uint8Array>, {
          headers: {
            'Content-Type': type,
            'Content-Length': String(stat.size),
            'Cache-Control': 'private, no-cache',
            'X-Content-Type-Options': 'nosniff',
          },
        });
      }
    } catch (error) {
      await handle.close();
      throw error;
    }
    await handle.close();
  } catch (error) {
    if (!['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) {
      console.warn('[local-media] Could not read asset:', (error as NodeJS.ErrnoException).code ?? 'unknown');
    }
  }
  return new Response(null, { status: 404 });
}
