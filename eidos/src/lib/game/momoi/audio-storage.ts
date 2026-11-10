// ============================================================
// Eidos · MOMOI 音频 IndexedDB 持久化
// ============================================================
// 将生成的语音 base64 数据存入 IndexedDB，与存档系统协同工作。
//
// 存储架构（复用 eidos_storage / blob_store）：
//   key: "voice_{worldId}_{speaker}_{emotion}_{textHash}"
//   value: { key, base64, size, createdAt }
//
// 与文件系统缓存互为备份：
//   - 文件系统（public/generated/）→ 服务端快速访问
//   - IndexedDB → 随存档持久化，跨设备恢复
// ============================================================

const BLOB_STORE = "blob_store";
const VOICE_KEY_PREFIX = "voice_";

interface VoiceBlobEntry {
  key: string;
  base64: string;
  size: number;
  createdAt: number;
}

import { openStorageDB as openDB } from "../storage";
import { writeAudioMetadata, enforceAudioStorageLimit } from './storage-quota';

// ============================================================
// Key 构建
// ============================================================

function voiceKey(
  worldId: string,
  speaker: string,
  emotion: string,
  textHash: string,
): string {
  return `${VOICE_KEY_PREFIX}${worldId}_${speaker}_${emotion}_${textHash}`;
}

// ============================================================
// 公开 API
// ============================================================

/** 存储语音 base64 到 IndexedDB */
export async function saveVoiceToIndexedDB(
  worldId: string,
  speaker: string,
  emotion: string,
  textHash: string,
  base64: string,
): Promise<void> {
  if (typeof window === "undefined") return;
  try {
    const db = await openDB();
    const key = voiceKey(worldId, speaker, emotion, textHash);
    const clean = base64.replace(/^data:audio\/\w+;base64,/, "");

    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(BLOB_STORE, "readwrite");
      const store = tx.objectStore(BLOB_STORE);
      const entry: VoiceBlobEntry = {
        key,
        base64: clean,
        size: clean.length,
        createdAt: Date.now(),
      };
      store.put(entry, key);
      writeAudioMetadata(store, key, entry);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    await enforceAudioStorageLimit();
  } catch (e: unknown) {
    console.warn("[VoiceStorage] saveVoiceToIndexedDB failed:", (e as Error)?.message);
  }
}

/** 从 IndexedDB 读取语音 base64 */
export async function getVoiceFromIndexedDB(
  worldId: string,
  speaker: string,
  emotion: string,
  textHash: string,
): Promise<string | null> {
  if (typeof window === "undefined") return null;
  try {
    const db = await openDB();
    const key = voiceKey(worldId, speaker, emotion, textHash);

    return new Promise((resolve, reject) => {
      const tx = db.transaction(BLOB_STORE, "readonly");
      const req = tx.objectStore(BLOB_STORE).get(key);
      req.onsuccess = () => {
        const entry = req.result as VoiceBlobEntry | undefined;
        resolve(entry?.base64 ?? null);
      };
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

/**
 * 将 base64 音频数据同步转换为 Blob URL。
 * 用于即时播放，避免 data URL 的浏览器兼容问题。
 */
export function base64ToBlobUrl(base64: string): string {
  const clean = base64.replace(/^data:audio\/\w+;base64,/, "");
  const binary = atob(clean);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  const blob = new Blob([bytes], { type: "audio/wav" });
  return URL.createObjectURL(blob);
}

/**
 * 尝试从 IndexedDB 获取语音并播放。
 * 返回 true 表示命中并已创建 blob URL（调用方负责播放）。
 */
export async function loadVoiceBlobUrl(
  worldId: string,
  speaker: string,
  emotion: string,
  textHash: string,
): Promise<string | null> {
  const base64 = await getVoiceFromIndexedDB(worldId, speaker, emotion, textHash);
  if (!base64) return null;

  try {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    const blob = new Blob([bytes], { type: "audio/wav" });
    return URL.createObjectURL(blob);
  } catch {
    return null;
  }
}

/** 删除指定世界的所有语音缓存 */
export async function clearWorldVoiceFromIndexedDB(
  worldId: string,
): Promise<number> {
  if (typeof window === "undefined") return 0;
  try {
    const db = await openDB();
    const prefix = `${VOICE_KEY_PREFIX}${worldId}_`;

    return new Promise((resolve, reject) => {
      const tx = db.transaction(BLOB_STORE, "readwrite");
      const store = tx.objectStore(BLOB_STORE);
      const req = store.getAllKeys();
      let deleted = 0;

      req.onsuccess = () => {
        const keys = req.result as string[];
        for (const key of keys) {
          if (typeof key === "string" && key.startsWith(prefix)) {
            store.delete(key);
            writeAudioMetadata(store, key);
            deleted++;
          }
        }
      };
      tx.oncomplete = () => resolve(deleted);
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    return 0;
  }
}

/** 查询 IndexedDB 中的语音缓存总大小（字节，估算） */
export async function getVoiceStorageSize(): Promise<number> {
  if (typeof window === "undefined") return 0;
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(BLOB_STORE, "readonly");
      const req = tx.objectStore(BLOB_STORE).getAll();
      req.onsuccess = () => {
        const entries = req.result as VoiceBlobEntry[];
        const total = entries
          .filter((e) => e.key?.startsWith(VOICE_KEY_PREFIX))
          .reduce((sum, e) => sum + (e.size || 0), 0);
        resolve(total);
      };
      req.onerror = () => reject(req.error);
    });
  } catch {
    return 0;
  }
}
