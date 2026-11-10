'use client';
import { useInterfaceText } from "@/components/shell/useInterfaceText";

import { useRef } from 'react';

/** Resize the graph vertically without competing with the graph's own pan gesture. */
export function MobileReadingDivider() {
  const ui = useInterfaceText();
  const drag = useRef<number | null>(null);
  const resize = (element: HTMLElement, percent: number) => {
    element.parentElement?.style.setProperty('--mobile-map-height', `${Math.max(20, Math.min(65, percent))}%`);
    element.setAttribute('aria-valuenow', String(Math.round(Math.max(20, Math.min(65, percent)))));
  };
  const move = (element: HTMLElement, y: number) => {
    const bounds = element.parentElement?.getBoundingClientRect();
    if (bounds?.height) resize(element, (y - bounds.top - 12) / bounds.height * 100);
  };
  return <div className="eidos-mobile-reading-divider eidos-focus" role="separator" aria-label={ui("分支图与原文高度")} aria-orientation="horizontal"
    aria-valuemin={20} aria-valuemax={65} aria-valuenow={35} tabIndex={0}
    onPointerDown={event => {
      if (event.button !== 0) return;
      event.preventDefault(); drag.current = event.pointerId; event.currentTarget.setPointerCapture(event.pointerId);
    }} onPointerMove={event => { if (drag.current === event.pointerId) move(event.currentTarget, event.clientY); }}
    onPointerUp={event => { if (drag.current === event.pointerId) { drag.current = null; event.currentTarget.releasePointerCapture(event.pointerId); } }}
    onLostPointerCapture={() => { drag.current = null; }}
    onKeyDown={event => {
      const value = Number(event.currentTarget.getAttribute('aria-valuenow'));
      const next = ({ ArrowUp: value - 5, ArrowDown: value + 5, Home: 20, End: 65 } as Record<string, number>)[event.key];
      if (next !== undefined) { event.preventDefault(); resize(event.currentTarget, next); }
    }}><span aria-hidden="true" /></div>;
}
