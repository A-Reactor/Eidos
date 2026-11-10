'use client';
import { useCallback, useEffect, useLayoutEffect, useRef, type RefObject, type TransitionEvent } from 'react';

export const MOBILE_PAGE_DURATION = 200;

/** Keep the previous page visible until the foreground card has left the viewport. */
export function useMobilePageTransition(rootRef: RefObject<HTMLElement | null>, options: {
  mobile: boolean; onBack?: () => void; beforeBack?: (leave: () => void) => void;
}) {
  const live = useRef(options);
  useLayoutEffect(() => { live.current = options; });
  const distance = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const leaving = useRef(false);
  const reset = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null; leaving.current = false; distance.current = 0;
    const root = rootRef.current;
    if (root) { delete root.dataset.mobileLeaving; root.style.removeProperty('--swipe-x'); }
  }, [rootRef]);
  useEffect(() => reset, [reset]);
  const finish = useCallback(() => {
    if (!leaving.current) return;
    reset(); live.current.onBack?.();
  }, [reset]);
  const leave = useCallback(() => {
    if (leaving.current || !live.current.onBack) return;
    const root = rootRef.current;
    const reduced = document.documentElement.dataset.motion === 'reduced' || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (!live.current.mobile || reduced || !root) { live.current.onBack(); return; }
    leaving.current = true;
    // The gesture detector clears its drag styles at release. Restore that exact
    // position before settling, so the card never flashes back to its origin.
    root.style.transition = 'none';
    root.style.setProperty('--swipe-x', `${distance.current}px`);
    root.getBoundingClientRect();
    root.style.removeProperty('transition');
    root.dataset.mobileLeaving = 'true';
    root.style.setProperty('--swipe-x', `${root.clientWidth || window.innerWidth}px`);
    timer.current = setTimeout(finish, MOBILE_PAGE_DURATION + 40);
  }, [finish, rootRef]);
  const back = useCallback(() => {
    if (leaving.current) return;
    if (live.current.beforeBack) {
      let accepted = false;
      live.current.beforeBack(() => { accepted = true; leave(); });
      if (!accepted) distance.current = 0;
    } else leave();
  }, [leave]);
  return {
    back, leave,
    progress: (value: number) => { distance.current = value; rootRef.current?.style.setProperty('--swipe-x', `${value}px`); },
    remember: (value: number) => { distance.current = value; },
    cancel: () => { distance.current = 0; },
    onTransitionEnd: (event: TransitionEvent<HTMLElement>) => {
      if (event.target === event.currentTarget && (!event.propertyName || event.propertyName === 'transform')) finish();
    },
  };
}
