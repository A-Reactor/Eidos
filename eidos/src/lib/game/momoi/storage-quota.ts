import { compactStoredAudio, openStorageDB } from '../storage';

export const DEFAULT_AUDIO_LIMIT_MB = 500;
const LIMIT_KEY = 'eidos_audio_cache_limit_mb';
export const VOICE_CACHE_CHANGED = 'eidos:voice-cache-changed';
export interface AudioCacheStats { beforeBytes: number; afterBytes: number; deletedKeys: string[]; protectedBytes: number }
const META_PREFIX = 'audio_cache_meta:';
const META_VERSION = 'audio_cache_metadata_v1';
interface CacheMetadata { key: string; size: number; createdAt: number; uploaded: boolean }
export function writeAudioMetadata(store: IDBObjectStore, key: string, asset?: { audioBase64?: string; base64?: string; createdAt?: number; provider?: string }) {
  if (!asset) { store.delete(META_PREFIX + key); return; }
  const meta: CacheMetadata = { key, size: asset.audioBase64?.length ?? asset.base64?.length ?? 0, createdAt: Number.isFinite(asset.createdAt) ? asset.createdAt! : 0, uploaded: asset.provider === 'uploaded' };
  store.put(meta, META_PREFIX + key);
}
export function clearAudioMetadata(store: IDBObjectStore, prefix: string) {
  store.delete(IDBKeyRange.bound(META_PREFIX + prefix, META_PREFIX + prefix + '\uffff'));
}
/** One lazy migration; subsequent writes read only small metadata, never all audio payloads. */
function migrateMetadata(store: IDBObjectStore, done: () => void, fail: (error: unknown) => void) {
  const version = store.get(META_VERSION);
  version.onerror = () => fail(version.error);
  version.onsuccess = () => {
    if (version.result === 1) { done(); return; }
    const cursorRequest = store.openCursor();
    cursorRequest.onerror = () => fail(cursorRequest.error);
    cursorRequest.onsuccess = () => {
      const cursor = cursorRequest.result;
      if (!cursor) { store.put(1, META_VERSION); done(); return; }
      const key = String(cursor.key);
      if (key.startsWith('momoi_v2_') || key.startsWith('voice_')) writeAudioMetadata(store, key, cursor.value);
      cursor.continue();
    };
  };
}
export function audioLimitMB() {
  try { const value = Number(localStorage.getItem(LIMIT_KEY)); return Number.isSafeInteger(value) && value >= 1 && value <= 1_048_576 ? value : DEFAULT_AUDIO_LIMIT_MB; }
  catch { return DEFAULT_AUDIO_LIMIT_MB; }
}
export async function setAudioLimitMB(value: number) {
  if (!Number.isSafeInteger(value) || value < 1 || value > 1_048_576) throw new Error('音频限制须为 1–1048576 MB 的整数');
  const result = await enforceAudioStorageLimit(value * 1024 * 1024);
  localStorage.setItem(LIMIT_KEY, String(value));
  return result;
}
/** Keep quota eviction in the writer's transaction, including concurrent windows. */
export function pruneAudioTransaction(tx: IDBTransaction, maxBytes: number): Promise<AudioCacheStats> {
  return new Promise((resolve, reject) => {
    const store = tx.objectStore('blob_store');
    migrateMetadata(store, () => {
      const request = store.getAll(IDBKeyRange.bound(META_PREFIX, META_PREFIX + '\uffff'));
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const metadata = request.result as CacheMetadata[];
        const entries = metadata.filter(entry => !entry.uploaded);
        let total = entries.reduce((sum, entry) => sum + entry.size, 0);
        const beforeBytes = total, deletedKeys: string[] = [];
        for (const entry of entries.sort((a, b) => a.createdAt - b.createdAt || a.key.localeCompare(b.key))) {
          if (total <= maxBytes) break;
          store.delete(entry.key); store.delete(META_PREFIX + entry.key); deletedKeys.push(entry.key); total -= entry.size;
        }
        resolve({ beforeBytes, afterBytes: total, deletedKeys, protectedBytes: metadata.filter(entry => entry.uploaded).reduce((sum, entry) => sum + entry.size, 0) });
      };
    }, reject);
  });
}
export function announceAudioCleanup(result: AudioCacheStats) {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(VOICE_CACHE_CHANGED, { detail: result }));
}
export async function enforceAudioStorageLimit(maxBytes = audioLimitMB() * 1024 * 1024): Promise<AudioCacheStats> {
  const empty = { beforeBytes: 0, afterBytes: 0, deletedKeys: [], protectedBytes: 0 };
  if (typeof indexedDB === 'undefined') return empty;
  await compactStoredAudio();
  const db = await openStorageDB();
  const tx = db.transaction('blob_store', 'readwrite');
  const done = new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = tx.onabort = () => reject(tx.error ?? new Error('音频清理失败')); });
  const result = await pruneAudioTransaction(tx, maxBytes);
  await done; announceAudioCleanup(result); return result;
}
