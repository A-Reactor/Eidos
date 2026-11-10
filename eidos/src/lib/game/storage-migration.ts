// ============================================================
// Eidos · 存储迁移
// ============================================================
// 启动只更新兼容标记。数据库 schema 由 IndexedDB 升级事务补齐，
// 旧 localStorage 存档由 storage.ts 在成功提交后迁移。
// ============================================================

import { STORAGE_VERSION_KEY, CURRENT_STORAGE_VERSION } from "./storage";

/** 保留导出名供旧调用方兼容；不再删除任何玩家数据。 */
export function cleanupLegacyStorage(): number {
  if (typeof window === "undefined") return 0;
  try {
    const version = Number(localStorage.getItem(STORAGE_VERSION_KEY));
    // 较新客户端写入的标记不应被旧客户端降级。
    if (!Number.isFinite(version) || version < CURRENT_STORAGE_VERSION) {
      localStorage.setItem(STORAGE_VERSION_KEY, String(CURRENT_STORAGE_VERSION));
    }
  } catch { /* 标记不可写不影响读取已有 IndexedDB 存档。 */ }
  return 0;
}

/**
 * 在应用启动时调用。幂等，不删除玩家数据。
 */
export function initStorage(): number {
  return cleanupLegacyStorage();
}
