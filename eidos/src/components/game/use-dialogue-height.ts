'use client';
import { useRef, useState, type CSSProperties, type RefObject } from 'react';

const STORAGE_KEY = 'eidos-dialogue-height';
const MIN_HEIGHT = 160;
const MAX_HEIGHT = 600;
const DEFAULT_HEIGHT = 240;

export function useDialogueHeight(readoutRef: RefObject<HTMLElement | null>) {
  const [height, setHeight] = useState(() => {
    try {
      const saved = Number(localStorage.getItem(STORAGE_KEY));
      return saved >= MIN_HEIGHT && saved <= MAX_HEIGHT ? saved : DEFAULT_HEIGHT;
    } catch { return DEFAULT_HEIGHT; }
  });
  const drag = useRef<{ id: number; y: number; height: number } | null>(null);
  const change = (value: number) => {
    const readout = readoutRef.current;
    const stage = readout?.closest('[data-story-stage]');
    const available = readout && stage ? readout.getBoundingClientRect().bottom - stage.getBoundingClientRect().top - 90 : MAX_HEIGHT;
    const next = Math.round(Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, available), value)));
    setHeight(next);
    try { localStorage.setItem(STORAGE_KEY, String(next)); } catch { /* Storage failure must not disable resizing. */ }
  };
  return {
    style: { '--eidos-dialogue-size': `${height}px` } as CSSProperties,
    handle: {
      role: 'separator', tabIndex: 0, 'aria-label': '对话框高度', 'aria-orientation': 'horizontal' as const,
      'aria-valuemin': MIN_HEIGHT, 'aria-valuemax': MAX_HEIGHT, 'aria-valuenow': height,
      onPointerDown: (event: React.PointerEvent<HTMLElement>) => {
        if (event.button !== 0) return;
        event.preventDefault(); event.stopPropagation();
        drag.current = { id: event.pointerId, y: event.clientY, height };
        event.currentTarget.setPointerCapture?.(event.pointerId);
      },
      onPointerMove: (event: React.PointerEvent<HTMLElement>) => {
        if (drag.current?.id === event.pointerId) change(drag.current.height + drag.current.y - event.clientY);
      },
      onPointerUp: () => { drag.current = null; },
      onPointerCancel: () => { drag.current = null; },
      onLostPointerCapture: () => { drag.current = null; },
      onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => {
        if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
        event.preventDefault(); event.stopPropagation();
        change(height + (event.key === 'ArrowUp' ? 24 : -24));
      },
    },
  };
}
