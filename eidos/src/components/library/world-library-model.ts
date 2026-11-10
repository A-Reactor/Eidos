import type { PlaythroughMeta, SaveSlot, WorldDefinition } from "@/lib/game/types";

export interface WorldLibraryItem {
  world: WorldDefinition;
  continuityCount: number;
  historyNodeCount: number;
  saveCount: number;
  latestSave: SaveSlot | null;
  activeContinuity: PlaythroughMeta | null;
  continuities: Array<PlaythroughMeta & { saves: SaveSlot[] }>;
}

function groupByWorldId<T extends { worldId: string }>(items: readonly T[]): Map<string, T[]> {
  const groups = new Map<string, T[]>();

  for (const item of items) {
    const group = groups.get(item.worldId);
    if (group) {
      group.push(item);
    } else {
      groups.set(item.worldId, [item]);
    }
  }

  return groups;
}

function newestFirst<T extends { updatedAt: number }>(items: readonly T[]): T[] {
  return items
    .map((item, index) => ({ item, index }))
    .sort((left, right) => right.item.updatedAt - left.item.updatedAt || left.index - right.index)
    .map(({ item }) => item);
}

function newest<T extends { updatedAt: number }>(items: readonly T[]): T | null {
  let result: T | null = null;

  for (const item of items) {
    if (result === null || item.updatedAt > result.updatedAt) {
      result = item;
    }
  }

  return result;
}

export function buildWorldLibraryItems(
  worlds: readonly WorldDefinition[],
  playthroughs: readonly PlaythroughMeta[],
  saves: readonly SaveSlot[],
): WorldLibraryItem[] {
  const playthroughsByWorld = groupByWorldId(playthroughs);
  const savesByWorld = groupByWorldId(saves);

  return worlds.map((world) => {
    const worldPlaythroughs = playthroughsByWorld.get(world.id) ?? [];
    const worldSaves = savesByWorld.get(world.id) ?? [];
    const activeContinuity = newest(worldPlaythroughs);

    const continuities = newestFirst(worldPlaythroughs).map((playthrough) => ({
      ...playthrough,
      saves: newestFirst(
        worldSaves.filter((save) => save.playthroughId === playthrough.id),
      ),
    }));

    return {
      world,
      continuityCount: worldPlaythroughs.length,
      historyNodeCount: worldPlaythroughs.reduce(
        (sum, playthrough) => sum + Math.max(0, playthrough.actionCount ?? 0),
        0,
      ),
      saveCount: worldSaves.length,
      latestSave: newest(worldSaves),
      activeContinuity,
      continuities,
    };
  });
}
