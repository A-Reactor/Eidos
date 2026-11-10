'use client';
import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react';

type Swipe = { id: number; x: number; y: number; started: number; horizontal: boolean };
const controls = 'a,input[type="range"],input[type="color"],input[type="file"],input[type="checkbox"],input[type="radio"],select,summary,iframe,[role="slider"],[role="separator"],[data-swipe-ignore],.eidos-worldline-canvas,.eidos-mod-surface,.eidos-card-panels';

const textEntry = 'textarea,input:not([type="button"]):not([type="submit"]):not([type="reset"]):not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="color"]):not([type="file"]):not([type="image"]),[contenteditable]:not([contenteditable="false"]),[role="textbox"]';
export const hasTextInputFocus = () => document.activeElement instanceof Element && Boolean(document.activeElement.closest(textEntry));

export function ownsTouch(target: EventTarget | null, root: HTMLElement) {
  if (!(target instanceof Element) || target.closest(controls)) return true;
  const dialog = target.closest('dialog, [role="dialog"]');
  if (dialog && dialog !== root && root.contains(dialog)) return true;
  // A horizontal list owns its gesture even when a finger starts near the page edge.
  for (let node: Element | null = target; node && node !== root; node = node.parentElement) {
    if (node.hasAttribute('data-mobile-slide')) return true;
    if (node.scrollWidth > node.clientWidth + 1 && /auto|scroll/.test(getComputedStyle(node).overflowX)) return true;
  }
  return false;
}

/** Full-page navigation pauses while editing; child scrollers and controls own their gestures. */
export function useMobileSwipe<T extends HTMLElement>(rootRef: RefObject<T | null>, options: {
  direction: 'left' | 'right' | 'both'; onSwipe: (direction: 'left' | 'right') => void; enabled?: boolean;
  onProgress?: (distance: number) => void; onCancel?: () => void;
}) {
  const live = useRef(options);
  useLayoutEffect(() => { live.current = options; });
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    let swipe: Swipe | null = null, suppressClick = false;
    const clear = () => { swipe = null; delete root.dataset.swiping; root.style.removeProperty('--swipe-x'); };
    const cancel = () => { if (swipe?.horizontal) live.current.onCancel?.(); clear(); };
    const start = (event: TouchEvent) => {
      cancel(); suppressClick = false;
      if (live.current.enabled === false || !window.matchMedia?.('(max-width: 767px)').matches || event.touches.length !== 1 || hasTextInputFocus() || ownsTouch(event.target, root) || window.getSelection()?.toString()) return;
      const touch = event.touches[0];
      swipe = { id: touch.identifier, x: touch.clientX, y: touch.clientY, started: Date.now(), horizontal: false };
    };
    const move = (event: TouchEvent) => {
      if (!swipe) return;
      if (event.touches.length !== 1 || hasTextInputFocus() || live.current.enabled === false || window.getSelection()?.toString()) { cancel(); return; }
      const touch = Array.from(event.touches).find(t => t.identifier === swipe!.id);
      if (!touch) { cancel(); return; }
      const dx = touch.clientX - swipe.x, dy = touch.clientY - swipe.y;
      if (!swipe.horizontal) {
        if (Date.now() - swipe.started > 450 || Math.abs(dy) > 12 && Math.abs(dy) >= Math.abs(dx)) { clear(); return; }
        if (Math.abs(dx) < 10 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
        if (live.current.direction !== 'both' && dx * (live.current.direction === 'right' ? 1 : -1) <= 0) { clear(); return; }
        swipe.horizontal = true; suppressClick = true;
        root.dataset.swiping = dx > 0 ? 'right' : 'left';
      }
      event.preventDefault();
      const sign = root.dataset.swiping === 'right' ? 1 : -1;
      const distance = sign * Math.max(0, Math.min(root.clientWidth || window.innerWidth, dx * sign));
      if (live.current.onProgress) live.current.onProgress(distance);
      else root.style.setProperty('--swipe-x', `${distance}px`);
    };
    const end = (event: TouchEvent) => {
      const current = swipe;
      const direction = root.dataset.swiping === 'right' ? 'right' : 'left';
      if (!current?.horizontal || event.touches.length || hasTextInputFocus() || live.current.enabled === false) { cancel(); return; }
      const touch = Array.from(event.changedTouches).find(t => t.identifier === current.id);
      if (!touch) { cancel(); return; }
      event.preventDefault();
      const dx = (touch.clientX - current.x) * (direction === 'right' ? 1 : -1);
      const threshold = Math.max(56, Math.min(88, root.clientWidth * .2));
      const elapsed = Math.max(16, Date.now() - current.started);
      const flick = dx >= 40 && elapsed <= 300 && dx / elapsed >= .55;
      if ((dx >= threshold || flick) && Math.abs(touch.clientY - current.y) < dx / 1.5) { clear(); live.current.onSwipe(direction); }
      else cancel();
    };
    const click = (event: MouseEvent) => {
      if (suppressClick && event.detail > 0) { suppressClick = false; event.preventDefault(); event.stopPropagation(); }
    };
    root.addEventListener('touchstart', start, { passive: true, capture: true });
    root.addEventListener('touchmove', move, { passive: false, capture: true });
    root.addEventListener('touchend', end, { passive: false, capture: true });
    root.addEventListener('touchcancel', cancel, { passive: true, capture: true });
    root.addEventListener('click', click, true);
    return () => {
      root.removeEventListener('touchstart', start, true); root.removeEventListener('touchmove', move, true);
      root.removeEventListener('touchend', end, true); root.removeEventListener('touchcancel', cancel, true);
      root.removeEventListener('click', click, true); clear();
    };
  }, [rootRef]);
}
