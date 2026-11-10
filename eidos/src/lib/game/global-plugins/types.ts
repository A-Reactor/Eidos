import type { GameplaySetting } from '../plugins/types';
import type { ModPreferenceValue } from '../plugins/preferences';
import type { GameStore } from '@/store/game-store';

export interface GlobalPlugin {
  introduction?: import('../plugins/introduction').PluginIntroduction;
  format: 'eidos-global-plugin'; version: 1; id: string; name: string; release: string; description: string;
  author?: string; css?: string; script?: string; settings?: GameplaySetting[];
}
export interface GlobalPluginEntry { plugin: GlobalPlugin; enabled: boolean; preferences: Record<string, ModPreferenceValue> }
export interface GlobalPluginLibrary { entries: GlobalPluginEntry[]; error?: string }
export interface ActionHookContext { worldId: string | null; playthroughId: string | null; nodeId: string | null; fromMap: boolean }
export type BeforeSubmitHook = (input: string, context: ActionHookContext) => string | void | { cancel: true; reason?: string };
export interface GlobalPluginStatus { state: 'disabled' | 'running' | 'error'; error?: string }
export type GlobalPluginStatuses = Record<string, GlobalPluginStatus>;
export interface GlobalPluginApi {
  version: 1; plugin: Readonly<GlobalPlugin>; preferences: Readonly<Record<string, ModPreferenceValue>>; signal: AbortSignal;
  game: {
    getState: () => GameStore;
    setState: (state: Partial<GameStore> | ((current: GameStore) => Partial<GameStore>)) => void;
    subscribe: (listener: (state: GameStore, previous: GameStore) => void) => () => void;
  };
  ui: { addStyle: (css: string) => () => void; mount: (element: HTMLElement, target?: Element | string) => () => void };
  actions: { beforeSubmit: (hook: BeforeSubmitHook) => () => void };
  voice: { registerJapaneseMaterial: () => () => void };
  storage: { get: (key: string, fallback?: unknown) => unknown; set: (key: string, value: unknown) => void; remove: (key: string) => void };
  listen: (target: EventTarget, type: string, listener: (event: Event) => void) => () => void;
  setTimeout: (callback: () => void, ms: number) => () => void;
  setInterval: (callback: () => void, ms: number) => () => void;
  onDispose: (cleanup: () => void) => () => void;
}
