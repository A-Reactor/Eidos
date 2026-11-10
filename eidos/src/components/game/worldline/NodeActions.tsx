"use client";
import { useInterfaceText } from "@/components/shell/useInterfaceText";


import { useState } from 'react';
import { useGameStore } from '@/store/game-store';
import { isPipelineBusy } from '@/lib/game/stream-lifecycle';
import type { WorldLineNode } from '@/lib/game/types';
import { ConfirmActions, ConfirmActionsExpanded } from './ConfirmActions';

export function NodeActions({ node, onBacktrack, onDelete, restrictedRewind = false }: {
  node: WorldLineNode;
  onBacktrack: (nodeId: string) => void | Promise<void>;
  onDelete: (nodeId: string) => void | Promise<void>;
  restrictedRewind?: boolean;
}) {
  const ui = useInterfaceText();
  const [busy, setBusy] = useState(false);
  const generating = useGameStore(state => state.isLoading);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmType, setConfirmType] = useState<'backtrack' | 'delete' | null>(null);
  const execute = async (action: () => void | Promise<void>) => {
    if (busy || useGameStore.getState().isLoading || isPipelineBusy()) return;
    setBusy(true); setError(null); setNotice(null);
    try { await action(); setConfirmType(null); setNotice('操作完成，可以返回游戏继续。'); }
    catch (error) { setError(error instanceof Error ? error.message : '操作失败，请重试'); }
    finally { setBusy(false); }
  };
  return (
      <fieldset disabled={busy || generating} aria-busy={busy} className="eidos-worldline-detail-actions">
        {generating && <p role="status" className="text-sm">{ui("行动完成后可回档或删除分支，回看不受影响。")}</p>}
        {busy && <p role="status" className="text-sm">{ui("正在处理…")}</p>}
        {error && <p role="alert" className="eidos-archive-error">{error}</p>}
        {notice && <p role="status" className="text-sm">{notice}</p>}
        {confirmType === "delete" && <p className="text-sm">{ui("删除这个节点和它之后的所有分支历史，此操作无法撤销。")}</p>}
        {/* 回档 — 仅当节点有快照数据时显示（根节点无快照） */}
        {restrictedRewind ? <p role="status" className="eidos-worldline-scope-note">{ui("可以回看这段经历。回溯能力由游戏依据剧情和角色能力判断目标。")}</p> : node.snapshotHash ? (
          <div key={`action-backtrack`}>
          {confirmType === "backtrack" ? (
            <ConfirmActionsExpanded
              confirmLabel="确认回档"
              variant="amber"
              onConfirm={() => {
                void execute(() => onBacktrack(node.id));
              }}
              onCancel={() => setConfirmType(null)}
            />
          ) : (
            <div onClick={() => setConfirmType("backtrack")}>
              <ConfirmActions
                label={ui("回档到此处")}
                confirmLabel="确认回档"
                variant="amber"
                onConfirm={() => {}}
              />
            </div>
          )}
          </div>
        ) : (
          <p className="eidos-worldline-scope-note">{ui("游戏开始 · 无法回档")}</p>
        )}

        {/* 删除 */}
        {!restrictedRewind && <div key={`action-delete`}>
          {confirmType === "delete" ? (
            <ConfirmActionsExpanded
              confirmLabel="确认删除"
              variant="red"
              onConfirm={() => {
                void execute(() => onDelete(node.id));
              }}
              onCancel={() => setConfirmType(null)}
            />
          ) : (
            <div onClick={() => setConfirmType("delete")}>
              <ConfirmActions
                label={ui("删除节点及后代")}
                confirmLabel="确认删除"
                variant="red"
                onConfirm={() => {}}
              />
            </div>
          )}
        </div>}
      </fieldset>
  );
}
