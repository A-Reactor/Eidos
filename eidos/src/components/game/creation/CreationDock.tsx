"use client";
import { useInterfaceText } from "@/components/shell/useInterfaceText";

import { useCallback, useEffect, useRef, type ReactNode } from 'react';

export function CreationDock({ children }: { children: ReactNode }) {
  const ui = useInterfaceText();
  const panel = useRef<HTMLElement>(null);
  const handle = useRef<HTMLDivElement>(null);
  const pointer = useRef<number | null>(null);
  const limit = useCallback(() => Math.max(56, (panel.current?.parentElement?.getBoundingClientRect().height ?? 600) * .65), []);
  const resize = useCallback((height: number, explicit = true) => {
    const value = Math.round(Math.max(56, Math.min(limit(), height)));
    // Observing a valid default must not freeze its responsive CSS height.
    if (explicit || value !== Math.round(height)) panel.current?.style.setProperty('--creation-dock-height', `${value}px`);
    handle.current?.setAttribute('aria-valuenow', String(value));
    handle.current?.setAttribute('aria-valuemax', String(Math.round(limit())));
  }, [limit]);
  useEffect(() => {
    if (!panel.current || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      if (panel.current) resize(panel.current.getBoundingClientRect().height, false);
    });
    observer.observe(panel.current);
    return () => observer.disconnect();
  }, [resize]);
  return <footer ref={panel} className="eidos-world-create__footer eidos-creation-dock" aria-label={ui("生成任务底栏")}>
    <div ref={handle} role="separator" className="eidos-creation-dock-handle eidos-focus" tabIndex={0} aria-label={ui("生成进度高度")} aria-orientation="horizontal" aria-valuemin={56} aria-valuemax={600} aria-valuenow={176}
      onPointerDown={event => {
        if (event.button !== 0) return;
        event.preventDefault(); pointer.current = event.pointerId; event.currentTarget.setPointerCapture(event.pointerId);
      }} onPointerMove={event => {
        if (pointer.current === event.pointerId && panel.current) resize(panel.current.getBoundingClientRect().bottom - event.clientY);
      }} onPointerUp={event => {
        if (pointer.current === event.pointerId) { pointer.current = null; event.currentTarget.releasePointerCapture(event.pointerId); }
      }} onLostPointerCapture={() => { pointer.current = null; }}
      onKeyDown={event => {
        const current = panel.current?.getBoundingClientRect().height ?? 176;
        const next = ({ ArrowUp: current + 32, ArrowDown: current - 32, Home: 56, End: limit() } as Record<string, number>)[event.key];
        if (next !== undefined) { event.preventDefault(); resize(next); }
      }}><span aria-hidden="true" /></div>
    <div className="eidos-creation-dock-body">{children}</div>
  </footer>;
}
