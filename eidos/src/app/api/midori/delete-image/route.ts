import { NextRequest, NextResponse } from 'next/server';
import fs from 'node:fs/promises';
import { imageCachePaths, imageFilePath, readImageCacheKey } from '@/lib/game/midori/image-paths';
import { existingImagePath, fileMissing } from '@/lib/game/midori/image-files';

export async function POST(request: NextRequest) {
  let body;
  try { body = await request.json(); }
  catch { return NextResponse.json({ ok: false, error: '无效的图像请求' }, { status: 400 }); }
  const cacheKey = readImageCacheKey(body?.cacheKey);
  if (!cacheKey || body.relativePath !== undefined && typeof body.relativePath !== 'string') {
    return NextResponse.json({ ok: false, error: '无效的图像标识' }, { status: 400 });
  }
  let candidates: string[];
  try {
    candidates = body.relativePath !== undefined ? [body.relativePath] : imageCachePaths(cacheKey);
    candidates.forEach(relativePath => imageFilePath(cacheKey.worldId, relativePath));
  } catch { return NextResponse.json({ ok: false, error: '无效的图像路径' }, { status: 400 }); }
  try {
    for (const relativePath of candidates) {
      const filePath = await existingImagePath(cacheKey.worldId, relativePath);
      if (!filePath) continue;
      try { await fs.unlink(filePath); }
      catch (cause) { if (!fileMissing(cause)) throw cause; }
      return NextResponse.json({ ok: true, deleted: relativePath });
    }
    // An already removed file should not block refreshing the directory.
    return NextResponse.json({ ok: true, deleted: false });
  } catch (cause) {
    console.error('[MIDORI delete-image] failed:', cause);
    return NextResponse.json({ ok: false, error: '删除图像失败，请重试' }, { status: 500 });
  }
}
