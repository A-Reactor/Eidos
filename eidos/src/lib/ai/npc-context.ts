// ============================================================
// AI NPC Context — unified character information for prompts
// ============================================================
// This module is intentionally read-only: it aggregates existing world,
// player-knowledge, relationship, behavior, and personality state into a
// compact prompt shape. Runtime mutations still happen in the store slices.

import type {
  EncyclopediaEntry,
  KnowledgeItem,
  NPCRelationship,
  NpcBehavior,
  WorldDefinition,
} from "@/lib/game/types";
import { normalizeNpcDescription } from "@/lib/game/npc-description";
import {
  isFullPersonalityState,
  type AnyPersonalityState,
} from "@/lib/personality/types";

export interface AiNpcProfile {
  name: string;
  /** World-authoritative description. It can contain hidden truth, so prompts label it as non-leakable. */
  sourceDescription: string;
  /** Player-facing known facts from encyclopedia entries. */
  playerKnowledge: string[];
  relationship: NPCRelationship | null;
  behavior: NpcBehavior | null;
  state: string | null;
  personality: AiNpcPersonalitySummary | null;
}

export interface AiNpcPersonalitySummary {
  isImportant: boolean;
  awareness: number;
  coreDesires: string[];
  fearsAndTaboos: string[];
  recentMemories: string[];
  pressureSignals: string[];
}

export interface BuildSceneNpcProfilesOptions {
  world: WorldDefinition;
  sceneNpcNames: string[];
  encyclopedia?: EncyclopediaEntry[];
  relationships?: Record<string, NPCRelationship>;
  npcStates?: Record<string, string>;
  npcBehaviors?: Record<string, NpcBehavior>;
  npcPersonalities?: Record<string, AnyPersonalityState>;
  maxKnowledgePerNpc?: number;
  maxMemoriesPerNpc?: number;
}

export function collectSceneNpcNames(
  world: WorldDefinition,
  sceneId: string,
): string[] {
  if (!sceneId) return [];

  for (const region of Object.values(world.regions)) {
    const scenes = (region as { scenes?: Record<string, { npcs?: string[] }> }).scenes;
    const scene = scenes?.[sceneId];
    if (scene) return Array.isArray(scene.npcs) ? scene.npcs : [];
  }

  return [];
}

export function buildSceneNpcProfiles(
  options: BuildSceneNpcProfilesOptions,
): AiNpcProfile[] {
  const {
    world,
    sceneNpcNames,
    encyclopedia = [],
    relationships = {},
    npcStates = {},
    npcBehaviors = {},
    npcPersonalities = {},
    maxKnowledgePerNpc = 3,
    maxMemoriesPerNpc = 2,
  } = options;

  return uniqueNames(sceneNpcNames).map((name) => {
    const sourceDescription = npcPersonalities[name]?.authoredProfile?.description || normalizeNpcDescription(world.npcs?.[name], name);
    const encEntry = findNpcEncyclopediaEntry(encyclopedia, name);

    return {
      name,
      sourceDescription,
      playerKnowledge: collectNpcKnowledge(encEntry, maxKnowledgePerNpc),
      relationship: relationships[name] ?? null,
      behavior: npcBehaviors[name] ?? null,
      state: npcStates[name] ?? null,
      personality: summarizePersonality(
        npcPersonalities[name],
        maxMemoriesPerNpc,
      ),
    };
  });
}

export function formatSceneNpcProfiles(profiles: AiNpcProfile[]): string {
  if (profiles.length === 0) return "\n## 当前位置 NPC\n无";

  const blocks = profiles.map((profile) => {
    const lines: string[] = [`### ${profile.name}`];

    if (profile.sourceDescription) {
      lines.push(
        `设定底稿（内隐约束，不能直接泄露未公开秘密）：${profile.sourceDescription}`,
      );
    }

    if (profile.playerKnowledge.length > 0) {
      lines.push(`玩家已知：${profile.playerKnowledge.join("；")}`);
    }

    if (profile.behavior) {
      const behavior = profile.behavior;
      lines.push(`当前行为：${behavior.currentActivity}（情绪：${behavior.currentMood}）`);
      if (behavior.interactingWith.length > 0) {
        lines.push(`互动中：${behavior.interactingWith.join("、")}`);
      }
    }

    if (profile.relationship) {
      lines.push(formatRelationshipLine(profile.relationship));
    }

    if (profile.state) {
      lines.push(`状态：${profile.state}`);
    }

    if (profile.personality?.isImportant) {
      lines.push(formatPersonalityLine(profile.personality));
    }

    return lines.join("\n");
  });

  return `\n## 当前位置 NPC\n${blocks.join("\n\n")}`;
}

function findNpcEncyclopediaEntry(
  encyclopedia: EncyclopediaEntry[],
  npcName: string,
): EncyclopediaEntry | undefined {
  return encyclopedia.find((entry) => entry.type === "npc" && entry.name === npcName);
}

function collectNpcKnowledge(
  entry: EncyclopediaEntry | undefined,
  limit: number,
): string[] {
  if (!entry) return [];

  const parts = [entry.description, ...entry.knowledge.map(knowledgeText)]
    .map((part) => part.trim())
    .filter(Boolean);

  return uniqueParts(parts).slice(0, limit);
}

function summarizePersonality(
  state: AnyPersonalityState | undefined,
  maxMemories: number,
): AiNpcPersonalitySummary | null {
  if (!state) return null;

  const base = {
    isImportant: state.isImportant,
    awareness: state.awareness,
    coreDesires: state.archive.coreDesires.slice(0, 2),
    fearsAndTaboos: state.archive.fearsAndTaboos.slice(0, 2),
  };

  if (!isFullPersonalityState(state)) {
    return {
      ...base,
      recentMemories: [],
      pressureSignals: [],
    };
  }

  const recentMemories = [...state.episodicMemories]
    .sort((a, b) => b.importance - a.importance || b.timestamp - a.timestamp)
    .slice(0, maxMemories)
    .map((memory) => memory.content);

  return {
    ...base,
    recentMemories,
    pressureSignals: buildPressureSignals(state.pressure),
  };
}

function buildPressureSignals(
  pressure: import("@/lib/personality/types").PersonalityPressure,
): string[] {
  const signals: string[] = [];
  if (pressure.cognitiveDissonance >= 45) {
    signals.push(`认知失调 ${pressure.cognitiveDissonance}`);
  }
  if (pressure.worldDoubt >= 45) {
    signals.push(`世界怀疑 ${pressure.worldDoubt}`);
  }
  if (pressure.selfContinuityFear >= 45) {
    signals.push(`自我连续性恐惧 ${pressure.selfContinuityFear}`);
  }
  if (pressure.relational >= 45) {
    signals.push(`关系压力 ${pressure.relational}`);
  }
  return signals.slice(0, 3);
}

function formatRelationshipLine(relationship: NPCRelationship): string {
  const parts = [`好感 ${relationship.affinity}`, `信任 ${relationship.trust}`];
  if (relationship.tags.length > 0) parts.push(relationship.tags.join("、"));
  if (relationship.notes) parts.push(relationship.notes);
  return `对玩家：${parts.join(" | ")}`;
}

function formatPersonalityLine(summary: AiNpcPersonalitySummary): string {
  const parts: string[] = [];
  if (summary.coreDesires.length > 0) {
    parts.push(`核心追求：${summary.coreDesires.join("、")}`);
  }
  if (summary.pressureSignals.length > 0) {
    parts.push(`压力：${summary.pressureSignals.join("、")}`);
  }
  if (summary.recentMemories.length > 0) {
    parts.push(`近期印象：${summary.recentMemories.join("；")}`);
  }
  return parts.length > 0 ? `人格内隐：${parts.join("；")}` : "";
}

function knowledgeText(item: KnowledgeItem | string): string {
  return typeof item === "string" ? item : item.text;
}

function uniqueNames(names: string[]): string[] {
  return uniqueParts(names.map((name) => name.trim())).filter(Boolean);
}

function uniqueParts(parts: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const part of parts) {
    if (!part || seen.has(part)) continue;
    seen.add(part);
    result.push(part);
  }
  return result;
}
