'use client';
import { useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from 'react';

const STORAGE_KEY = 'eidos-gallery-columns';
const MIN_TILE = 48;
const MAX_COLUMNS = 24;
interface Pinch { columns: number; distance: number }
interface WebKitGesture extends Event { scale: number }

/** The gallery page accepts pinch gestures even over headings, directory entries, and blank space. */
function bindPinch(element: HTMLElement, current: () => number, change: (columns: number) => void) {
  let touch: Pinch | null = null, gesture: Pinch | null = null;
  let wheel: { at: number; columns: number; scale: number } | null = null;
  let suppressUntil = 0;
  const distance = (event: TouchEvent) => Math.hypot(event.touches[0].clientX - event.touches[1].clientX, event.touches[0].clientY - event.touches[1].clientY);
  const touchStart = (event: TouchEvent) => {
    if (event.touches.length !== 2) { touch = null; return; }
    touch = { columns: current(), distance: distance(event) };
    suppressUntil = Date.now() + 400;
  };
  const touchMove = (event: TouchEvent) => {
    if (!touch || event.touches.length !== 2 || touch.distance <= 0) return;
    event.preventDefault(); event.stopPropagation();
    const next = distance(event);
    if (next > 0) change(touch.columns * touch.distance / next);
    suppressUntil = Date.now() + 400;
  };
  const endTouch = () => { if (touch) suppressUntil = Date.now() + 400; touch = null; };
  const wheelMove = (event: WheelEvent) => {
    if (!event.ctrlKey) return;
    event.preventDefault(); event.stopPropagation();
    const now = Date.now();
    if (!wheel || now - wheel.at > 200) wheel = { at: now, columns: current(), scale: 1 };
    wheel.at = now; wheel.scale *= Math.exp(-Math.max(-500, Math.min(500, event.deltaY)) * .006);
    wheel.scale = Math.max(.01, Math.min(100, wheel.scale));
    change(wheel.columns / wheel.scale);
  };
  const gestureStart = (event: Event) => { event.preventDefault(); gesture = { columns: current(), distance: 1 }; };
  const gestureMove = (event: Event) => {
    if (!gesture) return;
    event.preventDefault(); event.stopPropagation();
    const scale = (event as WebKitGesture).scale;
    if (scale > 0) change(gesture.columns / scale);
  };
  const gestureEnd = () => { gesture = null; };
  const click = (event: MouseEvent) => {
    if (event.detail > 0 && Date.now() < suppressUntil) { event.preventDefault(); event.stopPropagation(); }
  };
  element.addEventListener('touchstart', touchStart, { passive: true });
  element.addEventListener('touchmove', touchMove, { passive: false });
  element.addEventListener('touchend', endTouch); element.addEventListener('touchcancel', endTouch);
  element.addEventListener('wheel', wheelMove, { passive: false });
  element.addEventListener('gesturestart', gestureStart, { passive: false });
  element.addEventListener('gesturechange', gestureMove, { passive: false });
  element.addEventListener('gestureend', gestureEnd); element.addEventListener('click', click, true);
  return () => {
    element.removeEventListener('touchstart', touchStart); element.removeEventListener('touchmove', touchMove);
    element.removeEventListener('touchend', endTouch); element.removeEventListener('touchcancel', endTouch);
    element.removeEventListener('wheel', wheelMove); element.removeEventListener('gesturestart', gestureStart);
    element.removeEventListener('gesturechange', gestureMove); element.removeEventListener('gestureend', gestureEnd);
    element.removeEventListener('click', click, true);
  };
}

export function useAlbumZoom(ref: RefObject<HTMLDivElement | null>) {
  const [width, setWidth] = useState(0);
  const [preferred, setPreferred] = useState(() => {
    try { const saved = Number(localStorage.getItem(STORAGE_KEY)); return Number.isInteger(saved) && saved >= 1 && saved <= MAX_COLUMNS ? saved : 0; }
    catch { return 0; }
  });
  const max = Math.max(1, Math.min(MAX_COLUMNS, Math.floor((width + 3) / (MIN_TILE + 3))));
  const columns = Math.min(max, preferred || Math.max(1, Math.round(width / 190)));
  const change = (value: number) => {
    const next = Math.max(1, Math.min(max, Math.round(value)));
    setPreferred(next);
    try { localStorage.setItem(STORAGE_KEY, String(next)); } catch { /* This gesture still applies if storage is full. */ }
  };
  const live = useRef({ columns, change });
  useLayoutEffect(() => { live.current = { columns, change }; });
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => setWidth(element.getBoundingClientRect().width);
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(element);
    const surface = element.closest<HTMLElement>('.eidos-gallery-screen') ?? element;
    const unbind = bindPinch(surface, () => live.current.columns, value => live.current.change(value));
    return () => { observer?.disconnect(); unbind(); };
  }, [ref]);
  return { style: { '--album-columns': columns } as CSSProperties };
}
