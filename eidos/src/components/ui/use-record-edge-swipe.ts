'use client';
import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react';
import { hasTextInputFocus, ownsTouch } from './use-mobile-swipe';

/** Arm at touch-start only: reaching an edge during ordinary reading must not change history. */
export function useRecordEdgeSwipe(rootRef: RefObject<HTMLElement | null>, options: {
  enabled: boolean; previous: boolean; next: boolean; onPrevious: () => void; onNext: () => void;
}) {
  const live = useRef(options);
  useLayoutEffect(() => { live.current = options; });
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    let gesture: { id: number; x: number; y: number; top: boolean; bottom: boolean; direction: 'previous' | 'next' | null; distance: number } | null = null;
    let suppressClick = false;
    const clear = () => { gesture = null; delete root.dataset.edgePull; root.style.removeProperty('--record-pull'); };
    const start = (event: TouchEvent) => {
      clear(); suppressClick = false;
      if (!live.current.enabled || !window.matchMedia?.('(max-width: 767px)').matches || event.touches.length !== 1 || hasTextInputFocus() || ownsTouch(event.target, root) || window.getSelection()?.toString()) return;
      const viewport = (event.target as Element).closest<HTMLElement>('.eidos-record-scroll');
      if (!viewport || viewport.closest('.is-outgoing')) return;
      const touch = event.touches[0];
      gesture = { id: touch.identifier, x: touch.clientX, y: touch.clientY, top: viewport.scrollTop <= 1, bottom: viewport.scrollTop + viewport.clientHeight >= viewport.scrollHeight - 1, direction: null, distance: 0 };
    };
    const move = (event: TouchEvent) => {
      if (!gesture) return;
      if (!live.current.enabled || event.touches.length !== 1 || hasTextInputFocus() || window.getSelection()?.toString()) { clear(); return; }
      const touch = Array.from(event.touches).find(item => item.identifier === gesture!.id);
      if (!touch) { clear(); return; }
      const dx = touch.clientX - gesture.x, dy = touch.clientY - gesture.y;
      if (!gesture.direction) {
        if (Math.abs(dx) > 12 && Math.abs(dx) >= Math.abs(dy)) { clear(); return; }
        if (Math.abs(dy) < 12 || Math.abs(dy) < Math.abs(dx) * 1.5) return;
        if (dy > 0 && gesture.top && live.current.previous) gesture.direction = 'previous';
        else if (dy < 0 && gesture.bottom && live.current.next) gesture.direction = 'next';
        else { clear(); return; }
      }
      event.preventDefault(); suppressClick = true;
      gesture.distance = Math.max(0, dy * (gesture.direction === 'previous' ? 1 : -1));
      root.dataset.edgePull = gesture.distance >= 76 ? `${gesture.direction}-ready` : gesture.direction;
      root.style.setProperty('--record-pull', `${Math.min(80, gesture.distance * .35) * (gesture.direction === 'previous' ? 1 : -1)}px`);
    };
    const end = (event: TouchEvent) => {
      const completed = gesture;
      clear();
      if (event.touches.length || !completed?.direction || completed.distance < 76 || hasTextInputFocus() || !live.current.enabled) return;
      event.preventDefault();
      if (completed.direction === 'previous') live.current.onPrevious(); else live.current.onNext();
    };
    const click = (event: MouseEvent) => {
      if (suppressClick && event.detail > 0) { suppressClick = false; event.preventDefault(); event.stopPropagation(); }
    };
    root.addEventListener('touchstart', start, { passive: true });
    root.addEventListener('touchmove', move, { passive: false });
    root.addEventListener('touchend', end, { passive: false });
    root.addEventListener('touchcancel', clear);
    root.addEventListener('click', click, true);
    return () => {
      root.removeEventListener('touchstart', start); root.removeEventListener('touchmove', move);
      root.removeEventListener('touchend', end); root.removeEventListener('touchcancel', clear);
      root.removeEventListener('click', click, true); clear();
    };
  }, [rootRef]);
}
