// POST /api/midori/upload-image — player supplied visual asset

import fs from "fs/promises";
import path from "path";
import { createHash, randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from "next/server";
import { GENERATED_ROOT, imagePublicUrl, isImagePathSegment } from '@/lib/game/midori/image-paths';
import { MAX_IMAGE_UPLOAD_BYTES } from '@/lib/game/midori/image-tags';
import { IMAGE_MIME_EXTENSIONS, isImageMimeType, matchesImageType } from '@/lib/game/midori/image-format';

const TARGET_SLOTS: Record<string, string[]> = {
  scene: ['background'], character: ['portrait', 'avatar', 'emotion'], detail: ['detail'], world: ['cover'], item: ['icon'],
};

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const worldId = requiredString(form.get("worldId"));
    const targetType = requiredString(form.get("targetType"));
    const targetId = requiredString(form.get("targetId"));
    const slot = requiredString(form.get("slot"));
    const file = form.get("file");

    if (!worldId || !targetType || !targetId || !slot) {
      return NextResponse.json({ error: "Missing worldId, targetType, targetId, or slot" }, { status: 400 });
    }
    if (!isImagePathSegment(worldId) || targetId.length > 512 || !Object.hasOwn(TARGET_SLOTS, targetType) || !TARGET_SLOTS[targetType].includes(slot)) {
      return NextResponse.json({ error: 'Invalid world or image target' }, { status: 400 });
    }
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Missing image file" }, { status: 400 });
    }
    if (!isImageMimeType(file.type)) {
      return NextResponse.json({ error: "Only PNG, JPEG, WebP, and GIF images are supported" }, { status: 415 });
    }
    const ext = IMAGE_MIME_EXTENSIONS[file.type];
    if (file.size > MAX_IMAGE_UPLOAD_BYTES) {
      return NextResponse.json({ error: "图片不能超过 32 MB" }, { status: 413 });
    }
    if (file.size === 0) return NextResponse.json({ error: 'Image is empty' }, { status: 400 });

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    if (!matchesImageType(buffer, file.type)) return NextResponse.json({ error: 'Image content does not match its format' }, { status: 415 });
    const dir = path.join(GENERATED_ROOT, worldId, "uploads");
    await fs.mkdir(dir, { recursive: true });
    const [root, actualDir] = await Promise.all([fs.realpath(GENERATED_ROOT), fs.realpath(dir)]);
    if (actualDir !== path.join(root, worldId, 'uploads')) throw new Error('Upload path leaves world directory');

    const targetHash = createHash('sha256').update(targetId).digest('hex').slice(0, 16);
    const fileName = `${targetType}_${targetHash}_${slot}_${randomUUID()}.${ext}`;
    const filePath = path.join(dir, fileName);
    await fs.writeFile(filePath, buffer, { flag: 'wx' });

    return NextResponse.json({
      ok: true,
      imageUrl: imagePublicUrl(worldId, `uploads/${fileName}`),
      relativePath: `uploads/${fileName}`,
      sizeBytes: buffer.byteLength,
      mimeType: file.type,
      source: "uploaded",
    });
  } catch (error) {
    console.error("[MIDORI upload-image] failed:", error);
    return NextResponse.json({ error: "Upload failed" }, { status: 500 });
  }
}

function requiredString(value: FormDataEntryValue | null): string {
  return typeof value === "string" ? value.trim() : "";
}
