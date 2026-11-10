'use client';
import { useLayoutEffect, useRef, type RefObject } from 'react';
import type { RecordLanding } from './ActionRecordPanel';

interface Options {
  pageKey: number; landing?: RecordLanding | null; loading: boolean;
  complete: boolean; showing: boolean; segmentIndex: number; focused?: boolean;
  visualLayout?: boolean; actionsCount: number; content: unknown;
}

export function useRecordPlaybackScroll(root: RefObject<HTMLElement | null>, options: Options) {
  const positionedPage = useRef(options.pageKey);
  const { pageKey, landing, loading, complete, showing, segmentIndex, focused, visualLayout, actionsCount, content } = options;
  useLayoutEffect(() => {
    const viewport = root.current?.querySelector<HTMLElement>('.eidos-record-page:not(.is-outgoing) .eidos-record-scroll');
    if (!viewport) return;
    const destination = landing?.pageKey === pageKey ? landing : null;
    if (positionedPage.current !== pageKey && destination) {
      if (loading) return;
      positionedPage.current = pageKey;
      viewport.scrollTo?.({ top: 'scrollTop' in destination ? destination.scrollTop : destination.edge === 'top' ? 0 : viewport.scrollHeight, behavior: 'instant' });
      return;
    }
    positionedPage.current = pageKey;
    const paragraph = viewport.querySelector<HTMLElement>('[data-record-segment][data-current-record-segment]');
    const recommendations = complete && !paragraph ? viewport.querySelector<HTMLElement>('.eidos-record-options') : null;
    const active = paragraph ?? recommendations;
    if (!active) return;
    const stage = viewport.closest('[data-story-stage]');
    const follow = () => {
      if (window.getSelection()?.toString()) return;
      const bounds = viewport.getBoundingClientRect(), target = active.getBoundingClientRect();
      const dialogue = visualLayout ? stage?.querySelector('.eidos-dialogue-readout')?.getBoundingClientRect() : null;
      // Reserve the overlay even for narration; tall paragraphs keep their first line visible.
      const bottom = dialogue && dialogue.height > 0 ? Math.max(bounds.top + 32, Math.min(bounds.bottom, dialogue.top)) : bounds.bottom;
      const inset = visualLayout && paragraph ? Math.max(0, bounds.bottom - bottom) : 0;
      viewport.style.setProperty('--record-follow-inset', `${inset}px`);
      const top = target.top - bounds.top + viewport.scrollTop;
      if (visualLayout && paragraph && bounds.height > 0) {
        const start = bounds.top + 16, end = bottom - 16;
        if (target.top >= start && target.bottom <= end) return;
        const desiredTop = Math.max(start, end - target.height);
        viewport.scrollTo?.({ top: Math.max(0, top - (desiredTop - bounds.top)), behavior: 'instant' });
        return;
      }
      if (paragraph && bounds.height > 0 && target.top >= bounds.top && target.bottom <= bounds.bottom) return;
      viewport.scrollTo?.({ top: recommendations ? viewport.scrollHeight : showing && segmentIndex === 0 ? 0 : Math.max(0, top - 28), behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
    };
    follow();
    if (!visualLayout) return;
    stage?.addEventListener('eidos-dialogue-resize', follow);
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(follow);
    observer?.observe(viewport); observer?.observe(active);
    return () => { observer?.disconnect(); stage?.removeEventListener('eidos-dialogue-resize', follow); };
  }, [root, segmentIndex, showing, focused, pageKey, landing, loading, complete, actionsCount, visualLayout, content]);
}
