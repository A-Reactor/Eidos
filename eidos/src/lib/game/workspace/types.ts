export const MAX_RESOURCE_BYTES = 4 * 1024 * 1024;
export interface ModResource {
  id: string; name: string; revisionName?: string; revisionToken?: string; mimeType: string; size: number;
  text?: string; base64?: string;
}
export type ResourceRef = Omit<ModResource, 'text' | 'base64'>;
export type WorkspaceFiles = Record<string, ResourceRef>;
export interface WorkspaceFileRef { path: string; version: string }
export type WorkspaceActor = { kind: 'assistant' } | { kind: 'character'; npcId: string; channelId: string };
export type WorkspaceMethod = 'files.list' | 'files.search' | 'files.read' | 'files.write' | 'files.patch' | 'files.rename';
export interface WorkspaceToolRequest { method: WorkspaceMethod; params: Record<string, unknown>; actor?: WorkspaceActor }
export interface WorkspaceCatalogEntry { imagePath?: string; writable?: boolean; selected?: boolean; path: string; version: string; name: string; mimeType: string; size: number }
export interface WorkspaceMatch { name?: string; writable?: boolean; imagePath?: string; path: string; version: string; offset: number; excerpt: string }
export interface WorkspaceCitation { path: string; version: string; blockId: string; start: number; end: number }
export interface WorkspaceToolResult {
  segmentIndex?: number;
  changes?: { added: number; removed: number };
  emptyText?: boolean;
  method: WorkspaceMethod; status: 'staged' | 'committed' | 'denied' | 'failed';
  actionId?: string; nodeId?: string; operationId?: string; actor?: WorkspaceActor; path?: string; version?: string;
  beforeVersion?: string | null; afterVersion?: string; resource?: ResourceRef;
  text?: string; offset?: number; totalChars?: number; nextOffset?: number | null;
  entries?: WorkspaceCatalogEntry[]; matches?: WorkspaceMatch[]; totalMatches?: number; error?: string;
  citations?: WorkspaceCitation[];
  document?: { documentId: string; revision: string; title: string };
}
export interface WorkspaceFileAccess {
  current(): boolean;
  files(): WorkspaceFiles;
  replaceFiles(next: WorkspaceFiles): void;
  canAccess(path: string, operation: 'read' | 'write'): boolean;
  validateWrite?(path: string, content: string): void;
  status?: 'staged' | 'committed';
  canRename?(path: string): boolean;
  canList?(path: string): boolean;
  comparePaths?(left: string, right: string): number;
  describe?(path: string, ref: ResourceRef): WorkspaceCatalogEntry;
}
