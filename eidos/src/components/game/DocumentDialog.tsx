'use client';
import { ActionButton } from '@/components/ui/ActionButton';
import { ActionIcon, type ActionIconName } from '@/components/ui/ActionIcon';
import { createPortal } from 'react-dom';
import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { useEscapeBack } from '@/components/ui/use-escape-back';

/** One focus boundary prevents document overlays from driving the underlying reader. */
export function DocumentDialog({ title, heading = title, icon = 'file', closeLabel = `关闭${title}`, footer, onClose, children, className = '' }: { title: string; heading?: string; icon?: ActionIconName; closeLabel?: string; footer?: ReactNode; onClose(): void; children: ReactNode; className?: string }) {
  const root = useRef<HTMLDivElement>(null);
  useEscapeBack(root, onClose);
  useLayoutEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    root.current?.focus({ preventScroll: true });
    const retain = (event: FocusEvent) => { if (event.target instanceof Node && root.current && !root.current.contains(event.target)) root.current.focus({ preventScroll: true }); };
    document.addEventListener('focusin', retain);
    return () => { document.removeEventListener('focusin', retain); if (previous?.isConnected) previous.focus({ preventScroll: true }); };
  }, []);
  if (typeof document === 'undefined') return null;
  return createPortal(<div className="eidos-document-dialog-backdrop" onClick={event => event.stopPropagation()} onPointerDown={event => { event.stopPropagation(); if (event.target === event.currentTarget) onClose(); }}>
    <div ref={root} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} className={`eidos-document-picker eidos-refined-dialog ${className}`} onKeyDown={event => {
      event.stopPropagation();
      if (event.key === 'Escape' && !event.defaultPrevented && !event.repeat && !event.nativeEvent.isComposing) { event.preventDefault(); onClose(); }
      if (event.key === 'Tab') {
        const items = Array.from(root.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),a[href],[tabindex="0"]') ?? []).filter(el => !el.hidden && !el.closest('[inert]'));
        const first = items[0], last = items.at(-1);
        if (!first) { event.preventDefault(); return; }
        if (event.shiftKey && (document.activeElement === first || document.activeElement === root.current)) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && (document.activeElement === last || document.activeElement === root.current)) { event.preventDefault(); first.focus(); }
      }
    }}><header className="eidos-file-dialog-header"><div><ActionIcon name={icon} /><h2>{heading}</h2></div><ActionButton icon="close" label={closeLabel} onClick={onClose} /></header>
      <div className="eidos-file-dialog-body">{children}</div>{footer && <footer className="eidos-file-dialog-footer">{footer}</footer>}
    </div>
  </div>, document.body);
}
