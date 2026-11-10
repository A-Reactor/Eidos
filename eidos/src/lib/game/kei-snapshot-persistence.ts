import type { StoreApi } from 'zustand';
import type { GameStore } from '@/store/game-store';
import type { KeiReviewOrigin } from '@/lib/ai/types';
import type { WorldLineNode, WorldSnapshot } from './types';
import { isCurrentKeiReview } from './stream-lifecycle';
import { archiveScopeSessionValue, scopeStorageKey } from './archive-scope';
import { hashAndStore, batchDecrementRef } from './cas-storage';
import { loadMeta } from './storage';

const writes = new WeakMap<StoreApi<GameStore>, Promise<void>>();

function waitForAcceptedNode(store: StoreApi<GameStore>, origin: KeiReviewOrigin): Promise<WorldLineNode | null> {
  return new Promise((resolve, reject) => {
    let unsubscribe = () => {};
    const timer = setTimeout(() => { unsubscribe(); reject(new Error('审核后的行动节点尚未保存')); }, 10000);
    const check = () => {
      const s = store.getState();
      if (!isCurrentKeiReview(origin, s)) { clearTimeout(timer); unsubscribe(); resolve(null); return; }
      if (s.currentNode?.actionId === origin.actionId) {
        clearTimeout(timer); unsubscribe(); resolve(s.currentNode);
      }
    };
    unsubscribe = store.subscribe(check);
    check();
  });
}

/** Persist captured corrections to their action, without restoring them into another branch. */
export function persistKeiReviewSnapshot(store: StoreApi<GameStore>, origin: KeiReviewOrigin, snapshot: WorldSnapshot): Promise<void> {
  const captured = structuredClone(snapshot);
  const previous = writes.get(store) ?? Promise.resolve();
  // Quality and causal results can arrive together. Preserve their application order in CAS too.
  const next = previous.catch(() => {}).then(async () => {
    const node = await waitForAcceptedNode(store, origin);
    if (!node) return;
    const lineId = store.getState().worldLine?.id;
    const hash = await hashAndStore('snapshot', captured);
    const s = store.getState();
    const target = s.allNodes[node.id];
    if (s.currentWorld?.id !== origin.worldId || s.currentPlaythroughId !== origin.playthroughId ||
        archiveScopeSessionValue(s) !== origin.archiveScope || s.worldLine?.id !== lineId ||
        target?.actionId !== origin.actionId || target.parentId !== node.parentId) {
      await batchDecrementRef([hash]);
      return;
    }
    const updated = { ...target, snapshotHash: hash };
    store.setState({ allNodes: { ...s.allNodes, [node.id]: updated },
      ...(s.currentNode?.id === node.id ? { currentNode: updated } : {}) });
    await store.getState().persistWorldLineData();
    // The legacy storage API logs write errors. Verify durability before releasing the old blob.
    const saved = await loadMeta<{ nodes: Record<string, WorldLineNode> }>(scopeStorageKey(s, `worldline_data_${lineId}`));
    if (saved?.nodes[node.id]?.snapshotHash !== hash) throw new Error('审核快照未写入世界线');
    if (target.snapshotHash) await batchDecrementRef([target.snapshotHash]);
  });
  writes.set(store, next);
  return next;
}
