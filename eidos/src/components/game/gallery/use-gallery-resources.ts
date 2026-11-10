'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useGameStore, type GameStore } from '@/store/game-store';
import { scopeStorageKey } from '@/lib/game/archive-scope';
import { loadWorldAssetRegistry, readWorldAssetRegistry } from '@/lib/game/midori/asset-library';
import { fetchGalleryImages, managedImagesFromList, deleteImage } from '@/lib/game/midori/image-manager';
import type { ImageResource } from '@/lib/game/midori/image-resource';
import { MAX_IMAGE_UPLOAD_BYTES } from '@/lib/game/midori/image-tags';
import { uploadImageResource, type ImageUploadTarget } from '@/lib/game/midori/upload-image';
import { saveImageDocument } from '@/lib/game/midori/image-documents';
import { currentDocumentScope, documentScopeKey } from '@/lib/game/model-documents';
import { retainImageOriginal } from '@/lib/game/midori/image-original';
import { worldImageResources } from '@/lib/game/midori/resource-catalog';
import { galleryCharacters, galleryScenes } from '@/lib/game/midori/gallery-data';
import type { GalleryListResponse } from '@/lib/game/midori/types';

export type { ImageUploadTarget } from '@/lib/game/midori/upload-image';
const npcSource = (state: GameStore, current: boolean) => current ? {
  encyclopedia: state.encyclopedia, npcStates: state.npcStates, npcBehaviors: state.npcBehaviors,
  npcPersonalities: state.npcPersonalities, relationships: state.relationships, currentScene: state.currentScene,
} : {};

export function useGalleryResources() {
  const state = useGameStore();
  const selected = state.galleryWorld;
  const world = state.currentWorld?.id === selected?.id ? state.currentWorld : selected;
  const current = state.currentWorld?.id === world?.id;
  const key = scopeStorageKey(state, world?.id ?? '');
  const registry = useMemo(() => loadWorldAssetRegistry(world ?? '', current ? state.midoriAssetRegistry : null, {
    sandboxMode: state.sandboxMode, sandboxDossierId: state.sandboxDossierId,
  // External world library writes also invalidate this view.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [world, current, state.midoriAssetRegistry, state.midoriAssetRevision, state.sandboxMode, state.sandboxDossierId]);
  const [listing, setListing] = useState<{ data?: GalleryListResponse; error?: string; loading: boolean }>({ loading: true });
  const [retry, setRetry] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const pending = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    if (!world?.id) return;
    const abort = new AbortController();
    void fetchGalleryImages(world.id, abort.signal).then(async data => {
      if (abort.signal.aborted) return;
      const live = useGameStore.getState(), active = live.currentWorld?.id === world.id;
      if (scopeStorageKey(live, live.galleryWorld?.id ?? '') !== key) return;
      const definition = active ? live.currentWorld! : live.galleryWorld!;
      try {
        // Import legacy metadata once per response so the next narrative request also knows cached images.
        const registry = await readWorldAssetRegistry(definition, active ? live.midoriAssetRegistry : null, live);
        if (abort.signal.aborted || scopeStorageKey(useGameStore.getState(), useGameStore.getState().galleryWorld?.id ?? '') !== key) return;
        await live.registerImageResources(world.id, worldImageResources(definition, registry, managedImagesFromList(world.id, data), npcSource(live, active)));
      } catch (cause) { setError(cause instanceof Error ? cause.message : '资源目录保存失败'); }
      if (!abort.signal.aborted && scopeStorageKey(useGameStore.getState(), useGameStore.getState().galleryWorld?.id ?? '') === key) setListing({ data, loading: false });
    })
      .catch(cause => { if (!abort.signal.aborted) setListing({ loading: false, error: cause instanceof Error ? cause.message : '加载失败' }); });
    return () => abort.abort();
  }, [world?.id, retry, key]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; pending.current?.abort(); }; }, []);
  const managed = useMemo(() => listing.data && world ? managedImagesFromList(world.id, listing.data) : null, [listing.data, world]);
  const source = npcSource(state, current);
  const resources = world ? worldImageResources(world, registry, managed, source) : [];
  const characters = world ? galleryCharacters(world, registry, [], source) : [];
  const scenes = world ? galleryScenes(world) : [];
  const isCurrent = (abort: AbortController) => mounted.current && !abort.signal.aborted && key === scopeStorageKey(useGameStore.getState(), useGameStore.getState().galleryWorld?.id ?? '');

  const save = async (image: ImageResource, makeDefault?: boolean, syncDocument = true): Promise<boolean> => {
    try {
      await state.saveImageResource({ ...image, updatedAt: Date.now() }, makeDefault); setError(null);
      const scope = currentDocumentScope(useGameStore.getState());
      if (syncDocument && scope?.worldId === image.worldId && image.originalResource) void saveImageDocument(scope, image).catch(cause => {
        if (mounted.current && key === scopeStorageKey(useGameStore.getState(), useGameStore.getState().galleryWorld?.id ?? '')) setError(cause instanceof Error ? cause.message : '图片文档保存失败，请重试');
      });
      return true;
    }
    catch (cause) { setError(cause instanceof Error ? cause.message : '保存失败，请重试'); return false; }
  };
  const upload = async (file: File, target: ImageUploadTarget) => {
    if (!world || pending.current) return;
    if (file.size > MAX_IMAGE_UPLOAD_BYTES) { setError('图片不能超过 32 MB'); return; }
    const abort = new AbortController(); pending.current = abort; setBusy(true); setError(null);
    try {
      const image = await uploadImageResource(world.id, file, target, abort.signal);
      if (!isCurrent(abort)) return;
      const scope = currentDocumentScope(useGameStore.getState());
      if (scope?.worldId === world.id) await saveImageDocument(scope, image);
      if (isCurrent(abort)) await save(image, undefined, false);
    } catch (cause) { if (isCurrent(abort)) setError(cause instanceof Error ? cause.message : '上传失败，请重试'); }
    finally { if (isCurrent(abort)) { pending.current = null; setBusy(false); } }
  };
  const remove = async (image: ImageResource): Promise<boolean> => {
    if (!world || pending.current) return false;
    const abort = new AbortController(); pending.current = abort; setBusy(true); setError(null);
    try {
      if (image.relativePath) await deleteImage({ worldId: world.id, sceneId: image.targetId || 'illustrations', weather: 'detail', timeOfDay: 'detail' }, image.relativePath);
      if (!isCurrent(abort)) return false;
      await state.removeImageResource(world.id, image.id);
      return true;
    } catch (cause) { if (isCurrent(abort)) setError(cause instanceof Error ? cause.message : '删除失败，请重试'); return false; }
    finally { if (isCurrent(abort)) { pending.current = null; setBusy(false); } }
  };
  const unbind = async (image: ImageResource) => {
    try {
      for (const binding of Object.values(registry.bindings)) if (binding.worldId === world?.id && binding.imageUrl === image.imageUrl) await state.removeMidoriAssetBinding(binding);
      setError(null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : '解除绑定失败'); }
  };
  const openDocument = async (image: ImageResource) => {
    const scope = currentDocumentScope(useGameStore.getState());
    if (!scope || scope.worldId !== image.worldId) return;
    try {
      const retained = await retainImageOriginal(image);
      const current = currentDocumentScope(useGameStore.getState());
      if (!mounted.current || !current || documentScopeKey(current) !== documentScopeKey(scope)) return;
      if (!image.originalResource && !await save(retained, false, false)) return;
      const link = await saveImageDocument(scope, retained);
      const live = useGameStore.getState(), destination = currentDocumentScope(live);
      if (!destination || documentScopeKey(scope) !== documentScopeKey(destination)) return;
      useGameStore.setState({ documentSelection: { scope, initialId: link.documentId } });
      live.setPhase('documents');
    } catch (cause) { if (mounted.current) setError(cause instanceof Error ? cause.message : '图片文档读取失败'); }
  };
  return { world, registry, resources, characters, scenes, loading: Boolean(world && listing.loading), listError: listing.error,
    retry: () => { setListing({ loading: true }); setError(null); setRetry(value => value + 1); }, error, busy, upload, save, remove, unbind,
    openDocument, canOpenDocument: current && Boolean(state.currentPlaythroughId) };
}
