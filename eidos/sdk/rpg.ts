/** Optional Eidos RPG rules; the root SDK remains independent of these conventions. */
export { createRpgSnapshot } from '../src/lib/game/action-runtime/initial-state';
export type { RpgSnapshotOptions } from '../src/lib/game/action-runtime/initial-state';
export { prepareRpgAction } from '../src/lib/game/action-runtime';
export type { RpgActionInput, RpgActionEffect, PreparedRpgAction } from '../src/lib/game/action-runtime';
export { buildEidosEngineWorld, engineCommandToPlayerInput } from '../src/lib/game/engine-world';
export { parseGameplayPlugins } from '../src/lib/game/plugins/manifest';
export { projectNpcMemoryState } from '../src/lib/game/npc-memory-save';
export { formatGameTime } from '../src/lib/game/time';
export type { WorldDefinition, WorldSnapshot, ActionRecord, GameTime, Scene, Weather, InventoryItem, Clue, EncyclopediaEntry, NpcMemoryState } from '../src/lib/game/types';
export type { AIGameResponse, StorySegment } from '../src/lib/ai/types';
export type { GameplayPlugin, PluginEvent } from '../src/lib/game/plugins/types';
export type { ChapterInputSource } from '../src/lib/game/chapters/types';
