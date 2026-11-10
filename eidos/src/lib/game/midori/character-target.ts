import type { WorldDefinition } from '../types';
import { resolveNpcReference } from '../npc-reference';

/** Only remove a scene annotation when the exact base name is an existing character. */
export function characterAssetId(world: Pick<WorldDefinition, 'npcs'> | null | undefined, reference: string): string {
  if (Object.hasOwn(world?.npcs ?? {}, reference)) return reference;
  const name = resolveNpcReference(reference, { names: Object.keys(world?.npcs ?? {}) });
  const base = name.replace(/\s*[（(][^（）()]+[）)]\s*$/u, '');
  return base !== name && Object.hasOwn(world?.npcs ?? {}, base) ? base : name;
}
