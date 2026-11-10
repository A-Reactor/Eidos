import type {
  EncyclopediaEntry,
  NPCRelationship,
  NpcBehavior,
  NpcMemoryState,
} from "@/lib/game/types";
import { mergeNpcMemoryIntoEncyclopedia, projectNpcMemoryState } from "@/lib/game/npc-memory-save";
import type { AnyPersonalityState } from "@/lib/personality/types";

export interface NpcViewModelSource {
  npcMemory?: NpcMemoryState;
  encyclopedia?: EncyclopediaEntry[];
  npcStates?: Record<string, string>;
  relationships?: Record<string, NPCRelationship>;
  npcBehaviors?: Record<string, NpcBehavior>;
  npcPersonalities?: Record<string, AnyPersonalityState>;
}

export interface NpcViewModel {
  name: string;
  state?: string;
  hasReacted: boolean;
  mood?: string;
  activity?: string;
  currentScene?: string;
  interactingWith: string[];
  relationship?: NPCRelationship;
  affinityLabel?: string;
  relationshipLine?: string;
  knownDescription?: string;
  primaryKnowledge?: string;
  statusLine: string;
  detailLine: string;
  tooltip: string;
}

export function buildNpcViewModels(
  npcNames: string[],
  source: NpcViewModelSource,
): NpcViewModel[] {
  const projection = projectNpcMemoryState(source.npcMemory);
  const npcStates = { ...projection.npcStates, ...(source.npcStates ?? {}) };
  const relationships = { ...projection.relationships, ...(source.relationships ?? {}) };
  const npcBehaviors = { ...projection.npcBehaviors, ...(source.npcBehaviors ?? {}) };
  const encyclopedia = source.npcMemory
    ? mergeNpcMemoryIntoEncyclopedia(source.encyclopedia ?? [], source.npcMemory)
    : (source.encyclopedia ?? []);

  return uniqueNames(npcNames).map((name) => {
    const state = npcStates[name];
    const behavior = npcBehaviors[name];
    const relationship = relationships[name];
    const entry = encyclopedia.find((candidate) => candidate.type === "npc" && candidate.name === name);
    const primaryKnowledge = entry?.knowledge?.[0]?.text;
    const mood = behavior?.currentMood || undefined;
    const activity = behavior?.currentActivity || undefined;
    const affinity = relationship ? affinityLabel(relationship.affinity) : undefined;
    const relationshipLine = relationship ? formatRelationship(relationship) : undefined;
    const statusLine = formatStatusLine(mood, activity, state);
    const detailLine = activity ?? primaryKnowledge ?? entry?.description ?? state ?? "Observed in scene";
    const tooltip = [
      name,
      statusLine,
      relationshipLine,
      entry?.description,
      primaryKnowledge,
    ].filter(Boolean).join("\n");

    return {
      name,
      state,
      hasReacted: state === "reacted",
      mood,
      activity,
      currentScene: behavior?.currentScene || undefined,
      interactingWith: behavior?.interactingWith ?? [],
      relationship,
      affinityLabel: affinity,
      relationshipLine,
      knownDescription: entry?.description,
      primaryKnowledge,
      statusLine,
      detailLine,
      tooltip,
    };
  });
}

export function affinityLabel(affinity: number): string {
  if (affinity >= 60) return "友善";
  if (affinity >= 20) return "好感";
  if (affinity >= -20) return "中立";
  if (affinity >= -60) return "疏远";
  return "敌对";
}

export function affinityToneClass(affinity: number): string {
  if (affinity >= 30) return "text-emerald-300";
  if (affinity <= -30) return "text-red-300";
  return "text-zinc-300";
}

function formatRelationship(relationship: NPCRelationship): string {
  const tags = relationship.tags.length > 0 ? ` | ${relationship.tags.join("、")}` : "";
  return `好感 ${relationship.affinity} | 信任 ${relationship.trust}${tags}`;
}

function formatStatusLine(mood?: string, activity?: string, state?: string): string {
  if (mood && activity) return `[${mood}] ${activity}`;
  if (activity) return activity;
  if (mood) return `[${mood}]`;
  return state ?? "Observed in scene";
}

function uniqueNames(names: string[]): string[] {
  const seen = new Set<string>();
  return names.filter((name) => {
    if (seen.has(name)) return false;
    seen.add(name);
    return true;
  });
}
