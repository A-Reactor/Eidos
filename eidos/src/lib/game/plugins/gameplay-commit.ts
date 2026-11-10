import type { StoreApi } from 'zustand';
import type { GameStore } from '@/store/game-store';
import type { ActionRecord } from '../types';
import { hashAndStore } from '../cas-storage';
import { createStreamRequestScope, isCurrentStreamContinuation, isPipelineBusy, type StreamRequestScope } from '../stream-lifecycle';
import { saveAcceptedActionNode, waitForAcceptedActionNodeSave, getPendingActionNodeSave, retryAcceptedActionNode } from '../action-node-commit';
import { parseGameplayPlugins } from './manifest';
import { isGameplayPluginActive } from './activation';
import { evaluateGameplayEvents } from './runtime';
import { normalizeGameplayModState } from './mod-ui';
import { authorState } from './workspace';
import { isCardAdapter } from '../cards/adapter';
import { GAMEPLAY_STATE_KEY, gameplayLedger, parseGameplayOperation, type GameplayReceipt } from './gameplay-state';
import { applyGameplayRuleEffects } from './rule-effects';
import { record, text } from './validation';
import { getPresentedText } from '../player-reading';

const queues = new WeakMap<object, Promise<unknown>>();
export type GameplayCommitResult = GameplayReceipt & { nodeId?: string; persistence: 'saved' | 'pending' };
function requireScope(store: StoreApi<GameStore>, scope: StreamRequestScope) {
  if (!isCurrentStreamContinuation(scope, store.getState())) throw new Error('玩法操作的世界或分支已变化');
}

async function commit(store: StoreApi<GameStore>, pluginId: string, raw: unknown, scope: StreamRequestScope): Promise<GameplayCommitResult> {
  requireScope(store, scope);
  const operation = parseGameplayOperation(raw);
  const initial = store.getState(), previous = initial.gameplayModState[pluginId] ?? {};
  const ledger = gameplayLedger(previous);
  if (ledger?.last.id === operation.id) {
    if (getPendingActionNodeSave(store)?.phase === 'failed') await retryAcceptedActionNode(store);
    return { ...ledger.last, nodeId: store.getState().currentNode?.id, persistence: 'saved' };
  }
  const writing = waitForAcceptedActionNodeSave(store.getState);
  if (writing) { await writing; requireScope(store, scope); }
  // The shared retry slot must keep the already accepted checkpoint until it is durable.
  if (getPendingActionNodeSave(store)?.phase === 'failed') throw new Error('请先重试保存已确认的结果，再继续玩法');
  if (isPipelineBusy()) throw new Error('请等待当前剧情或关键核对完成后再提交玩法');
  const plugin = parseGameplayPlugins(initial.currentWorld?.gameplayPlugins).find(p => p.id === pluginId);
  if (!plugin?.ui || isCardAdapter(plugin) || !isGameplayPluginActive(plugin, initial.worldFlags, initial.currentSceneId)) throw new Error('当前模组不能提交玩法结果');
  if (operation.expectedRevision !== (ledger?.revision ?? 0)) throw new Error('玩法版本已变化，请使用最新进度重试');
  if (operation.events && (!Array.isArray(operation.events) || operation.events.some(e => e?.pluginId !== pluginId))) throw new Error('模组只能提交自己声明的规则');
  // Save the actual pre-action root so the first local operation is rewindable too.
  const before = initial.createSnapshot(), parent = initial.currentNode;
  if (!parent) throw new Error('请先进入当前世界再提交玩法');
  if (!parent.snapshotHash) {
    const snapshotHash = await hashAndStore('snapshot', before);
    requireScope(store, scope);
    const segmentHash = !parent.segmentHash && initial.savedSegments.length ? await hashAndStore('segments', initial.savedSegments) : parent.segmentHash;
    requireScope(store, scope);
    const live = store.getState();
    store.setState({ allNodes: { ...live.allNodes, [parent.id]: { ...live.allNodes[parent.id], snapshotHash, segmentHash } } });
  }
  requireScope(store, scope);
  const live = store.getState();
  if (isPipelineBusy() || (gameplayLedger(live.gameplayModState[pluginId] ?? {})?.revision ?? 0) !== operation.expectedRevision) throw new Error('玩法版本或当前操作已变化');
  const active = parseGameplayPlugins(live.currentWorld?.gameplayPlugins).find(p => p.id === pluginId);
  if (!active?.ui || isCardAdapter(active) || !isGameplayPluginActive(active, live.worldFlags, live.currentSceneId)) throw new Error('当前模组不能提交玩法结果');
  const transition = evaluateGameplayEvents(live.currentWorld ?? {}, live.worldFlags, live.gameplayResources, operation.events);
  const receipt: GameplayReceipt = { id: operation.id, revision: operation.expectedRevision + 1, summary: operation.summary, createdAt: Date.now(), narration: operation.narrate === false ? 'none' : 'pending' };
  const nextState = { ...authorState(live.gameplayModState[pluginId] ?? {}, operation.state), [GAMEPLAY_STATE_KEY]: { revision: receipt.revision, facts: operation.facts, last: receipt } };
  const gameplayModState = normalizeGameplayModState(live.currentWorld ?? {}, { ...live.gameplayModState, [pluginId]: nextState });
  const segments = operation.segments ?? [{ type: 'narration' as const, text: operation.summary }];
  const prose = getPresentedText(segments, 0, false, '', true);
  const record: ActionRecord = { id: `gameplay:${pluginId}:${operation.id}`, timestamp: receipt.createdAt, gameTime: { ...live.gameTime },
    sceneId: live.currentSceneId, sceneName: live.currentScene?.name ?? '', playerInput: operation.playerInput ?? `【${plugin.name}】${operation.summary}`, aiResponse: prose,
    summary: operation.summary, timeSpent: { day: 0, hour: 0, minute: 0 }, worldImpacts: [], availableActions: live.availableActions, snapshot: before };
  // One synchronous store update is the acceptance boundary; model generation has no part in it.
  store.setState({ gameplayModState, worldFlags: { ...live.worldFlags, ...transition.flags }, gameplayResources: transition.resources,
    history: [...live.history, record], sceneNarrative: prose, savedSegments: segments, savedSegmentIndex: 0, savedIsShowingSegments: true });
  const origin = { worldId: scope.worldId, playthroughId: scope.playthroughId, worldLineId: scope.worldLineId, archiveScope: scope.archiveScope, parentNodeId: scope.nodeId, actionId: record.id };
  try {
    const node = await saveAcceptedActionNode(store, origin, record, segments, { reuseExisting: false });
    const after = store.getState();
    if (!node || !isCurrentStreamContinuation({ ...scope, nodeId: node.id }, after)) throw new Error('玩法已保存在原分支，当前分支已变化');
    return { ...receipt, nodeId: node.id, persistence: 'saved' };
  } catch (error) {
    // Accepted local facts survive a disk failure; the shared save banner offers a write-only retry.
    if (getPendingActionNodeSave(store)?.phase === 'failed') return { ...receipt, persistence: 'pending' };
    throw error;
  }
}
/** Serialize across every surface. The original node scope is captured before joining the queue. */
export function commitGameplayOperation(store: StoreApi<GameStore>, pluginId: string, operation: unknown, scope = createStreamRequestScope(store.getState())): Promise<GameplayCommitResult> {
  return enqueueGameplayChange(store, () => commit(store, pluginId, operation, scope));
}
export function enqueueGameplayChange<T>(store: StoreApi<GameStore>, run: () => Promise<T>) {
  const prior = queues.get(store.getState) ?? Promise.resolve();
  const work = prior.catch(() => undefined).then(run);
  queues.set(store.getState, work);
  void work.finally(() => { if (queues.get(store.getState) === work) queues.delete(store.getState); }).catch(() => undefined);
  return work;
}
/** Buttons and model pluginEvents share the same declared rule and author-state preparation. */
export function commitGameplayRule(store: StoreApi<GameStore>, pluginId: string, raw: unknown, scope = createStreamRequestScope(store.getState())): Promise<GameplayCommitResult> {
  return enqueueGameplayChange(store, async () => {
    requireScope(store, scope);
    const params = record(raw), state = store.getState(), current = state.gameplayModState[pluginId] ?? {};
    const id = params.id === undefined ? crypto.randomUUID() : text(params.id, 160), ruleId = text(params.ruleId, 64), ledger = gameplayLedger(current);
    const plugin = parseGameplayPlugins(state.currentWorld?.gameplayPlugins).find(p => p.id === pluginId), rule = plugin?.rules.find(r => r.id === ruleId);
    if (!rule) throw new Error('玩法规则不存在');
    if (ledger?.last.id === id) return commit(store, pluginId, { id, expectedRevision: params.expectedRevision ?? ledger.revision, summary: rule.description }, scope);
    if (rule.once && state.worldFlags[`gameplay.${pluginId}.done:${ruleId}`]) throw new Error('这项玩法结果已经确认');
    const events = [{ pluginId, ruleId }];
    evaluateGameplayEvents(state.currentWorld ?? {}, state.worldFlags, state.gameplayResources, events);
    const prepared = applyGameplayRuleEffects({ world: state.currentWorld ?? {}, state: state.gameplayModState, flags: state.worldFlags, events, receiptId: id, createdAt: Date.now(), sceneId: state.currentSceneId });
    const next = prepared[pluginId] ?? current;
    const authored = plugin?.ui?.presentation === 'native' ? plugin.ui.actions?.find(action => action.ruleId === ruleId)?.segments : undefined;
    const label = plugin?.ui?.presentation === 'native' ? plugin.ui.actions?.find(action => action.ruleId === ruleId)?.label : undefined;
    return commit(store, pluginId, { id, expectedRevision: params.expectedRevision ?? ledger?.revision ?? 0, summary: rule.description, state: next,
      facts: gameplayLedger(next)?.facts ?? ledger?.facts ?? {}, events, narrate: params.narrate, ...(authored ? { segments: authored } : {}), ...(label ? { playerInput: label } : {}) }, scope);
  });
}
