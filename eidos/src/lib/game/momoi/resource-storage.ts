import { normalizeVoiceAssets, type VoiceAsset } from "./model";
import { openStorageDB as openResources } from "../storage";
import { announceAudioCleanup, audioLimitMB, pruneAudioTransaction, writeAudioMetadata, clearAudioMetadata, type AudioCacheStats } from './storage-quota';
export async function readVoiceResources(scope: string): Promise<Record<string, VoiceAsset>> {
  if (typeof indexedDB === "undefined") return {};
  const db = await openResources();
  const prefix = `momoi_v2_${scope}:`;
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction("blob_store").objectStore("blob_store").getAll(IDBKeyRange.bound(prefix, prefix + "\uffff"));
      request.onsuccess = () => resolve(normalizeVoiceAssets(Object.fromEntries((request.result as VoiceAsset[]).map(asset => [asset.id, asset]))));
      request.onerror = () => reject(request.error);
    });
  } finally { /* Connection lifecycle belongs to storage.ts. */ }
}
/** Write only changed clips; a new line must not rewrite an entire playthrough's audio. */
export async function writeVoiceResources(scope: string, assets: Record<string, VoiceAsset>, previous?: Record<string, VoiceAsset>): Promise<Record<string, VoiceAsset>> {
  const before = previous ?? await readVoiceResources(scope);
  const db = await openResources();
  const prefix = `momoi_v2_${scope}:`;
  let cleanup: AudioCacheStats | undefined;
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("blob_store", "readwrite");
      const store = tx.objectStore("blob_store");
      for (const [id, asset] of Object.entries(assets)) if (before[id] !== asset) { store.put(asset, prefix + id); writeAudioMetadata(store, prefix + id, asset); }
      for (const id of Object.keys(before)) if (!assets[id]) { store.delete(prefix + id); writeAudioMetadata(store, prefix + id); }
      void pruneAudioTransaction(tx, audioLimitMB() * 1024 * 1024).then(result => { cleanup = result; }).catch(() => tx.abort());
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error ?? new Error("音频存储已取消"));
    });
    if (cleanup) announceAudioCleanup(cleanup);
    const deleted = new Set(cleanup?.deletedKeys ?? []);
    return Object.fromEntries(Object.entries(assets).filter(([id]) => !deleted.has(prefix + id)));
  } finally { /* Connection lifecycle belongs to storage.ts. */ }
}

export async function clearVoiceResources(scope: string): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  const db = await openResources();
  const prefix = `momoi_v2_${scope}:`;
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("blob_store", "readwrite");
      tx.objectStore("blob_store").delete(IDBKeyRange.bound(prefix, prefix + "\uffff"));
      clearAudioMetadata(tx.objectStore('blob_store'), prefix);
      tx.oncomplete = () => resolve();
      tx.onabort = tx.onerror = () => reject(tx.error ?? new Error("音频资源清理失败"));
    });
  } finally { /* Connection lifecycle belongs to storage.ts. */ }
}
