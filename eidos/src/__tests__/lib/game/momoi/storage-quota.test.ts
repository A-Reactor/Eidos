// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { beforeEach, expect, it, vi } from 'vitest';
import * as resources from '@/lib/game/momoi/resource-storage';
import { loadFromDB, openStorageDB, saveToDB } from '@/lib/game/storage';
import { audioLimitMB, enforceAudioStorageLimit, setAudioLimitMB } from '@/lib/game/momoi/storage-quota';
import { writeVoiceResources, readVoiceResources } from '@/lib/game/momoi/resource-storage';
import { getVoiceLibrary, voiceScope } from '@/lib/game/momoi/runtime';
import { useGameStore } from '@/store/game-store';
import type { VoiceAsset } from '@/lib/game/momoi/model';
const asset = (letter: string, createdAt: number, length = 8, provider: VoiceAsset['provider'] = 'compatible'): VoiceAsset => ({ id: letter.repeat(64), text: '你好', speaker: '甲', emotion: 'neutral', audioBase64: 'a'.repeat(length), mimeType: 'audio/wav', provider, model: '', createdAt });
beforeEach(async () => {
  localStorage.clear(); useGameStore.setState({ voiceSession: useGameStore.getState().voiceSession + 1, voiceAssets: {}, voiceAssetScope: null });
  const db = await openStorageDB(); await new Promise<void>((resolve, reject) => { const tx = db.transaction(['blob_store', 'save_data', 'meta_data'], 'readwrite'); for (const name of ['blob_store', 'save_data', 'meta_data']) tx.objectStore(name).clear(); tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); });
});
it('defaults to 500 MB and evicts oldest generated clips across scopes, preserving uploads and unrelated blobs', async () => {
  expect(audioLimitMB()).toBe(500);
  const old = asset('a', 1), newer = asset('b', 3), upload = asset('c', 0, 16, 'uploaded');
  const db = await openStorageDB();
  await new Promise<void>(resolve => { const tx = db.transaction('blob_store', 'readwrite'), store = tx.objectStore('blob_store'); store.put({ key: 'voice_old', base64: 'a'.repeat(8), createdAt: 0 }, 'voice_old'); store.put({ text: '原稿' }, 'author-original'); tx.oncomplete = () => resolve(); });
  await writeVoiceResources('one', { [old.id]: old, [upload.id]: upload });
  await writeVoiceResources('two', { [newer.id]: newer });
  const result = await enforceAudioStorageLimit(8);
  expect(result).toMatchObject({ beforeBytes: 24, afterBytes: 8, protectedBytes: 16 });
  expect(result.deletedKeys).toEqual(['voice_old', `momoi_v2_one:${old.id}`]);
  expect(await readVoiceResources('one')).toEqual({ [upload.id]: upload });
  expect(await readVoiceResources('two')).toEqual({ [newer.id]: newer });
  expect(await new Promise(resolve => { const req = db.transaction('blob_store').objectStore('blob_store').get('author-original'); req.onsuccess = () => resolve(req.result); })).toEqual({ text: '原稿' });
});
it('enforces lower limits immediately, synchronizes the active library, and does not resurrect clips on its next write', async () => {
  const first = asset('a', 1, 800_000), second = asset('b', 2, 800_000);
  const scope = voiceScope();
  useGameStore.setState({ voiceAssets: { [first.id]: first, [second.id]: second }, voiceAssetScope: scope });
  const library = await getVoiceLibrary();
  const result = await setAudioLimitMB(1);
  expect(result.deletedKeys).toContain(`momoi_v2_${scope}:${first.id}`);
  expect(library.assets[first.id]).toBeUndefined(); expect(useGameStore.getState().voiceAssets[first.id]).toBeUndefined();
  await library.remove(second.id);
  expect(await readVoiceResources(scope)).toEqual({});
  expect(audioLimitMB()).toBe(1);
  await expect(setAudioLimitMB(0)).rejects.toThrow(); expect(audioLimitMB()).toBe(1);
});
it('applies quota during writes, handles a clip bigger than the limit, and counts replacement sizes correctly', async () => {
  await setAudioLimitMB(1);
  const large = asset('a', 1, 1_500_000), small = asset('b', 2, 8);
  expect(await writeVoiceResources('write', { [large.id]: large })).toEqual({});
  await writeVoiceResources('write', { [small.id]: small });
  const replaced = { ...small, audioBase64: 'a'.repeat(16) };
  await writeVoiceResources('write', { [small.id]: replaced });
  expect((await enforceAudioStorageLimit()).afterBytes).toBe(16);
});
it('deduplicates save-slot audio, hydrates exports, migrates old slots, and cannot read a foreign scope pointer', async () => {
  const clip = asset('a', 1, 800_000);
  const save = { meta: { worldId: 'world', playthroughId: 'pt' }, state: { playerName: '玩家', voiceAssets: { [clip.id]: clip } } };
  await saveToDB('save_data_one', save); await saveToDB('save_data_two', save);
  const db = await openStorageDB();
  const raw = await new Promise<typeof save>(resolve => { const r = db.transaction('save_data').objectStore('save_data').get('save_data_one'); r.onsuccess = () => resolve(r.result); });
  expect(raw.state.voiceAssets).toEqual({});
  expect((await loadFromDB('save_data_two') as typeof save).state.voiceAssets[clip.id]).toEqual(clip);
  expect((await enforceAudioStorageLimit()).afterBytes).toBe(800_000);
  const older = asset('b', 0, 800_000);
  await new Promise<void>(resolve => { const tx = db.transaction(['save_data', 'meta_data'], 'readwrite'); tx.objectStore('save_data').put({ ...save, state: { ...save.state, voiceAssets: { [older.id]: older } } }, 'save_data_old'); tx.objectStore('meta_data').delete('audio_pool_compacted_v1'); tx.oncomplete = () => resolve(); });
  await setAudioLimitMB(1);
  expect((await loadFromDB('save_data_old') as typeof save).state.voiceAssets[older.id]).toBeUndefined();
  expect((await loadFromDB('save_data_one') as typeof save).state.voiceAssets[clip.id]).toEqual(clip);
  await saveToDB('sandbox_other_save_data_foreign', raw);
  expect((await loadFromDB('sandbox_other_save_data_foreign') as typeof save).state.voiceAssets).toEqual({});
  const replacement = { ...clip, provider: 'uploaded' as const, audioBase64: 'bmV3' };
  await writeVoiceResources(JSON.stringify(['world', 'pt']), { [clip.id]: replacement });
  await saveToDB('save_data_historical', save);
  expect((await loadFromDB('save_data_historical') as typeof save).state.voiceAssets[clip.id]).toEqual(replacement);
});
it('keeps the original slot and reports a failed legacy migration, then permits retry', async () => {
  const clip = asset('a', 1);
  const save = { meta: { worldId: 'world', playthroughId: 'pt' }, state: { voiceAssets: { [clip.id]: clip } } };
  const db = await openStorageDB();
  await new Promise<void>(resolve => { const tx = db.transaction('save_data', 'readwrite'); tx.objectStore('save_data').put(save, 'save_data_legacy'); tx.oncomplete = () => resolve(); });
  const spy = vi.spyOn(resources, 'writeVoiceResources').mockRejectedValue(new Error('quota'));
  try {
    await expect(setAudioLimitMB(1)).rejects.toThrow('原存档已保留');
    expect(audioLimitMB()).toBe(500);
    const raw = await new Promise<typeof save>(resolve => { const req = db.transaction('save_data').objectStore('save_data').get('save_data_legacy'); req.onsuccess = () => resolve(req.result); });
    expect(raw).toEqual(save);
  } finally { spy.mockRestore(); }
  await setAudioLimitMB(1);
  expect((await loadFromDB('save_data_legacy') as typeof save).state.voiceAssets[clip.id]).toEqual(clip);
});
