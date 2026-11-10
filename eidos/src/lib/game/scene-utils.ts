import { mappedScene, mapScenes } from "./map-state";
// ============================================================
// 场景工具函数
// ============================================================
// 按 sceneId 在世界数据中查找场景
// ============================================================

import type { WorldDefinition, Scene } from "./types";

export function getSceneById(
  world: WorldDefinition | null,
  sceneId: string
): Scene | null {
  if (!world) return null;
  return mappedScene(world, sceneId);
}

export function resolveSceneReference(
  world: WorldDefinition | null,
  reference: unknown
): string | null {
  if (!world) return null;

  const rawReference = extractSceneReferenceString(reference);
  if (!rawReference) return null;

  const normalizedReference = rawReference.trim();
  if (!normalizedReference) return null;

  const scenes = mapScenes(world);
  if (Object.hasOwn(scenes, normalizedReference)) return normalizedReference;
  const matches = Object.entries(scenes).filter(([, scene]) => scene.name === normalizedReference);
  if (matches.length === 1) return matches[0][0];

  return null;
}

function extractSceneReferenceString(reference: unknown): string | null {
  if (typeof reference === "string") return reference;
  if (!reference || typeof reference !== "object" || Array.isArray(reference)) {
    return null;
  }

  const record = reference as Record<string, unknown>;
  for (const key of ["sceneId", "id", "targetSceneId", "target"]) {
    if (typeof record[key] === "string") return record[key];
  }

  return null;
}
