// ============================================================
// Eidos · IndexedDB 存储层
// ============================================================
// 存储架构:
//   save_data   store — 存档数据（过渡期保留）
//   meta_data   store — 索引数据（世界列表、周目列表、世界线树，小体积）
//   blob_store  store — CAS 内容块（WorldSnapshot / StorySegment[]）
//
// localStorage 保留版本标记和 IndexedDB 暂不可用时的备用数据。
// ============================================================

import type { GameSave } from "./types";

const DB_NAME = "eidos_storage";
// V4 repairs V3 databases first opened by the old CAS/audio initializer,
// which created only blob_store. Existing records stay in place.
export const CURRENT_STORAGE_VERSION = 4;
export const STORAGE_VERSION_KEY = "eidos_storage_version";
const STORE_NAME = "save_data";
const META_STORE_NAME = "meta_data";
export const BLOB_STORE_NAME = "blob_store";
let _db: IDBDatabase | null = null;
let opening: Promise<IDBDatabase> | null = null;
const recordQueues = new Map<string, Promise<void>>();
const lockManager = () => typeof navigator !== "undefined" ? navigator.locks : undefined;

async function withRecordLock<T>(store: string, key: string, operation: () => Promise<T>): Promise<T> {
  const name = `${DB_NAME}:${store}:${key}`;
  const locks = lockManager();
  if (locks) return locks.request(name, operation);
  // Older webviews still need ordering between operations in this context.
  const previous = recordQueues.get(name) ?? Promise.resolve();
  const result = previous.then(operation);
  const settled = result.then(() => {}, () => {});
  recordQueues.set(name, settled);
  void settled.then(() => { if (recordQueues.get(name) === settled) recordQueues.delete(name); });
  return result;
}

/** Existing test compatibility. Closing the handle also releases upgrade locks. */
export function _resetDB(): void {
  _db?.close(); _db = null; opening = null;
}

export function openStorageDB(): Promise<IDBDatabase> {
  if (_db) return Promise.resolve(_db);
  if (opening) return opening;
  const pending = new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, CURRENT_STORAGE_VERSION);
    let blocked = false;
    req.onupgradeneeded = () => {
      for (const name of [STORE_NAME, META_STORE_NAME, BLOB_STORE_NAME]) {
        if (!req.result.objectStoreNames.contains(name)) req.result.createObjectStore(name);
      }
    };
    req.onsuccess = () => {
      if (blocked) { req.result.close(); return; }
      const db = req.result;
      _db = db;
      db.onversionchange = () => { db.close(); if (_db === db) _db = null; };
      db.onclose = () => { if (_db === db) _db = null; };
      resolve(db);
    };
    req.onerror = () => reject(req.error ?? new Error("无法打开存档数据库"));
    req.onblocked = () => {
      blocked = true;
      reject(new Error("存档升级被其他窗口阻塞，请关闭其他 EIDOS 窗口后重试"));
    };
  });
  opening = pending;
  void pending.then(() => { if (opening === pending) opening = null; }, () => { if (opening === pending) opening = null; });
  return pending;
}

async function writeRecord(storeName: string, key: string, data: unknown): Promise<void> {
  const db = await openStorageDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    tx.objectStore(storeName).put(data, key);
    tx.oncomplete = () => resolve();
    tx.onabort = tx.onerror = () => reject(tx.error ?? new Error("存档写入事务已取消"));
  });
}

async function readRecord(storeName: string, key: string): Promise<unknown> {
  const db = await openStorageDB();
  return await new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readonly");
    const req = tx.objectStore(storeName).get(key);
    tx.oncomplete = () => resolve(req.result);
    tx.onabort = tx.onerror = () => reject(tx.error ?? new Error("存档读取事务已取消"));
  });
}

function readFallback(key: string): { data: unknown; raw: string } | null {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? null : { data: JSON.parse(raw), raw };
  } catch { return null; } // Keep corrupt source bytes available for manual recovery.
}

function clearFallback(key: string, raw?: string): void {
  // A concurrent tab may have replaced the source while migration was committing.
  if (raw === undefined || localStorage.getItem(key) === raw) localStorage.removeItem(key);
}

async function saveRecord(storeName: string, key: string, fallbackKey: string, data: unknown): Promise<void> {
  if (typeof window === "undefined") return;
  let previous: string | null = null;
  try { previous = localStorage.getItem(fallbackKey); } catch { /* IDB may still work. */ }
  try {
    await writeRecord(storeName, key, data);
  } catch (error) {
    console.warn(`[Storage] write failed [${key}]:`, error);
    // If both backends fail, propagate the failure so UI cannot report a false save.
    localStorage.setItem(fallbackKey, JSON.stringify(data));
    return;
  }
  try {
    if (localStorage.getItem(fallbackKey) === previous) clearFallback(fallbackKey);
  } catch { /* A committed IDB record remains saved even if fallback cleanup is denied. */ }
}

async function loadRecord(storeName: string, key: string, fallbackKey: string): Promise<unknown | null> {
  if (typeof window === "undefined") return null;
  const fallback = readFallback(fallbackKey);
  if (fallback) {
    // A failed IDB write leaves the latest data here. Commit before removing it.
    try {
      // Without a cross-context lock, loading must not write a stale copy over a
      // newer value or recreate a concurrently deleted save. Keep the backup.
      if (lockManager() && localStorage.getItem(fallbackKey) === fallback.raw) {
        await writeRecord(storeName, key, fallback.data);
        clearFallback(fallbackKey, fallback.raw);
      }
    }
    catch { /* The intact fallback is still a valid load source. */ }
    return fallback.data;
  }
  try { return (await readRecord(storeName, key)) ?? null; }
  catch (error) { console.warn(`[Storage] read failed [${key}]:`, error); return null; }
}

async function removeRecord(storeName: string, key: string, fallbackKey: string): Promise<void> {
  if (typeof window === "undefined") return;
  // A delete must not leave an old fallback that resurrects the record on next load.
  const db = await openStorageDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    tx.objectStore(storeName).delete(key);
    tx.oncomplete = () => resolve();
    tx.onabort = tx.onerror = () => reject(tx.error ?? new Error("存档删除事务已取消"));
  });
  clearFallback(fallbackKey);
}

export async function saveToDB(key: string, data: unknown): Promise<void> {
  await withRecordLock(STORE_NAME, key, async () => {
    const { compactSaveAudio } = await import('./momoi/save-audio');
    await saveRecord(STORE_NAME, key, key, await compactSaveAudio(key, data));
  });
}
export async function loadFromDB(key: string): Promise<unknown | null> {
  return withRecordLock(STORE_NAME, key, async () => {
    const { compactSaveAudio, hydrateSaveAudio } = await import('./momoi/save-audio');
    const original = await loadRecord(STORE_NAME, key, key);
    const compact = await compactSaveAudio(key, original);
    if (compact !== original) await saveRecord(STORE_NAME, key, key, compact);
    return hydrateSaveAudio(key, compact);
  });
}
/** One-time lazy compaction of legacy embedded audio before quota cleanup. */
export async function compactStoredAudio(): Promise<void> {
  const db = await openStorageDB();
  const migrated = await readRecord(META_STORE_NAME, 'audio_pool_compacted_v1');
  if (migrated) return;
  const keys = await new Promise<IDBValidKey[]>((resolve, reject) => {
    const req = db.transaction(STORE_NAME).objectStore(STORE_NAME).getAllKeys();
    req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error);
  });
  for (const key of keys) if (typeof key === 'string' && /(?:save_data_|autosave_data_|autosave_prev_data_)/.test(key)) {
    await withRecordLock(STORE_NAME, key, async () => {
      const { compactSaveAudio } = await import('./momoi/save-audio');
      const original = await loadRecord(STORE_NAME, key, key), compact = await compactSaveAudio(key, original, true);
      if (compact !== original) await saveRecord(STORE_NAME, key, key, compact);
    });
  }
  await writeRecord(META_STORE_NAME, 'audio_pool_compacted_v1', true);
}
export async function removeFromDB(key: string): Promise<void> {
  await withRecordLock(STORE_NAME, key, () => removeRecord(STORE_NAME, key, key));
}
export async function saveMeta<T>(key: string, data: T): Promise<void> {
  await withRecordLock(META_STORE_NAME, key, () => saveRecord(META_STORE_NAME, key, `meta_${key}`, data));
}
export async function loadMeta<T>(key: string): Promise<T | null> {
  return withRecordLock(META_STORE_NAME, key, () => loadRecord(META_STORE_NAME, key, `meta_${key}`)) as Promise<T | null>;
}
export function withMetaLock<T>(key: string, operation: () => Promise<T>): Promise<T> {
  return withRecordLock(META_STORE_NAME, key, operation);
}
/** Compare and compensate under the same lock as ordinary metadata writes. */
export async function updateMeta<T>(key: string, update: (current: T | null) => T | null): Promise<void> {
  await withRecordLock(META_STORE_NAME, key, async () => {
    const current = await loadRecord(META_STORE_NAME, key, `meta_${key}`) as T | null;
    const next = update(current);
    if (next !== current && next !== null) await saveRecord(META_STORE_NAME, key, `meta_${key}`, next);
  });
}

/** Read and update a counter in one IndexedDB transaction, including across browser tabs. */
export async function updateDurableMeta<T>(key: string, update: (current: T | null) => T): Promise<T> {
  const db = await openStorageDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(META_STORE_NAME, 'readwrite');
    const store = tx.objectStore(META_STORE_NAME);
    const request = store.get(key);
    let next: T;
    request.onsuccess = () => {
      try {
        const current = (request.result ?? null) as T | null;
        next = update(current);
        if (next !== current) store.put(next, key);
      } catch (error) {
        reject(error);
        tx.abort();
      }
    };
    tx.oncomplete = () => resolve(next);
    tx.onabort = tx.onerror = () => reject(tx.error ?? new Error('统计事务已取消'));
  });
}
export async function removeMeta(key: string): Promise<void> {
  await withRecordLock(META_STORE_NAME, key, () => removeRecord(META_STORE_NAME, key, `meta_${key}`));
}

// ============================================================
// 自动存档 — IndexedDB 专用函数 (V2)
// ============================================================

export const autoSaveDataKey = (playthroughId: string) =>
  `autosave_data_${playthroughId}`;

export const autoSavePrevDataKey = (playthroughId: string) =>
  `autosave_prev_data_${playthroughId}`;

/** 保存自动存档到 IndexedDB */
export async function saveAutoSaveToDB(playthroughId: string, data: GameSave): Promise<void> {
  await saveToDB(autoSaveDataKey(playthroughId), data);
}

/** 加载自动存档 */
export async function loadAutoSaveFromDB(playthroughId: string): Promise<GameSave | null> {
  return loadFromDB(autoSaveDataKey(playthroughId)) as Promise<GameSave | null>;
}

/** 保存上一步自动存档 */
export async function saveAutoSavePrevToDB(playthroughId: string, data: GameSave): Promise<void> {
  await saveToDB(autoSavePrevDataKey(playthroughId), data);
}

/** 删除自动存档（当前 + 上一步） */
export async function removeAutoSaveFromDB(playthroughId: string): Promise<void> {
  await removeFromDB(autoSaveDataKey(playthroughId));
  await removeFromDB(autoSavePrevDataKey(playthroughId));
}

// ============================================================
// localStorage 辅助 — 仅用于索引过渡和版本标记
// ============================================================

/** 同步：保存索引（小数据，过渡期保留） */
export function saveIndex(key: string, data: unknown): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(key, JSON.stringify(data));
  } catch {
    // 索引极小，不太可能失败
  }
}

/** 同步：读取索引 */
export function loadIndex<T>(key: string): T | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

/**
 * 迁移所有旧的 save_data_* 键从 localStorage 到 IndexedDB。
 * 在应用启动时由 migration 模块调用。
 */
export async function migrateLegacySaves(): Promise<number> {
  if (typeof window === "undefined") return 0;
  let migrated = 0;
  const keys = Object.keys(localStorage).filter(k => k.startsWith("save_data_"));
  for (const key of keys) {
    try {
      await withRecordLock(STORE_NAME, key, async () => {
        const raw = localStorage.getItem(key);
        if (!raw) return;
        const data = JSON.parse(raw);
        // Existing databases may already contain a newer copy. Legacy records
        // have no revision metadata, so an explicit migration only adds missing keys.
        const db = await openStorageDB();
        let added = false;
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction(STORE_NAME, "readwrite"), store = tx.objectStore(STORE_NAME);
          const req = store.get(key);
          req.onsuccess = () => {
            if (req.result === undefined && localStorage.getItem(key) === raw) { store.add(data, key); added = true; }
          };
          tx.oncomplete = () => resolve();
          tx.onabort = tx.onerror = () => reject(tx.error ?? new Error("存档迁移事务已取消"));
        });
        // Cleanup without a Web Lock could race with another context's delete.
        if (added && lockManager()) { clearFallback(key, raw); migrated++; }
      });
    } catch { /* skip corrupted */ }
  }
  if (migrated > 0) {
    console.log(`[Storage] 已迁移 ${migrated} 个存档到 IndexedDB`);
  }
  return migrated;
}
