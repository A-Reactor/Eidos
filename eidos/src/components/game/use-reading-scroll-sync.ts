import { useCallback, useEffect, useLayoutEffect, useRef, type RefObject } from 'react';

interface ReadingScrollSyncOptions {
  viewportRef: RefObject<HTMLElement | null>;
  selectedNodeId: string | null;
  onLocateNode: (nodeId: string) => void;
}

export function useReadingScrollSync({ viewportRef, selectedNodeId, onLocateNode }: ReadingScrollSyncOptions) {
  const frame = useRef<number | null>(null);
  const programmaticTop = useRef<number | null>(null);
  const latest = useRef({ selectedNodeId, onLocateNode });
  useLayoutEffect(() => { latest.current = { selectedNodeId, onLocateNode }; });
  useEffect(() => () => { if (frame.current !== null) cancelAnimationFrame(frame.current); }, []);

  const preserveTextTarget = useCallback(() => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    // A graph click or search already chose its destination; its scroll event must not choose again.
    programmaticTop.current = viewportRef.current?.scrollTop ?? null;
  }, [viewportRef]);

  const syncReadingScroll = useCallback(() => {
    if (frame.current !== null) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      const viewport = viewportRef.current;
      if (!viewport) return;
      if (programmaticTop.current !== null) {
        if (Math.abs(viewport.scrollTop - programmaticTop.current) < 1) return;
        programmaticTop.current = null;
      }
      const bounds = viewport.getBoundingClientRect();
      if (bounds.height <= 0) return;
      // The upper reading area follows the prose instead of lingering on a previous record's bottom padding.
      const readingTop = bounds.top + bounds.height / 4;
      const record = [...viewport.querySelectorAll<HTMLElement>('[data-reading-node-id]')].find(element => {
        const rect = element.getBoundingClientRect();
        return rect.bottom > readingTop && rect.top < bounds.bottom;
      });
      const nodeId = record?.dataset.readingNodeId;
      if (nodeId && nodeId !== latest.current.selectedNodeId) latest.current.onLocateNode(nodeId);
    });
  }, [viewportRef]);

  return { syncReadingScroll, preserveTextTarget };
}
