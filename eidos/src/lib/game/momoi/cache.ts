// ============================================================
// Eidos · MOMOI 音频缓存管理器
// ============================================================
// 文件系统缓存：生成的语音存到 public/generated/ 下。
// LRU 淘汰策略：总量超限时删除最旧文件。
//
// 目录结构：
//   public/generated/<worldId>/voices/
//     <speaker>_<emotion>_<textHash>.wav     (~10-50KB per clip)
//     <speaker>.wav                           (NPC 参考音频)
//
// 仅在 Node.js 服务端使用（import fs），不在浏览器端导入
// ============================================================

import fs from "fs/promises";
import path from "path";
import type { AudioCacheKey } from "./types";
import { hashText } from "./utils";
import { GENERATED_ROOT } from '../media-root';

// Re-export for consumers that import from cache
export { hashText };

/** 最大缓存大小 200MB（音频文件很小） */
const MAX_STORAGE_BYTES = 200 * 1024 * 1024;

/** 淘汰触发阈值：超过 80% 时触发清理 */
const EVICTION_THRESHOLD = MAX_STORAGE_BYTES * 0.8;

// ============================================================
// 路径构建
// ============================================================

/**
 * 根据音频缓存键构建文件系统路径。
 */
function buildFilePath(key: AudioCacheKey): string {
  // speaker 可能含中文 → 转为 hex 避免 URL 问题
  const speakerSafe = /^[a-zA-Z0-9_-]+$/.test(key.speaker)
    ? key.speaker
    : Buffer.from(key.speaker, "utf-8").toString("hex").slice(0, 16);
  return path.join(
    GENERATED_ROOT,
    key.worldId,
    "voices",
    `${speakerSafe}_${key.emotion}_${key.textHash}.wav`,
  );
}

/**
 * 文件路径 → 公开 URL 路径
 * public/generated/xxx.wav → /generated/xxx.wav
 */
function filePathToUrl(filePath: string): string {
  return "/generated/" + path.relative(GENERATED_ROOT, filePath).split(path.sep).map(encodeURIComponent).join('/');
}

// ============================================================
// 公开 API
// ============================================================

/**
 * 检查音频缓存中是否存在指定键的音频。
 *
 * @returns 公开 URL 路径，未命中返回 null
 */
export async function getAudioFromCache(key: AudioCacheKey): Promise<string | null> {
  const filePath = buildFilePath(key);
  try {
    await fs.access(filePath);
    // 更新访问时间（用于 LRU 排序）
    const now = new Date();
    await fs.utimes(filePath, now, now).catch(() => {});
    return filePathToUrl(filePath);
  } catch {
    return null;
  }
}

/**
 * 将 base64 音频数据存入缓存。
 *
 * @param key — 缓存键
 * @param base64Data — base64 编码的 WAV 数据
 * @returns 公开 URL 路径
 */
export async function saveAudioToCache(
  key: AudioCacheKey,
  base64Data: string,
): Promise<string> {
  const filePath = buildFilePath(key);
  const dir = path.dirname(filePath);

  // 确保目录存在
  await fs.mkdir(dir, { recursive: true });

  // 处理可能的 data URL 前缀
  const cleanBase64 = base64Data.replace(/^data:audio\/\w+;base64,/, "");
  const buffer = Buffer.from(cleanBase64, "base64");
  await fs.writeFile(filePath, buffer);

  // 异步触发淘汰检查（不阻塞返回）
  ensureStorageLimit().catch((e) => {
    console.warn("[MomoiCache] eviction check failed:", e);
  });

  return filePathToUrl(filePath);
}

/**
 * 保存 NPC 参考音频（用于音色克隆）。
 */
export async function saveReferenceAudio(
  worldId: string,
  speaker: string,
  base64Data: string,
): Promise<string> {
  const filePath = path.join(GENERATED_ROOT, worldId, "voices", `${speaker}.wav`);
  const dir = path.dirname(filePath);

  await fs.mkdir(dir, { recursive: true });

  const cleanBase64 = base64Data.replace(/^data:audio\/\w+;base64,/, "");
  const buffer = Buffer.from(cleanBase64, "base64");
  await fs.writeFile(filePath, buffer);

  return filePathToUrl(filePath);
}

/**
 * 删除 NPC 参考音频。
 */
export async function deleteReferenceAudio(
  worldId: string,
  speaker: string,
): Promise<boolean> {
  const filePath = path.join(GENERATED_ROOT, worldId, "voices", `${speaker}.wav`);
  try {
    await fs.unlink(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * 列出某世界所有已保存的 NPC 音色 profile。
 */
export async function listVoiceProfiles(worldId: string): Promise<
  Array<{ speaker: string; url: string }>
> {
  const dir = path.join(GENERATED_ROOT, worldId, "voices");
  const profiles: Array<{ speaker: string; url: string }> = [];

  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith(".wav") && !entry.name.includes("_")) {
        const speaker = entry.name.replace(".wav", "");
        profiles.push({
          speaker,
          url: `/generated/${worldId}/voices/${entry.name}`,
        });
      }
    }
  } catch {
    // 目录不存在或为空
  }

  return profiles;
}

// ============================================================
// LRU 淘汰
// ============================================================

/**
 * 检查并清理超限缓存（LRU 淘汰）。
 */
export async function ensureStorageLimit(): Promise<{
  beforeBytes: number;
  afterBytes: number;
  deletedCount: number;
} | null> {
  let totalSize = 0;
  const entries: Array<{ path: string; mtime: number; size: number }> = [];

  async function walk(dir: string): Promise<void> {
    let dirents;
    try {
      dirents = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of dirents) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.name.endsWith(".wav")) {
        try {
          const stat = await fs.stat(fullPath);
          totalSize += stat.size;
          entries.push({ path: fullPath, mtime: stat.mtimeMs, size: stat.size });
        } catch { /* 文件可能已被删除 */ }
      }
    }
  }

  await walk(GENERATED_ROOT);

  if (totalSize <= EVICTION_THRESHOLD) return null;

  const beforeBytes = totalSize;
  entries.sort((a, b) => a.mtime - b.mtime);

  const targetBytes = MAX_STORAGE_BYTES * 0.6;
  let deletedCount = 0;
  for (const entry of entries) {
    if (totalSize <= targetBytes) break;
    try {
      await fs.unlink(entry.path);
      totalSize -= entry.size;
      deletedCount++;
    } catch { /* 忽略删除失败 */ }
  }

  console.log(
    `[MomoiCache] LRU eviction: deleted ${deletedCount} files, ` +
    `${((beforeBytes - totalSize) / 1024 / 1024).toFixed(1)}MB freed, ` +
    `${(totalSize / 1024 / 1024).toFixed(1)}MB remaining`,
  );

  return { beforeBytes, afterBytes: totalSize, deletedCount };
}

/**
 * 删除指定世界的所有音频缓存。
 */
export async function clearWorldVoiceCache(worldId: string): Promise<number> {
  const worldDir = path.join(GENERATED_ROOT, worldId, "voices");
  let deletedCount = 0;

  try {
    const entries = await fs.readdir(worldDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith(".wav")) {
        await fs.unlink(path.join(worldDir, entry.name));
        deletedCount++;
      }
    }
  } catch { /* 目录可能不存在 */ }

  return deletedCount;
}
