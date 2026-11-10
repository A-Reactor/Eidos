'use client';

import { useLayoutEffect, useRef, type RefObject } from 'react';

type Entry = { root: RefObject<HTMLElement | null>; run: () => void; enabled: boolean };
const entries = new Set<Entry>();
const isVisible = (element: HTMLElement) => element.isConnected && !element.closest('[inert], [hidden], [aria-hidden="true"]') && getComputedStyle(element).display !== 'none' && getComputedStyle(element).visibility !== 'hidden';

function handleEscape(event: KeyboardEvent) {
  if (event.key !== 'Escape' || event.defaultPrevented || event.repeat || event.isComposing || event.keyCode === 229) return;
  const dialogs = Array.from(document.querySelectorAll<HTMLElement>('dialog[open], [role="dialog"]')).filter(isVisible);
  const dialog = dialogs.at(-1);
  // Native dialogs own system dismissal. A custom modal also blocks all page returns.
  if (dialog?.matches('dialog[open]')) { event.stopImmediatePropagation(); return; }
  const candidates = [...entries].filter(entry => entry.enabled && entry.root.current && isVisible(entry.root.current) && (!dialog || dialog.contains(entry.root.current)));
  candidates.sort((a, b) => {
    const position = a.root.current!.compareDocumentPosition(b.root.current!);
    return position & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : position & Node.DOCUMENT_POSITION_PRECEDING ? 1 : 0;
  });
  const top = candidates.at(-1);
  if (!top) return;
  // Consume before closing: unmounting a layer must not expose its parent to the same key.
  event.preventDefault(); event.stopImmediatePropagation();
  top.run();
}

/** Register the same guarded return action used by this layer's back/close button. */
export function useEscapeBack(root: RefObject<HTMLElement | null>, run: () => void, enabled = true) {
  const entry = useRef<Entry>({ root, run, enabled });
  useLayoutEffect(() => { Object.assign(entry.current, { root, run, enabled }); });
  useLayoutEffect(() => {
    const current = entry.current;
    if (!entries.size) window.addEventListener('keydown', handleEscape);
    entries.add(current);
    return () => {
      entries.delete(current);
      if (!entries.size) window.removeEventListener('keydown', handleEscape);
    };
  }, []);
}
