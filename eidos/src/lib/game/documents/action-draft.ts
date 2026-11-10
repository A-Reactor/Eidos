import type { DocumentLink, DocumentScope } from './types';

export interface DocumentActionDraft { scope: DocumentScope; links: DocumentLink[] }
export function mergeDocumentLinks(existing: readonly DocumentLink[], additions: readonly DocumentLink[]): DocumentLink[] {
  const links = new Map(existing.map(link => [link.documentId, link]));
  additions.forEach(link => links.set(link.documentId, link));
  return [...links.values()];
}

export function actionInputIdentity(text: string, refs: readonly import('./types').DocumentRef[], workspaceRevision = ''): string {
  const entries = [...new Set(refs.map(ref => JSON.stringify([ref.documentId, ref.revision, ...(typeof (ref as import('./types').DocumentLink).allowWrite === 'boolean' ? [(ref as import('./types').DocumentLink).allowWrite] : [])])))].sort();
  return !entries.length && !workspaceRevision ? text.trim() : `eidos_action_v1:${JSON.stringify([text.trim(), entries, workspaceRevision])}`;
}
export function matchesActionInput(node: { playerInput: string; inputIdentity?: string; inputDocuments?: readonly import('./types').DocumentRef[]; workspaceEffects?: readonly unknown[] }, text: string, identity = text.trim()): boolean {
  if (node.inputIdentity !== undefined) return node.inputIdentity === identity;
  return !node.inputDocuments?.length && !node.workspaceEffects?.length && identity === text.trim() && node.playerInput.trim() === text.trim();
}
