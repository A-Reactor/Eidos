import { openStorageDB, saveMeta } from '../storage';
import { scopeStorageKey, type ArchiveScopeSource } from '../archive-scope';
import type { ResourceRef } from './workspace';

export interface ModMail { resource: ResourceRef; origin: string }
export type ModMailBundle = Record<string, Record<string, ModMail>>;
async function indexedMail(prefix: string): Promise<[string, ModMail][]> {
  if (typeof indexedDB === 'undefined') return [];
  const db = await openStorageDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('meta_data'), store = tx.objectStore('meta_data');
    const range = IDBKeyRange.bound(prefix, prefix + '\uffff');
    const keys = store.getAllKeys(range), values = store.getAll(range);
    tx.oncomplete = () => resolve((keys.result as string[]).map((key, i) => [key, values.result[i]]));
    tx.onabort = tx.onerror = () => reject(tx.error ?? new Error('跨分支材料读取失败'));
  });
}
export async function collectModMail(worldId: string, playthroughId: string, scope: ArchiveScopeSource): Promise<ModMailBundle> {
  const prefix = scopeStorageKey(scope, `mod_mail:${JSON.stringify([worldId, playthroughId]).slice(0, -1)},`);
  const entries = new Map(await indexedMail(prefix));
  // Failed IDB writes keep the newest mail in the storage fallback; include it in backups.
  if (typeof localStorage !== 'undefined') {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key?.startsWith(`meta_${prefix}`)) continue;
      const raw = localStorage.getItem(key);
      if (raw !== null) entries.set(key.slice(5), JSON.parse(raw));
    }
  }
  const bundle: ModMailBundle = {};
  for (const [key, mail] of entries) {
    const tail = key.slice(prefix.length), end = tail.indexOf(']:');
    const pluginId = JSON.parse(tail.slice(0, end)) as string, mailKey = tail.slice(end + 2);
    (bundle[pluginId] ??= {})[mailKey] = mail;
  }
  return bundle;
}
export async function restoreModMail(bundle: ModMailBundle, worldId: string, playthroughId: string, scope: ArchiveScopeSource) {
  for (const [pluginId, mails] of Object.entries(bundle)) for (const [key, mail] of Object.entries(mails)) await saveMeta(scopeStorageKey(scope, `mod_mail:${JSON.stringify([worldId, playthroughId, pluginId])}:${key}`), mail);
}
