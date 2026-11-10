"use client";
import { useInterfaceText } from "@/components/shell/useInterfaceText";

import { useState } from 'react';
import type { WorldLineNode } from '@/lib/game/types';
import type { WorkspaceToolResult } from '@/lib/game/workspace/types';
import { documentHref } from '@/lib/game/documents/inline-links';
import { ActionButton } from '@/components/ui/ActionButton';
import { InlineDocumentText } from './InlineDocumentText';

interface Props {
  node?: WorldLineNode | null; attempt?: WorkspaceToolResult[]; segmentIndex?: number;
  showConflict?: boolean; onResolve?(segment: number): void;
}
/** A file result belongs to the paragraph that owns it, like an ordinary recommendation. */
export function WorkspaceReceipts({ node, attempt, segmentIndex, showConflict, onResolve }: Props) {
  const ui = useInterfaceText();
  const [expandedError, setExpandedError] = useState<string | null>(null);
  const branch = node?.workspaceBranch, failure = branch?.mergeFailure;
  const recovered = branch?.effects.filter(receipt => receipt.segmentIndex <= branch.mergedThrough) ?? [];
  const sameFile = (a: WorkspaceToolResult, b: WorkspaceToolResult) => a.document && b.document ? a.document.documentId === b.document.documentId : Boolean(a.path && a.path === b.path);
  const at = (index: number) => segmentIndex === undefined || segmentIndex === index;
  const documents = (branch?.documents ?? []).filter(change => at(change.segmentIndex));
  const effects = (attempt ?? [...branch?.effects ?? node?.workspaceEffects ?? [], ...branch?.attempts ?? []]).filter(receipt =>
    at(receipt.segmentIndex ?? 0) && !((receipt.status === 'failed' || receipt.status === 'denied') && recovered.some(r => sameFile(r, receipt))) && !branch?.documents.some(change => change.link.revision === receipt.afterVersion));
  const showFailure = failure && (showConflict || at(failure.segmentIndex));
  const status = (index: number, changes?: { added: number; removed: number }) => failure && index > (branch?.mergedThrough ?? -1) && index <= failure.segmentIndex ? ui("合并受阻")
    : branch && index > branch.mergedThrough ? '待播放' : changes ? `+${changes.added} -${changes.removed}` : '已生效';
  const rows = documents.map(change => ({ key: `${change.link.documentId}:${change.link.revision}`,
    title: change.link.title, href: documentHref(change.link), state: status(change.segmentIndex, change.changes), error: undefined as string | undefined }));
  for (const [index, receipt] of effects.entries()) {
    const failed = receipt.status === 'failed' || receipt.status === 'denied';
    const title = receipt.resource?.revisionName ?? receipt.document?.title ?? receipt.path?.split('/').at(-1) ?? ui("文件操作");
    rows.push({ key: receipt.operationId ?? `attempt:${index}`, title, href: '', state: failed ? ui("失败") : status(receipt.segmentIndex ?? 0, receipt.changes), error: receipt.error });
  }
  if (!rows.length && !showFailure) return null;
  return <div className="eidos-record-options" aria-label={ui("文件操作")} onClick={event => event.stopPropagation()}>
    <ul className="list-none p-0">{rows.map(row => <li key={row.key} title={row.error} style={{ display: 'flex' }} className="eidos-record-option flex-wrap items-baseline justify-between gap-3">
      <span className="min-w-0 truncate">{row.href ? <InlineDocumentText text={`[${row.title.replace(/[\[\]\n]/g, ' ')}](${row.href})`} /> : row.title}</span>
      {row.error ? <button type="button" className="eidos-focus shrink-0 font-mono text-xs opacity-65" aria-label={ui("查看 {0} 失败原因", {"0": row.title})} aria-expanded={expandedError === row.key} onClick={() => setExpandedError(expandedError === row.key ? null : row.key)}>{row.state}</button> : <span className="shrink-0 font-mono text-xs opacity-65">{row.state}</span>}
      {row.error && expandedError === row.key && <p role="note" className="w-full break-words text-xs leading-6 opacity-65">{row.error}</p>}
    </li>)}</ul>
    {showFailure && <div role="status" aria-label={ui("文件合并状态")} title={failure.message} className="flex items-center justify-between gap-3 text-sm">
      <span>{failure.phase === 'save' ? ui("记录保存失败") : ui("合并受阻")}</span>
      {onResolve && <ActionButton icon="compare" label={ui("处理文件冲突")} onClick={() => onResolve(failure.segmentIndex)} />}
    </div>}
  </div>;
}
