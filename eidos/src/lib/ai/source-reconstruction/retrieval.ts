import type { SourceIndex, SourceLookupRequest, SourceBlock } from '@/lib/game/source-reconstruction/types';
export function resolveSourceLookup(request: SourceLookupRequest, index: SourceIndex): SourceBlock[] {
  if (!Array.isArray(request.refIds) || !request.refIds.length || request.refIds.length > 4 || typeof request.reason !== 'string') throw new Error('回查请求无效');
  return [...new Set(request.refIds)].map(id => {
    const block = index.blocks.find(b => b.id === id);
    if (!block || block.sourceRevision !== index.revision) throw new Error('回查来源不存在或已过期');
    return block;
  });
}
