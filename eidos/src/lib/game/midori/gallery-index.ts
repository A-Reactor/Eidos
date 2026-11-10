// ============================================================
// 画廊索引 — 按存档隔离，共享图片缓存
// ============================================================
//
// 图片缓存（MIDORI 文件系统）按 worldId/sceneId 存储，所有存档共享。
// 画廊索引（localStorage）按 saveId 隔离，每个存档独立记录已生成的图片。
//
// 架构：
//   MIDORI 缓存: ~/.cache/midori-images/{worldId}/{sceneId}/{weather}_{timeOfDay}.png
//                  ↑ 共享，不重复生成
//   画廊索引:     localStorage: eidos_gallery_{saveId}
//                  ↑ 每个存档独立，新建存档从空开始

import type { ImageCacheKey } from "./types";

// ============================================================
// 类型
// ============================================================

export interface GalleryEntry {
  /** 图片 URL（MIDORI 缓存路径） */
  url: string;
  /** 场景 ID */
  sceneId: string;
  /** 天气 */
  weather: string;
  /** 时段（如 "12h", "dawn", "dusk"） */
  timeOfDay: string;
  /** 生成时间戳 */
  generatedAt: number;
}

// ============================================================
// localStorage 持久化
// ============================================================

function galleryKey(saveId: string): string {
  return `eidos_gallery_${saveId}`;
}

function loadGallery(saveId: string): GalleryEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(galleryKey(saveId));
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveGallery(saveId: string, entries: GalleryEntry[]): void {
  if (typeof window === "undefined") return;
  try {
    // 限制单个存档的画廊条目数（防止无限增长）
    const trimmed = entries.slice(-500);
    localStorage.setItem(galleryKey(saveId), JSON.stringify(trimmed));
  } catch (e: any) {
    console.warn("[GalleryIndex] save failed:", e?.message || e);
  }
}

// ============================================================
// 公共 API
// ============================================================

/**
 * 记录一张图片到存档的画廊索引。
 *
 * 调用时机：MIDORI 成功生图并保存到缓存后。
 *
 * @param saveId 存档 ID（如 "save_xxx" 或 "autosave_xxx"）
 * @param cacheKey 图片缓存键
 * @param imageUrl 图片 URL（缓存路径）
 */
export function recordGalleryImage(
  saveId: string,
  cacheKey: ImageCacheKey,
  imageUrl: string,
): void {
  if (!saveId) return;
  const entries = loadGallery(saveId);

  // 去重：相同场景+天气+时段的条目只保留最新的
  const filtered = entries.filter(
    (e) =>
      !(
        e.sceneId === cacheKey.sceneId &&
        e.weather === (cacheKey.weather || "晴") &&
        e.timeOfDay === (cacheKey.timeOfDay || "12h")
      ),
  );

  filtered.push({
    url: imageUrl,
    sceneId: cacheKey.sceneId,
    weather: cacheKey.weather || "晴",
    timeOfDay: cacheKey.timeOfDay || "12h",
    generatedAt: Date.now(),
  });

  saveGallery(saveId, filtered);
}

/**
 * 获取指定存档的画廊索引。
 *
 * @param saveId 存档 ID
 * @returns 画廊条目列表（按生成时间排序）
 */
export function getGalleryForSave(saveId: string): GalleryEntry[] {
  if (!saveId) return [];
  return loadGallery(saveId)
    .sort((a, b) => b.generatedAt - a.generatedAt);
}

/**
 * 获取指定世界所有存档的画廊条目（合并去重）。
 * 用于世界选择界面的画廊预览。
 *
 * @param worldId 世界 ID
 * @param allSaveIds 该世界的所有存档 ID 列表
 */
export function getGalleryForWorld(
  worldId: string,
  allSaveIds: string[],
): GalleryEntry[] {
  if (!worldId || allSaveIds.length === 0) return [];

  const allEntries: GalleryEntry[] = [];
  for (const saveId of allSaveIds) {
    const entries = loadGallery(saveId);
    allEntries.push(...entries);
  }

  // 去重（按 url）+ 排序
  const seen = new Set<string>();
  return allEntries
    .filter((e) => {
      const key = e.url;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => b.generatedAt - a.generatedAt);
}

/**
 * 删除指定存档的画廊索引（存档被删除时调用）。
 */
export function deleteGalleryForSave(saveId: string): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(galleryKey(saveId));
  } catch {}
}

/**
 * 删除指定存档的某条画廊记录。
 */
export function removeGalleryEntry(saveId: string, url: string): void {
  const entries = loadGallery(saveId).filter((e) => e.url !== url);
  saveGallery(saveId, entries);
}
