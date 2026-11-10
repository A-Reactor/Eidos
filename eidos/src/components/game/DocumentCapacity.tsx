'use client';
import { useInterfaceText } from "@/components/shell/useInterfaceText";

import { useCallback, useEffect, useRef, useState } from 'react';
import { ActionButton } from '@/components/ui/ActionButton';
import { useGameStore } from '@/store/game-store';
import { currentDocumentScope, documentScopeKey } from '@/lib/game/model-documents';
import { documentCapacity } from '@/lib/game/documents/capacity';
import { cleanupUnusedMaterials } from '@/lib/game/documents/material-cleanup';
import type { DocumentScope } from '@/lib/game/documents/types';
function bytes(value: number) {
  return value < 1024 ? `${value} B` : value < 1024 * 1024 ? `${(value / 1024).toFixed(1)} KiB` : `${(value / 1024 / 1024).toFixed(1)} MiB`;
}
export function DocumentCapacity({ scope }: { scope: DocumentScope }) {
  const ui = useInterfaceText();
  const [capacity, setCapacity] = useState<Awaited<ReturnType<typeof documentCapacity>> | null>(null);
  const [estimate, setEstimate] = useState<StorageEstimate | null>(null), [busy, setBusy] = useState(false), [notice, setNotice] = useState('');
  const alive = useRef(false), lock = useRef(false), sequence = useRef(0);
  const generating = useGameStore(s => s.isLoading);
  const reload = useCallback(async () => {
    const request = ++sequence.current;
    try {
      const data = await documentCapacity(scope);
      if (alive.current && request === sequence.current) setCapacity(data);
      if (navigator.storage?.estimate) {
        const usage = await navigator.storage.estimate();
        if (alive.current && request === sequence.current) setEstimate(usage);
      }
    } catch (cause) { if (alive.current) setNotice(cause instanceof Error ? cause.message : ui("容量读取失败")); }
  }, [ui, scope]);
  useEffect(() => {
    alive.current = true; queueMicrotask(() => { if (alive.current) void reload(); }); const changed = () => { void reload(); };
    window.addEventListener('eidos-documents-updated', changed);
    return () => { alive.current = false; window.removeEventListener('eidos-documents-updated', changed); };
  }, [reload]);
  const clean = async () => {
    if (lock.current || generating) return; lock.current = true; setBusy(true); setNotice('');
    try {
      const result = await cleanupUnusedMaterials({ isCurrent: () => {
        const state = useGameStore.getState(), current = currentDocumentScope(state);
        return alive.current && !state.isLoading && Boolean(current && documentScopeKey(current) === documentScopeKey(scope));
      } });
      if (alive.current) { setNotice(ui("已清理 {0} 份未引用原件，原始数据 {1}。", {"0": result.deleted, "1": bytes(result.bytes)})); await reload(); }
    } catch (cause) { if (alive.current) setNotice(cause instanceof Error ? cause.message : ui("清理失败，未删除原件")); }
    finally { lock.current = false; if (alive.current) setBusy(false); }
  };
  return <details className="mx-auto max-w-[68rem] border-t border-current/15 py-3" aria-label={ui("文档容量管理")}>
    <summary className="cursor-pointer text-sm">{ui("容量")}{capacity ? ` · ${bytes(capacity.bytes)}` : ui("统计")}</summary>
    {capacity && <p className="eidos-file-hint">{capacity.documents} {ui("份文档 · 回收站")} {capacity.trashed} {ui("份 · 暂存")} {capacity.drafts} {ui("份 ·")} {capacity.versions} {ui("个版本 ·")} {capacity.resources} {ui("份原件。大小按原件去重，包含历史、回收站和暂存资料，不等于磁盘占用。")}</p>}
    {estimate?.usage !== undefined && <p className="eidos-file-hint">{ui("应用存储估算")}{bytes(estimate.usage)}{estimate.quota !== undefined && ui(" / 可用配额 {0}", {"0": bytes(estimate.quota)})}{ui("，包含其他世界、存档和媒体。")}</p>}
    <p className="eidos-file-hint">{ui("清理只删除超过 7 天且未被存档、历史或工作区引用的原件，保留回收站、历史版本及无法确认安全的旧数据。")}</p>
    <div className="eidos-document-actions"><ActionButton icon="refresh" label={ui("刷新容量")} disabled={busy} onClick={() => void reload()} /><ActionButton icon="trash" label={ui("清理本机未引用原件")} iconOnly={false} disabled={busy || generating} onClick={() => void clean()} /></div>
    {notice && <p role="status" className="eidos-file-hint">{notice}</p>}
  </details>;
}
