'use client';
import { useEffect } from 'react';
import { useGameStore } from '@/store/game-store';
import { loadBlob } from '@/lib/game/cas-storage';
import { legacyPresentation } from '@/lib/game/presentation/legacy';
import type { StorySegment } from '@/lib/ai/types';

/** Lazily index legacy paragraphs without copying their raw text into another ledger. */
export function usePresentationArchive(ids: string[]) {
  const world = useGameStore(s => s.currentWorld), line = useGameStore(s => s.worldLine?.id);
  const key = ids.join('\n');
  useEffect(() => {
    if (!world?.gameplayPlugins?.some(p => p.ui?.presentation === 'native-text')) return;
    let active = true;
    void (async () => {
      for (const id of ids) {
        const before = useGameStore.getState().allNodes[id];
        if (!before || before.presentation || !before.segmentHash) continue;
        const segments = await loadBlob(before.segmentHash) as StorySegment[] | null;
        const live = useGameStore.getState(), node = live.allNodes[id];
        if (!active || live.worldLine?.id !== line || !node || node.segmentHash !== before.segmentHash) return;
        if (!segments?.length || node.presentation) continue;
        const presentation = legacyPresentation(node,segments,live.allNodes);
        const updated = { ...node,presentation };
        useGameStore.setState({ allNodes: { ...live.allNodes,[id]:updated }, ...(live.currentNode?.id === id ? { currentNode: updated } : {}) });
      }
    })().catch(error => console.warn('[Presentation] legacy index unavailable',error));
    return () => { active = false; };
    // The node list is a stable identity; ledger updates must not restart the loader.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, world?.id, line]);
}
