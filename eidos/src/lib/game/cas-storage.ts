// ============================================================
// Eidos · 内容寻址存储 (Content-Addressed Storage)
// ============================================================
// 所有世界线节点的 WorldSnapshot 和 StorySegment[] 按内容哈希存储。
// 同一份数据被多个节点引用时只存一份，通过 refCount 追踪引用。
//
// IndexedDB store: blob_store (DB Version 3)
//   key: "cas_{hash}"
//   value: { hash, type, data, refCount, size, createdAt }
// ============================================================

const BLOB_STORE = "blob_store";

/** 存储的内容块类型 */
export type BlobType = "snapshot" | "segments";

interface BlobEntry {
  hash: string;
  type: BlobType;
  data: unknown;
  refCount: number;
  size: number;
  createdAt: number;
}

// All consumers share the schema and connection lifecycle.
import { openStorageDB as openDB, _resetDB } from "./storage";
export function _resetCasDB(): void { _resetDB(); }

// ============================================================
// Content hashing
// ============================================================

/**
 * Compute a SHA-256 hash (first 16 hex chars) of the JSON-serialized data.
 * Same content → same hash → deduplication.
 */
export async function computeContentHash(data: unknown): Promise<string> {
  const json = JSON.stringify(data);
  const buffer = new TextEncoder().encode(json);
  const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 16);
}

/**
 * Synchronous hash for quick equality checks (non-cryptographic, fast).
 * Use computeContentHash() for canonical storage keys; this is for comparisons only.
 */
export function quickHash(data: unknown): string {
  const json = JSON.stringify(data);
  let h = 0;
  for (let i = 0; i < json.length; i++) {
    h = ((h << 5) - h + json.charCodeAt(i)) | 0;
  }
  return h.toString(36);
}

// ============================================================
// Blob CRUD
// ============================================================

/** Store a content blob. If it already exists, increment refCount. */
export async function storeBlob(
  hash: string,
  type: BlobType,
  data: unknown
): Promise<void> {
  if (typeof window === "undefined") return;
  try {
    const db = await openDB();
    const key = `cas_${hash}`;

    return await new Promise((resolve, reject) => {
      const tx = db.transaction(BLOB_STORE, "readwrite");
      const store = tx.objectStore(BLOB_STORE);
      const getReq = store.get(key);

      getReq.onsuccess = () => {
        const existing = getReq.result as BlobEntry | undefined;
        if (existing) {
          // Already exists — increment refCount
          existing.refCount += 1;
          store.put(existing, key);
        } else {
          // New blob
          const json = JSON.stringify(data);
          const entry: BlobEntry = {
            hash,
            type,
            data,
            refCount: 1,
            size: json.length,
            createdAt: Date.now(),
          };
          store.put(entry, key);
        }
      };
      getReq.onerror = () => reject(getReq.error);

      tx.oncomplete = () => resolve();
      tx.onabort = tx.onerror = () => reject(tx.error ?? new Error("内容块存储事务已取消"));
    });
  } catch (e: any) {
    console.warn(`[CAS] storeBlob failed [${hash}]:`, e?.message);
    throw e;
  }
}

/** Load a content blob by hash. Returns null if not found. */
export async function loadBlob(hash: string): Promise<unknown | null> {
  if (typeof window === "undefined") return null;
  try {
    const db = await openDB();
    const key = `cas_${hash}`;

    return await new Promise((resolve, reject) => {
      const tx = db.transaction(BLOB_STORE, "readonly");
      const req = tx.objectStore(BLOB_STORE).get(key);
      req.onsuccess = () => {
        const entry = req.result as BlobEntry | undefined;
        resolve(entry?.data ?? null);
      };
      req.onerror = () => reject(req.error);
    });
  } catch (e: any) {
    console.warn(`[CAS] loadBlob failed [${hash}]:`, e?.message);
    return null;
  }
}

/** Bound each transaction so large archives yield between batches and deduplicate reads. */
export async function loadBlobs(hashes: string[]): Promise<Map<string, unknown | null>> {
  const result = new Map<string, unknown | null>(), unique = [...new Set(hashes)];
  if (typeof window === 'undefined' || !unique.length) return result;
  const db = await openDB();
  for (let from = 0; from < unique.length; from += 128) {
    const batch = unique.slice(from, from + 128);
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(BLOB_STORE, 'readonly'), store = tx.objectStore(BLOB_STORE);
      for (const hash of batch) {
        const request = store.get(`cas_${hash}`);
        request.onsuccess = () => result.set(hash, (request.result as BlobEntry | undefined)?.data ?? null);
      }
      tx.oncomplete = () => resolve();
      tx.onabort = tx.onerror = () => reject(tx.error ?? new Error('内容块批量读取已取消'));
    });
  }
  return result;
}

/** Increment refCount for an existing blob. */
export async function incrementRef(hash: string): Promise<void> {
  if (typeof window === "undefined") return;
  try {
    const db = await openDB();
    const key = `cas_${hash}`;

    return await new Promise((resolve, reject) => {
      const tx = db.transaction(BLOB_STORE, "readwrite");
      const store = tx.objectStore(BLOB_STORE);
      const getReq = store.get(key);

      getReq.onsuccess = () => {
        const entry = getReq.result as BlobEntry | undefined;
        if (entry) {
          entry.refCount += 1;
          store.put(entry, key);
        }
      };
      getReq.onerror = () => reject(getReq.error);
      tx.oncomplete = () => resolve();
      tx.onabort = tx.onerror = () => reject(tx.error ?? new Error("内容块存储事务已取消"));
    });
  } catch (e: any) {
    console.warn(`[CAS] incrementRef failed [${hash}]:`, e?.message);
    throw e;
  }
}

/**
 * Decrement refCount for a blob. If refCount reaches 0, delete the blob.
 * Returns true if the blob was deleted.
 */
export async function decrementRef(hash: string): Promise<boolean> {
  if (typeof window === "undefined") return false;
  try {
    const db = await openDB();
    const key = `cas_${hash}`;

    return await new Promise((resolve, reject) => {
      const tx = db.transaction(BLOB_STORE, "readwrite");
      const store = tx.objectStore(BLOB_STORE);
      const getReq = store.get(key);
      let deleted = false;

      getReq.onsuccess = () => {
        const entry = getReq.result as BlobEntry | undefined;
        if (!entry) return;

        entry.refCount -= 1;
        if (entry.refCount <= 0) {
          store.delete(key);
          deleted = true;
        } else {
          store.put(entry, key);
          deleted = false;
        }
      };
      getReq.onerror = () => reject(getReq.error);
      tx.oncomplete = () => resolve(deleted);
      tx.onabort = tx.onerror = () => reject(tx.error ?? new Error("内容块存储事务已取消"));
    });
  } catch (e: any) {
    console.warn(`[CAS] decrementRef failed [${hash}]:`, e?.message);
    return false;
  }
}

/** Batch decrement: decrement refCount for all given hashes. */
export async function batchDecrementRef(hashes: string[]): Promise<number> {
  let deleted = 0;
  for (const hash of hashes) {
    const wasDeleted = await decrementRef(hash);
    if (wasDeleted) deleted++;
  }
  return deleted;
}

// ============================================================
// Garbage Collection
// ============================================================

/**
 * Collect all blobs with refCount <= 0.
 * Returns the number of blobs removed.
 */
export async function gcBlobs(): Promise<number> {
  if (typeof window === "undefined") return 0;
  try {
    const db = await openDB();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(BLOB_STORE, "readwrite");
      const store = tx.objectStore(BLOB_STORE);
      const getAllReq = store.getAllKeys();

      const toDelete: string[] = [];
      getAllReq.onsuccess = () => {
        const keys = getAllReq.result as string[];
        if (keys.length === 0) { resolve(0); return; }

        let processed = 0;
        for (const key of keys) {
          const getReq = store.get(key);
          getReq.onsuccess = () => {
            const entry = getReq.result as BlobEntry | undefined;
            if (entry && entry.refCount <= 0) {
              toDelete.push(key as string);
              store.delete(key);
            }
            processed++;
            if (processed >= keys.length && toDelete.length > 0) {
              console.log(`[CAS] GC: removed ${toDelete.length} blobs`);
            }
          };
        }
      };
      tx.oncomplete = () => resolve(toDelete.length);
      tx.onabort = tx.onerror = () => reject(tx.error ?? new Error("内容块存储事务已取消"));
    });
  } catch (e: any) {
    console.warn("[CAS] gcBlobs failed:", e?.message);
    return 0;
  }
}

// ============================================================
// Store + Hash helpers (convenience)
// ============================================================

/**
 * Compute hash + store blob atomically.
 * Returns the hash. If blob already exists, just bumps refCount.
 */
export async function hashAndStore(type: BlobType, data: unknown): Promise<string> {
  const hash = await computeContentHash(data);
  await storeBlob(hash, type, data);
  return hash;
}

/**
 * Load snapshot by hash, with type assertion.
 */
export async function loadSnapshot(hash: string): Promise<Record<string, any> | null> {
  return loadBlob(hash) as Promise<Record<string, any> | null>;
}

/**
 * Load segments by hash, with type assertion.
 */
export async function loadSegments(hash: string): Promise<any[] | null> {
  return loadBlob(hash) as Promise<any[] | null>;
}

// ============================================================
// Stats / Debug
// ============================================================

/** Get total blob count and total size (debug). */
export async function getCasStats(): Promise<{ count: number; totalSize: number }> {
  if (typeof window === "undefined") return { count: 0, totalSize: 0 };
  try {
    const db = await openDB();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(BLOB_STORE, "readonly");
      const store = tx.objectStore(BLOB_STORE);
      const req = store.openCursor();
      let count = 0, totalSize = 0;
      req.onsuccess = () => {
        const cursor = req.result;
        if (cursor) { count++; totalSize += (cursor.value as BlobEntry).size || 0; cursor.continue(); }
      };
      tx.oncomplete = () => resolve({ count, totalSize });
      tx.onabort = tx.onerror = () => reject(tx.error ?? new Error('内容块统计读取已取消'));
    });
  } catch {
    return { count: 0, totalSize: 0 };
  }
}
