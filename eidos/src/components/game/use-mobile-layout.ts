'use client';
import { useLayoutEffect, useRef, useSyncExternalStore } from 'react';

const query = '(max-width: 767px)';
const subscribe = (notify: () => void) => {
  const media = window.matchMedia?.(query);
  if (!media) return () => {};
  media.addEventListener('change', notify);
  return () => media.removeEventListener('change', notify);
};
const snapshot = () => window.matchMedia?.(query).matches ?? false;

export function useMobileLayout(dockVisible: boolean) {
  const mobile = useSyncExternalStore(subscribe, snapshot, () => false);
  const frame = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const root = frame.current;
    const dock = root?.querySelector<HTMLElement>('[data-stage-lower-bound]');
    if (!root || !dock || typeof ResizeObserver === 'undefined') return;
    // Input drafts and generation notices can grow; reserve the measured dock, not a fixed guess.
    const measure = () => root.style.setProperty('--eidos-dock-height', `${Math.ceil(dock.getBoundingClientRect().height)}px`);
    const observer = new ResizeObserver(measure);
    measure(); observer.observe(dock);
    return () => { observer.disconnect(); root.style.removeProperty('--eidos-dock-height'); };
  }, [mobile, dockVisible]);
  return { mobile, frame };
}
