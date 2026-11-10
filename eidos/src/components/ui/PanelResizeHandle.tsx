"use client";
import { useRef, useState, type CSSProperties } from 'react';

export function usePanelWidth(id: string, initial: number) {
  const key = `eidos-panel-width:${id}`;
  const [width, setWidth] = useState(() => {
    try { const value = Number(localStorage.getItem(key)); return value >= 260 && value <= 900 ? value : initial; } catch { return initial; }
  });
  const change = (value: number) => {
    const next = Math.round(Math.max(260, Math.min(900, window.innerWidth - 80, value)));
    setWidth(next);
    try { localStorage.setItem(key, String(next)); } catch { /* 本次拖动仍可用。 */ }
  };
  return { width, change, style: { '--panel-width': `${width}px` } as CSSProperties };
}

export function PanelResizeHandle({ label, panel, onResizeStart }: { label: string; panel: ReturnType<typeof usePanelWidth>; onResizeStart?: () => void }) {
  const start = useRef<{ x: number; width: number } | null>(null);
  return <div role="separator" aria-label={label} aria-orientation="vertical" aria-valuemin={260} aria-valuemax={900} aria-valuenow={panel.width}
    tabIndex={0} className="eidos-panel-resizer"
    onPointerDown={event => {
      if (event.button !== 0) return;
      event.preventDefault(); event.stopPropagation();
      onResizeStart?.();
      start.current = { x: event.clientX, width: event.currentTarget.parentElement?.getBoundingClientRect().width || panel.width };
      event.currentTarget.setPointerCapture?.(event.pointerId);
    }} onPointerMove={event => { if (start.current) panel.change(start.current.width + start.current.x - event.clientX); }}
    onPointerUp={() => { start.current = null; }} onPointerCancel={() => { start.current = null; }}
    onKeyDown={event => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      event.preventDefault(); event.stopPropagation(); onResizeStart?.(); panel.change(panel.width + (event.key === 'ArrowLeft' ? 24 : -24));
    }} />;
}
