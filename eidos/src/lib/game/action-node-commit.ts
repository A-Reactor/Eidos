import { mergeWorkspaceBranchAt, waitForWorkspaceBranchMerge } from './workspace/branch';
import { finalizeActionArtifacts, type PreparedActionArtifacts } from './documents/action-artifacts';
import type { StoreApi } from 'zustand';
import type { GameStore } from '@/store/game-store';
import type { KeiReviewOrigin, StorySegment } from '@/lib/ai/types';
import type { ActionRecord, WorldLineNode, WorldSnapshot } from './types';
import { isCurrentKeiReview } from './stream-lifecycle';

interface PendingCommit { snapshot:WorldSnapshot; origin: KeiReviewOrigin; action: ActionRecord; segments: StorySegment[]; phase: 'saving' | 'failed'; options?: Parameters<GameStore['addActionNode']>[3]; artifacts?: PreparedActionArtifacts }
const writes = new WeakMap<object, Promise<WorldLineNode | null>>();
const pending = new WeakMap<StoreApi<GameStore>, PendingCommit>();
const listeners = new WeakMap<StoreApi<GameStore>, Set<() => void>>();
function notify(store: StoreApi<GameStore>) { listeners.get(store)?.forEach(cb => cb()); }
export function subscribeActionNodeSave(store: StoreApi<GameStore>, callback: () => void): () => void {
  const set = listeners.get(store) ?? new Set(); listeners.set(store, set); set.add(callback);
  return () => { set.delete(callback); };
}
export function getPendingActionNodeSave(store: StoreApi<GameStore>): PendingCommit | null {
  const entry = pending.get(store);
  if (!entry) return null;
  if (!isCurrentKeiReview(entry.origin, store.getState())) { pending.delete(store); return null; }
  return entry;
}
async function save(store: StoreApi<GameStore>, entry: PendingCommit): Promise<WorldLineNode | null> {
  entry.phase = 'saving'; notify(store);
  try {
    const state = store.getState();
    const node = state.currentNode?.actionId === entry.action.id ? state.currentNode : await state.addActionNode(entry.action, entry.snapshot, entry.segments, entry.options);
    if (node && entry.artifacts) await finalizeActionArtifacts(entry.artifacts, node);
    if (node?.workspaceBranch) await mergeWorkspaceBranchAt(store, node.id, 0);
    if (pending.get(store) === entry) pending.delete(store);
    return node?.workspaceBranch ? store.getState().currentNode : node;
  } catch (error) {
    if (pending.get(store) === entry) entry.phase = 'failed';
    throw error;
  } finally { notify(store); }
}
function startSave(store: StoreApi<GameStore>, entry: PendingCommit) {
  const work = save(store, entry), key = store.getState;
  writes.set(key, work);
  const clear = () => { if (writes.get(key) === work) writes.delete(key); };
  void work.then(clear, clear);
  return work;
}
/** A rewind must not race the accepted action's local CAS commit. This performs no generation. */
export function waitForAcceptedActionNodeSave(stateReader: object): Promise<WorldLineNode | null> | null {
  return writes.get(stateReader) ?? waitForWorkspaceBranchMerge(stateReader)?.then(() => null) ?? null;
}
/** Retain accepted prose across mounts so failed local writes can be retried without regenerating. */
export function saveAcceptedActionNode(store: StoreApi<GameStore>, origin: KeiReviewOrigin, action: ActionRecord, segments: StorySegment[], options?: PendingCommit['options'], artifacts?: PreparedActionArtifacts): Promise<WorldLineNode | null> {
  const entry: PendingCommit = { snapshot:structuredClone(store.getState().createSnapshot()), origin, action, segments:structuredClone(segments), phase: 'saving', options, artifacts }; pending.set(store, entry);
  return startSave(store, entry);
}
export function retryAcceptedActionNode(store: StoreApi<GameStore>): Promise<WorldLineNode | null> {
  const entry = getPendingActionNodeSave(store);
  return entry?.phase === 'failed' ? startSave(store, entry) : Promise.resolve(null);
}
