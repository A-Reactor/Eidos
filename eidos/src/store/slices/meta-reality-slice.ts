// ============================================================
// Eidos · Meta Reality Slice
// ============================================================

import type {
  BoundaryEvent,
  MetaChannelManifest,
  RealityArtifact,
} from "@/lib/meta-reality/types";
import type { WorldDefinition } from "@/lib/game/types";
import { savePlayerWorlds } from "./save-slice";

export interface MetaRealitySlice {
  realityArtifacts: RealityArtifact[];
  boundaryEvents: BoundaryEvent[];
  metaChannelManifest: MetaChannelManifest | null;
  addRealityArtifact: (artifact: RealityArtifact) => void;
  addBoundaryEvent: (event: BoundaryEvent) => void;
  setMetaChannelManifest: (manifest: MetaChannelManifest | null) => void;
  applyMetaChannelManifestToCurrentWorld: (manifest: MetaChannelManifest | null) => void;
  clearMetaReality: () => void;
}

export const createMetaRealitySlice = (
  set: (
    partial:
      | Partial<Record<string, any>>
      | ((state: Record<string, any>) => Partial<Record<string, any>>)
  ) => void,
  get: () => any,
): MetaRealitySlice => ({
  realityArtifacts: [],
  boundaryEvents: [],
  metaChannelManifest: null,

  addRealityArtifact: (artifact) =>
    set((state) => ({
      realityArtifacts: upsertById(state.realityArtifacts ?? [], artifact),
    })),

  addBoundaryEvent: (event) =>
    set((state) => ({
      boundaryEvents: upsertById(state.boundaryEvents ?? [], event),
    })),

  setMetaChannelManifest: (manifest) =>
    set({
      metaChannelManifest: manifest ? structuredCloneCompat(manifest) : null,
    }),

  applyMetaChannelManifestToCurrentWorld: (manifest) => {
    const state = get();
    const nextManifest = manifest ? structuredCloneCompat(manifest) : null;
    const currentWorld = isWorldDefinitionLike(state.currentWorld)
      ? state.currentWorld
      : null;

    if (!currentWorld) {
      set({ metaChannelManifest: nextManifest });
      return;
    }

    const updatedWorld: WorldDefinition = {
      ...currentWorld,
      metaChannelManifest: nextManifest,
    };

    if (state.sandboxMode && typeof state.addSandboxWorld === "function") {
      void Promise.resolve(state.addSandboxWorld(updatedWorld, state.sandboxDossierId)).catch(error=>{
        console.warn('[MetaReality] 沙盒世界设定尚未保存:',error);
      });
      const sandboxWorlds = updateWorldList(
        (get().sandboxWorlds as WorldDefinition[] | undefined) ?? state.sandboxWorlds,
        updatedWorld,
        true,
      );
      set({
        metaChannelManifest: nextManifest,
        currentWorld: updatedWorld,
        sandboxWorlds,
      });
      return;
    }

    const playerWorlds = updateWorldList(
      state.playerWorlds as WorldDefinition[] | undefined,
      updatedWorld,
      Boolean(updatedWorld.isPlayerCreated),
    );
    if (playerWorlds) savePlayerWorlds(playerWorlds);

    set({
      metaChannelManifest: nextManifest,
      currentWorld: updatedWorld,
      ...(playerWorlds ? { playerWorlds } : {}),
    });
  },

  clearMetaReality: () =>
    set({
      realityArtifacts: [],
      boundaryEvents: [],
      metaChannelManifest: null,
    }),
});

function upsertById<T extends { id: string }>(items: T[], item: T): T[] {
  const cloned = structuredCloneCompat(item);
  const index = items.findIndex((existing) => existing.id === item.id);
  if (index < 0) return [...items, cloned];
  return items.map((existing, i) => (i === index ? cloned : existing));
}

function structuredCloneCompat<T>(value: T): T {
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value)) as T;
}

function updateWorldList(
  worlds: WorldDefinition[] | undefined,
  updatedWorld: WorldDefinition,
  appendWhenMissing: boolean,
): WorldDefinition[] | null {
  const list = Array.isArray(worlds) ? worlds : [];
  const index = list.findIndex((world) => world.id === updatedWorld.id);
  if (index >= 0) {
    return list.map((world, i) => (i === index ? updatedWorld : world));
  }
  return appendWhenMissing ? [...list, updatedWorld] : null;
}

function isWorldDefinitionLike(value: unknown): value is WorldDefinition {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { id?: unknown }).id === "string" &&
    typeof (value as { name?: unknown }).name === "string"
  );
}
