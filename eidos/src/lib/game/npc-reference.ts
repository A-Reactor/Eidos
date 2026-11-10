import { mapScenes } from './map-state';
import type { EncyclopediaEntry, Scene, WorldDefinition } from './types';

export interface NpcReferenceSource {
  encyclopedia?: Pick<EncyclopediaEntry, 'type' | 'name'>[];
  npcStates?: Record<string, unknown>;
  npcBehaviors?: Record<string, unknown>;
  npcPersonalities?: Record<string, unknown>;
  relationships?: Record<string, unknown>;
  currentScene?: Scene | null;
}
export interface NpcReferenceContext { names: string[]; exactNames?: string[] }

export function npcReferenceContext(world: WorldDefinition | null, source: NpcReferenceSource = {}, speakers: string[] = []): NpcReferenceContext {
  const exactNames = [...new Set([
    ...Object.keys(world?.npcs ?? {}), ...(world ? Object.values(mapScenes(world)).flatMap(scene => scene.npcs ?? []) : []),
    ...(source.currentScene?.npcs ?? []), ...speakers,
  ])];
  const names = [...new Set([
    ...exactNames, ...(source.encyclopedia ?? []).filter(entry => entry.type === 'npc').map(entry => entry.name),
    ...Object.keys(source.npcStates ?? {}), ...Object.keys(source.npcBehaviors ?? {}),
    ...Object.keys(source.npcPersonalities ?? {}), ...Object.keys(source.relationships ?? {}),
  ])];
  return { names, exactNames };
}

/** Only a known exact prefix can separate a reaction note; explicit character names keep their punctuation. */
export function resolveNpcReference(reference: string, context: NpcReferenceContext): string {
  const value = reference.trim();
  if ((context.exactNames ?? context.names).includes(value)) return value;
  const prefix = context.names.filter(name => name && value.startsWith(name) && /^\s*[:：]\s*\S/u.test(value.slice(name.length)))
    .sort((a, b) => b.length - a.length)[0];
  return prefix ?? value;
}

export function npcReaction(reference: string, context: NpcReferenceContext): { name: string; reaction?: string } {
  const value = reference.trim(), name = resolveNpcReference(value, context);
  const reaction = name !== value ? value.slice(name.length).replace(/^\s*[:：]\s*/u, '') : undefined;
  return { name, ...(reaction ? { reaction } : {}) };
}
