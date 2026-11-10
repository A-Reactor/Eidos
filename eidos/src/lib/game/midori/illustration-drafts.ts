import type { WorldDefinition } from '../types';
import { mapScenes } from '../map-state';
import type { ImageResource } from './image-resource';
import { illustrationDrafts } from './image-context';
import type { MidoriAssetRegistry } from './asset-registry';

/** Called only after accepting an action: speculative or failed prose cannot create gallery entries. */
export async function rememberIllustrationDrafts(state: {
  currentWorld: WorldDefinition | null; midoriAssetRegistry: MidoriAssetRegistry;
  saveImageResource: (image: ImageResource, makeDefault?: boolean) => void | Promise<void>;
  setMidoriAssetRegistry?: (registry:MidoriAssetRegistry)=>void;
}, value: unknown, actionId: string): Promise<void> {
  if (!state.currentWorld) return;
  const worldId = state.currentWorld.id, scenes = mapScenes(state.currentWorld);
  const existing = Object.values(state.midoriAssetRegistry.images ?? {});
  const additions:ImageResource[]=[];
  for (const [index, draft] of illustrationDrafts(value).entries()) {
    const id = `illustration:${actionId}:${index}`;
    if (state.midoriAssetRegistry.removedImageIds?.includes(id) || existing.some(image => image.id === id ||
      image.worldId === worldId && image.type === 'illustration' && image.description === draft.description && image.label === draft.label)) continue;
    const now = Date.now();
    const image: ImageResource = { id, worldId, type: 'illustration', targetId: draft.sceneId && Object.hasOwn(scenes, draft.sceneId) ? draft.sceneId : '',
      label: draft.label || '插图构想', description: draft.description, tags: draft.tags ?? [], source: 'generated', createdAt: now, updatedAt: now };
    additions.push(image);existing.push(image);
  }
  if(!additions.length) return;
  // Accepted metadata belongs in the action snapshot immediately; writing gallery
  // files may continue independently without a cancellable gap in action settlement.
  state.setMidoriAssetRegistry?.({...state.midoriAssetRegistry,images:{...state.midoriAssetRegistry.images,...Object.fromEntries(additions.map(image=>[image.id,image]))}});
  for(const image of additions) await state.saveImageResource(image,false);
}
