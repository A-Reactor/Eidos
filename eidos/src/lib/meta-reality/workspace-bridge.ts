import type { MetaChannelManifest } from './types';
import type { WorkspaceActor, WorkspaceFiles, WorkspaceToolRequest, WorkspaceToolResult } from '../game/workspace/types';
import type { WorkspaceSession } from '../game/workspace/session';
import { filePath, withinPath } from '../game/workspace/paths';
import { runFileOperation } from '../game/workspace/operations';
import { workspaceOf, WORKSPACE_KEY } from '../game/plugins/workspace';
import type { GameplayModState } from '../game/plugins/mod-ui';
import { ACTION_TOOL_LIMITS } from '../game/action-tool-budget';

export function checkMetaWorkspaceAccess(input: { manifest?: MetaChannelManifest | null; actor: WorkspaceActor; mountId: string; path: string; operation: 'read' | 'write' }): { allowed: true } | { allowed: false; reason: string } {
  try {
    const path = filePath(input.path), actor = input.actor;
    if (actor.kind !== 'character') throw new Error('只有获准角色可使用此文件通道');
    const channel = input.manifest?.channels.find(c => c.id === actor.channelId);
    if (!channel?.allowedConsumers.includes(actor.npcId)) throw new Error('角色或文件通道未获准');
    if (!channel.workspaceGrants?.some(g => g.mountId === input.mountId && g.npcIds.includes(actor.npcId) && g.operations.includes(input.operation) && withinPath(path, filePath(g.pathPrefix)))) throw new Error('角色文件访问超出通道授权范围');
    return { allowed: true };
  } catch (cause) { return { allowed: false, reason: cause instanceof Error ? cause.message : '文件权限无效' }; }
}
function splitPath(path: string) {
  const valid = filePath(path), [, mountId, ...parts] = valid.split('/');
  if (!valid.startsWith('meta/') || !mountId || !parts.length) throw new Error('角色文件访问路径须在 meta 挂载内');
  return { mountId, local: parts.join('/') };
}
function authorized(session: WorkspaceSession, request: WorkspaceToolRequest, path: string, operation: 'read' | 'write') {
  const { mountId, local } = splitPath(path);
  if (!session.metaMounts.some(m => m.id === mountId)) return false;
  return checkMetaWorkspaceAccess({ manifest: session.currentManifest ? session.currentManifest() : session.manifest, actor: request.actor ?? { kind: 'assistant' }, mountId, path: local, operation }).allowed;
}
export async function stageMetaWorkspaceOperation(session: WorkspaceSession, request: WorkspaceToolRequest): Promise<WorkspaceToolResult> {
  return runFileOperation(request, {
    current: () => !session.closed && session.isCurrent(), files: () => session.files,
    replaceFiles: files => { session.files = files; },
    canAccess: (path, operation) => authorized(session, request, path, operation),
  });
}
export interface PreparedMetaWorkspaceEffects { files: Record<string, WorkspaceFiles>; receipts: WorkspaceToolResult[]; actionId: string }
export function prepareMetaWorkspaceEffects(session: WorkspaceSession, ids: unknown): PreparedMetaWorkspaceEffects {
  if (!Array.isArray(ids) || ids.length > ACTION_TOOL_LIMITS.write || ids.some(id => typeof id !== 'string') || new Set(ids).size !== ids.length) throw new Error('文件变更操作 ID 列表无效');
  if (session.closed || !session.isCurrent()) throw new Error('行动已取消或归属发生变化');
  const chosen = new Set(ids), pending = session.receipts.filter(r => r.operationId && chosen.has(r.operationId));
  if (pending.length !== ids.length || pending.some(r => r.status !== 'staged' || r.actor?.kind !== 'character' || !r.resource || !r.path)) throw new Error('文件变更没有本轮已暂存的角色回执');
  const files: Record<string, WorkspaceFiles> = {};
  for (const receipt of pending) {
    if (!authorized(session, { method: receipt.method, params: {}, actor: receipt.actor }, receipt.path!, 'write')) throw new Error('角色文件访问权限已变化');
    const { mountId, local } = splitPath(receipt.path!), mount = session.metaMounts.find(m => m.id === mountId)!;
    files[mountId] ??= { ...(mount.currentFiles ? mount.currentFiles() : mount.files) };
    if ((files[mountId][local]?.id ?? null) !== receipt.beforeVersion) throw new Error('文件版本冲突，整批变更未提交');
    files[mountId][local] = receipt.resource!;
  }
  return { files, actionId: session.actionId, receipts: pending.map(r => ({ ...r, actionId: session.actionId, status: 'committed' })) };
}
/** Keep the original plugin ledger authoritative; never introduce a second writable mapping. */
export function applyMetaWorkspaceEffects(state: GameplayModState, effects: PreparedMetaWorkspaceEffects): GameplayModState {
  if (!effects.receipts.length) return state;
  const next = { ...state };
  for (const mountId of Object.keys(effects.files)) {
    const current = state[mountId] ?? {}, workspace = workspaceOf(current);
    const receipts = effects.receipts.filter(r => splitPath(r.path!).mountId === mountId);
    const files = { ...workspace.files }, events = [...workspace.events];
    for (const r of receipts) {
      if (events.some(event => event.id === r.operationId)) continue;
      const { local } = splitPath(r.path!);
      if ((files[local]?.id ?? null) !== r.beforeVersion) throw new Error('文件版本冲突，整批变更未提交');
      files[local] = r.resource!;
      events.push({ id: r.operationId!, type: 'character_file_written', path: local, version: r.afterVersion, createdAt: Date.now() });
    }
    next[mountId] = { ...current, [WORKSPACE_KEY]: { ...workspace, files, events: events.slice(-32) } };
  }
  return next;
}
