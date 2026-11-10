import type { WorldDefinition } from '../types';
import type { GameplayModState } from '../plugins/mod-ui';
import { cardAdapterId, cardLedger, isCardAdapter, validateCardAdapterState } from './adapter';
import { CARD_STATE_KEY, mutableVariable, scalar, validateBound } from './initialization';
import { readVariableParts, variableRootPath } from './variable-path';
import { isRecord } from './types';

export interface CardVariableUpdate { assetId: string; expectedRevision: number; changes: Array<{ path: string; oldValue: unknown; newValue: unknown }> }
type Mode = 'action' | 'rejected' | 'introspection' | 'cutaway' | 'speculation';
export function prepareCardVariableTransition(input: {
  world: Pick<WorldDefinition, 'cardBindings' | 'gameplayPlugins'>; state: GameplayModState; updates?: unknown; mode: Mode; activeAssetIds?: string[];
}): GameplayModState {
  if (input.mode !== 'action' || input.updates === undefined || Array.isArray(input.updates) && input.updates.length === 0) return input.state;
  if (!Array.isArray(input.updates) || input.updates.length > 16) throw new Error('卡片变量提案须为最多 16 个卡片');
  const next = structuredClone(input.state), seen = new Set<string>(); let count = 0;
  for (const update of input.updates) {
    if (!isRecord(update) || typeof update.assetId !== 'string' || seen.has(update.assetId)
      || !input.world.cardBindings?.some(b => b.enabled && b.assetId === update.assetId)
      || (input.activeAssetIds && !input.activeAssetIds.includes(update.assetId))) throw new Error('卡片变量提案引用未激活或重复的卡片');
    const assetId = update.assetId;
    seen.add(assetId);
    const plugin = input.world.gameplayPlugins?.find(p => p.id === cardAdapterId(assetId));
    const ledger = cardLedger(next, assetId);
    if (!plugin || !isCardAdapter(plugin) || !ledger) throw new Error('卡片尚未安装变量适配器，请重新挂载');
    validateCardAdapterState(plugin, next[plugin.id]);
    if (update.expectedRevision !== ledger.revision || ledger.revision >= Number.MAX_SAFE_INTEGER) throw new Error('卡片变量提案版本过期');
    if (!Array.isArray(update.changes) || !update.changes.length || (count += update.changes.length) > 32) throw new Error('卡片变量每轮须为 1–32 项');
    const paths = new Set<string>();
    for (const change of update.changes) applyChange(ledger.variables, change, paths, plugin.data?.variableBounds);
    next[plugin.id][CARD_STATE_KEY] = { ...ledger, revision: ledger.revision + 1 };
    validateCardAdapterState(plugin, next[plugin.id]);
  }
  return next;
}
function applyChange(variables: Record<string, unknown>, change: unknown, paths: Set<string>, bounds: unknown) {
  if (!isRecord(change) || typeof change.path !== 'string' || !scalar(change.oldValue) || !scalar(change.newValue)) throw new Error('卡片变量变更格式无效');
  const parts = variableRootPath(change.path), canonical = JSON.stringify(parts);
  if (paths.has(canonical) || !mutableVariable(variables, change.path)) throw new Error('变量路径不存在、重复或指向说明');
  paths.add(canonical);
  const oldValue = readVariableParts(variables, parts);
  if (oldValue !== change.oldValue) throw new Error('卡片变量旧值过期');
  if (typeof change.newValue !== typeof oldValue || (oldValue === null) !== (change.newValue === null)
    || (typeof change.newValue === 'number' && !Number.isFinite(change.newValue))
    || (typeof change.newValue === 'string' && change.newValue.length > 8000)) throw new Error('卡片变量类型或长度无效');
  if (isRecord(bounds)) for (const [path, bound] of Object.entries(bounds)) if (JSON.stringify(variableRootPath(path)) === canonical) validateBound(bound, change.newValue);
  let parent: unknown = variables;
  for (const key of parts.slice(0, -1)) parent = (parent as Record<string, unknown>)[key];
  (parent as Record<string, unknown>)[parts.at(-1)!] = change.newValue;
}
