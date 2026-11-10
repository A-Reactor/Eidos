// POST /api/midori/check-image — 检查单张图片是否已缓存
import { NextRequest, NextResponse } from "next/server";
import { getFromCache } from "@/lib/game/midori/cache";
import type { ImageCacheKey } from "@/lib/game/midori/types";
import { readImageCacheKey } from '@/lib/game/midori/image-paths';

export async function POST(request: NextRequest) {
  try {
    const { cacheKey: input } = await request.json() as { cacheKey: ImageCacheKey };
    const cacheKey = readImageCacheKey(input);
    if (!cacheKey) {
      return NextResponse.json({ cached: false, error: "无效的图像标识" }, { status: 400 });
    }
    const url = await getFromCache(cacheKey);
    return NextResponse.json({ cached: !!url, url: url ?? null });
  } catch (e) {
    return NextResponse.json({ cached: false, error: (e as Error).message }, { status: 500 });
  }
}
