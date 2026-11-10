// ============================================================
// MIDORI Asset Registry
// ============================================================
// Tracks which image is currently bound to each game object.
// Image files live in generated/upload caches; this registry belongs to saves.

import { normalizeImageResources, type ImageResource } from './image-resource';

export type MidoriAssetTargetType = "scene" | "character" | "detail" | "world" | "item";

export type MidoriAssetSlot =
  | "background"
  | "portrait"
  | "avatar"
  | "emotion"
  | "detail"
  | "cover"
  | "icon";

export type MidoriAssetSource = "generated" | "uploaded" | "default" | "edited";

export interface MidoriAssetDisplay {
  fit: "cover" | "contain";
  positionX: number;
  positionY: number;
  zoom: number;
}

export interface MidoriAssetBinding {
  id: string;
  worldId: string;
  targetType: MidoriAssetTargetType;
  targetId: string;
  slot: MidoriAssetSlot;
  variant?: string;
  imageUrl: string;
  source: MidoriAssetSource;
  label?: string;
  display: MidoriAssetDisplay;
  createdAt: number;
  updatedAt: number;
}

export interface MidoriAssetRegistry {
  version: 1;
  bindings: Record<string, MidoriAssetBinding>;
  images?: Record<string, ImageResource>;
  /** Removed cached files and old save entries must stay hidden after a reload. */
  removedImageIds?: string[];
}

export type MidoriAssetLookup = Pick<MidoriAssetBinding, "targetType" | "targetId" | "slot"> & {
  variant?: string;
  worldId?: string;
};

export type MidoriAssetInput = Omit<MidoriAssetBinding, "id" | "display" | "createdAt" | "updatedAt"> & {
  display?: Partial<MidoriAssetDisplay>;
  createdAt?: number;
  updatedAt?: number;
};

export const DEFAULT_MIDORI_ASSET_DISPLAY: MidoriAssetDisplay = {
  fit: "cover",
  positionX: 50,
  positionY: 50,
  zoom: 1,
};

export function createEmptyMidoriAssetRegistry(): MidoriAssetRegistry {
  return {
    version: 1,
    bindings: {},
  };
}

export function makeMidoriAssetKey(
  targetType: MidoriAssetTargetType,
  targetId: string,
  slot: MidoriAssetSlot,
  variant?: string,
): string {
  return [targetType, targetId, slot, variant].filter(Boolean).join(":");
}

export function normalizeMidoriAssetDisplay(input: unknown): MidoriAssetDisplay {
  const raw = isRecord(input) ? input : {};
  return {
    fit: raw.fit === "contain" ? "contain" : "cover",
    positionX: clampNumber(raw.positionX, 0, 100, DEFAULT_MIDORI_ASSET_DISPLAY.positionX),
    positionY: clampNumber(raw.positionY, 0, 100, DEFAULT_MIDORI_ASSET_DISPLAY.positionY),
    zoom: clampNumber(raw.zoom, 0.2, 4, DEFAULT_MIDORI_ASSET_DISPLAY.zoom),
  };
}

export function normalizeMidoriAssetRegistry(input: unknown): MidoriAssetRegistry {
  if (!isRecord(input) || !isRecord(input.bindings)) {
    return createEmptyMidoriAssetRegistry();
  }

  const registry = createEmptyMidoriAssetRegistry();
  if (isRecord(input.images)) registry.images = normalizeImageResources(input.images);
  if (Array.isArray(input.removedImageIds)) registry.removedImageIds = input.removedImageIds.filter((id): id is string => typeof id === 'string');
  for (const value of Object.values(input.bindings)) {
    if (!isRecord(value)) continue;
    if (
      typeof value.worldId !== "string" ||
      !isTargetType(value.targetType) ||
      typeof value.targetId !== "string" ||
      !isSlot(value.slot) ||
      typeof value.imageUrl !== "string" ||
      !isSource(value.source)
    ) {
      continue;
    }

    const key = makeMidoriAssetKey(value.targetType, value.targetId, value.slot, stringOrUndefined(value.variant));
    const createdAt = typeof value.createdAt === "number" ? value.createdAt : 0;
    const updatedAt = typeof value.updatedAt === "number" ? value.updatedAt : createdAt;
    registry.bindings[key] = {
      id: key,
      worldId: value.worldId,
      targetType: value.targetType,
      targetId: value.targetId,
      slot: value.slot,
      ...(typeof value.variant === "string" ? { variant: value.variant } : {}),
      imageUrl: value.imageUrl,
      source: value.source,
      ...(typeof value.label === "string" ? { label: value.label } : {}),
      display: normalizeMidoriAssetDisplay(value.display),
      createdAt,
      updatedAt,
    };
  }
  return registry;
}

export function bindMidoriAsset(registry: MidoriAssetRegistry, input: MidoriAssetInput): MidoriAssetRegistry {
  const now = input.updatedAt ?? Date.now();
  const normalized = normalizeMidoriAssetRegistry(registry);
  const key = makeMidoriAssetKey(input.targetType, input.targetId, input.slot, input.variant);
  const previous = normalized.bindings[key];
  return {
    ...normalized,
    bindings: {
      ...normalized.bindings,
      [key]: {
        id: key,
        worldId: input.worldId,
        targetType: input.targetType,
        targetId: input.targetId,
        slot: input.slot,
        ...(input.variant ? { variant: input.variant } : {}),
        imageUrl: input.imageUrl,
        source: input.source,
        ...(input.label ? { label: input.label } : {}),
        display: normalizeMidoriAssetDisplay(input.display ?? previous?.display),
        createdAt: previous?.createdAt ?? input.createdAt ?? now,
        updatedAt: now,
      },
    },
  };
}

export function findMidoriAsset(registry: MidoriAssetRegistry, lookup: MidoriAssetLookup): MidoriAssetBinding | null {
  const normalized = normalizeMidoriAssetRegistry(registry);
  const key = makeMidoriAssetKey(lookup.targetType, lookup.targetId, lookup.slot, lookup.variant);
  const binding = normalized.bindings[key];
  return binding && (!lookup.worldId || binding.worldId === lookup.worldId) ? binding : null;
}

export function updateMidoriAssetDisplay(
  registry: MidoriAssetRegistry,
  lookup: MidoriAssetLookup & { display: Partial<MidoriAssetDisplay> },
): MidoriAssetRegistry {
  const normalized = normalizeMidoriAssetRegistry(registry);
  const key = makeMidoriAssetKey(lookup.targetType, lookup.targetId, lookup.slot, lookup.variant);
  const previous = findMidoriAsset(normalized, lookup);
  if (!previous) return normalized;
  return {
    ...normalized,
    bindings: {
      ...normalized.bindings,
      [key]: {
        ...previous,
        display: normalizeMidoriAssetDisplay({ ...previous.display, ...lookup.display }),
        updatedAt: Date.now(),
      },
    },
  };
}

export function removeMidoriAsset(registry: MidoriAssetRegistry, lookup: MidoriAssetLookup): MidoriAssetRegistry {
  const normalized = normalizeMidoriAssetRegistry(registry);
  const key = makeMidoriAssetKey(lookup.targetType, lookup.targetId, lookup.slot, lookup.variant);
  const next = { ...normalized.bindings };
  if (findMidoriAsset(normalized, lookup)) delete next[key];
  return {
    ...normalized,
    bindings: next,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function isTargetType(value: unknown): value is MidoriAssetTargetType {
  return value === "scene" || value === "character" || value === "detail" || value === "world" || value === "item";
}

function isSlot(value: unknown): value is MidoriAssetSlot {
  return value === "background" ||
    value === "portrait" ||
    value === "avatar" ||
    value === "emotion" ||
    value === "detail" ||
    value === "cover" ||
    value === "icon";
}

function isSource(value: unknown): value is MidoriAssetSource {
  return value === "generated" || value === "uploaded" || value === "default" || value === "edited";
}
