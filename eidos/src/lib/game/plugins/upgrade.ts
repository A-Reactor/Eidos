import type { StoreApi } from 'zustand';
import type { GameStore } from '@/store/game-store';
import { computeContentHash } from '../cas-storage';
import { createStreamRequestScope, isCurrentStreamContinuation, isPipelineBusy } from '../stream-lifecycle';
import { getPendingActionNodeSave, waitForAcceptedActionNodeSave } from '../action-node-commit';
import { enqueueGameplayChange } from './gameplay-commit';
import { migratePluginProgress, upgradeIdentity } from './upgrade-progress';
import { normalizeGameplayModState } from './mod-ui';
import { normalizeGameplayResources } from './resources';
import { parseGameplayPlugins } from './manifest';
import { stableRecordJSON } from '@/lib/ai/prompt-layout';
import { persistPluginUpgrade } from './upgrade-storage';

export async function previewPluginUpgrade(store: StoreApi<GameStore>, incoming: unknown) {
  const source = store.getState(), prepared = migratePluginProgress(source, incoming);
  const initial = await computeContentHash(parseGameplayPlugins(source.currentWorld?.gameplayPlugins));
  const current = await computeContentHash(prepared.world.gameplayPlugins);
  return { ...prepared, scope: createStreamRequestScope(source), base: upgradeIdentity(source, prepared.target.id),
    history: { initial: source.currentWorld?.gameplayPluginHistory?.initial ?? initial, current,
      packages: { ...source.currentWorld?.gameplayPluginHistory?.packages, [initial]: parseGameplayPlugins(source.currentWorld?.gameplayPlugins), [current]: prepared.world.gameplayPlugins! } } };
}
export type PluginUpgradePreview = Awaited<ReturnType<typeof previewPluginUpgrade>>;
function requireCurrent(store: StoreApi<GameStore>, preview: PluginUpgradePreview) {
  const source = store.getState();
  if (!isCurrentStreamContinuation(preview.scope, source) || upgradeIdentity(source, preview.target.id) !== preview.base) throw new Error('世界、分支或模组进度已变化，请重新预览更新');
  if (isPipelineBusy()) throw new Error('请等待当前剧情或关键核对完成后再更新模组');
  if (getPendingActionNodeSave(store)?.phase === 'failed') throw new Error('请先保存已确认的结果，再更新模组');
}
/** Host-only opt-in operation. Migrations never execute author JavaScript or gameplay events. */
export function applyPluginUpgrade(store: StoreApi<GameStore>, preview: PluginUpgradePreview) {
  return enqueueGameplayChange(store, async () => {
    requireCurrent(store, preview);
    const writing = waitForAcceptedActionNodeSave(store.getState);
    if (writing) { await writing; requireCurrent(store, preview); }
    const live = store.getState(), next = migratePluginProgress(live, preview.target);
    // Recompute against current progress; a modified UI preview cannot substitute its state.
    if (stableRecordJSON(next.pluginState) !== stableRecordJSON(preview.pluginState)) throw new Error('迁移预览已变化，请重新预览');
    const world = { ...live.currentWorld!, gameplayPlugins: next.world.gameplayPlugins, gameplayPluginHistory: preview.history };
    const modState = { ...live.gameplayModState }; delete modState[next.target.id];
    const patch={currentWorld:world,
      gameplayModState:normalizeGameplayModState(world,{...modState,...(next.hasAuthorState ? {[next.target.id]:next.pluginState} : {})}),
      gameplayResources:normalizeGameplayResources(world,next.resources),
      worldFlags:{...Object.fromEntries(Object.entries(live.worldFlags).filter(([key])=>!key.startsWith(`gameplay.${next.target.id}.`))),...next.flags}};
    const snapshot={...live.createSnapshot(),gameplayModState:patch.gameplayModState,gameplayResources:patch.gameplayResources,worldFlags:patch.worldFlags,gameplayPluginSet:preview.history.current};
    const nodeId=await persistPluginUpgrade({store,patch,snapshot,history:preview.history,assertCurrent:()=>requireCurrent(store,preview)});
    return {persistence:'saved' as const,nodeId};
  });
}
