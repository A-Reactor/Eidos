import { NextRequest, NextResponse } from 'next/server';
import { isImagePathSegment } from '@/lib/game/midori/image-paths';
import { listImageFiles, type ImageFile } from '@/lib/game/midori/image-files';
import { IMAGE_FILE_EXTENSION } from '@/lib/game/midori/image-format';
import type { GalleryCharacterImage, GalleryDetailImage, GalleryListResponse, GallerySceneImage } from '@/lib/game/midori/types';

export async function GET(request: NextRequest) {
  const worldId = request.nextUrl.searchParams.get('worldId');
  if (!isImagePathSegment(worldId)) return NextResponse.json({ error: 'Missing or invalid worldId' }, { status: 400 });
  try {
    const [scenes, details, npcs, regions, illustrations] = await Promise.all(
      ['scenes', 'details', 'npcs', 'regions', 'illustrations'].map(directory => listImageFiles(worldId, directory)),
    );
    const result: GalleryListResponse = { sceneImages: [], detailImages: [], illustrations: [], npcImages: [], regionImages: [] };
    for (const file of scenes) {
      const match = stem(file).match(/^(.+)_([^_]+)_([^_]+)$/u);
      if (match) result.sceneImages.push({ ...metadata(file), sceneId: match[1], weather: match[2], timeOfDay: match[3] } satisfies GallerySceneImage);
    }
    for (const file of details) {
      const name = stem(file);
      if (name.startsWith('icon_npc_')) result.npcImages!.push(character(file, name.slice(9)));
      else if (name.startsWith('npcs_')) result.npcImages!.push(character(file, name.slice(5)));
      else if (name.startsWith('regions_')) result.regionImages!.push({ ...metadata(file), sceneId: 'regions', regionId: name.slice(8) });
      else if (!name.startsWith('icon_')) {
        const at = name.lastIndexOf('_');
        if (at > 0 && at < name.length - 1) result.detailImages.push({ ...metadata(file), sceneId: name.slice(0, at), regionId: name.slice(at + 1) } satisfies GalleryDetailImage);
      }
    }
    for (const file of npcs) result.npcImages!.push(character(file, stem(file)));
    for (const file of regions) result.regionImages!.push({ ...metadata(file), sceneId: 'regions', regionId: stem(file).replace(/_overview$/u, '') });
    for (const file of illustrations) result.illustrations.push({ ...metadata(file), sceneId: stem(file), weather: '', timeOfDay: '' });
    return NextResponse.json(result);
  } catch (cause) {
    console.error('[MIDORI list-images] failed:', cause);
    return NextResponse.json({ error: '无法读取图像资源，请重试' }, { status: 500 });
  }
}

const stem = (file: ImageFile) => file.filename.replace(IMAGE_FILE_EXTENSION, '');
const metadata = ({ url, relativePath, fileSize, lastModified }: ImageFile) => ({ url, relativePath, fileSize, lastModified });
function character(file: ImageFile, name: string): GalleryCharacterImage {
  // Keep the original identifier: a real name can itself end in “_happy”.
  const emotion = name.match(/_(neutral|happy|sad|angry|surprised|thinking)$/i)?.[1].toLowerCase();
  return { ...metadata(file), name, ...(emotion ? { emotion } : {}) };
}
