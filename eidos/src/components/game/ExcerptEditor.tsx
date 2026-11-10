"use client";
import { useInterfaceText } from "@/components/shell/useInterfaceText";


import { useRef, useState } from 'react';
import { InteractionDialog } from '@/components/ui/InteractionDialog';
import { recordPresentationText } from '@/lib/game/presentation';
import { useGameStore } from '@/store/game-store';

export interface ExcerptDraft {
  nodeId: string;
  originId?:string;
  text: string;
  note: string;
  excerptId?: string;
}

const button = 'eidos-focus eidos-dossier-action px-3 py-2 text-sm disabled:opacity-40';

export function ExcerptEditor({ draft, onClose }: { draft: ExcerptDraft; onClose: () => void }) {
  const ui = useInterfaceText();
  const [note, setNote] = useState(draft.note);
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const savedExcerptId = useRef(draft.excerptId);
  const [error, setError] = useState<string | null>(null);
  const source = useGameStore(s => s.allNodes[draft.nodeId]);
  const save = async () => {
    if (saving.current) return;
    const store = useGameStore.getState();
    const node = store.allNodes[draft.nodeId];
    if (!node || !savedExcerptId.current && !recordPresentationText(node,store.allNodes,draft.originId ?? store.currentNode?.id).includes(draft.text) ||
      (savedExcerptId.current && !node.playerExcerpts?.some(entry => entry.id === savedExcerptId.current))) {
      setError('原文已不在当前记录中，请关闭后重新选择。'); return;
    }
    saving.current = true; setBusy(true); setError(null);
    if (savedExcerptId.current) store.updatePlayerExcerpt(draft.nodeId, savedExcerptId.current, note);
    else {
      store.addPlayerExcerpt(draft.nodeId, draft.text, note,draft.originId);
      // Retrying after a disk failure edits the same record, even if the note changed.
      savedExcerptId.current = useGameStore.getState().allNodes[draft.nodeId].playerExcerpts?.find(entry => entry.text === draft.text.trim() && entry.note === note.trim())?.id;
    }
    try { await useGameStore.getState().persistWorldLineData(); onClose(); }
    catch { setError('摘录尚未保存到磁盘，你的备注仍保留在这里。请重试保存。'); }
    finally { saving.current = false; setBusy(false); }
  };
  return <InteractionDialog title={draft.excerptId ? ui("编辑备注") : ui("我的摘录")} onClose={() => { if (!saving.current) onClose(); }}>
    <form className="max-h-[70dvh] space-y-4 overflow-y-auto" onSubmit={event => { event.preventDefault(); void save(); }}>
      <blockquote className="max-h-48 overflow-y-auto whitespace-pre-wrap text-sm leading-7">{draft.text}</blockquote>
      {source && <p className="text-xs text-black/55">{ui("第")}{source.gameTime.day}{ui("天 ·")}{source.sceneName}</p>}
      <label className="block text-sm">{ui("我的备注")}<textarea autoFocus disabled={busy} value={note} onChange={event => setNote(event.target.value)} placeholder={ui("可以留空，稍后再记")} className="eidos-focus mt-2 block min-h-24 w-full border border-black/25 bg-white p-3 text-base text-black" /></label>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      <div className="flex flex-wrap gap-3">
        <button type="submit" disabled={busy} className={button}>{busy ? ui("正在保存…") : error ? ui("重试保存") : draft.excerptId ? ui("保存备注") : ui("保存摘录")}</button>
        <button type="button" disabled={busy} className={button} onClick={onClose}>{ui("取消")}</button>
      </div>
    </form>
  </InteractionDialog>;
}
