'use client';
import { useEffect } from 'react';

export function useVisualViewport() {
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const root = document.documentElement;
    const update = () => {
      // Pinch zoom should magnify the page, not reflow its layout as if a keyboard opened.
      if (viewport.scale !== 1 || window.innerWidth > 767) {
        root.style.removeProperty('--eidos-viewport-height');
        root.style.removeProperty('--eidos-viewport-top');
        return;
      }
      root.style.setProperty('--eidos-viewport-height', `${viewport.height}px`);
      root.style.setProperty('--eidos-viewport-top', `${viewport.offsetTop}px`);
    };
    update(); viewport.addEventListener('resize', update); viewport.addEventListener('scroll', update);
    window.addEventListener('resize', update);
    return () => {
      viewport.removeEventListener('resize', update); viewport.removeEventListener('scroll', update); window.removeEventListener('resize', update);
      root.style.removeProperty('--eidos-viewport-height'); root.style.removeProperty('--eidos-viewport-top');
    };
  }, []);
}
