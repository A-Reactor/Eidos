"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { useEscapeBack } from './use-escape-back';

export function InteractionDialog({ title, children, onClose, className = "", footer }: { title: string; children: ReactNode; footer?: ReactNode; onClose: () => void; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  useEscapeBack(ref, onClose);
  useEffect(() => { closeRef.current = onClose; }, [onClose]);
  const titleId = useId();
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const panel = ref.current!;
    panel.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented && !event.repeat && !event.isComposing) { event.preventDefault(); event.stopPropagation(); closeRef.current(); }
      if (event.key !== "Tab") return;
      const elements = Array.from(panel.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]'));
      const first = elements[0], last = elements.at(-1);
      if (!first) { event.preventDefault(); return; }
      if (event.shiftKey && (document.activeElement === first || document.activeElement === panel)) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || document.activeElement === panel)) { event.preventDefault(); first.focus(); }
    };
    panel.addEventListener("keydown", onKey);
    return () => { panel.removeEventListener("keydown", onKey); previous?.focus(); };
  }, []);
  return <div className="eidos-interaction-overlay fixed inset-0 z-[200] flex items-center justify-center bg-black/65 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={titleId} className={`eidos-interaction-dialog eidos-dossier-card w-full max-w-lg ${footer ? "eidos-interaction-dialog--with-footer" : "space-y-5"} border p-6 shadow-2xl outline-none ${className}`}>
      <h2 id={titleId} className="text-xl font-semibold">{title}</h2>
      {footer ? <>
        <div className="eidos-interaction-dialog__body space-y-5">{children}</div>
        <footer className="eidos-interaction-dialog__footer">{footer}</footer>
      </> : children}
    </div>
  </div>;
}
