import type { WorldDefinition } from "@/lib/game/types";

export interface WorldContinuityDependencies {
  setCurrentWorld: (world: WorldDefinition) => void;
  createPlaythrough: (worldId: string) => Promise<string>;
  setCurrentPlaythrough: (playthroughId: string | null) => void;
  initWorldLine: (playthroughId: string, worldId: string) => Promise<unknown>;
  deletePlaythrough: (playthroughId: string) => Promise<void>;
  enterIdentityPhase: () => void;
}

export async function createWorldContinuity(
  world: WorldDefinition,
  dependencies: WorldContinuityDependencies,
): Promise<boolean> {
  try {
    dependencies.setCurrentWorld(world);
    const playthroughId = await dependencies.createPlaythrough(world.id);
    dependencies.setCurrentPlaythrough(playthroughId);
    try {
      await dependencies.initWorldLine(playthroughId, world.id);
    } catch {
      try {
        await dependencies.deletePlaythrough(playthroughId);
      } finally {
        dependencies.setCurrentPlaythrough(null);
      }
      return false;
    }
    dependencies.enterIdentityPhase();
    return true;
  } catch {
    return false;
  }
}
