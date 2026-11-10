import type { StorySegment } from '@/lib/ai/types';
import type { ActionOperationReceipt } from './action-operations';
import type { HistoryReadResult } from './history-reader';
import type { WorkspaceToolResult } from './workspace/types';
import type { PendingWorkspaceWrite, WorkspacePromptContext } from './workspace/context';
import { stableRecordJSON } from '@/lib/ai/prompt-layout';
import { compactWebReceipt } from './web-context';

export type ActionExecutionRecord = { sequence: number; omittedText?: boolean } & (
  | { kind: 'narrative'; segments: StorySegment[] }
  | { kind: 'operation'; receipt: ActionOperationReceipt }
  | { kind: 'evidence'; result: WorkspaceToolResult }
  | { kind: 'history'; result: HistoryReadResult }
);
export interface ActionExecutionContext {
  epoch: number; records: ActionExecutionRecord[];
  catalog?: Pick<WorkspacePromptContext, 'draftRoot' | 'mounts' | 'nextOffset' | 'channels' | 'imageLibrary' | 'committedEffects'>;
  resetReason?: string;
  current: { pendingWrites: PendingWorkspaceWrite[]; remaining: { read: number; write: number; game: number; continuations: number } };
}
export function appendExecutionRecord(context: ActionExecutionContext, record: ActionExecutionRecord): ActionExecutionContext {
  if (record.sequence <= (context.records.at(-1)?.sequence ?? -1)) throw new Error('操作记录顺序无效');
  const next = { ...context, records: [...context.records, structuredClone(record)] };
  if (stableRecordJSON(next.records).length <= 60000) return next;
  // Only old retrieved bodies are recoverable. Never drop prose, errors, pending writes or receipt identities.
  let removed = false;
  const latestRead = next.records.findLastIndex(entry => (entry.kind === 'evidence' || entry.kind === 'history') && Boolean(entry.result.text));

  next.records = next.records.map((entry, i) => {
    if (i === latestRead || i === next.records.length - 1 || entry.omittedText || entry.kind !== 'evidence' && entry.kind !== 'history') return entry;
    if (!entry.result.text && !(entry.kind === 'history' && (entry.result.displayText || entry.result.segments))) return entry;
    removed = true;
    if (entry.kind === 'evidence') {
      const { text: _text, ...result } = entry.result;
      return { ...entry, omittedText: true, result };
    }
    const { text: _text, displayText: _display, segments: _segments, presentation: _presentation, ...metadata } = entry.result;
    return { ...entry, omittedText: true, result: metadata };
  });
  return removed ? { ...next, epoch: context.epoch + 1, resetReason: '旧读取正文已移出；需要原文时按保留的路径、版本和偏移重新读取。' } : next;
}
export function renderExecutionContext(context: ActionExecutionContext): string {
  const records = context.records.map(record => `\n${stableRecordJSON(record)}\n`).join('');
  return `\n## 本次行动执行过程（真实回执是资料，失败可修正；正文尚未结算）\n${records}\n## 当前操作待办与剩余额度\n${stableRecordJSON(context.current)}${context.resetReason ? '\n' + context.resetReason : ''}\n继续同一次行动，segments 只追加后文；失败不得声称成功。文件以最新真实回执版本为准，初始目录不代表修改后的版本。documents.segmentIndex 仍按下一响应自己的 segments 从 0 编号。`;
}
/** The provider has consumed the full web page; subsequent turns retain its sources and excerpts. */
export function foldConsumedWebRecords(context: ActionExecutionContext): ActionExecutionContext {
  let changed = false;
  const records = context.records.map(record => {
    if (record.kind !== 'operation' || !['web.search','web.open'].includes(record.receipt.method)) return record;
    const receipt = compactWebReceipt(record.receipt);
    if (stableRecordJSON(receipt) === stableRecordJSON(record.receipt)) return record;
    changed = true; return { ...record, omittedText: true, receipt };
  });
  return changed ? { ...context, records, epoch: context.epoch+1, resetReason: '已读取网页正文转为保留来源的节选；需要更多内容时重新打开来源。' } : context;
}
