'use client';
import { useInterfaceText } from "@/components/shell/useInterfaceText";

import { useCallback, useEffect, useRef, useState } from 'react';
import { useGameStore } from '@/store/game-store';
import { inspectWorkspaceConflicts, resolveWorkspaceConflict, type WorkspaceConflict } from '@/lib/game/workspace/conflicts';
import { lineDiff } from '@/lib/game/documents/line-diff';
import { ActionButton } from '@/components/ui/ActionButton';
import { ActionIcon } from '@/components/ui/ActionIcon';
import { BackButton } from '@/components/ui/BackButton';
import { DocumentDialog } from './DocumentDialog';

function Comparison({ conflict }: { conflict: WorkspaceConflict }) {
  const ui = useInterfaceText();
  const [full, setFull] = useState(false), [base, setBase] = useState(false);
  const difference = lineDiff(base ? conflict.baseText : conflict.currentText, conflict.candidateText);
  return <section aria-label={ui("文件版本比较")}>
    <div className="eidos-conflict-versions">{[{ label: ui("原始版本"), title: conflict.base?.title ?? ui("新建文件") }, { label: conflict.currentIsPending ? ui("前一步候选") : ui("当前版本"), title: conflict.current?.title ?? ui("尚无版本") }, { label: ui("候选版本"), title: conflict.candidate.title }].map(version => <div key={version.label}><small>{ui(version.label)}</small><span><ActionIcon name="file" />{version.title}</span></div>)}</div>
    <div className="eidos-conflict-controls"><div role="group" aria-label={ui("比较基准")} className="eidos-file-segmented"><ActionButton icon="file" label={ui("比较当前与候选")} text="当前" iconOnly={false} aria-pressed={!base} onClick={() => setBase(false)} /><ActionButton icon="history" label={ui("比较原始与候选")} text="原始" iconOnly={false} aria-pressed={base} onClick={() => setBase(true)} /></div><ActionButton icon={full ? 'compare' : 'file'} label={full ? ui("查看差异") : ui("查看三个版本全文")} text={full ? ui("差异") : ui("全文")} iconOnly={false} aria-pressed={full} onClick={() => setFull(value => !value)} /></div>
    {full ? <div className="eidos-conflict-originals">{[[ui("原始正文"), conflict.baseText], [ui("当前正文"), conflict.currentText], [ui("候选正文"), conflict.candidateText]].map(([label, text]) => <label key={label}>{label}<textarea aria-label={label} readOnly value={text} /></label>)}</div>
      : difference.identical ? <p className="eidos-file-hint">{ui("正文一致，请核对名称。")}</p> : <><pre className="eidos-file-diff" aria-label={ui("正文差异")}>{difference.rows.map((row, index) => <span key={index} data-diff={row.kind}>{row.kind === 'removed' ? '− ' : row.kind === 'added' ? '+ ' : '  '}{row.text}{'\n'}</span>)}</pre>{difference.omitted > 0 && <p className="eidos-file-hint">{ui("另有")}{difference.omitted} {ui("行差异，可切换全文查看。")}</p>}</>}
  </section>;
}

interface ConflictDialogProps { nodeId: string; segmentIndex: number; onClose(): void; onRetry(): Promise<void> }
function useConflictEditor({ nodeId, segmentIndex, onRetry }: ConflictDialogProps) {
  const ui = useInterfaceText();
  const branch = useGameStore(state => state.allNodes[nodeId]?.workspaceBranch);
  const heads = useGameStore(state => state.documentHeads);
  const [conflicts, setConflicts] = useState<WorkspaceConflict[]>([]), [index, setIndex] = useState(0);
  const [error, setError] = useState(''), [busy, setBusy] = useState(true), [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(''), [text, setText] = useState('');
  const alive = useRef(false), request = useRef(0);
  const [captured, setCaptured] = useState({ branch, heads });
  const stale = captured.branch !== branch || captured.heads !== heads;
  const conflict = conflicts[index];
  const reload = useCallback(async () => {
    const id = ++request.current; setBusy(true); setError('');
    try {
      const values = await inspectWorkspaceConflicts(useGameStore, nodeId, segmentIndex);
      if (!alive.current || id !== request.current) return;
      setCaptured({ branch: useGameStore.getState().allNodes[nodeId]?.workspaceBranch, heads: useGameStore.getState().documentHeads });
      setConflicts(values); setIndex(0); setEditing(false);
    } catch (cause) { if (alive.current) setError(cause instanceof Error ? cause.message : ui("比较失败")); }
    finally { if (alive.current && id === request.current) setBusy(false); }
  }, [ui, nodeId, segmentIndex]);
  useEffect(() => {
    alive.current = true; const generation = ++request.current;
    queueMicrotask(() => { if (alive.current && request.current === generation) void reload(); });
    return () => { alive.current = false; };
  }, [reload]);
  const apply = async (manual: boolean) => {
    setBusy(true); setError('');
    let resolved = false;
    try {
      if (conflict) await resolveWorkspaceConflict(useGameStore, conflict, manual ? { kind: 'manual', title, text } : { kind: 'candidate' });
      resolved = true;
      await onRetry();
    } catch (cause) { if (alive.current) { if (resolved) await reload(); setError(cause instanceof Error ? cause.message : ui("合并仍未完成")); } }
    finally { if (alive.current) setBusy(false); }
  };
  return { branch, conflicts, index, setIndex, error, busy, editing, setEditing, title, setTitle, text, setText, stale, conflict, reload, apply };
}
export function WorkspaceConflictDialog(props: ConflictDialogProps) {
  const ui = useInterfaceText();
  const { segmentIndex, onClose } = props;
  const { branch, conflicts, index, setIndex, error, busy, editing, setEditing, title, setTitle, text, setText, stale, conflict, reload, apply } = useConflictEditor(props);
  const primaryLabel = busy ? ui("正在处理…") : editing ? ui("保存合并并重试") : conflict ? ui("采用候选并重试") : branch?.mergeFailure?.phase === 'save' ? ui("重试保存记录") : ui("重新尝试合并");
  return <DocumentDialog title={ui("处理文件冲突")} icon="compare" closeLabel="关闭文件冲突" className="eidos-workspace-conflict" onClose={onClose} footer={<><BackButton header label={ui("稍后处理")} onClick={onClose} /><div className="eidos-file-dialog-actions"><ActionButton icon="refresh" label={ui("重新载入比较")} disabled={busy} onClick={() => void reload()} />
      {conflict && !editing && <ActionButton icon="edit" label={ui("编辑合并结果")} disabled={busy || stale} onClick={() => { setTitle(conflict.candidate.title); setText(conflict.candidateText); setEditing(true); }} />}
      <ActionButton icon={busy ? 'refresh' : editing ? 'save' : 'check'} label={primaryLabel} text={busy ? ui("处理中…") : editing ? ui("保存合并") : conflict ? ui("采用候选") : ui("重试")} iconOnly={false} variant="primary" disabled={busy || stale} aria-busy={busy} onClick={() => void apply(editing)} /></div></>}>
    <p className="eidos-file-hint">{branch?.mergeFailure?.phase === 'save' ? ui("文件已生效，本地记录尚未保存。") : ui("第 {0} 段的文件已被修改。比较版本或编辑合并结果后继续。", {"0": segmentIndex + 1})}{ui("各版本均会保留。")}</p>
    {branch?.mergeFailure && <p role="status" className="eidos-file-notice"><ActionIcon name="alert" />{branch.mergeFailure.phase === 'save' ? ui("文件已生效，但记录保存失败：") : ''}{branch.mergeFailure.message}</p>}
    {stale && <p role="alert" className="eidos-file-notice"><ActionIcon name="alert" />{ui("文件或候选已变化，请重新载入比较后处理。")}</p>}
    {error && <p role="alert" className="eidos-file-notice"><ActionIcon name="alert" />{error}</p>}
    {conflicts.length > 1 && <label>{ui("待处理文件")}<select aria-label={ui("待处理文件")} value={index} disabled={busy} onChange={event => { setIndex(Number(event.target.value)); setEditing(false); }}>{conflicts.map((value, i) => <option key={value.changeIndex} value={i}>{value.candidate.title}</option>)}</select></label>}
    {conflict && <Comparison key={`${conflict.candidate.revision}:${index}`} conflict={conflict} />}
    {!busy && !conflict && <p>{ui("没有可手动合并的普通文档冲突。角色文件需恢复作品授权或由原文件入口处理；存储故障修复后可直接重试。")}</p>}
    {editing && <div className="eidos-file-merge-editor"><label className="eidos-document-field">{ui("合并后名称")}<input aria-label={ui("合并后名称")} maxLength={240} value={title} onChange={event => setTitle(event.target.value)} /></label><label className="eidos-document-field">{ui("合并后正文")}<textarea aria-label={ui("合并后正文")} value={text} onChange={event => setText(event.target.value)} /></label></div>}

  </DocumentDialog>;
}
