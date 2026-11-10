// ============================================================
// Eidos · MIDORI 图像缓存管理器
// ============================================================
// 文件系统缓存：生成图存到 public/generated/ 下
// LRU 淘汰策略：总量超限时删除最旧文件
//
// 目录结构：
//   public/generated/<worldId>/
//     scenes/<sceneId>_<weather>_<hour>h.png     (~150-300KB)
//     details/<sceneId>_<regionId>.png             (~150-300KB)
//
// 仅在 Node.js 服务端使用（import fs），不在浏览器端导入
// ============================================================

import fs from "fs/promises";
import path from "path";
import type { ImageCacheKey } from "./types";
import { GENERATED_ROOT, imageCachePaths, imageFilePath, imagePublicUrl } from './image-paths';
import { existingImagePath } from './image-files';

/** 最大缓存大小 500MB */
const MAX_STORAGE_BYTES = 500 * 1024 * 1024;

/** 淘汰触发阈值：超过 80% 时触发清理 */
const EVICTION_THRESHOLD = MAX_STORAGE_BYTES * 0.8;

// ============================================================
// 路径构建
// ============================================================

/**
 * 根据缓存键构建文件系统路径
 */
function buildFilePath(key: ImageCacheKey): string {
  return imageFilePath(key.worldId, imageCachePaths(key)[0]);
}

/**
 * 文件路径 → 公开 URL 路径
 * public/generated/xxx.png → /generated/xxx.png
 */
function filePathToUrl(filePath: string): string {
  return "/generated/" + path.relative(GENERATED_ROOT, filePath).split(path.sep).map(encodeURIComponent).join('/');
}

// ============================================================
// 公开 API
// ============================================================

/**
 * 检查缓存中是否存在指定键的图片
 *
 * @returns 公开 URL 路径，未命中返回 null
 */
export async function getFromCache(key: ImageCacheKey): Promise<string | null> {
  for (const relativePath of imageCachePaths(key)) {
    const filePath = await existingImagePath(key.worldId, relativePath);
    if (!filePath) continue;
    // 更新访问时间（用于 LRU 排序）
    const now = new Date();
    await fs.utimes(filePath, now, now).catch((e) => { console.warn("[MidoriCache] utimes update failed:", e?.message || e); });
    return imagePublicUrl(key.worldId, relativePath);
  }
  return null;
}

/**
 * 将 base64 图片数据存入缓存
 *
 * @param key — 缓存键
 * @param base64Data — base64 编码的 PNG 数据
 * @returns 公开 URL 路径
 */
export async function saveToCache(
  key: ImageCacheKey,
  base64Data: string,
): Promise<string> {
  const filePath = buildFilePath(key);
  const dir = path.dirname(filePath);

  // 确保目录存在
  await fs.mkdir(dir, { recursive: true });

  // 解码 base64 → Buffer → 写入文件
  // 处理可能的 data URL 前缀 (data:image/png;base64,...)
  const cleanBase64 = base64Data.replace(/^data:image\/\w+;base64,/, "");
  const buffer = Buffer.from(cleanBase64, "base64");
  await fs.writeFile(filePath, buffer);

  // 异步触发淘汰检查（不阻塞返回）
  ensureStorageLimit().catch((e) => {
    console.warn("[MidoriCache] eviction check failed:", e);
  });

  return filePathToUrl(filePath);
}

/**
 * 检查并清理超限缓存（LRU 淘汰）
 *
 * 当 public/generated/ 下所有 PNG 总大小超过阈值时，
 * 按最后修改时间从旧到新删除，直到低于限制。
 */
export async function ensureStorageLimit(): Promise<{
  beforeBytes: number;
  afterBytes: number;
  deletedCount: number;
} | null> {
  let totalSize = 0;
  const entries: Array<{ path: string; mtime: number; size: number }> = [];

  // 递归扫描 generated 目录
  async function walk(dir: string): Promise<void> {
    let dirents;
    try {
      dirents = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return; // 目录不存在
    }
    for (const entry of dirents) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        // Uploaded artwork belongs to the player, not the expendable generation cache.
        if (entry.name === 'uploads') continue;
        await walk(fullPath);
      } else if (entry.name.endsWith(".png")) {
        try {
          const stat = await fs.stat(fullPath);
          totalSize += stat.size;
          entries.push({
            path: fullPath,
            mtime: stat.mtimeMs,
            size: stat.size,
          });
        } catch {
          // 文件可能已被删除
        }
      }
    }
  }

  await walk(GENERATED_ROOT);

  // 未超限，无需清理
  if (totalSize <= EVICTION_THRESHOLD) return null;

  const beforeBytes = totalSize;

  // 按修改时间升序（最旧的在前）
  entries.sort((a, b) => a.mtime - b.mtime);

  // 删除最旧文件直到低于限制
  const targetBytes = MAX_STORAGE_BYTES * 0.6; // 清理到 60%
  let deletedCount = 0;
  for (const entry of entries) {
    if (totalSize <= targetBytes) break;
    try {
      await fs.unlink(entry.path);
      totalSize -= entry.size;
      deletedCount++;
    } catch {
      // 忽略删除失败
    }
  }

  console.log(
    `[MidoriCache] LRU eviction: deleted ${deletedCount} files, ` +
    `${((beforeBytes - totalSize) / 1024 / 1024).toFixed(1)}MB freed, ` +
    `${(totalSize / 1024 / 1024).toFixed(1)}MB remaining`,
  );

  return { beforeBytes, afterBytes: totalSize, deletedCount };
}

/**
 * 获取缓存统计信息
 */
export async function getCacheStats(): Promise<{
  totalFiles: number;
  totalBytes: number;
  worldCount: number;
}> {
  let totalFiles = 0;
  let totalBytes = 0;
  const worlds = new Set<string>();

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
        // 追踪 worldId 目录
        if (dir === GENERATED_ROOT) worlds.add(entry.name);
        await walk(fullPath);
      } else if (entry.name.endsWith(".png")) {
        totalFiles++;
        try {
          const stat = await fs.stat(fullPath);
          totalBytes += stat.size;
        } catch {}
      }
    }
  }

  await walk(GENERATED_ROOT);

  return { totalFiles, totalBytes, worldCount: worlds.size };
}

/**
 * 删除指定世界的所有缓存
 */
export async function clearWorldCache(worldId: string): Promise<number> {
  const worldDir = path.join(GENERATED_ROOT, worldId);
  let deletedCount = 0;

  async function rmDir(dir: string): Promise<void> {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await rmDir(fullPath);
      } else {
        await fs.unlink(fullPath);
        deletedCount++;
      }
    }
    await fs.rmdir(dir);
  }

  await rmDir(worldDir);
  return deletedCount;
}
