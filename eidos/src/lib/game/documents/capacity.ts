import { loadDocumentRecords, loadDocuments } from './repository';
import type { DocumentScope } from './types';
import { playerDocuments } from './visibility';
/** Logical original bytes, deduplicated across all versions; not a browser disk estimate. */
export async function documentCapacity(scope: DocumentScope) {
  const records = await loadDocumentRecords(scope), active = await loadDocuments(scope);
  const resources = new Map<string, number>();
  let versions = 0;
  for (const doc of records) for (const version of Object.values(doc.versions)) {
    versions++;
    for (const ref of [version.resource, version.originalResource, version.responseResource]) if (ref) resources.set(ref.id, ref.size);
  }
  return { documents: playerDocuments(active).length, trashed: playerDocuments(records).filter(d => d.trashedAt !== undefined && !d.staged).length,
    drafts: records.filter(d => d.staged).length, versions, resources: resources.size, bytes: [...resources.values()].reduce((a,b) => a+b, 0) };
}
