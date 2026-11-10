import { openStorageDB } from '../storage';
import { scopeStorageKey, type ArchiveScopeSource } from '../archive-scope';
import type { WorldDefinition } from '../types';
import { characterAssetId } from './character-target';
import { imageResourceId, normalizeImageResource, type ImageResource } from './image-resource';
import {
  createEmptyMidoriAssetRegistry, makeMidoriAssetKey, normalizeMidoriAssetRegistry,
  type MidoriAssetBinding, type MidoriAssetLookup, type MidoriAssetRegistry,
} from './asset-registry';

type Overrides = Record<string, MidoriAssetBinding | null>;
type ImageOverrides = Record<string, ImageResource | null>;
interface LibraryRecord { overrides: Overrides; imageOverrides: ImageOverrides }
const storageKey = (worldId: string, scope: ArchiveScopeSource) =>
  scopeStorageKey(scope, `eidos_image_assets_${encodeURIComponent(worldId)}`);

const libraries = new Map<string, LibraryRecord>();
const pending = new Set<Promise<void>>();
export async function settleImageLibrary(): Promise<void> {
  while (pending.size) await Promise.allSettled([...pending]);
}
export const IMAGE_LIBRARY_UPDATED = 'eidos-image-library-updated';
export function resetImageLibraryCache(): void { libraries.clear(); }

function readLegacyLibrary(worldId: string, scope: ArchiveScopeSource): LibraryRecord {
  if (typeof window === 'undefined') return { overrides: {}, imageOverrides: {} };
  const raw = localStorage.getItem(storageKey(worldId, scope));
  if (!raw) return { overrides: {}, imageOverrides: {} };
  const value = JSON.parse(raw);
  if (value?.version !== 1 || !value.overrides || typeof value.overrides !== 'object' || Array.isArray(value.overrides)) {
    throw new Error('图像绑定记录无法读取');
  }
  const valid = normalizeMidoriAssetRegistry({ bindings: value.overrides }).bindings;
  const result: Overrides = {};
  for (const [key, asset] of Object.entries(value.overrides)) {
    if (asset === null) result[key] = null;
    else if (valid[key]?.worldId === worldId) result[key] = valid[key];
  }
  const imageOverrides: ImageOverrides = Object.create(null);
  if (value.imageOverrides !== undefined && (!value.imageOverrides || typeof value.imageOverrides !== 'object' || Array.isArray(value.imageOverrides))) throw new Error('图像资源记录无法读取');
  for (const [id, rawImage] of Object.entries(value.imageOverrides ?? {})) {
    if (rawImage === null) imageOverrides[id] = null;
    else {
      const image = normalizeImageResource(rawImage);
      if (image?.worldId === worldId && image.id === id) imageOverrides[id] = image;
    }
  }
  return { overrides: result, imageOverrides };
}

function readLibrary(worldId: string, scope: ArchiveScopeSource): LibraryRecord {
  return structuredClone(libraries.get(storageKey(worldId, scope)) ?? readLegacyLibrary(worldId, scope));
}

/** A single IDB transaction owns the read/merge/write, including across windows.
 * The legacy key is removed only after commit; no small localStorage fallback is used. */
async function runLibraryTransaction(worldId: string, scope: ArchiveScopeSource, edit?: (library: LibraryRecord) => void): Promise<void> {
  if (typeof window === 'undefined') return;
  const key = storageKey(worldId, scope), db = await openStorageDB();
  let legacyRaw: string | null = null;
  try { legacyRaw = localStorage.getItem(key); } catch { /* Local database remains usable. */ }
  let next: LibraryRecord;
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('meta_data', 'readwrite'), store = tx.objectStore('meta_data');
    const request = store.get(key);
    let failure: unknown;
    request.onsuccess = () => {
      try {
        next = request.result ?? readLegacyLibrary(worldId, scope);
        edit?.(next);
        if (edit || legacyRaw !== null && request.result === undefined) store.put(next, key);
      } catch (error) { failure = error; tx.abort(); }
    };
    tx.oncomplete = () => resolve();
    tx.onabort = tx.onerror = () => reject(failure ?? tx.error ?? new Error('图像资源本地数据库事务已取消'));
  });
  libraries.set(key, next!);
  if (legacyRaw !== null) {
    try { if (localStorage.getItem(key) === legacyRaw) localStorage.removeItem(key); }
    catch { /* The committed database remains authoritative. */ }
  }
  if (edit) window.dispatchEvent(new CustomEvent(IMAGE_LIBRARY_UPDATED, { detail: key }));
}

function transactLibrary(worldId: string, scope: ArchiveScopeSource, edit?: (library: LibraryRecord) => void): Promise<void> {
  const task = runLibraryTransaction(worldId, scope, edit).catch(cause => {
    const detail = cause && typeof cause === 'object' && 'message' in cause ? `${'name' in cause ? String(cause.name) : 'Error'}: ${String(cause.message)}` : String(cause);
    throw new Error(`图像资源本地数据库操作失败：${detail}`, { cause });
  });
  pending.add(task);
  void task.then(() => pending.delete(task), () => pending.delete(task));
  return task;
}

export async function hydrateWorldAssetLibrary(worldId: string, scope: ArchiveScopeSource = {}): Promise<void> {
  await transactLibrary(worldId, scope);
}

export async function readWorldAssetRegistry(world: string | Pick<WorldDefinition, 'id' | 'npcs'>, baseline?: MidoriAssetRegistry | null, scope: ArchiveScopeSource = {}): Promise<MidoriAssetRegistry> {
  await hydrateWorldAssetLibrary(typeof world === 'string' ? world : world.id, scope);
  return loadWorldAssetRegistry(world, baseline, scope);
}

/** Old save bindings remain the baseline; explicit library changes survive loading an older save. */
export function loadWorldAssetRegistry(world: string | Pick<WorldDefinition, 'id' | 'npcs'>, baseline?: MidoriAssetRegistry | null, scope: ArchiveScopeSource = {}): MidoriAssetRegistry {
  const worldId = typeof world === 'string' ? world : world.id;
  const definition = typeof world === 'string' ? null : world;
  const canonicalKey = (key: string) => key.replace(/^character:(.+):(portrait|avatar|emotion)(?::(.*))?$/u,
    (_match, id: string, slot: string, variant?: string) => ['character', characterAssetId(definition, id), slot, variant].filter(Boolean).join(':'));
  const canonicalAsset = (asset: MidoriAssetBinding): MidoriAssetBinding => asset.targetType === 'character' ?
    { ...asset, id: canonicalKey(asset.id), targetId: characterAssetId(definition, asset.targetId) } : asset;
  const bindings: Record<string, MidoriAssetBinding> = {};
  for (const asset of Object.values(normalizeMidoriAssetRegistry(baseline).bindings)) {
    if (asset.worldId !== worldId) continue;
    const next = canonicalAsset(asset);
    if (!bindings[next.id] || next.updatedAt >= bindings[next.id].updatedAt) bindings[next.id] = next;
  }
  const normalized = normalizeMidoriAssetRegistry(baseline);
  const images = Object.fromEntries(Object.entries(normalized.images ?? {}).filter(([, image]) => image.worldId === worldId).map(([id, image]) =>
    [id, image.type === 'character' ? { ...image, targetId: characterAssetId(definition, image.targetId) } : image]));
  const removed = new Set(normalized.removedImageIds ?? []);
  let library: LibraryRecord;
  try { library = readLibrary(worldId, scope); }
  catch (cause) { console.warn('[ImageAssets] 无法读取本地绑定，保留存档中的图像:', cause); return { ...normalized, bindings, ...(normalized.images ? { images } : {}) }; }
  // Explicit canonical edits win over an old annotated alias, including removal markers.
  const entries = Object.entries(library.overrides).sort(([a], [b]) => Number(a === canonicalKey(a)) - Number(b === canonicalKey(b)));
  for (const [key, asset] of entries) {
    if (asset) bindings[canonicalKey(key)] = canonicalAsset(asset);
    else delete bindings[canonicalKey(key)];
  }
  for (const [id, image] of Object.entries(library.imageOverrides)) {
    if (image) {
      images[id] = image.type === 'character' ? { ...image, targetId: characterAssetId(definition, image.targetId) } : image;
      removed.delete(id);
    } else { delete images[id]; removed.add(id); }
  }
  for (const id of removed) delete images[id];
  for (const [key, binding] of Object.entries(bindings)) if (removed.has(imageResourceId(binding.imageUrl))) delete bindings[key];
  return { ...createEmptyMidoriAssetRegistry(), bindings,
    ...(Object.keys(images).length || normalized.images ? { images } : {}), ...(removed.size ? { removedImageIds: [...removed] } : {}) };
}

export async function saveWorldAssetOverride(worldId: string, lookup: MidoriAssetLookup, asset: MidoriAssetBinding | null, scope: ArchiveScopeSource = {}): Promise<void> {
  await saveWorldImageEdits(worldId, { bindings: [{ lookup, asset }] }, scope);
}

/** Metadata and default binding changes share one write so quota failure cannot leave a half-edited image. */
export async function saveWorldImageEdits(worldId: string, edits: {
  images?: Array<{ id: string; image: ImageResource | null }>;
  bindings?: Array<{ lookup: MidoriAssetLookup; asset: MidoriAssetBinding | null }>;
}, scope: ArchiveScopeSource = {}): Promise<void> {
  if (typeof window === 'undefined') return;
  await transactLibrary(worldId, scope, library => {
    for (const { lookup, asset } of edits.bindings ?? []) {
      const key = makeMidoriAssetKey(lookup.targetType, lookup.targetId, lookup.slot, lookup.variant);
      library.overrides[key] = asset;
    }
    for (const { id, image } of edits.images ?? []) library.imageOverrides[id] = image;
  });
}

export async function persistImageRegistry(worldId: string, before: MidoriAssetRegistry, next: MidoriAssetRegistry, scope: ArchiveScopeSource = {}): Promise<void> {
  const keys = new Set([...Object.keys(before.bindings), ...Object.keys(next.bindings)]);
  await saveWorldImageEdits(worldId, {
    images: [...Object.values(next.images ?? {}).filter(image => JSON.stringify(before.images?.[image.id]) !== JSON.stringify(image)).map(image => ({ id: image.id, image })),
      ...Object.keys(before.images ?? {}).filter(id => !next.images?.[id]).map(id => ({ id, image: null }))],
    bindings: [...keys].flatMap(key => JSON.stringify(before.bindings[key]) === JSON.stringify(next.bindings[key]) ? [] : [{ lookup: next.bindings[key] ?? before.bindings[key], asset: next.bindings[key] ?? null }]),
  }, scope);
}
