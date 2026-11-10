import { parseGameplayPlugins, validateGameModeConfig } from './manifest';
import { applyGameplayPatches } from './json-patch';
import { GAMEPLAY_STATE_KEY, gameplayLedger } from './gameplay-state';
import { normalizeGameplayModState, type GameplayModState } from './mod-ui';
import { normalizeGameplayResources } from './resources';
import { record } from './validation';
import type { WorldDefinition } from '../types';
import { stableRecordJSON } from '@/lib/ai/prompt-layout';
import { legacyNativeFlags } from './native-upgrade';

function local(values: Record<string, unknown>, prefix: string) {
  return Object.fromEntries(Object.entries(values).filter(([key]) => key.startsWith(prefix)).map(([key, value]) => [key.slice(prefix.length), value]));
}
export interface UpgradeSource { currentWorld: WorldDefinition | null; gameplayModState: GameplayModState; worldFlags: Record<string, boolean>; gameplayResources: Record<string, number> }
export function upgradeIdentity(source: UpgradeSource, id: string): string {
  return stableRecordJSON({ plugins: source.currentWorld?.gameplayPlugins, state: source.gameplayModState[id],
    flags: local(source.worldFlags, `gameplay.${id}.`), resources: local(source.gameplayResources, `gameplay.${id}.`) });
}
export function migratePluginProgress(source: UpgradeSource, incoming: unknown) {
  const target = parseGameplayPlugins([incoming])[0], plugins = parseGameplayPlugins(source.currentWorld?.gameplayPlugins);
  const previous = plugins.find(plugin => plugin.id === target.id);
  if (!previous) throw new Error('当前世界没有安装这个模组');
  if (stableRecordJSON(previous) === stableRecordJSON(target)) throw new Error('模组内容相同，无需更新');
  let version = previous.stateVersion ?? 1, count = 0;
  if (version > (target.stateVersion ?? 1)) throw new Error('不支持降低模组状态版本，请使用匹配版本的存档');
  const old = source.gameplayModState[target.id] ?? previous.ui?.initialState ?? {}, ledger = gameplayLedger(old);
  const author = Object.fromEntries(Object.entries(old).filter(([key]) => !key.startsWith('_eidos')));
  let progress = { state: structuredClone(author), facts: structuredClone(ledger?.facts ?? {}),
    flags: local(source.worldFlags, `gameplay.${target.id}.`), resources: local(normalizeGameplayResources(source.currentWorld ?? {}, source.gameplayResources), `gameplay.${target.id}.`) };
  while (version < (target.stateVersion ?? 1)) {
    const step = target.migrations?.find(migration => migration.from === version);
    if (!step) throw new Error(`缺少从状态版本 ${version} 开始的迁移`);
    progress = applyGameplayPatches(progress, step.patches) as typeof progress;
    version = step.to; count++;
  }
  const nativeFlags = legacyNativeFlags(previous, target, old, progress.flags);
  if (Object.keys(nativeFlags).length) { progress.flags = { ...progress.flags, ...nativeFlags }; count++; }
  const state = record(progress.state), facts = record(progress.facts), flags = record(progress.flags), resources = record(progress.resources);
  if (Object.keys(progress).some(key => !['state', 'facts', 'flags', 'resources'].includes(key)) || Object.keys(state).some(key => key.startsWith('_eidos'))) throw new Error('迁移不能写入宿主保留状态');
  if (Object.values(flags).some(value => typeof value !== 'boolean')) throw new Error('迁移后的标记须为布尔值');
  validateGameModeConfig(facts);
  const pluginState = { ...state, ...Object.fromEntries(Object.entries(old).filter(([key]) => key.startsWith('_eidos'))),
    ...(ledger ? { [GAMEPLAY_STATE_KEY]: { ...ledger, facts } } : {}) };
  if (!ledger && Object.keys(facts).length) throw new Error('无正式结果时不能由升级伪造玩法事实');
  const nextPlugins = plugins.map(plugin => plugin.id === target.id ? target : plugin), world = { ...source.currentWorld!, gameplayPlugins: nextPlugins };
  const hasAuthorState = Boolean(target.ui || target.rules.some(rule => rule.effects));
  if (!hasAuthorState && Object.keys(pluginState).length) throw new Error('新版没有作者状态，不能丢失现有进度或工作区');
  const modState = { ...source.gameplayModState }; delete modState[target.id];
  normalizeGameplayModState(world, { ...modState, ...(hasAuthorState ? { [target.id]: pluginState } : {}) });
  const prefixed = (values: Record<string, unknown>) => Object.fromEntries(Object.entries(values).map(([key, value]) => [`gameplay.${target.id}.${key}`, value]));
  const nextResources = normalizeGameplayResources(world, { ...Object.fromEntries(Object.entries(source.gameplayResources).filter(([key]) => !key.startsWith(`gameplay.${target.id}.`))), ...prefixed(resources) });
  return { target, previous, world, pluginState, hasAuthorState, flags: prefixed(flags) as Record<string, boolean>, resources: nextResources, migrationCount: count };
}
