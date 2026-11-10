"use client";

import { useContext, useEffect, useId, useRef, useState, useSyncExternalStore, type MouseEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useMobileSwipe } from './use-mobile-swipe';
import { ArchiveToolbarContext } from './archive-toolbar-context';
import { ArchiveDirectoryContext } from './archive-directory-context';

const query = '(max-width: 767px)';
const subscribe = (notify: () => void) => {
  const media = window.matchMedia?.(query);
  media?.addEventListener('change', notify);
  return () => media?.removeEventListener('change', notify);
};
const snapshot = () => window.matchMedia?.(query).matches ?? false;

type SidebarProps = {
  label: string;
  current?: string;
  closeLabel?: string;
  className: string;
  as?: 'aside' | 'nav' | 'div';
  children?: ReactNode;
  side?: 'left' | 'right';
};

/** Keep a single directory: hidden mobile controls must never duplicate form IDs. */
export function ResponsiveSidebar(props: SidebarProps) {
  const mobile = useSyncExternalStore(subscribe, snapshot, () => false);
  const directory = useContext(ArchiveDirectoryContext);
  const Tag = props.as ?? 'aside';
  // Keep the mobile cards positioned before hydration detects the viewport. Otherwise
  // the visible desktop inspector slides out to the right during phone entry.
  if (directory) {
    return <>
      <Tag className={`eidos-directory-index eidos-sidebar-directory ${props.className}`} aria-label={props.label} inert={mobile && !directory.open} aria-hidden={mobile ? !directory.open : undefined}
        onClick={event => {
          const action = (event.target as Element).closest('button, a');
          if (mobile && action && !action.matches(':disabled, [aria-disabled="true"], [data-sidebar-keep-open]') && !event.defaultPrevented) directory.showDetail();
        }}>{props.children}</Tag></>;
  }
  return mobile ? <MobileSidebar {...props} /> : <Tag className={props.className} aria-label={props.label}>{props.children}</Tag>;
}

function MobileSidebar({ label, current, closeLabel = '收起菜单', className, as: Tag = 'aside', children, side = 'left' }: SidebarProps) {
  const [open, setOpen] = useState(false);
  const toolbar = useContext(ArchiveToolbarContext);
  const panel = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const id = useId();
  const close = () => setOpen(false);
  useMobileSwipe(panel, { direction: side === 'right' ? 'right' : 'left', onSwipe: close, enabled: open });
  useEffect(() => {
    const dialog = panel.current!;
    const button = trigger.current;
    if (!open) return;
    // The top layer keeps the page inert and routes Escape/system dismiss to this menu.
    dialog.showModal();
    dialog.querySelector<HTMLElement>('[aria-current="page"], [aria-current="step"], [aria-pressed="true"]')?.focus({ preventScroll: true });
    return () => { dialog.close(); button?.focus({ preventScroll: true }); };
  }, [open]);
  const choose = (event: MouseEvent<HTMLElement>) => {
    const action = (event.target as Element).closest('button, a');
    if (action && !action.matches(':disabled, [aria-disabled="true"], [data-sidebar-keep-open]') && !event.defaultPrevented) close();
  };
  const entry = <button ref={trigger} type="button" className="eidos-focus eidos-sidebar-trigger" aria-label={label} title={[label, current].filter(Boolean).join(' · ')}
      aria-haspopup="dialog" aria-controls={id} aria-expanded={open} onClick={() => setOpen(true)}>
      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M4 6h16M4 12h16M4 18h16" /></svg>
      <span>{label}</span><b>{current}</b><span aria-hidden="true">›</span>
    </button>;
  return <>
    {toolbar ? createPortal(entry, toolbar) : entry}
    <dialog ref={panel} id={id} aria-labelledby={`${id}-title`} className="eidos-sidebar-dialog" data-side={side} onCancel={event => { event.preventDefault(); close(); }}
      onClick={event => { if (event.target === event.currentTarget) close(); }}>
      <header className="eidos-sidebar-dialog-head"><h2 id={`${id}-title`}>{label}</h2><button type="button" className="eidos-focus" aria-label={closeLabel} onClick={close}>×</button></header>
      <Tag className={`eidos-sidebar-directory ${className}`} aria-label={label} onClick={choose}>{children}</Tag>
    </dialog>
  </>;
}
