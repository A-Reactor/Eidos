import type { WorldDefinition } from '../types';
import type { GameplayPlugin } from '../plugins/types';
import type { GameplayModState } from '../plugins/mod-ui';
import { parseGameplayPlugins, validateGameModeConfig } from '../plugins/manifest';
import { CARD_STATE_KEY, cardInitialization, scalar, validateBound } from './initialization';
import { CARD_PANEL_HTML } from './panel';
import { readVariableParts, variableRootPath } from './variable-path';
import { isRecord, type CardAsset } from './types';
export { prepareCardVariableTransition } from './variable-updates';

export interface CardLedger { assetId: string; revision: number; variables: Record<string, unknown> }
export const cardAdapterId = (assetId: string) => `card-${assetId.slice(0, 48)}`;
export function isCardAdapter(plugin: GameplayPlugin) { return plugin.data?.cardAdapter === 1; }
export function installCardAdapter(world: WorldDefinition, asset: CardAsset, publicVariables?: string[]): WorldDefinition {
  const initial = cardInitialization(asset);
  if (!initial) return world;
  if (publicVariables !== undefined) {
    validatePublicPaths(initial.variables, publicVariables);
    initial.publicVariables = publicVariables;
  }
  const id = cardAdapterId(asset.id), plugins = world.gameplayPlugins ?? [];
  const existing = plugins.find(p => p.id === id);
  if (existing) {
    if (existing.data?.cardAssetId !== asset.id || !isCardAdapter(existing)) throw new Error('卡片适配器 ID 与现有模组冲突');
    return world;
  }
  const plugin: GameplayPlugin = {
    format: 'eidos-gameplay-plugin', version: 1, id, name: `${asset.name} · 变量`, description: '原卡变量与公开面板', tags: ['card-adapter'],
    prompts: { creation: '', action: '', review: '' }, rules: [],
    data: { cardAdapter: 1, cardAssetId: asset.id, publicVariables: initial.publicVariables, variableBounds: initial.bounds },
    ui: { html: CARD_PANEL_HTML, reading: 'inherit', initialState: { [CARD_STATE_KEY]: { assetId: asset.id, revision: 0, variables: initial.variables } } },
  };
  return { ...world, gameplayPlugins: parseGameplayPlugins([...plugins, plugin]) };
}
export function cardLedger(state: GameplayModState, assetId: string): CardLedger | undefined {
  const value = state[cardAdapterId(assetId)]?.[CARD_STATE_KEY];
  return isRecord(value) ? value as unknown as CardLedger : undefined;
}
export function validateCardAdapterState(plugin: GameplayPlugin, state: Record<string, unknown>) {
  if (!isCardAdapter(plugin)) return;
  const initial = plugin.ui?.initialState?.[CARD_STATE_KEY], ledger = state[CARD_STATE_KEY];
  if (!isRecord(initial) || !isRecord(initial.variables) || !isRecord(ledger) || !isRecord(ledger.variables)
    || typeof plugin.data?.cardAssetId !== 'string' || !/^[a-f0-9]{64}$/.test(plugin.data.cardAssetId)
    || plugin.id !== cardAdapterId(plugin.data.cardAssetId) || ledger.assetId !== plugin.data.cardAssetId
    || typeof ledger.revision !== 'number' || !Number.isSafeInteger(ledger.revision) || ledger.revision < 0) throw new Error('原卡变量账本无效');
  validateGameModeConfig(ledger.variables, 32_000);
  sameShape(initial.variables, ledger.variables);
  const bounds = plugin.data.variableBounds;
  if (isRecord(bounds)) for (const [path, bound] of Object.entries(bounds)) validateBound(bound, readVariableParts(ledger.variables, variableRootPath(path)));
}
function sameShape(initial: unknown, current: unknown, depth = 0) {
  if (depth > 32 || typeof initial !== typeof current || (initial === null) !== (current === null)) throw new Error('原卡变量结构／类型不匹配');
  if (scalar(initial)) return;
  if (Array.isArray(initial) !== Array.isArray(current) || (!Array.isArray(current) && !isRecord(current))) throw new Error('原卡变量结构不匹配');
  const keys = Object.keys(initial as object), otherKeys = Object.keys(current as object);
  if (keys.length !== otherKeys.length || keys.some(k => !Object.hasOwn(current as object, k))) throw new Error('原卡变量结构不匹配');
  if (Array.isArray(initial) && initial.length === 2 && typeof initial[1] === 'string' && initial[1] !== (current as unknown[])[1]) throw new Error('原卡变量说明不可变更');
  for (const key of keys) sameShape((initial as Record<string, unknown>)[key], (current as Record<string, unknown>)[key], depth + 1);
}
export function publicCardState(plugin: GameplayPlugin, state: Record<string, unknown>): Record<string, unknown> {
  if (!isCardAdapter(plugin)) return state;
  const ledger = state[CARD_STATE_KEY];
  const paths = plugin.data?.publicVariables;
  if (!isRecord(ledger) || !Array.isArray(paths)) return { publicVariables: [] };
  const { [CARD_STATE_KEY]: _private, ...author } = state;
  return { ...author, publicVariables: paths.filter((p): p is string => typeof p === 'string').map(path => ({ path, value: readVariableParts(ledger.variables, variableRootPath(path)) })), revision: ledger.revision };
}
function validatePublicPaths(variables: Record<string, unknown>, paths: string[]) {
  if (paths.length > 32 || paths.some(path => typeof path !== 'string' || !scalar(readVariableParts(variables, variableRootPath(path))))) throw new Error('公开变量须为最多 32 个已有标量路径');
}
export function cardRuntimePrompt(assetId: string, ledger: CardLedger) {
  return `\n### 原卡当前变量 ${assetId}\nstat_data = ${JSON.stringify(ledger.variables)}\nexpectedRevision = ${ledger.revision}\n原卡 InitVar 仅为起点。遵循原文变量变更条件，只按本轮已发生的事实提出改动。使用 Eidos JSON 字段 cardVariableUpdates: [{assetId:"${assetId}",expectedRevision:${ledger.revision},changes:[{path:"已有路径",oldValue:当前标量,newValue:新标量}]}]。不输出 UpdateVariable/_.set 脚本，不在正文显示变量协议。省略未变化项，每轮最多 32 项。卡片变量属于本卡命名空间，不能代替引擎时间、库存、关系等状态字段的更新。\n`;
}
