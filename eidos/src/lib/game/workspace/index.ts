import { indexSources } from '../source-reconstruction/source-index';
import type { ModResource, WorkspaceCitation } from './types';

const cached = new Map<string, Array<Omit<WorkspaceCitation, 'path'>>>();
/** Reuse exact source ranges; the canonical version is the stored resource ID. */
export function indexWorkspaceText(path: string, resource: ModResource): WorkspaceCitation[] {
  let blocks = cached.get(resource.id);
  if (!blocks) {
    blocks = indexSources({ id: resource.id, language: 'mixed', createdAt: 0,
      documents: [{ id: resource.id, title: resource.name, kind: 'imported_text', content: resource.text ?? '', createdAt: 0 }] },
    { targetTokens: 12000, estimate: text => text.length }).map(block => ({ version: resource.id,
      blockId: `${resource.id}:${block.start}-${block.end}`, start: block.start, end: block.end }));
    if (cached.size >= 32) cached.delete(cached.keys().next().value!);
    cached.set(resource.id, blocks);
  }
  return blocks.map(block => ({ ...block, path }));
}
