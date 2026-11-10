// ============================================================
// Eidos · MIDORI 图像引擎 Slice
// ============================================================

import {
  DEFAULT_MIDORI_SETTINGS,
  type ExamineState,
  type MidoriSettings,
} from "@/lib/game/midori/types";
import {
  bindMidoriAsset as bindAsset,
  createEmptyMidoriAssetRegistry,
  normalizeMidoriAssetRegistry,
  removeMidoriAsset,
  updateMidoriAssetDisplay as updateAssetDisplay,
  type MidoriAssetInput,
  type MidoriAssetLookup,
  type MidoriAssetRegistry,
  type MidoriAssetDisplay,
} from "@/lib/game/midori/asset-registry";
import type { WorldDefinition } from "@/lib/game/types";
import type { ResourceDocumentSelection } from '@/lib/game/model-documents';
import type { DocumentActionDraft } from '@/lib/game/documents/action-draft';
import { loadWorldAssetRegistry, readWorldAssetRegistry, persistImageRegistry } from '@/lib/game/midori/asset-library';
import { scopeStorageKey } from '@/lib/game/archive-scope';
import { characterAssetId } from '@/lib/game/midori/character-target';
import { editImageResource, eraseImageResource } from '@/lib/game/midori/resource-edits';
import { normalizeImageResource, type ImageResource } from '@/lib/game/midori/image-resource';

const assetWorld = (state: { currentWorld?: WorldDefinition | null; galleryWorld?: WorldDefinition | null }, worldId: string) =>
  state.currentWorld?.id === worldId ? state.currentWorld : state.galleryWorld?.id === worldId ? state.galleryWorld : worldId;

function publishAssetRegistry(set: (value: Partial<import('@/store/game-store').GameStore>) => void, get: () => import('@/store/game-store').GameStore, origin: import('@/store/game-store').GameStore, world: WorldDefinition | string) {
  const live = get(), worldId = typeof world === 'string' ? world : world.id;
  if (scopeStorageKey(origin, worldId) !== scopeStorageKey(live, worldId)) return;
  set({ ...(live.currentWorld?.id === worldId ? { midoriAssetRegistry: loadWorldAssetRegistry(world, live.midoriAssetRegistry, origin) } : {}), midoriAssetRevision: live.midoriAssetRevision + 1 });
}

export interface MidoriSlice {
  sceneImageUrl: string | null;
  setSceneImageUrl: (url: string | null) => void;
  examineState: ExamineState | null;
  setExamineState: (s: ExamineState | null) => void;
  midoriSettings: MidoriSettings;
  setMidoriSettings: (s: Partial<MidoriSettings>) => void;
  midoriAssetRegistry: MidoriAssetRegistry;
  midoriAssetRevision: number;
  setMidoriAssetRegistry: (registry: unknown) => void;
  bindMidoriAsset: (asset: MidoriAssetInput) => Promise<void>;
  updateMidoriAssetDisplay: (lookup: MidoriAssetLookup & { display: Partial<MidoriAssetDisplay> }) => Promise<void>;
  removeMidoriAssetBinding: (lookup: MidoriAssetLookup) => Promise<void>;
  saveImageResource: (image: ImageResource, makeDefault?: boolean) => Promise<void>;
  removeImageResource: (worldId: string, id: string) => Promise<void>;
  registerImageResources: (worldId: string, images: ImageResource[]) => Promise<void>;
  galleryWorld: WorldDefinition | null;
  galleryTab: 'scenes' | 'npcs' | 'details';
  documentSelection: ResourceDocumentSelection | null;
  documentDraft: DocumentActionDraft | null;
  setGalleryWorld: (world: WorldDefinition) => void;
  clearGalleryWorld: () => void;
}

export const createMidoriSlice = (
  set: (partial: (Record<string, any> | ((state: Record<string, any>) => Record<string, any>))) => void,
  get: () => any,
  _store?: any
): MidoriSlice => ({
  sceneImageUrl: null,
  setSceneImageUrl: (url) => set({ sceneImageUrl: url }),

  examineState: null,
  setExamineState: (s) => set({ examineState: s }),

  midoriSettings: { ...DEFAULT_MIDORI_SETTINGS },
  setMidoriSettings: (s) =>
    set((st) => ({ midoriSettings: { ...st.midoriSettings, ...s, enabled: false, autoGenerate: false } })),

  midoriAssetRegistry: createEmptyMidoriAssetRegistry(),
  midoriAssetRevision: 0,
  setMidoriAssetRegistry: (registry) =>
    set({ midoriAssetRegistry: normalizeMidoriAssetRegistry(registry) }),
  bindMidoriAsset: async (asset) => {
    const state = get(), world = assetWorld(state, asset.worldId);
    if (asset.targetType === 'character') asset = { ...asset, targetId: characterAssetId(typeof world === 'string' ? null : world, asset.targetId) };
    const before = await readWorldAssetRegistry(world, state.currentWorld?.id === asset.worldId ? state.midoriAssetRegistry : null, state);
    await persistImageRegistry(asset.worldId, before, bindAsset(before, asset), state);
    publishAssetRegistry(set, get, state, world);
  },
  updateMidoriAssetDisplay: async (lookup) => {
    const state = get(), worldId = lookup.worldId ?? state.currentWorld?.id;
    if (!worldId) return;
    const world = assetWorld(state, worldId);
    if (lookup.targetType === 'character') lookup = { ...lookup, targetId: characterAssetId(typeof world === 'string' ? null : world, lookup.targetId) };
    const before = await readWorldAssetRegistry(world, state.currentWorld?.id === worldId ? state.midoriAssetRegistry : null, state);
    await persistImageRegistry(worldId, before, updateAssetDisplay(before, { ...lookup, worldId }), state);
    publishAssetRegistry(set, get, state, world);
  },
  removeMidoriAssetBinding: async (lookup) => {
    const state = get(), worldId = lookup.worldId ?? state.currentWorld?.id;
    if (!worldId) return;
    const world = assetWorld(state, worldId);
    if (lookup.targetType === 'character') lookup = { ...lookup, targetId: characterAssetId(typeof world === 'string' ? null : world, lookup.targetId) };
    const before = await readWorldAssetRegistry(world, state.currentWorld?.id === worldId ? state.midoriAssetRegistry : null, state);
    await persistImageRegistry(worldId, before, removeMidoriAsset(before, { ...lookup, worldId }), state);
    publishAssetRegistry(set, get, state, world);
  },
  saveImageResource: async (image, makeDefault) => {
    const state = get(), world = assetWorld(state, image.worldId);
    const before = await readWorldAssetRegistry(world, state.currentWorld?.id === image.worldId ? state.midoriAssetRegistry : null, state);
    const next = editImageResource({ world, registry: before, image, makeDefault, scope: state });
    await persistImageRegistry(image.worldId, before, next, state);
    publishAssetRegistry(set, get, state, world);
  },
  removeImageResource: async (worldId, id) => {
    const state = get(), world = assetWorld(state, worldId);
    const before = await readWorldAssetRegistry(world, state.currentWorld?.id === worldId ? state.midoriAssetRegistry : null, state);
    await persistImageRegistry(worldId, before, eraseImageResource({ worldId, id, registry: before, scope: state }), state);
    publishAssetRegistry(set, get, state, world);
  },
  registerImageResources: async (worldId, images) => {
    const state = get(), world = assetWorld(state, worldId);
    const before = await readWorldAssetRegistry(world, state.currentWorld?.id === worldId ? state.midoriAssetRegistry : null, state);
    const additions = images.map(normalizeImageResource).filter((image): image is ImageResource => Boolean(image && image.worldId === worldId && !before.images?.[image.id] && !before.removedImageIds?.includes(image.id)));
    if (!additions.length) { publishAssetRegistry(set, get, state, world); return; }
    await persistImageRegistry(worldId, before, { ...before, images: { ...before.images, ...Object.fromEntries(additions.map(image => [image.id, image])) } }, state);
    publishAssetRegistry(set, get, state, world);
  },

  galleryWorld: null,
  galleryTab: 'scenes',
  documentSelection: null,
  documentDraft: null,
  setGalleryWorld: (world) => set((state) => ({ galleryWorld: world,
    ...(state.galleryWorld?.id !== world.id ? { galleryTab: 'scenes' } : {}) })),
  clearGalleryWorld: () => set({ galleryWorld: null, galleryTab: 'scenes' }),
});
