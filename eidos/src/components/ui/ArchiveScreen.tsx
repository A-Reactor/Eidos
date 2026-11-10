"use client";

import { useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useMobileSwipe } from './use-mobile-swipe';
import { useEscapeBack } from './use-escape-back';
import { useTextareaPageScroll } from './use-textarea-page-scroll';
import { ArchiveToolbarContext } from './archive-toolbar-context';
import { useI18n } from '@/components/shell/LocaleProvider';
import { ArchiveDirectoryContext } from './archive-directory-context';
import { BackButton } from './BackButton';
import { ArchiveBackContext } from './archive-back-context';
import { useMobilePageTransition } from './use-mobile-page-transition';
import { useMobileLayout } from '@/components/game/use-mobile-layout';

export function ArchiveScreen({ title, subtitle, action, headerContent, className = '', label, children, onBack, directoryFirst, swipeBack, beforeBack, backLabel, covered, navigationPlacement = 'start', menuSide = 'left' }: {
  title: string;
  subtitle?: ReactNode;
  action?: ReactNode;
  headerContent?: ReactNode;
  className?: string;
  label?: string;
  children?: ReactNode;
  onBack?: () => void;
  directoryFirst?: boolean;
  swipeBack?: boolean;
  beforeBack?: (leave: () => void) => void;
  backLabel?: string;
  covered?: boolean;
  navigationPlacement?: 'start' | 'end';
  menuSide?: 'left' | 'right';
}) {
  const root = useRef<HTMLElement>(null);
  const [toolbar, setToolbar] = useState<HTMLDivElement | null>(null);
  const [descriptionOpen, setDescriptionOpen] = useState(false);
  const descriptionId = useId();
  const { locale } = useI18n();
  const { mobile } = useMobileLayout(false);
  const transition = useMobilePageTransition(root, { mobile, onBack, beforeBack });
  const [indexOpen, setIndexOpen] = useState(directoryFirst ?? false);
  const stacked = mobile && directoryFirst !== undefined;
  const showIndex = () => setIndexOpen(true);
  const showDetail = () => setIndexOpen(false);
  useLayoutEffect(() => {
    if (!stacked) return;
    const detail = root.current?.querySelector<HTMLElement>('.eidos-directory-index ~ main');
    if (!detail) return;
    detail.inert = indexOpen;
    detail.setAttribute('aria-hidden', String(indexOpen));
    const index = root.current?.querySelector<HTMLElement>('.eidos-directory-index');
    // Move keyboard focus out of the card that just became inert without opening a keyboard.
    if (indexOpen && detail.contains(document.activeElement)) index?.querySelector<HTMLElement>('[aria-pressed="true"], [aria-current="page"], button')?.focus({ preventScroll: true });
    else if (!indexOpen && index?.contains(document.activeElement)) { detail.tabIndex = -1; detail.focus({ preventScroll: true }); }
    return () => { detail.inert = false; detail.removeAttribute('aria-hidden'); };
  }, [stacked, indexOpen]);
  useTextareaPageScroll(root);
  useMobileSwipe(root, { direction: stacked && indexOpen || !stacked && !swipeBack && menuSide === 'right' ? 'both' : 'right', onSwipe: direction => {
    if (stacked) {
      root.current?.style.removeProperty('--directory-drag');
      if (direction === 'left' && indexOpen) showDetail();
      else if (direction === 'right' && !indexOpen) showIndex();
      else if (direction === 'right') transition.back();
      return;
    }
    if (swipeBack) { transition.back(); return; }
    const menu = root.current?.querySelector<HTMLButtonElement>('.eidos-sidebar-trigger');
    if (menu && direction === (menuSide === 'right' ? 'left' : 'right')) menu.click();
    else if (direction === 'right') transition.back();
  }, onProgress: stacked ? distance => {
    transition.remember(distance);
    const page = root.current;
    if (!page) return;
    if (indexOpen && distance > 0) page.style.setProperty('--swipe-x', `${distance}px`);
    else if (indexOpen || distance > 0) page.style.setProperty('--directory-drag', `${distance}px`);
  } : distance => {
    // Overlay menus move independently; dragging the form would make it jump on release.
    if (!swipeBack && root.current?.querySelector('.eidos-sidebar-trigger') && (menuSide === 'right' ? distance < 0 : distance > 0)) return;
    transition.progress(distance);
  },
  onCancel: () => { transition.cancel(); root.current?.style.removeProperty('--directory-drag'); }, enabled: Boolean(onBack) && !covered });
  const back = stacked && !indexOpen ? showIndex : transition.back;
  useEscapeBack(root, back, Boolean(onBack) && !covered);
  return <ArchiveBackContext.Provider value={mobile && Boolean(onBack)}><ArchiveDirectoryContext.Provider value={directoryFirst !== undefined ? { open: indexOpen, showIndex, showDetail, back, backLabel: locale === 'en' ? 'Back to previous page' : '返回上一级' } : null}><ArchiveToolbarContext.Provider value={toolbar}><section ref={root} data-mobile-slide data-mobile-directory={directoryFirst !== undefined ? indexOpen ? 'index' : 'detail' : undefined} className={`eidos-refined-screen eidos-swipe-page eidos-mobile-page overflow-hidden ${className}`} onTransitionEnd={transition.onTransitionEnd} aria-label={label}
    >
    <header className="eidos-archive-header" inert={covered} aria-hidden={covered || undefined}>
      {navigationPlacement === 'start' && <div ref={setToolbar} className="eidos-archive-navigation" />}
      <div className="eidos-archive-heading"><span aria-hidden="true" /><div><div className="eidos-archive-title-row"><h1>{title}</h1>{subtitle && <button type="button" className="eidos-focus eidos-archive-description-toggle" aria-label={locale === 'en' ? 'Page description' : '页面说明'} aria-controls={descriptionId} aria-expanded={descriptionOpen} onClick={() => setDescriptionOpen(value => !value)}><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="12" cy="12" r="8" /><path d="M12 10v7m0-10v1" /></svg></button>}</div>{subtitle && <p id={descriptionId} data-expanded={descriptionOpen}>{subtitle}</p>}</div></div>
      {navigationPlacement === 'end' && <div ref={setToolbar} className="eidos-archive-navigation" />}
      {headerContent && <div className="eidos-archive-header-content">{headerContent}</div>}
      {action && <div className="eidos-archive-header-action">{action}</div>}
      {mobile && onBack && <div className="eidos-archive-back"><BackButton header onClick={back} label={backLabel} /></div>}
    </header>
    {children}
  </section></ArchiveToolbarContext.Provider></ArchiveDirectoryContext.Provider></ArchiveBackContext.Provider>;
}
