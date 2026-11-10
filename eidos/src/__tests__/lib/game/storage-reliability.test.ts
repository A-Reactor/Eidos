// @vitest-environment jsdom
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { initStorage } from '@/lib/game/storage-migration';
import { _resetDB, openStorageDB, loadFromDB, loadMeta, migrateLegacySaves, removeFromDB, saveMeta, saveToDB } from '@/lib/game/storage';
import { _resetCasDB, storeBlob, loadBlob } from '@/lib/game/cas-storage';

beforeEach(() => {
  vi.stubGlobal('indexedDB', new IDBFactory());
  _resetDB(); _resetCasDB(); localStorage.clear(); sessionStorage.clear();
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it.each([null, '1', '2', '99'])('startup preserves old saves and settings with marker %s', marker => {
  if (marker) localStorage.setItem('eidos_storage_version', marker);
  localStorage.setItem('save_data_old', '{"playerName":"旧角色"}');
  localStorage.setItem('eidos_player_worlds', '[{"id":"old"}]');
  localStorage.setItem('eidos_settings', '{"fontSize":3}');
  sessionStorage.setItem('eidos_session', 'keep');
  initStorage(); initStorage();
  expect(localStorage.getItem('save_data_old')).toBe('{"playerName":"旧角色"}');
  expect(localStorage.getItem('eidos_player_worlds')).toBe('[{"id":"old"}]');
  expect(localStorage.getItem('eidos_settings')).toBe('{"fontSize":3}');
  expect(sessionStorage.getItem('eidos_session')).toBe('keep');
  if (marker === '99') expect(localStorage.getItem('eidos_storage_version')).toBe('99');
});

it('CAS-first initialization creates all stores and metadata survives without a fallback copy', async () => {
  await storeBlob('first', 'snapshot', { scene: 'start' });
  await saveMeta('worlds', [{ id: 'world' }]);
  localStorage.removeItem('meta_worlds');
  expect(await loadMeta('worlds')).toEqual([{ id: 'world' }]);
});

it('keeps the only legacy copy if IndexedDB is unavailable during migration', async () => {
  vi.stubGlobal('indexedDB', undefined);
  localStorage.setItem('save_data_legacy', '{"playerName":"旧角色"}');
  expect(await migrateLegacySaves()).toBe(0);
  expect(localStorage.getItem('save_data_legacy')).toBe('{"playerName":"旧角色"}');
});

it('preserves corrupt legacy data instead of silently destroying it', async () => {
  localStorage.setItem('save_data_corrupt', '{broken');
  expect(await loadFromDB('save_data_corrupt')).toBeNull();
  expect(localStorage.getItem('save_data_corrupt')).toBe('{broken');
});

it('reports a metadata failure when neither storage backend can persist it', async () => {
  vi.stubGlobal('indexedDB', undefined);
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('full', 'QuotaExceededError'); });
  await expect(saveMeta('worlds', [{ id: 'world' }])).rejects.toThrow();
});

it('deleting a save removes its stale local fallback too', async () => {
  await saveToDB('save', { playerName: 'new' });
  localStorage.setItem('save', '{"playerName":"old"}');
  await removeFromDB('save');
  expect(await loadFromDB('save')).toBeNull();
});

it('does not delete a fallback updated by another tab while a save is committing', async () => {
  const db = await openStorageDB();
  const original = db.transaction.bind(db);
  localStorage.setItem('save', '{"revision":1}');
  vi.spyOn(db, 'transaction').mockImplementationOnce((...args: Parameters<IDBDatabase['transaction']>) => {
    const tx = original(...args);
    localStorage.setItem('save', '{"revision":3}');
    return tx;
  });
  const writing = saveToDB('save', { revision: 2 });
  await writing;
  expect(await loadFromDB('save')).toEqual({ revision: 3 });
});

it('repairs a blob-only V3 schema without removing its content', async () => {
  const old = await new Promise<IDBDatabase>((resolve, reject) => {
    const r = indexedDB.open('eidos_storage', 3);
    r.onupgradeneeded = () => r.result.createObjectStore('blob_store');
    r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
  });
  await new Promise<void>(resolve => {
    const tx = old.transaction('blob_store', 'readwrite');
    tx.objectStore('blob_store').put({ data: { playerName: '旧角色' } }, 'cas_old');
    tx.oncomplete = () => resolve();
  });
  old.close();
  await saveMeta('worlds', [{ id: 'legacy' }]);
  expect(await loadBlob('old')).toEqual({ playerName: '旧角色' });
  expect(await loadMeta('worlds')).toEqual([{ id: 'legacy' }]);
});

it('does not treat a successful put request as a committed transaction', async () => {
  await openStorageDB();
  const original = IDBObjectStore.prototype.put;
  vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, value: unknown, key?: IDBValidKey) {
    const r = original.call(this, value, key);
    r.addEventListener('success', () => this.transaction.abort());
    return r;
  });
  const originalAdd = IDBObjectStore.prototype.add;
  vi.spyOn(IDBObjectStore.prototype, 'add').mockImplementation(function (this: IDBObjectStore, value: unknown, key?: IDBValidKey) {
    const r = originalAdd.call(this, value, key);
    r.addEventListener('success', () => this.transaction.abort());
    return r;
  });
  localStorage.setItem('save_data_abort', '{"playerName":"唯一副本"}');
  expect(await migrateLegacySaves()).toBe(0);
  expect(localStorage.getItem('save_data_abort')).toBe('{"playerName":"唯一副本"}');
  await expect(storeBlob('abort', 'snapshot', { playerName: '角色' })).rejects.toThrow();
});

it('does not overwrite a concurrent successful save while loading a fallback', async () => {
  localStorage.setItem('save', '{"revision":1}');
  await Promise.all([saveToDB('save', { revision: 2 }), loadFromDB('save')]);
  expect(await loadFromDB('save')).toEqual({ revision: 2 });
});

it('coordinates save and fallback migration across contexts with the same Web Lock', async () => {
  let previous: Promise<unknown> = Promise.resolve();
  const request = vi.fn((_name: string, operation: () => Promise<unknown>) => {
    const job = previous.catch(() => {}).then(operation);
    previous = job;
    return job;
  });
  vi.stubGlobal('navigator', { locks: { request } });
  // A separate module instance represents another tab's independent JS queue/DB handle.
  vi.resetModules();
  const otherTab = await import('@/lib/game/storage');
  localStorage.setItem('save', '{"revision":1}');
  await Promise.all([saveToDB('save', { revision: 2 }), otherTab.loadFromDB('save')]);
  expect(await otherTab.loadFromDB('save')).toEqual({ revision: 2 });
  expect(new Set(request.mock.calls.map(call => call[0]))).toEqual(new Set(['eidos_storage:save_data:save']));
  otherTab._resetDB();
});
