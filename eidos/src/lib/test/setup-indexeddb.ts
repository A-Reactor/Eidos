import { beforeEach } from 'vitest';
import * as idb from 'fake-indexeddb';
import { _resetDB } from '@/lib/game/storage';
import { resetImageLibraryCache, settleImageLibrary } from '@/lib/game/midori/asset-library';

// Storage is asynchronous in the app; each test receives an independent local database.
beforeEach(async () => {
  await settleImageLibrary();
  _resetDB();
  resetImageLibraryCache();
  if (typeof window === 'undefined') return;
  for (const [name, value] of Object.entries(idb)) if (name.startsWith('IDB')) Object.defineProperty(globalThis, name, { value, writable: true, configurable: true });
  globalThis.indexedDB = new idb.IDBFactory();
});
