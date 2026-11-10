import { openStorageDB } from '../storage';
import { exportValues } from '../export-values';
import { workspaceResourcePins } from '../workspace/session';

const MATERIAL = /^material_[a-f0-9]{16}$/;
const WEEK = 7 * 24 * 60 * 60 * 1000;
interface Candidate { size: number; lastStoredAt?: number; dependencies: Set<string> }
function references(value: unknown): Set<string> {
  const ids = new Set<string>();
  for (const item of exportValues(value)) if (typeof item === 'string') for (const match of item.matchAll(/material_[a-f0-9]{16}/g)) ids.add(match[0]);
  return ids;
}
function retainFallback(keep: Set<string>) {
  // Scan raw fallback bytes too, so identifiable references survive even in malformed JSON.
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)!;
    if (/^meta_material_[a-f0-9]{16}$/.test(key)) keep.add(key.slice(5));
    for (const id of references(key)) keep.add(id);
    const raw = localStorage.getItem(key);
    if (raw) for (const id of references(raw)) keep.add(id);
  }
}
/** One transaction keeps the reference scan and deletion atomic against durable writers. */
export async function cleanupUnusedMaterials(input: { pins?: () => string[]; isCurrent?: () => boolean } = {}): Promise<{ deleted: number; bytes: number }> {
  const db = await openStorageDB(), keep = new Set<string>(), materials = new Map<string, Candidate>();
  const cutoff = Date.now() - WEEK;
  return new Promise((resolve, reject) => {
    const stores = [...db.objectStoreNames], tx = db.transaction(stores, 'readwrite');
    let pending = stores.length, deleted = 0, bytes = 0, failure: unknown;
    const abort = (cause: unknown) => { failure = cause; tx.abort(); };
    const current = () => { if (input.isCurrent && !input.isCurrent()) throw new Error('清理所属进度已变化，操作已取消'); };
    const finish = () => {
      try {
        current(); retainFallback(keep);
        for (const id of [...workspaceResourcePins(), ...input.pins?.() ?? []]) keep.add(id);
        for (const [id, r] of materials) if (!Number.isFinite(r.lastStoredAt) || r.lastStoredAt! <= 0 || r.lastStoredAt! >= cutoff) keep.add(id);
        const pending = [...keep];
        while (pending.length) for (const id of materials.get(pending.pop()!)?.dependencies ?? []) if (!keep.has(id)) { keep.add(id); pending.push(id); }
        for (const [id, resource] of materials) if (!keep.has(id) && Number.isFinite(resource.lastStoredAt) && resource.lastStoredAt! > 0 && resource.lastStoredAt! < cutoff) {
          tx.objectStore('meta_data').delete(id); deleted++; bytes += resource.size;
        }
      } catch (cause) { abort(cause); }
    };
    for (const name of stores) {
      const request = tx.objectStore(name).openCursor();
      request.onsuccess = () => {
        try {
          current(); const cursor = request.result;
          if (!cursor) { if (--pending === 0) finish(); return; }
          const key = String(cursor.key), value = cursor.value;
          if (name === 'meta_data' && MATERIAL.test(key)) {
            if (value && value.id === key && typeof value.size === 'number' && Number.isFinite(value.size) && value.size >= 0) materials.set(key, { size: value.size, lastStoredAt: value.lastStoredAt, dependencies: references(value) });
            else keep.add(key);
          } else for (const id of references([key, value])) keep.add(id);
          cursor.continue();
        } catch (cause) { abort(cause); }
      };
    }
    tx.oncomplete = () => resolve({ deleted, bytes });
    tx.onerror = tx.onabort = () => reject(failure ?? tx.error ?? new Error('清理事务未能完成，原件未删除'));
  });
}
