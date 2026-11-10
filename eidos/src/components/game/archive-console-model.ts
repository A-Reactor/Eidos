import type { CausalProjection } from "@/lib/game/types";

export type ArchiveConsoleTab =
  | "status"
  | "causal"
  | "worldline"
  | "relations"
  | "intel"
  | "gallery";

export interface ArchiveConsoleInput {
  activeQuestCount: number;
  branchCount: number;
  causalProjections: CausalProjection[];
  criticalFactCount: number;
  discoveredClueCount: number;
  encyclopediaCount: number;
  inventoryCount: number;
  npcCount: number;
  totalClueCount: number;
  worldLineNodeCount: number;
}

export interface ArchiveConsoleModule {
  id: ArchiveConsoleTab;
  count?: number;
}

export interface ArchiveConsoleModel {
  modules: ArchiveConsoleModule[];
  stats: {
    avgConfidencePercent: number;
    pendingRipples: number;
    totalRipples: number;
  };
}

export function buildArchiveConsoleModel(_input: ArchiveConsoleInput): ArchiveConsoleModel {
  const input = _input;
  const ripples = input.causalProjections.flatMap((projection) => projection.rippleEffects);
  const totalConfidence = ripples.reduce((sum, ripple) => sum + ripple.confidence, 0);
  const avgConfidencePercent = ripples.length === 0
    ? 0
    : Math.round((totalConfidence / ripples.length) * 100);
  const pendingRipples = ripples.filter((ripple) => ripple.status === "pending").length;

  return {
    modules: [
      { id: "status", count: input.inventoryCount + input.activeQuestCount },
      { id: "causal", count: pendingRipples },
      { id: "worldline", count: input.worldLineNodeCount },
      { id: "relations", count: input.npcCount },
      {
        id: "intel",
        count: input.discoveredClueCount + input.criticalFactCount + input.encyclopediaCount,
      },
      { id: "gallery" },
    ],
    stats: {
      avgConfidencePercent,
      pendingRipples,
      totalRipples: ripples.length,
    },
  };
}
