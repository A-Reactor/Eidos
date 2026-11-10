"use client";
import { useInterfaceText } from "@/components/shell/useInterfaceText";


import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useGameStore } from '@/store/game-store';
import { recordPresentationText } from '@/lib/game/presentation';
import { ExcerptEditor, type ExcerptDraft } from './ExcerptEditor';

export function ExcerptSelection({ nodeId, originId, disabled, onActiveChange, children }: {
  nodeId: string | null;
  originId?:string;
  disabled: boolean;
  onActiveChange: (active: boolean) => void;
  children: ReactNode;
}) {
  const ui = useInterfaceText();
  const root = useRef<HTMLDivElement>(null);
  const [selection, setSelection] = useState<{ nodeId: string; text: string } | null>(null);
  const [draft, setDraft] = useState<ExcerptDraft | null>(null);
  const activeSelection = !disabled && selection?.nodeId === nodeId ? selection : null;
  const activeDraft = draft?.nodeId === nodeId ? draft : null;
  useEffect(() => { onActiveChange(Boolean(activeSelection || activeDraft)); }, [activeSelection, activeDraft, onActiveChange]);
  useEffect(() => {
    const update = () => {
      const selected = window.getSelection();
      let text = selected?.toString().trim() ?? '';
      const state=useGameStore.getState();
      const node = nodeId ? state.allNodes[nodeId] : null;
      const textForNode=node ? recordPresentationText(node,state.allNodes,originId ?? state.currentNode?.id) : '';
      const storyElement = (point: Node | null | undefined) => (point instanceof Element ? point : point?.parentElement)?.closest('[data-reading-text]');
      const anchor = storyElement(selected?.anchorNode);
      const focus = storyElement(selected?.focusNode);
      // Dialogue wrappers differ visually from the archived speaker-prefixed text.
      // Remove only presentation quotes, and still require an exact visible-source match.
      if (node && anchor === focus && anchor?.hasAttribute('data-reading-dialogue') && !textForNode.includes(text)) {
        text = text.replace(/^[“「]|[”」]$/g, '').trim();
      }
      // Only actual story text can be excerpted; labels and hidden world data are excluded.
      if (disabled || !node || !text || !anchor || !focus || !root.current?.contains(anchor) ||
        !root.current.contains(focus) || !textForNode.includes(text)) { setSelection(null); return; }
      setSelection({ nodeId: node.id, text });
    };
    document.addEventListener('selectionchange', update);
    return () => document.removeEventListener('selectionchange', update);
  }, [nodeId, originId, disabled]);
  return <div ref={root} className="contents">
    {children}
    {activeSelection && !activeDraft && <button type="button" aria-label={ui("摘录选中文字")}
      onPointerDown={event => event.preventDefault()} onKeyDown={event => event.stopPropagation()}
      onClick={() => { setDraft({ ...activeSelection, originId, note: '' }); window.getSelection()?.removeAllRanges(); setSelection(null); }}
      className="eidos-focus fixed bottom-20 right-5 z-[110] border border-black/25 bg-[var(--eidos-paper)] px-4 py-3 text-sm text-black shadow-lg">{ui("摘录选中文字")}</button>}
    {activeDraft && <ExcerptEditor draft={activeDraft} onClose={() => setDraft(null)} />}
  </div>;
}
