'use client';
import { useInterfaceText } from "@/components/shell/useInterfaceText";

import { useId, useRef, useState } from 'react';
import { ArchiveScreen } from '@/components/ui/ArchiveScreen';
import { BackButton } from '@/components/ui/BackButton';
import { InteractionDialog } from '@/components/ui/InteractionDialog';
import { useGameStore } from '@/store/game-store';
import type { SaveSlot } from '@/lib/game/types';

function SaveCard({ slot, number, disabled, onOverwrite }: { slot: SaveSlot; number: number; disabled: boolean; onOverwrite: () => void }) {
  const ui = useInterfaceText();
  return <li className="eidos-manual-save-slot">
    <div className="eidos-manual-save-slot-top"><span className="eidos-manual-save-number">{ui("存档")}{String(number).padStart(2, '0')}</span><time dateTime={new Date(slot.updatedAt).toISOString()}>{new Date(slot.updatedAt).toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</time></div>
    <h2>{slot.name}</h2>
    <p>{slot.playerName} · {slot.currentSceneName}</p>
    <p>{ui("第")} {slot.gameTime.day} {ui("天 ·")}{String(slot.gameTime.hour).padStart(2, '0')}:{String(slot.gameTime.minute).padStart(2, '0')} {ui("· 第")} {slot.actionCount} {ui("步 · 游玩")}{Math.round(slot.playDuration || 0)} {ui("分钟")}</p>
    <div className="eidos-manual-save-slot-bottom"><p>{slot.preview}</p><button type="button" className="eidos-focus eidos-archive-button" disabled={disabled} aria-label={ui("覆盖存档 {0}", {"0": slot.name})} onClick={onOverwrite}>{ui("覆盖")}</button></div>
  </li>;
}

/** Uses the active archive cache, so another world, playthrough or sandbox cannot become a save target. */
export function ManualSavePage({ onBack, onSave, busy }: {
  onBack: () => void; onSave: (name?: string, overwriteSaveId?: string) => Promise<string>; busy: boolean;
}) {
  const ui = useInterfaceText();
  const store = useGameStore();
  const nameId = useId();
  const [name, setName] = useState('');
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
  const [confirm, setConfirm] = useState<SaveSlot | null>(null);
  const [feedback, setFeedback] = useState<'success' | 'error' | null>(null);
  const slots = store.cachedSaveSlots.filter(slot => slot.worldId === store.currentWorld?.id && slot.playthroughId === store.currentPlaythroughId &&
    (!slot.type || slot.type === 'manual') && !slot.id.startsWith('autosave_')).sort((a, b) => b.updatedAt - a.updatedAt);
  const disabled = busy || pending;
  const save = async (slot?: SaveSlot) => {
    if (busy || pendingRef.current) return;
    pendingRef.current = true; setPending(true); setFeedback(null);
    try {
      const id = await onSave(slot ? undefined : name.trim() || undefined, slot?.id);
      setFeedback(id ? 'success' : 'error');
      if (id && !slot) setName('');
    } catch { setFeedback('error'); }
    finally { pendingRef.current = false; setPending(false); setConfirm(null); }
  };
  return <ArchiveScreen className="eidos-archive-resource-page eidos-manual-save-page" title={ui("手动保存")} onBack={onBack} swipeBack backLabel={ui("返回档案目录")}
    beforeBack={leave => { if (!pendingRef.current) leave(); }} action={<BackButton onClick={onBack} label={ui("返回档案目录")} />}>
    <div className="eidos-manual-save-content">
      <section className="eidos-manual-save-current" aria-label={ui("当前进度")}><strong>{store.currentWorld?.name}</strong><p>{store.playerName || ui("主角")} · {store.currentScene?.name || ui("位置待确认")}</p><p>{ui("第")} {store.gameTime.day} {ui("天 · 第")} {store.currentNode?.stepNumber ?? 0} {ui("步")}</p></section>
      <form className="eidos-manual-save-new" onSubmit={event => { event.preventDefault(); void save(); }}>
        <label htmlFor={nameId}>{ui("存档名称")}</label><input id={nameId} className="eidos-focus" value={name} maxLength={80} disabled={disabled} placeholder={ui("留空使用当前世界与游戏日期")} onChange={event => setName(event.target.value)} />
        <button className="eidos-focus eidos-archive-button" type="submit" disabled={disabled}>{pending ? ui("保存中…") : ui("新建存档")}</button>
      </form>
      {feedback && <p role={feedback === 'error' ? 'alert' : 'status'} className="eidos-manual-save-feedback">{feedback === 'success' ? ui("保存成功") : ui("保存失败，请重试。")}</p>}
      <p className="eidos-manual-save-count">{ui("当前周目 ·")}{slots.length} {ui("个手动存档")}</p>
      {slots.length ? <ol aria-label={ui("当前周目手动存档")}>{slots.map((slot, index) => <SaveCard key={slot.id} slot={slot} number={index + 1} disabled={disabled} onOverwrite={() => setConfirm(slot)} />)}</ol> : <p className="eidos-manual-save-empty">{ui("还没有手动存档。新建一个存档，留住此刻的进度。")}</p>}
    </div>
    {confirm && <InteractionDialog title={ui("覆盖此存档？")} onClose={() => { if (!pendingRef.current) setConfirm(null); }}><p>{ui("将用当前进度替换“")}{confirm.name}”。</p><div className="eidos-manual-save-confirm"><button className="eidos-focus eidos-archive-button" disabled={disabled} onClick={() => setConfirm(null)}>{ui("取消")}</button><button className="eidos-focus eidos-archive-button" disabled={disabled} onClick={() => { void save(confirm); }}>{pending ? ui("保存中…") : ui("确认覆盖")}</button></div></InteractionDialog>}
  </ArchiveScreen>;
}
