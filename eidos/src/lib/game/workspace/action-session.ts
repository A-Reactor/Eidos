import { mountSceneMapFiles, sceneMapInputRevision } from '../plugins/scene-map-files';
import { mountImageWorkspace } from '../midori/workspace-images';
import { quickHash } from '../cas-storage';
import { getSandboxDossierId } from '../archive-scope';
import { workspaceOf } from '../plugins/workspace';
import { isGameplayPluginActive } from '../plugins/activation';
import { parseGameplayPlugins } from '../plugins/manifest';
import { normalizeMetaChannelManifest } from '@/lib/meta-reality/manifest-editor';
import type { GameStore } from '@/store/game-store';
import { currentDocumentScope } from '../model-documents';
import { loadDocuments } from '../documents/repository';
import type { DocumentLink, DocumentRef } from '../documents/types';
import { getPlayerVisibleText, getReadingPath } from '../player-reading';
import type { StreamRequestScope } from '../stream-lifecycle';
import { createWorkspaceSession, registerWorkspaceSession } from './session';

/** The current library is readable; explicit selection supplies emphasis and per-version write grants. */
export async function createActionWorkspace(state: GameStore, refs: readonly DocumentRef[], scope: StreamRequestScope, isCurrent: () => boolean, actionId = crypto.randomUUID(), readState: () => GameStore = () => state) {
  const documentScope = currentDocumentScope(state);
  if (!documentScope) return null;
  const catalog = await loadDocuments(documentScope, state.documentHeads);
  const library = catalog.filter(doc => !doc.referenceError).map(doc => ({ documentId: doc.id, revision: doc.currentRevision, title: doc.title }));
  const known = new Map<string, DocumentLink>();
  for (const node of getReadingPath(state.allNodes, state.currentNode?.id ?? null)) {
    if (!getPlayerVisibleText(node) || !node.generationComplete) continue;
    const linked = node as typeof node & { inputDocuments?: DocumentLink[]; outputDocuments?: DocumentLink[] };
    for (const link of [...linked.inputDocuments ?? [], ...mergedOutputDocuments(node)]) known.set(`${link.documentId}:${link.revision}`, link);
  }
  if (refs.length) {
    const docs = catalog;
    for (const ref of refs) {
      const doc = docs.find(d => d.id === ref.documentId);
      if (!doc?.versions[ref.revision]) throw new Error('引用文档已失效，请重新选择');
      known.set(`${ref.documentId}:${ref.revision}`, { ...ref, title: doc.title });
    }
  }
  if (!isCurrent()) throw new DOMException('行动已取消或归属发生变化', 'AbortError');
  const manifest = state.metaChannelManifest ? normalizeMetaChannelManifest(state.metaChannelManifest) : null;
  const mountIds = new Set(manifest?.channels.flatMap(c => c.workspaceGrants?.map(g => g.mountId) ?? []) ?? []);
  const metaMounts = parseGameplayPlugins(state.currentWorld?.gameplayPlugins).filter(p => mountIds.has(p.id) && isGameplayPluginActive(p, state.worldFlags, state.currentSceneId)).map(p => ({
    id: p.id, files: structuredClone(workspaceOf(state.gameplayModState[p.id] ?? {}).files),
    currentFiles: () => workspaceOf(readState().gameplayModState[p.id] ?? {}).files,
  }));
  const grants = refs as readonly DocumentLink[];
  // An explicit read-only choice must override sandbox002's default for this exact version.
  const readOnly = new Set(grants.filter(ref => ref.allowWrite === false).map(ref => `${ref.documentId}:${ref.revision}`));
  const writableDocuments = state.sandboxMode && getSandboxDossierId(state.sandboxDossierId) === '002'
    ? library.filter(ref => !readOnly.has(`${ref.documentId}:${ref.revision}`)) : grants.filter(ref => ref.allowWrite);
  const session = await createWorkspaceSession({ scope: documentScope, actionId, parentNodeId: state.currentNode?.id ?? scope.nodeId,
    inputs: [...known.values()], library, writableDocuments, branchFiles: readableWorkspaceFiles(state), metaMounts, manifest, currentManifest: () => readState().metaChannelManifest, isCurrent });
  if (!isCurrent()) throw new DOMException('行动已取消或归属发生变化', 'AbortError');
  session.actionInputs = refs.map(ref => known.get(`${ref.documentId}:${ref.revision}`)!);
  await mountSceneMapFiles(session, state);
  await mountImageWorkspace(session, state);
  session.inputRevision = workspaceInputRevision(state);
  session.previousEffects = getReadingPath(state.allNodes, state.currentNode?.id ?? null).flatMap(node => {
    const failure = node.workspaceBranch?.mergeFailure;
    return (node.workspaceEffects ?? node.workspaceBranch?.effects ?? []).map(effect => failure && effect.segmentIndex !== undefined && effect.segmentIndex >= failure.segmentIndex
      ? { ...effect, status: 'failed' as const, error: `本地合并未完成：${failure.message}` } : effect);
  }).slice(-8);
  session.actionInputs = refs.map(ref => known.get(`${ref.documentId}:${ref.revision}`)!);
  registerWorkspaceSession(scope.requestId, session);
  return session;
}

/** Library heads and role grants invalidate candidates when their readable context changes. */
export function workspaceInputRevision(state: GameStore): string {
  const entries = new Set<string>((state.documentHeads ?? []).map(ref => `library:${ref.documentId}:${ref.revision}`));
  if (Object.keys(state.midoriAssetRegistry.bindings).length || Object.keys(state.midoriAssetRegistry.images ?? {}).length) entries.add(`images:${quickHash(state.midoriAssetRegistry)}`);
  const sceneMaps = sceneMapInputRevision(state);
  if (sceneMaps !== '[]') entries.add(`maps:${sceneMaps}`);
  for (const node of getReadingPath(state.allNodes, state.currentNode?.id ?? null)) {
    if (!getPlayerVisibleText(node) || !node.generationComplete) continue;
    for (const link of [...node.inputDocuments ?? [], ...mergedOutputDocuments(node)]) entries.add(`input:${link.documentId}:${link.revision}`);
  }
  for (const [path, ref] of Object.entries(readableWorkspaceFiles(state))) entries.add(`${path}:${ref.id}`);
  const manifest = state.metaChannelManifest;
  const active = parseGameplayPlugins(state.currentWorld?.gameplayPlugins).filter(p => isGameplayPluginActive(p, state.worldFlags, state.currentSceneId));
  for (const channel of manifest?.channels ?? []) for (const grant of channel.workspaceGrants ?? []) {
    if (!active.some(p => p.id === grant.mountId)) continue;
    const actors = grant.npcIds.filter(id => channel.allowedConsumers.includes(id));
    if (!actors.length) continue;
    entries.add(JSON.stringify([channel.id, grant.mountId, grant.pathPrefix, [...actors].sort(), [...grant.operations].sort()]));
    for (const [path, ref] of Object.entries(workspaceOf(state.gameplayModState[grant.mountId] ?? {}).files)) {
      if (path === grant.pathPrefix || path.startsWith(`${grant.pathPrefix}/`)) entries.add(`meta/${grant.mountId}/${path}:${ref.id}`);
    }
  }
  return entries.size ? JSON.stringify([...entries].sort()) : '';
}

export function readableWorkspaceFiles(state: GameStore): import('./types').WorkspaceFiles {
  const actions = new Set(getReadingPath(state.allNodes, state.currentNode?.id ?? null).filter(node => node.generationComplete && getPlayerVisibleText(node)).map(node => node.actionId).filter(Boolean));
  return Object.fromEntries(Object.entries(state.workspaceState ?? {}).filter(([path]) => path.startsWith('outputs/') && actions.has(path.split('/')[1])));
}

function mergedOutputDocuments(node: import('../types').WorldLineNode): DocumentLink[] {
  return (node.outputDocuments ?? []).filter(link => !node.workspaceBranch || node.workspaceBranch.documents.some(change => change.link.documentId === link.documentId && change.link.revision === link.revision && change.segmentIndex <= node.workspaceBranch!.mergedThrough));
}
