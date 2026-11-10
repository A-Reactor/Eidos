import type { NativeGameplayAction } from './types';
import { isGameplayPluginActive } from './activation';
import { evaluateGameplayEvents } from './runtime';
import { applyGameplayRuleEffects } from './rule-effects';
import { parseGameplayPlugins } from './manifest';
import type { GameStore } from '@/store/game-store';


export type AvailableNativeAction = NativeGameplayAction & { pluginId: string; displayLabel: string };
type NativeState = Pick<GameStore, 'currentWorld' | 'currentSceneId' | 'worldFlags' | 'gameplayResources' | 'gameplayModState'>;
/** Project only labels. Authored answers stay inside the installed package until acceptance. */
export function nativeGameplayActions(state: NativeState): AvailableNativeAction[] {
  const world = state.currentWorld ?? {}, all = parseGameplayPlugins(state.currentWorld?.gameplayPlugins);
  const actions = all.filter(p => p.ui?.presentation === 'native' && isGameplayPluginActive(p, state.worldFlags, state.currentSceneId)).flatMap(plugin =>
    (plugin.ui?.actions ?? []).flatMap(action => {
      const rule = plugin.rules.find(r => r.id === action.ruleId)!;
      if (rule.once && state.worldFlags[`gameplay.${plugin.id}.done:${rule.id}`]) return [];
      const events = [{ pluginId: plugin.id, ruleId: rule.id }];
      try {
        evaluateGameplayEvents(world, state.worldFlags, state.gameplayResources, events);
        applyGameplayRuleEffects({ world, state: state.gameplayModState, flags: state.worldFlags, events, receiptId: 'native-preview', createdAt: 0, sceneId: state.currentSceneId });
        return [{ ...action, pluginId: plugin.id, displayLabel: action.label }];
      } catch { return []; } // A failed prerequisite is simply unavailable, never a successful action.
    }));
  return actions.map(action => actions.filter(other => other.label === action.label).length > 1
    ? { ...action, displayLabel: `${action.label}（${all.find(p => p.id === action.pluginId)!.name}）` } : action);
}
