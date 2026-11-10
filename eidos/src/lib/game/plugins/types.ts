export type PluginPhase = 'creation' | 'action' | 'review';
export interface GameplayDisplayLocation {
  placement: 'left' | 'right';
  tone: 'cyan' | 'mint' | 'amber' | 'coral';
}
export interface GameplayResourceHud extends GameplayDisplayLocation {
  style: 'gauge' | 'bar' | 'counter';
  warningBelow?: number;
  warningAbove?: number;
}
export interface GameplayResource {
  name: string;
  initial: number;
  min: number;
  max: number;
  unit: string;
  visible: boolean;
  hud?: GameplayResourceHud;
}
export interface ResourceBounds { min?: number; max?: number }
export type GameplayPatch = { op: 'add' | 'replace' | 'test'; path: string; value: unknown } | { op: 'remove'; path: string } | { op: 'copy'; from: string; path: string } | { op: 'move'; from: string; path: string };
export interface GameplayRuleEffects { state?: GameplayPatch[]; facts?: GameplayPatch[] }
export interface GameplayReadout extends GameplayDisplayLocation {
  id: string;
  text: string;
  requires: Record<string, boolean>;
  resourceRequires: Record<string, ResourceBounds>;
}
export interface GameplayRule {
  id: string;
  description: string;
  requires: Record<string, boolean>;
  sets: Record<string, boolean>;
  once: boolean;
  resourceRequires?: Record<string, ResourceBounds>;
  resourceChanges?: Record<string, number>;
  effects?: GameplayRuleEffects;
}
export interface GameplayActivation {
  requires: Record<string, boolean>;
  scenes?: string[];
}
export interface GameplaySetting {
  id: string;
  label: string;
  description?: string;
  type: 'boolean' | 'number' | 'string' | 'select';
  default: boolean | number | string;
  min?: number;
  max?: number;
  options?: string[];
}
/** Portable author packages; code runs only inside the isolated presentation frame. */
export interface GameplayPlugin {
  introduction?: import('./introduction').PluginIntroduction;
  release?: string;
  stateVersion?: number;
  migrations?: Array<{ from: number; to: number; patches: GameplayPatch[] }>;
  activation?: GameplayActivation;
  settings?: GameplaySetting[];
  /** Author-owned presentation and operations, excluded from model context. */
  ui?: { html: string; reading: 'replace' | 'inherit'; initialState?: Record<string, unknown>; priority?: number; presentation?: 'scene-map' | 'native-text' | 'native' | 'tool'; actions?: NativeGameplayAction[]; nativeReading?: boolean };
  format: 'eidos-gameplay-plugin';
  version: 1 | 2;
  id: string;
  name: string;
  description: string;
  tags: string[];
  prompts: Record<PluginPhase, string>;
  rules: GameplayRule[];
  resources?: Record<string, GameplayResource>;
  /** Author-defined setting data, without a required genre or progression schema. */
  data?: Record<string, unknown>;
  /** A view of accepted state; these declarations never settle gameplay events. */
  readouts?: GameplayReadout[];
}
export interface PluginEvent { pluginId: string; ruleId: string }
export interface NativeGameplayAction {
  ruleId: string;
  label: string;
  segments?: import('@/lib/ai/types').StorySegment[];
}
