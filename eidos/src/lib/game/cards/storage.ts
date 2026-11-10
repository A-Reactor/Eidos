import { openStorageDB, BLOB_STORE_NAME } from '../storage';
import { parseCardBytes } from './parser';
import type { CardAsset } from './types';

export async function importCardAsset(bytes: Uint8Array, filename: string): Promise<CardAsset> {
  const parsed = parseCardBytes(bytes, filename);
  const originalBytes = Uint8Array.from(bytes);
  const digest = await crypto.subtle.digest('SHA-256', originalBytes);
  const id = Array.from(new Uint8Array(digest), n => n.toString(16).padStart(2, '0')).join('');
  const asset = { ...parsed, id, filename, originalBytes, createdAt: Date.now() };
  const db = await openStorageDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(BLOB_STORE_NAME, 'readwrite');
    const store = tx.objectStore(BLOB_STORE_NAME);
    const request = store.get(`card_asset_${id}`);
    request.onsuccess = () => { if (!request.result) store.put(asset, `card_asset_${id}`); };
    tx.oncomplete = () => resolve();
    tx.onabort = tx.onerror = () => reject(tx.error ?? new Error('原卡保存失败'));
  });
  return asset;
}
export async function loadCardAsset(id: string): Promise<CardAsset | null> {
  if (!/^[a-f0-9]{64}$/.test(id)) throw new Error('卡片资源标识无效');
  const db = await openStorageDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(BLOB_STORE_NAME, 'readonly');
    const req = tx.objectStore(BLOB_STORE_NAME).get(`card_asset_${id}`);
    tx.oncomplete = () => resolve(req.result ?? null);
    tx.onabort = tx.onerror = () => reject(tx.error ?? new Error('原卡读取失败'));
  });
}
