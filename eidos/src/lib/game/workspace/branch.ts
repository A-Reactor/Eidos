import { isGameplayPluginActive } from '../plugins/activation';
import { parseGameplayPlugins } from '../plugins/manifest';
import type { StoreApi } from 'zustand';
import type { GameStore } from '@/store/game-store';
import type { DocumentScope } from '../documents/types';
import { mergeBranchDocuments, notifyDocuments, type BranchDocumentChange } from '../documents/repository';
import type { WorkspaceFiles, WorkspaceToolResult } from './types';
import { checkMetaWorkspaceAccess, applyMetaWorkspaceEffects } from '@/lib/meta-reality/workspace-bridge';
import { hashAndStore } from '../cas-storage';
import { documentScopeKey, currentDocumentScope } from '../model-documents';
import { updateWorkspaceNode } from './branch-state';
import type { DocumentLink } from '../documents/types';
import { projectImageChanges, persistImageProjection, type WorkspaceImageChange } from '../midori/workspace-images';

export interface WorkspaceMergeFailure { segmentIndex: number; message: string; phase: 'merge' | 'save'; occurredAt: number }
export interface WorkspaceResolution {
  id: string; segmentIndex: number; kind: 'candidate' | 'manual'; createdAt: number;
  base: DocumentLink | null; current: DocumentLink | null; candidate: DocumentLink; result: DocumentLink;
}

export interface WorkspaceBranch {
  images?: WorkspaceImageChange[];
  id: string; scope: DocumentScope; baseNodeId: string | null;
  documents: BranchDocumentChange[]; effects: Array<WorkspaceToolResult & { segmentIndex: number }>;
  outputs: Array<{ path: string; resource: WorkspaceFiles[string]; segmentIndex: number }>;
  attempts?: Array<WorkspaceToolResult & { segmentIndex: number }>;
  mergedThrough: number;
  mergeFailure?: WorkspaceMergeFailure;
  resolutions?: WorkspaceResolution[];
}
const jobs = new WeakMap<object, Promise<void>>();
/** Serializes playback merges; a candidate never becomes the active file mapping by generation alone. */
export function mergeWorkspaceBranchAt(store: StoreApi<GameStore>, nodeId: string, segmentIndex: number): Promise<void> {
  const previous = jobs.get(store.getState) ?? Promise.resolve();
  const job = previous.catch(() => {}).then(() => merge(store, nodeId, segmentIndex)).catch(async error => {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    const live = store.getState(), node = live.allNodes[nodeId], branch = node?.workspaceBranch;
    if (live.currentNode?.id === nodeId && branch) {
      const message = error instanceof Error ? error.message : '文件合并失败';
      updateWorkspaceNode(store, { ...node, workspaceBranch: { ...branch, mergeFailure: { segmentIndex, message, phase: branch.mergedThrough >= segmentIndex ? 'save' : 'merge', occurredAt: Date.now() } } });
      try { await store.getState().persistWorldLineData(); } catch (saveError) { console.warn('文件失败回执尚未保存', saveError); }
    }
    throw error;
  });
  jobs.set(store.getState, job);
  void job.finally(() => { if (jobs.get(store.getState) === job) jobs.delete(store.getState); }).catch(() => {});
  return job;
}
function validateMetaEffects(live: GameStore, branch: WorkspaceBranch, meta: WorkspaceToolResult[]) {
  const metaFiles: Record<string, WorkspaceFiles> = {};
  for (const receipt of meta) {
    const [, mountId, ...path] = receipt.path!.split('/');
    if (!parseGameplayPlugins(live.currentWorld?.gameplayPlugins).some(plugin => plugin.id === mountId && isGameplayPluginActive(plugin, live.worldFlags, live.currentSceneId))) throw new Error('角色文件挂载已停用，未合并文件');
    if (!checkMetaWorkspaceAccess({ manifest: live.metaChannelManifest, actor: receipt.actor!, mountId, path: path.join('/'), operation: 'write' }).allowed) throw new Error('角色文件权限已变化，未合并文件');
    metaFiles[mountId] ??= {};
  }
  return applyMetaWorkspaceEffects(live.gameplayModState, { actionId: branch.id, files: metaFiles, receipts: meta.map(r => ({ ...r, status: 'committed' })) });
}
async function merge(store: StoreApi<GameStore>, nodeId: string, segmentIndex: number): Promise<void> {
  let state = store.getState();
  const node = state.allNodes[nodeId], branch = node?.workspaceBranch;
  if (!branch) return;
  const current = () => { const live = store.getState(), scope = currentDocumentScope(live); return Boolean(live.currentNode?.id === nodeId && scope && documentScopeKey(scope) === documentScopeKey(branch.scope)); };
  if (!current()) throw new DOMException('文件分支不属于当前播放节点', 'AbortError');
  if (branch.mergedThrough >= segmentIndex) {
    if (branch.mergeFailure?.phase === 'save' && branch.mergeFailure.segmentIndex <= segmentIndex) updateWorkspaceNode(store, { ...node, workspaceBranch: { ...branch, mergeFailure: undefined } });
    await store.getState().persistWorldLineData(); return;
  }
  const changes = branch.documents.filter(d => d.segmentIndex > branch.mergedThrough && d.segmentIndex <= segmentIndex);
  const receipts = branch.effects.filter(r => r.segmentIndex > branch.mergedThrough && r.segmentIndex <= segmentIndex);
  const meta = receipts.filter(r => r.actor?.kind === 'character');
  const imageChanges = (branch.images ?? []).filter(change => change.segmentIndex > branch.mergedThrough && change.segmentIndex <= segmentIndex);
  const imageBaseRegistry = state.midoriAssetRegistry;
  const midoriAssetRegistry = imageChanges.length ? await projectImageChanges(state, imageChanges, current) : state.midoriAssetRegistry;
  validateMetaEffects(state, branch, meta);
  const heads = changes.length ? await mergeBranchDocuments(branch.scope, changes, state.documentHeads) : state.documentHeads;
  if (!current()) throw new DOMException('文件合并期间播放节点已变化', 'AbortError');
  if (store.getState().documentHeads !== state.documentHeads) throw new Error('文件版本在合并期间变化，请重新播放');
  if (imageChanges.length && store.getState().midoriAssetRegistry !== imageBaseRegistry) throw new Error('图像库在合并期间变化，请重试播放');
  state = store.getState();
  const gameplayModState = validateMetaEffects(state, branch, meta);
  const workspaceState = { ...state.workspaceState };
  for (const output of branch.outputs) if (output.segmentIndex <= segmentIndex) workspaceState[output.path] = output.resource;
  for (const image of branch.images ?? []) if (image.segmentIndex <= segmentIndex) workspaceState[image.path] = image.resource;
  const updated = { ...store.getState().allNodes[nodeId], workspaceBranch: { ...branch, mergeFailure: branch.mergeFailure && branch.mergeFailure.segmentIndex > segmentIndex ? branch.mergeFailure : undefined, mergedThrough: segmentIndex }, workspaceEffects: [...branch.effects.map(r => ({ ...r, status: r.segmentIndex <= segmentIndex ? 'committed' as const : 'staged' as const, nodeId })), ...branch.attempts ?? []] };
  // Prepare the durable node before exposing its new projection in memory.
  const snapshot = { ...state.createSnapshot(), documentHeads: heads, gameplayModState, workspaceState, ...(imageChanges.length ? { midoriAssetRegistry } : {}) };
  updated.snapshotHash = await hashAndStore('snapshot', snapshot);
  if (!current()) throw new DOMException('文件合并期间播放节点已变化', 'AbortError');
  if (store.getState().gameplayModState !== state.gameplayModState || store.getState().documentHeads !== state.documentHeads) throw new Error('文件合并期间状态已变化，请重试播放');
  if (imageChanges.length && store.getState().midoriAssetRegistry !== state.midoriAssetRegistry) throw new Error('图像库在合并期间变化，请重试播放');
  if (imageChanges.length) await persistImageProjection(state, midoriAssetRegistry);
  if (!current()) throw new DOMException('图像合并期间播放节点已变化', 'AbortError');
  const committed = { ...store.getState().allNodes[nodeId], snapshotHash: updated.snapshotHash, workspaceBranch: updated.workspaceBranch, workspaceEffects: updated.workspaceEffects };
  store.setState({ documentHeads: heads, gameplayModState, workspaceState, ...(imageChanges.length ? { midoriAssetRegistry, midoriAssetRevision: state.midoriAssetRevision + 1 } : {}), currentNode: committed,
    allNodes: { ...store.getState().allNodes, [nodeId]: committed },
    history: store.getState().history.map(action => action.id === branch.id ? { ...action, workspaceBranch: updated.workspaceBranch, workspaceEffects: updated.workspaceEffects } : action) });
  await store.getState().persistWorldLineData();
  notifyDocuments(branch.scope);
}

export function waitForWorkspaceBranchMerge(stateReader: object): Promise<void> | undefined { return jobs.get(stateReader); }
