import type { WorldDefinition } from '../types';
import type { GameplayModState } from './mod-ui';
import type { GameplayRuleEffects, PluginEvent } from './types';
import { parseGameplayPlugins, validateGameModeConfig } from './manifest';
import { allowedFields, PluginInputError, record } from './validation';
import { GAMEPLAY_STATE_KEY, gameplayLedger, type GameplayReceipt } from './gameplay-state';
import { isGameplayPluginActive } from './activation';
import { parseGameplayPatches, applyGameplayPatches } from './json-patch';

export function parseRuleEffects(value: unknown): GameplayRuleEffects | undefined {
  if (value === undefined) return undefined;
  const input = record(value); allowedFields(input, ['state', 'facts']);
  return { ...(input.state === undefined ? {} : { state: parseGameplayPatches(input.state) }),
    ...(input.facts === undefined ? {} : { facts: parseGameplayPatches(input.facts) }) };
}
interface EffectInput {
  world: Pick<WorldDefinition, 'gameplayPlugins'>; state: GameplayModState; flags: Record<string, boolean>;
  events: PluginEvent[] | undefined; receiptId: string; createdAt: number; sceneId?: string; narration?: GameplayReceipt['narration'];
}
/** Pure preparation: author effects and facts join the same acceptance boundary as world rules. */
export function applyGameplayRuleEffects(input: EffectInput): GameplayModState {
  let next = input.state;
  const flags = { ...input.flags };
  const plugins = parseGameplayPlugins(input.world.gameplayPlugins), seen = new Set<string>(), descriptions = new Map<string, string[]>();
  for (const event of input.events ?? []) {
    const plugin = plugins.find(p => p.id === event.pluginId), rule = plugin?.rules.find(r => r.id === event.ruleId);
    if (!plugin || !rule) throw new PluginInputError('玩法更新引用未知规则');
    const key = `gameplay.${plugin.id}.done:${rule.id}`;
    if (seen.has(key) || rule.once && flags[key]) continue;
    seen.add(key);
    const wasActive = isGameplayPluginActive(plugin, flags, input.sceneId);
    for (const [id, value] of Object.entries(rule.sets)) flags[`gameplay.${plugin.id}.${id}`] = value;
    if (rule.once) flags[key] = true;
    if (!rule.effects) continue;
    if (!wasActive && !isGameplayPluginActive(plugin, flags, input.sceneId)) throw new PluginInputError('玩法当前未启用');
    const current = next[plugin.id] ?? plugin.ui?.initialState ?? {}, ledger = gameplayLedger(current);
    const updated = applyGameplayPatches(current, rule.effects.state), facts = applyGameplayPatches(ledger?.facts ?? {}, rule.effects.facts);
    validateGameModeConfig(facts);
    const summary = [...(descriptions.get(plugin.id) ?? []), rule.description]; descriptions.set(plugin.id, summary);
    const revision = (gameplayLedger(input.state[plugin.id] ?? {})?.revision ?? 0) + 1;
    const result = { ...updated, [GAMEPLAY_STATE_KEY]: { revision, facts,
      last: { id: `${input.receiptId.slice(0, 95)}:${plugin.id}`, revision, summary: summary.join('；'), createdAt: input.createdAt, narration: input.narration ?? 'complete' } } };
    // Accept only a complete state that the existing save/rewind boundary can restore.
    validateGameModeConfig(result);
    gameplayLedger(result);
    next = { ...next, [plugin.id]: result };
  }
  return next;
}
