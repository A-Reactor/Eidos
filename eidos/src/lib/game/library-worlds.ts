import type { WorldDefinition } from './types';

const removedKey = 'eidos_library_removed_worlds';
function removedWorlds(): string[] {
  if (typeof window === 'undefined') return [];
  const value: unknown = JSON.parse(localStorage.getItem(removedKey) ?? '[]');
  if (!Array.isArray(value) || value.some(id => typeof id !== 'string')) throw new Error('世界集合记录无效，已保留原件');
  return value;
}

/** Stored definitions override seeds; an explicitly reimported world is visible again. */
export function assembleLibraryWorlds(seeds: WorldDefinition[], stored: WorldDefinition[]): WorldDefinition[] {
  const removed = new Set(removedWorlds());
  return [...new Map([...seeds.filter(world => !removed.has(world.id)), ...stored].map(world => [world.id, world])).values()];
}

/** Removal affects only collection membership, including worlds originally supplied as examples. */
export function rememberLibraryWorldRemoval(id: string): void {
  localStorage.setItem(removedKey, JSON.stringify([...new Set([...removedWorlds(), id])]));
}
