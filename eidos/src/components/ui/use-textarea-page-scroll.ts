"use client";
import { useEffect, type RefObject } from 'react';

function pageScroller(field: HTMLTextAreaElement, root: HTMLElement) {
  for (let node = field.parentElement; node; node = node.parentElement) {
    if (/auto|scroll/.test(getComputedStyle(node).overflowY)) return node;
    if (node === root) break;
  }
  return null;
}

/** An unfocused field is part of the page; editing restores the browser's own text gestures. */
export function useTextareaPageScroll(rootRef: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    let drag: { field: HTMLTextAreaElement; page: HTMLElement; id: number; x: number; startY: number; y: number; scrolling: boolean } | null = null;
    let suppressClick = false;
    const fieldAt = (target: EventTarget | null) => target instanceof HTMLTextAreaElement && document.activeElement !== target && window.matchMedia?.('(max-width: 767px)').matches ? target : null;
    const start = (event: TouchEvent) => {
      drag = null; suppressClick = false;
      const field = fieldAt(event.target), touch = event.touches[0];
      const page = field && pageScroller(field, root);
      if (field && page && event.touches.length === 1) drag = { field, page, id: touch.identifier, x: touch.clientX, startY: touch.clientY, y: touch.clientY, scrolling: false };
    };
    const move = (event: TouchEvent) => {
      if (!drag) return;
      if (event.touches.length !== 1 || document.activeElement === drag.field || window.getSelection()?.toString()) { drag = null; return; }
      const touch = Array.from(event.touches).find(touch => touch.identifier === drag!.id);
      if (!touch) return;
      if (!drag.scrolling) {
        const dx = Math.abs(touch.clientX - drag.x), dy = Math.abs(touch.clientY - drag.startY);
        if (dy < 8) return;
        if (dx > dy) { drag = null; return; }
        drag.scrolling = true; suppressClick = true;
      }
      event.preventDefault();
      drag.page.scrollTop += drag.y - touch.clientY;
      drag.y = touch.clientY;
    };
    const end = (event: TouchEvent) => { if (drag?.scrolling) event.preventDefault(); drag = null; };
    const click = (event: MouseEvent) => { if (suppressClick && event.detail > 0) { suppressClick = false; event.preventDefault(); event.stopPropagation(); } };
    const wheel = (event: WheelEvent) => {
      if (event.ctrlKey) return;
      const field = fieldAt(event.target), page = field && pageScroller(field, root);
      if (!page || !event.deltaY) return;
      event.preventDefault(); page.scrollTop += event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? page.clientHeight : 1);
    };
    root.addEventListener('touchstart', start, { passive: true, capture: true });
    root.addEventListener('touchmove', move, { passive: false, capture: true });
    root.addEventListener('touchend', end, { passive: false, capture: true });
    root.addEventListener('touchcancel', end, { passive: false, capture: true });
    root.addEventListener('wheel', wheel, { passive: false, capture: true });
    root.addEventListener('click', click, true);
    return () => {
      root.removeEventListener('touchstart', start, true); root.removeEventListener('touchmove', move, true);
      root.removeEventListener('touchend', end, true); root.removeEventListener('touchcancel', end, true);
      root.removeEventListener('wheel', wheel, true); root.removeEventListener('click', click, true);
    };
  }, [rootRef]);
}
