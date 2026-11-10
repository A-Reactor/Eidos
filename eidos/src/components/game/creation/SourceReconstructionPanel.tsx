
import { useInterfaceText } from "@/components/shell/useInterfaceText";
import { CreationImportZone } from './CreationImportZone';
import type { SourceDocumentDraft } from '@/lib/game/creation-materials';

export function SourceReconstructionPanel({ draft, documents, disabled, busy, progress, onDraft, onDocuments, onBuild }: {
  draft: SourceDocumentDraft; documents: SourceDocumentDraft[]; disabled: boolean; busy: boolean;
  progress: { completed: number; total: number; message: string };
  onDraft: (draft: SourceDocumentDraft) => void; onDocuments: (documents: SourceDocumentDraft[]) => void; onBuild: () => void;
}) {
  const ui = useInterfaceText();
  return <fieldset disabled={disabled || busy} className="min-w-0 space-y-5">
    <legend className="text-sm text-[color:var(--eidos-archive-ink)]">{ui("从文本搭建世界")}</legend>
    <p className="text-xs leading-6 text-[color:var(--eidos-archive-muted)]">{ui("按顺序添加文章或设定笔记。梳理后可逐项选择遵照原文、自由改写或由 AI 补全。")}</p>
    <label className="block space-y-2"><span>{ui("资料标题")}</span>
      <input aria-label={ui("资料标题")} value={draft.title} onChange={e => onDraft({ ...draft, title: e.target.value })} className="eidos-world-create__input w-full px-4 py-3" />
    </label>
    <label className="block space-y-2"><span>{ui("资料正文")}</span>
      <textarea aria-label={ui("资料正文")} value={draft.content} onChange={e => onDraft({ ...draft, content: e.target.value })} rows={12} className="eidos-world-create__input w-full p-4 resize-y" placeholder={ui("粘贴文章、章节或世界设定…")} />
    </label>
    <button type="button" className="eidos-focus eidos-world-create__ghost disabled:opacity-40" disabled={!draft.content.trim()} onClick={() => { onDocuments([...documents, { ...draft, id: draft.id ?? crypto.randomUUID() }]); onDraft({ title: ui("资料 {0}", {"0": documents.length + 2}), content: '' }); }}>{ui("加入资料")}</button>
    <CreationImportZone label={ui("拖入或选择文本资料")} inputLabel={ui("导入 TXT / Markdown")} accept=".txt,.md,text/plain,text/markdown" multiple disabled={disabled || busy}
      heading={ui("导入文本资料")} description={ui("拖放 TXT / Markdown 文件到此处，或点击选择文件")}
      hint={ui("支持一次导入多个文件，导入后可在下方调整阅读顺序。")} onFiles={async files => {
        const added = await Promise.all(files.map(async f => ({ id: crypto.randomUUID(), title: f.name, content: await f.text() })));
        onDocuments([...documents, ...added]);
      }} />
    {documents.length > 0 && <div className="space-y-2">
      <p className="text-xs text-[color:var(--eidos-archive-muted)]">{ui("阅读顺序 ·")}{documents.length} {ui("份资料")}</p>
      {documents.map((doc, i) => <div key={doc.id ?? i} className="eidos-world-create__summary flex flex-wrap gap-2 items-center px-3 py-2">
        <span className="min-w-0 flex-1 break-words text-sm">{doc.title}<small className="ml-2 text-[color:var(--eidos-archive-muted)]">{doc.content.length} {ui("字")}</small></span>
        <div className="flex shrink-0 gap-1">
          <button type="button" className="eidos-focus eidos-world-create__ghost disabled:opacity-30" aria-label={ui("上移{0}", {"0": doc.title})} disabled={busy || disabled || i === 0} onClick={() => { const next = [...documents]; [next[i - 1], next[i]] = [next[i], next[i - 1]]; onDocuments(next); }}>{ui("上移")}</button>
          <button type="button" className="eidos-focus eidos-world-create__ghost" aria-label={ui("移除{0}", {"0": doc.title})} onClick={() => onDocuments(documents.filter((_, n) => n !== i))}>{ui("移除")}</button>
        </div>
      </div>)}
    </div>}
    <button type="button" className="eidos-focus eidos-world-create__primary disabled:opacity-40" onClick={onBuild}>{ui("梳理文本，生成编辑稿")}</button>
    {progress.total > 0 && <div role="status" className="eidos-world-create__summary space-y-2 p-4 text-sm">
      <p>{ui("已读")} {progress.completed} / {progress.total} {ui("个片段")}</p>
      <progress aria-label={ui("资料阅读进度")} value={progress.completed} max={progress.total} className="h-1 w-full accent-[color:var(--eidos-accent)]" />
      <p className="text-xs text-[color:var(--eidos-archive-muted)]">{progress.message}</p>
    </div>}
  </fieldset>;
}
