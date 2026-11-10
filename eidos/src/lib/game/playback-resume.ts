import type { StorySegment } from '@/lib/ai/types';
import type { WorldLineNode } from './types';
import { loadBlob } from './cas-storage';
import { segmentRanges } from './presentation/compile';
import { getPlayerVisibleText } from './player-reading';

export interface PlaybackPosition { nodeId: string; index: number; showing: boolean }
export function parsePlaybackPosition(value: unknown): PlaybackPosition | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as PlaybackPosition;
  return typeof v.nodeId === 'string' && Number.isSafeInteger(v.index) && v.index >= 0 && typeof v.showing === 'boolean'
    ? { nodeId: v.nodeId, index: v.index, showing: v.showing } : null;
}
/** Cursor data cannot supply prose; load it from the selected saved node's immutable segments. */
export async function restoreNodePlayback(node: WorldLineNode, position: unknown) {
  const raw = node.segmentHash ? await loadBlob(node.segmentHash) : null;
  const segments: StorySegment[] = Array.isArray(raw) && raw.every(s => s && ['narration', 'dialogue'].includes(s.type) && typeof s.text === 'string')
    ? raw : node.aiResponse ? [{ type: 'narration', text: node.aiResponse }] : [];
  const saved = parsePlaybackPosition(position);
  const visible = getPlayerVisibleText(node).length;
  const readIndex = segmentRanges(segments).findLastIndex(range => range.textStart < visible);
  const index = Math.min(saved?.nodeId === node.id ? saved.index : Math.max(0, readIndex), Math.max(0, segments.length - 1));
  return { savedSegments: segments, savedSegmentIndex: index, savedIsShowingSegments: saved?.nodeId === node.id ? saved.showing : segments.length > 0,
    playbackPosition: segments.length ? { nodeId: node.id, index, showing: saved?.nodeId === node.id ? saved.showing : true } : null };
}
