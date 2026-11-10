import type { ResourceRef, WorkspaceFileRef } from '../workspace/types';

export interface DocumentScope { worldId: string; playthroughId: string; archiveId?: string }
export interface DocumentRef { documentId: string; revision: string }
export interface DocumentLink extends DocumentRef { title: string; allowWrite?: boolean }
export interface DocumentCitation extends DocumentRef { blockId: string; start: number; end: number }
export type DocumentOrigin = 'imported' | 'authored' | 'generated' | 'recovered';
export type DocumentFormat = 'markdown' | 'text';
export interface DocumentVersion {
  pending?: boolean; restoredFrom?: string; parentRevision?: string;
  title?: string; fileName?: string;
  resource: ResourceRef; originalResource?: ResourceRef; responseResource?: ResourceRef;
  sourceRefs?: DocumentCitation[]; format: DocumentFormat; createdAt: number;
}
export interface DocumentRecord {
  libraryVisibility?: 'visible';
  trashedAt?: number; trashedRevision?: string;
  id: string; scope: DocumentScope; title: string; origin: DocumentOrigin; currentRevision: string;
  versions: Record<string, DocumentVersion>; createdAt: number; updatedAt: number;
  fileName?: string; idempotencyKey?: string; originActionId?: string; linkedNodeId?: string;
  legacyId?: string; referenceError?: string; staged?: boolean; branchManaged?: boolean; baseRevision?: string;
}
export interface SaveDocumentInput {
  libraryVisibility?: 'visible';
  title: string; origin: DocumentOrigin; resource: ResourceRef; originalResource?: ResourceRef; responseResource?: ResourceRef;
  format?: DocumentFormat; sourceRefs?: DocumentCitation[]; previous?: DocumentRef; idempotencyKey?: string;
  fileName?: string; originActionId?: string; linkedNodeId?: string; staged?: boolean; branchManaged?: boolean;
}
export type DocumentDraft = { segmentIndex?: number; key: string; title: string; format: DocumentFormat; sourceRefs?: DocumentCitation[] } & (
  { content: string; artifactRef?: never } | { artifactRef: WorkspaceFileRef; content?: never }
);
export interface ActionDraft { text: string; documentRefs: DocumentRef[] }
