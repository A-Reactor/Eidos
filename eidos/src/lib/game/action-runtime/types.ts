import type { AIGameResponse, StorySegment } from '@/lib/ai/types';
import type { ActionRecord, GameTime, Scene, Weather, WorldDefinition, WorldSnapshot } from '../types';
import type { ChapterInputSource } from '../chapters/types';
import type { PlayerSlice } from '@/store/slices/player-slice';

export type RpgActionEffect =
  | { type: 'scene.entered'; sceneId: string }
  | { type: 'map.rejected'; message: string }
  | { type: 'encyclopedia.updated' }
  | { type: 'diary.requested'; day: number; history: ActionRecord[] };
export interface RpgActionInput {
  world: WorldDefinition; snapshot: WorldSnapshot; response: AIGameResponse;
  input: string; actionId: string; timestamp: number; segments?: StorySegment[];
  introspection?: boolean; inputSource?: ChapterInputSource; history?: ActionRecord[];
}
export interface PreparedRpgAction {
  world: WorldDefinition; snapshot: WorldSnapshot; response: AIGameResponse;
  record: ActionRecord; segments: StorySegment[]; text: string; timeSpent: GameTime;
  effects: RpgActionEffect[];
}
export type RpgPlayerState = PlayerSlice & {
  currentWorld: WorldDefinition; currentSceneId: string; currentScene: Scene | null;
  gameTime: GameTime; weather: Weather; history: ActionRecord[];
  worldFlags: Record<string, boolean>; sceneDetailLevels: Record<string, number>;
  visitedScenes: string[]; discoveredSecrets: Record<string, string[]>;
  npcStates: NonNullable<WorldSnapshot['npcStates']>;
  npcBehaviors: NonNullable<WorldSnapshot['npcBehaviors']>;
  npcPersonalities: NonNullable<WorldSnapshot['npcPersonalities']>;
  resolvedTimelineEvents: string[]; deviatedEvents: Record<string, string>;
  causalProjections: NonNullable<WorldSnapshot['causalProjections']>; sceneNarrative: string;
  availableActions: string[];
};
