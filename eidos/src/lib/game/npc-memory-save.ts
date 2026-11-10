import type {
  EncyclopediaEntry,
  NPCRelationship,
  NpcBehavior,
  NpcMemoryRecord,
  NpcMemoryState,
  NpcPlayerKnowledgeSnapshot,
  WorldDefinition,
} from "@/lib/game/types";
import type { AnyPersonalityState } from "@/lib/personality/types";
import { repairLegacyNpcDefaults } from '@/lib/personality/legacy-defaults';

export interface NpcMemorySource {
  encyclopedia?: EncyclopediaEntry[];
  npcStates?: Record<string, string>;
  relationships?: Record<string, NPCRelationship>;
  npcBehaviors?: Record<string, NpcBehavior>;
  npcPersonalities?: Record<string, AnyPersonalityState>;
}

export interface NpcMemoryProjection {
  npcStates: Record<string, string>;
  relationships: Record<string, NPCRelationship>;
  npcBehaviors: Record<string, NpcBehavior>;
  npcPersonalities: Record<string, AnyPersonalityState>;
  encyclopedia: EncyclopediaEntry[];
}

export interface SplitNpcKnowledgeResult {
  npcMemory: NpcMemoryState;
  encyclopedia: EncyclopediaEntry[];
}

export const NPC_MEMORY_VERSION: NpcMemoryState["version"] = "npc_memory_v1";

export function buildNpcMemoryState(source: NpcMemorySource): NpcMemoryState {
  const encyclopedia = source.encyclopedia ?? [];
  const npcStates = source.npcStates ?? {};
  const relationships = source.relationships ?? {};
  const npcBehaviors = source.npcBehaviors ?? {};
  const npcPersonalities = source.npcPersonalities ?? {};
  const npcEntries = encyclopedia.filter(
    (entry) => entry.type === "npc" && isValidNpcName(entry.name),
  );

  const names = new Set<string>();
  for (const entry of npcEntries) names.add(entry.name);
  for (const name of Object.keys(npcStates)) if (isValidNpcName(name)) names.add(name);
  for (const name of Object.keys(relationships)) if (isValidNpcName(name)) names.add(name);
  for (const name of Object.keys(npcBehaviors)) if (isValidNpcName(name)) names.add(name);
  for (const name of Object.keys(npcPersonalities)) if (isValidNpcName(name)) names.add(name);

  const records: Record<string, NpcMemoryRecord> = {};
  for (const name of [...names].sort((a, b) => a.localeCompare(b, "zh-Hans-CN"))) {
    const entry = npcEntries.find((candidate) => candidate.name === name);
    records[name] = compactRecord({
      name,
      state: npcStates[name] || undefined,
      relationship: cloneOptional(relationships[name]),
      behavior: cloneOptional(npcBehaviors[name]),
      personality: cloneOptional(npcPersonalities[name]),
      playerKnowledge: entry ? toPlayerKnowledgeSnapshot(entry) : undefined,
    });
  }

  return { version: NPC_MEMORY_VERSION, records };
}

export function splitNpcKnowledgeFromEncyclopedia(source: NpcMemorySource): SplitNpcKnowledgeResult {
  const npcMemory = buildNpcMemoryState(source);
  const encyclopedia = (source.encyclopedia ?? [])
    .filter((entry) => entry.type !== "npc")
    .map((entry) => cloneJson(entry));

  return { npcMemory, encyclopedia };
}

export function projectNpcMemoryState(memory: NpcMemoryState | null | undefined, world?: WorldDefinition): NpcMemoryProjection {
  const projection: NpcMemoryProjection = {
    npcStates: {},
    relationships: {},
    npcBehaviors: {},
    npcPersonalities: {},
    encyclopedia: [],
  };
  if (!memory) return projection;

  for (const record of Object.values(memory.records)) {
    if (!isValidNpcName(record.name)) continue;
    if (record.state) projection.npcStates[record.name] = record.state;
    if (record.relationship) projection.relationships[record.name] = cloneJson(record.relationship);
    if (record.behavior) projection.npcBehaviors[record.name] = cloneJson(record.behavior);
    if (record.personality) projection.npcPersonalities[record.name] = cloneJson(record.personality);
    if (record.playerKnowledge) {
      projection.encyclopedia.push(fromPlayerKnowledgeSnapshot(record.name, record.playerKnowledge));
    }
  }

  return world ? repairLegacyNpcDefaults(projection, world) : projection;
}

export function mergeNpcMemoryIntoEncyclopedia(
  encyclopedia: EncyclopediaEntry[],
  memory: NpcMemoryState | null | undefined,
): EncyclopediaEntry[] {
  const nonNpcEntries = encyclopedia
    .filter((entry) => entry.type !== "npc")
    .map((entry) => cloneJson(entry));
  const projected = projectNpcMemoryState(memory);
  return [...nonNpcEntries, ...projected.encyclopedia];
}

function compactRecord(record: NpcMemoryRecord): NpcMemoryRecord {
  return Object.fromEntries(
    Object.entries(record).filter(([, value]) => value !== undefined),
  ) as NpcMemoryRecord;
}

function toPlayerKnowledgeSnapshot(entry: EncyclopediaEntry): NpcPlayerKnowledgeSnapshot {
  return {
    entryId: entry.id,
    description: entry.description,
    knowledge: cloneJson(entry.knowledge),
    firstEncountered: cloneJson(entry.firstEncountered),
    lastUpdated: cloneJson(entry.lastUpdated),
    relatedEntries: [...entry.relatedEntries],
    ...(entry.imageUrl ? { imageUrl: entry.imageUrl } : {}),
  };
}

function fromPlayerKnowledgeSnapshot(
  name: string,
  knowledge: NpcPlayerKnowledgeSnapshot,
): EncyclopediaEntry {
  return {
    id: knowledge.entryId,
    type: "npc",
    name,
    description: knowledge.description,
    knowledge: cloneJson(knowledge.knowledge),
    firstEncountered: cloneJson(knowledge.firstEncountered),
    lastUpdated: cloneJson(knowledge.lastUpdated),
    relatedEntries: [...knowledge.relatedEntries],
    ...(knowledge.imageUrl ? { imageUrl: knowledge.imageUrl } : {}),
  };
}

function cloneOptional<T>(value: T | undefined): T | undefined {
  return value === undefined ? undefined : cloneJson(value);
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function isValidNpcName(name: unknown): name is string {
  return typeof name === "string" && name.trim().length > 0;
}
