import type { WorkspaceGrant } from '@/lib/meta-reality/types';
import type { WorkspaceSession } from './session';
import { workspaceDefaultCatalogAccess, workspaceCatalogEntry, workspacePathOrder } from './session';
import type { WorkspaceCatalogEntry, WorkspaceToolResult } from './types';

export interface PendingWorkspaceWrite {
  path: string; name: string; version: string;
  kind: 'library' | 'image' | 'character' | 'draft'; operationIds: string[];
}
export interface WorkspacePromptContext {
  execution?: import('../action-execution-context').ActionExecutionContext;
  pendingWrites?: PendingWorkspaceWrite[];
  imageLibrary?: { count: number };
  /** Ordinary paragraphs emitted earlier in this same, still unaccepted action. */
  narrative?: import('@/lib/ai/types').StorySegment[];
  committedEffects?: WorkspaceToolResult[];
  channels?: Array<WorkspaceGrant & { channelId: string }>;
  draftRoot: string; mounts: WorkspaceCatalogEntry[]; nextOffset: number | null; results: WorkspaceToolResult[];
}
/** Read pagination must not evict the successful write needed to finish this action. */
function pendingWrites(session: WorkspaceSession): PendingWorkspaceWrite[] {
  const groups = new Map<string, WorkspaceToolResult[]>();
  for (const receipt of session.receipts) if (receipt.status === 'staged' && receipt.operationId && receipt.path && receipt.afterVersion) {
    groups.set(receipt.path, [...groups.get(receipt.path) ?? [], receipt]);
  }
  return [...groups].flatMap(([path, writes]) => {
    const last = writes.at(-1)!;
    if (session.files[path]?.id !== last.afterVersion) return [];
    const kind: PendingWorkspaceWrite['kind'] = last.actor?.kind === 'character' ? 'character' : path.startsWith('library/') ? 'library' : path.startsWith('images/') ? 'image' : 'draft';
    return [{ path, name: workspaceCatalogEntry(session, path, session.files[path]).name, version: last.afterVersion!, kind,
      operationIds: (kind === 'character' ? writes : [last]).map(receipt => receipt.operationId!) }];
  });
}
export function workspacePromptContext(session: WorkspaceSession): WorkspacePromptContext {
  const channels = session.manifest?.channels.flatMap(c => (c.workspaceGrants ?? []).filter(g => session.metaMounts.some(m => m.id === g.mountId)).map(g => ({ ...g, channelId: c.id }))) ?? [];
  const files = Object.entries(session.files).filter(([path]) => workspaceDefaultCatalogAccess(session, path)).sort(([a], [b]) => workspacePathOrder(session, a, b));
  const imageCount = Object.keys(session.imageLibrary?.entries ?? {}).length;
  const pending = pendingWrites(session);
  return { ...(pending.length ? { pendingWrites: pending } : {}), ...(imageCount ? { imageLibrary: { count: imageCount } } : {}), ...(session.previousEffects?.length ? { committedEffects: structuredClone(session.previousEffects) } : {}), ...(channels.length ? { channels } : {}), draftRoot: session.draftRoot, mounts: files.slice(0, 8).map(([path, ref]) => workspaceCatalogEntry(session, path, ref)),
    nextOffset: files.length > 8 ? 8 : null, results: structuredClone(session.receipts.slice(-8)) };
}
