import { useGameStore } from '@/store/game-store';
import type { DocumentScope } from '../documents/types';
import { loadWorldAssetRegistry, readWorldAssetRegistry, persistImageRegistry } from './asset-library';
import { saveImageDocument } from './image-documents';
import { boundImageResource, type ImageResource } from './image-resource';
import { canAdaptImageOriginal, retainImageOriginal } from './image-original';
import { editImageResource } from './resource-edits';

/** World-library uploads get a document in the entered playthrough, without guessing another world's scope. */
export async function ensureWorldImageDocuments(scope: DocumentScope): Promise<string[]> {
  const state = useGameStore.getState();
  const archive = scope.archiveId?.startsWith('sandbox:') ? { sandboxMode: true, sandboxDossierId: scope.archiveId.slice(8) } : { sandboxMode: false };
  const currentArchive = state.sandboxMode ? `sandbox:${state.sandboxDossierId ?? 'default'}` : 'main';
  const active = state.currentWorld?.id === scope.worldId && currentArchive === (scope.archiveId ?? 'main');
  const registry = await readWorldAssetRegistry(active ? state.currentWorld! : scope.worldId, active ? state.midoriAssetRegistry : null, archive);
  const images = new Map<string, ImageResource>();
  for (const binding of Object.values(registry.bindings)) { const image = boundImageResource(binding); if (image) images.set(image.id, image); }
  for (const image of Object.values(registry.images ?? {})) images.set(image.id, image);
  const warnings: string[] = [];
  for (const image of images.values()) {
    if (registry.removedImageIds?.includes(image.id) || !canAdaptImageOriginal(image)) continue;
    try {
      let retained = await retainImageOriginal(image);
      if (!image.originalResource) {
        const live = useGameStore.getState();
        const sameArchive = (live.sandboxMode ? `sandbox:${live.sandboxDossierId ?? 'default'}` : 'main') === (scope.archiveId ?? 'main');
        const active = sameArchive && live.currentWorld?.id === scope.worldId;
        const world = active ? live.currentWorld! : scope.worldId;
        const fresh = loadWorldAssetRegistry(world, active ? live.midoriAssetRegistry : null, archive);
        if (fresh.removedImageIds?.includes(image.id)) continue;
        retained = { ...(fresh.images?.[image.id] ?? image), originalResource: retained.originalResource };
        const next = editImageResource({ world, registry: fresh, image: retained, scope: archive, makeDefault: false });
        await persistImageRegistry(scope.worldId, fresh, next, archive);
        if (active && useGameStore.getState().currentWorld?.id === scope.worldId) useGameStore.getState().setMidoriAssetRegistry(loadWorldAssetRegistry(world, useGameStore.getState().midoriAssetRegistry, archive));
      }
      await saveImageDocument(scope, retained);
    } catch (cause) { warnings.push(`${image.label}：${cause instanceof Error ? cause.message : '图片文档适配失败'}`); }
  }
  return warnings;
}
