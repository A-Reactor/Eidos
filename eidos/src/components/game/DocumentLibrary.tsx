'use client';
import { useInterfaceText } from "@/components/shell/useInterfaceText";

import { useCallback, useEffect, useRef, useState } from 'react';
import { DocumentCapacity } from './DocumentCapacity';
import { DocumentVersionHistory } from './DocumentVersionHistory';
import { ActionButton } from '@/components/ui/ActionButton';
import { ActionIcon } from '@/components/ui/ActionIcon';
import { FileImportAction } from '@/components/ui/FileImportAction';
import { ArchiveScreen } from '@/components/ui/ArchiveScreen';
import { BackButton } from '@/components/ui/BackButton';
import { DocumentMarkdown } from '@/components/ui/DocumentMarkdown';
import { downloadFile, sanitizeExportName } from '@/lib/game/export-records';
import { saveFile } from '@/lib/game/save-file';
import { documentScopeKey, type PendingModelDocument } from '@/lib/game/model-documents';
import { loadDocuments, loadTrashedDocuments, setDocumentTrashed, readDocument, saveDocument } from '@/lib/game/documents/repository';
import { importDocument, saveLocalDocument } from '@/lib/game/documents/ingest';
import { readLegacyDocument } from '@/lib/game/documents/legacy';
import { readResource, storeResource } from '@/lib/game/workspace/resources';
import type { DocumentLink, DocumentRecord, DocumentRef, DocumentScope } from '@/lib/game/documents/types';
import type { ModResource } from '@/lib/game/workspace/types';
import { isImageMimeType } from '@/lib/game/midori/image-format';
import { IMAGE_ACCEPT } from '@/lib/game/midori/image-tags';
import { importImageDocument } from '@/lib/game/midori/image-documents';
import { ensureWorldImageDocuments } from '@/lib/game/midori/image-document-library';
import { useGameStore } from '@/store/game-store';
import { playerDocuments } from '@/lib/game/documents/visibility';
import { useEscapeBack } from '@/components/ui/use-escape-back';

interface Props {
  scope: DocumentScope; initialId?: string; initial?: PendingModelDocument; onClose?: () => void;
  onDetailChange?: (open: boolean) => void; onReference?: (link: DocumentLink) => void;
}
const message = (error: unknown) => error instanceof Error ? error.message : '文档操作失败';

/** Resource management is local; all model writing is initiated from the action composer. */
export function DocumentLibrary({ scope, initialId, initial, onClose, onDetailChange, onReference }: Props) {
  const ui = useInterfaceText();
  const [trash, setTrash] = useState<DocumentRecord[]>([]), [showTrash, setShowTrash] = useState(false);
  const generating = useGameStore(s => s.isLoading);
  const [documents, setDocuments] = useState<DocumentRecord[]>([]), [ready, setReady] = useState(false);
  const [selected, setSelected] = useState<{ record: DocumentRecord; resource: ModResource } | null>(null);
  const [mode, setMode] = useState<'list' | 'read' | 'edit' | 'history'>(initialId || initial ? 'read' : 'list');
  const listRoot = useRef<HTMLElement>(null);
  const [pending, setPending] = useState(initial), [title, setTitle] = useState(''), [content, setContent] = useState('');
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [query, setQuery] = useState('');
  useEscapeBack(listRoot, () => { setShowTrash(false); setQuery(''); }, mode === 'list' && showTrash);
  const mounted = useRef(false), working = useRef(false), loadId = useRef(0), reader = useRef<HTMLElement>(null);
  const key = documentScopeKey(scope);
  const reload = useCallback(async () => {
    const id = ++loadId.current;
    try {
      const warnings = await ensureWorldImageDocuments(scope), docs = await loadDocuments(scope), deleted = await loadTrashedDocuments(scope);
      if (mounted.current && id === loadId.current) { setDocuments(docs); setTrash(deleted); setReady(true); if (warnings.length) setError(warnings.join('\n')); }
    }
    catch (cause) { if (mounted.current) setError(message(cause)); }
  }, [scope]);
  const open = useCallback(async (ref: DocumentRef) => {
    try { const shown = await readDocument(scope, ref); if (mounted.current) { setSelected(shown); setPending(undefined); setMode('read'); setError(''); } }
    catch (cause) { if (mounted.current) setError(message(cause)); }
  }, [scope]);
  useEffect(() => {
    mounted.current = true;
    queueMicrotask(async () => {
      try {
        await reload();
        if (initialId) {
          const doc = (await loadDocuments(scope)).find(d => d.id === initialId);
          if (doc && mounted.current) await open({ documentId: doc.id, revision: doc.currentRevision });
        }
      } catch (cause) { if (mounted.current) setError(message(cause)); }
    });
    const changed = () => { void reload(); };
    window.addEventListener('eidos-documents-updated', changed);
    return () => { mounted.current = false; window.removeEventListener('eidos-documents-updated', changed); };
  }, [key, initialId, open, reload, scope]);
  useEffect(() => { onDetailChange?.(mode !== 'list'); return () => onDetailChange?.(false); }, [mode, onDetailChange]);
  useEffect(() => { if (mode === 'read') reader.current?.focus({ preventScroll: true }); }, [mode, selected]);
  const leave = () => { setMode('list'); setSelected(null); setError(''); onClose?.(); };
  const persist = async () => {
    if (working.current) return;
    working.current = true; setBusy(true); setError('');
    try {
      let link: DocumentLink;
      if (pending) {
        const resource = await storeResource({ name: 'recovered.md', mimeType: 'text/markdown', text: pending.document.content });
        const responseResource = pending.document.rawOutput ? await storeResource({ name: 'response.txt', mimeType: 'text/plain', text: pending.document.rawOutput }) : undefined;
        link = await saveDocument(scope, { title: pending.document.title, origin: 'recovered', resource, responseResource, format: 'markdown' });
      } else {
        link = await saveLocalDocument(scope, { title, content, format: selected?.record.versions[selected.resource.id].format,
          previous: selected ? { documentId: selected.record.id, revision: selected.resource.id } : undefined });
      }
      if (!mounted.current) return;
      await reload(); await open(link);
    } catch (cause) { if (mounted.current) setError(message(cause)); }
    finally { working.current = false; if (mounted.current) setBusy(false); }
  };
  const importFiles = async (files: File[]) => {
    setBusy(true); setError('');
    const results = await Promise.allSettled(files.map(async file => {
      if (!isImageMimeType(file.type)) return importDocument(scope, file);
      const imported = await importImageDocument(scope, file);
      const state = useGameStore.getState();
      const archive = state.sandboxMode ? `sandbox:${state.sandboxDossierId ?? 'default'}` : 'main';
      if (mounted.current && archive === (scope.archiveId ?? 'main')) await state.saveImageResource(imported.image);
      return imported.link;
    }));
    if (!mounted.current) return;
    setError(results.flatMap((result, i) => result.status === 'rejected' ? [`${files[i].name}：${message(result.reason)}`] : []).join('\n'));
    await reload(); setBusy(false);
  };
  const exportFile = async (kind: 'body' | 'original' | 'raw') => {
    try {
      if (pending) { await downloadFile(kind === 'raw' ? pending.document.rawOutput ?? pending.document.content : pending.document.content,
        `${sanitizeExportName(pending.document.title)}.${kind === 'raw' ? 'txt' : 'md'}`, 'text/plain;charset=utf-8'); return; }
      if (!selected) return;
      const { record, resource } = selected, version = record.versions[resource.id];
      if (kind === 'body') { await downloadFile(resource.text ?? '', version.originalResource && isImageMimeType(version.originalResource.mimeType) ? `${sanitizeExportName(record.title)}.md` : record.fileName ?? `${sanitizeExportName(record.title)}.${version.format === 'markdown' ? 'md' : 'txt'}`, resource.mimeType); return; }
      if (kind === 'raw' && record.legacyId && !version.responseResource) {
        await downloadFile(JSON.stringify((await readLegacyDocument(scope, record.legacyId)).parts, null, 2), `${sanitizeExportName(record.title)}-raw-response.json`, 'application/json'); return;
      }
      const ref = kind === 'original' ? version.originalResource : version.responseResource;
      if (!ref) return;
      const original = await readResource(ref), data = original.text ?? Uint8Array.from(atob(original.base64!), c => c.charCodeAt(0));
      await saveFile(new Blob([data], { type: original.mimeType }), kind === 'original' ? isImageMimeType(original.mimeType) ? original.name : record.fileName ?? record.title : `${sanitizeExportName(record.title)}-raw-response.json`);
    } catch (cause) { if (mounted.current) setError(message(cause)); }
  };
  const changeTrash = async (doc: DocumentRef, trashed: boolean) => {
    if (working.current || generating) return;
    working.current = true; setBusy(true); setError('');
    try {
      await setDocumentTrashed(scope, doc, trashed);
      if (!mounted.current) return;
      await reload();
      if (selected?.record.id === doc.documentId) { if (trashed) leave(); else await open(doc); }
    } catch (cause) { if (mounted.current) setError(message(cause)); }
    finally { working.current = false; if (mounted.current) setBusy(false); }
  };
  if (mode === 'history' && selected) return <DocumentVersionHistory scope={scope} initial={selected.record} onBack={() => setMode('read')} onRestored={async link => { await reload(); await open(link); }} />;
  if (mode !== 'list') {
    const shown = pending?.document, body = shown?.content ?? selected?.resource.text;
    const format = shown?.format ?? (selected && selected.record.versions[selected.resource.id].format);
    return <ArchiveScreen className="eidos-document-page" title={mode === 'edit' ? selected ? ui("编辑文档") : ui("新建文档") : shown?.title ?? selected?.record.title ?? ui("文档")}
      label={ui("文档阅读")} subtitle={selected?.record.trashedAt !== undefined ? ui("回收站 · 历史引用仍可阅读") : ui("本地资料 · 在行动中引用后使用")} onBack={leave} swipeBack backLabel={ui("返回文档列表")} action={<BackButton label={ui("返回文档列表")} onClick={leave} />}>
      <main className="eidos-document-reader">
        {error && <p role="alert" className="eidos-document-notice">{error}</p>}
        {selected?.record.referenceError && <p role="status">{selected.record.referenceError}</p>}
        {shown?.incomplete && <p role="status">{ui("文稿尚未完成，可引用到行动后继续处理。")}</p>}
        {mode === 'edit' ? <form id="local-document-form" onSubmit={event => { event.preventDefault(); void persist(); }} className="eidos-document-create">
          <label className="eidos-document-field">{ui("文档标题")}<input value={title} onChange={event => setTitle(event.target.value)} disabled={busy} /></label>
          <label className="eidos-document-field">{ui("文档内容")}<textarea rows={12} value={content} onChange={event => setContent(event.target.value)} disabled={busy} /></label>
        </form> : body !== undefined ? <article ref={reader} tabIndex={-1} aria-label={ui("文档正文")} className={`eidos-document-prose${format === 'markdown' ? ' eidos-markdown' : ''}`}>
          {format === 'markdown' ? <DocumentMarkdown content={body} image={selected?.record.versions[selected.resource.id].originalResource} /> : body}</article> : <p role="status">{ready ? ui("未找到这份文档，请返回列表。") : ui("正在读取文档…")}</p>}
      </main>
      <footer className="eidos-document-footer"><div className="eidos-document-actions">
        {mode === 'edit' ? <ActionButton icon="save" label={ui("保存文档")} text="保存" iconOnly={false} variant="primary" type="submit" form="local-document-form" disabled={busy || !title.trim() || !content.trim()} />
          : pending ? <ActionButton icon="save" label={ui("保存文档")} text="保存" iconOnly={false} variant="primary" disabled={busy} onClick={() => void persist()} />
          : selected?.record.trashedAt !== undefined ? <ActionButton icon="undo" label={ui("还原文档")} iconOnly={false} disabled={busy || generating} onClick={() => void changeTrash({ documentId: selected.record.id, revision: selected.resource.id }, false)} />
          : selected && <><ActionButton icon="attach" label={ui("引用到行动")} disabled={!onReference || Boolean(selected.record.referenceError)} onClick={() => onReference?.({ documentId: selected.record.id, revision: selected.resource.id, title: selected.record.title })} />
            <ActionButton icon="history" label={ui("版本历史")} onClick={() => setMode('history')} /><ActionButton icon="edit" label={ui("编辑文档")} onClick={() => { setTitle(selected.record.title); setContent(selected.resource.text ?? ''); setMode('edit'); }} /></>}
        {mode === 'read' && selected && selected.record.trashedAt === undefined && <ActionButton icon="trash" label={ui("移入回收站")} disabled={busy || generating} onClick={() => void changeTrash({ documentId: selected.record.id, revision: selected.resource.id }, true)} />}
        {mode !== 'edit' && body !== undefined && <ActionButton icon="export" label={ui("导出文档")} onClick={() => void exportFile('body')} />}
        {selected?.record.versions[selected.resource.id].originalResource && <ActionButton icon="file" label={ui("导出原件")} onClick={() => void exportFile('original')} />}
        {(pending?.document.rawOutput || selected?.record.versions[selected.resource.id].responseResource || selected?.record.legacyId) && <ActionButton icon="history" label={ui("原始响应")} onClick={() => void exportFile('raw')} />}
      </div></footer>
    </ArchiveScreen>;
  }
  const listed = playerDocuments(showTrash ? trash : documents);
  const filtered = listed.filter(doc => doc.title.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  return <section ref={listRoot} className="eidos-documents" aria-label={ui("当前周目文档")}>
    <header className="eidos-documents-toolbar"><div><h2>{showTrash ? ui("回收站") : ui("文档")} <small>{listed.length}</small></h2><p>{ui("当前周目 · 本地资料与行动产物")}</p></div><div className="eidos-document-actions">
      <ActionButton icon={showTrash ? 'file' : 'trash'} label={showTrash ? ui("返回文档") : ui("回收站")} aria-pressed={showTrash} disabled={busy} onClick={() => { setShowTrash(value => !value); setQuery(''); }} />
      {!showTrash && <><FileImportAction label={ui("选择文件导入")} inputLabel={ui("导入文档")} accept={`.txt,.md,.markdown,.json,.csv,.log,.yml,.yaml,text/*,${IMAGE_ACCEPT}`} disabled={busy} onFiles={importFiles} />
      <ActionButton icon="plus" label={ui("新建文档")} disabled={!ready || busy} onClick={() => { setTitle(''); setContent(''); setSelected(null); setMode('edit'); }} /></>}
    </div></header>
    {error && <p role="alert" className="eidos-document-notice">{error}</p>}
    {pending && <button onClick={() => setMode('read')}>{ui("有一份资料尚未保存 · 继续处理 →")}</button>}
    {!!listed.length && <label className="eidos-documents-search"><ActionIcon name="search" /><span className="sr-only">{ui("查找文档")}</span><input aria-label={ui("查找文档")} placeholder={ui("查找文档…")} type="search" value={query} onChange={event => setQuery(event.target.value)} /></label>}
    <ul aria-label={showTrash ? ui("回收站文档") : ui("已保存文档")} className="eidos-document-list">{filtered.map((doc, i) => <li key={doc.id} className="flex items-center"><button className="eidos-focus eidos-document-card" onClick={() => void open({ documentId: doc.id, revision: doc.currentRevision })}>
      <span className="eidos-document-card__number">{String(i + 1).padStart(2, '0')}</span><span className="eidos-document-card__content"><strong>{doc.title}</strong><small>{doc.versions[doc.currentRevision].resource.size.toLocaleString()} {ui("字节")}{doc.originActionId && !doc.linkedNodeId && ui(" · 节点关联待保存")}</small></span><ActionIcon name="next" className="eidos-document-card__arrow" />
    </button>{showTrash && <ActionButton icon="undo" label={ui("还原 {0}", {"0": doc.title})} disabled={busy || generating} onClick={() => void changeTrash({ documentId: doc.id, revision: doc.currentRevision }, false)} />}</li>)}</ul>
    <DocumentCapacity scope={scope} />
    {!ready ? <p role="status">{ui("正在读取文档…")}</p> : !filtered.length && <div className="eidos-documents-empty"><h3>{listed.length ? ui("没有找到匹配的文档") : showTrash ? ui("回收站为空。") : ui("还没有文档。")}</h3><p>{showTrash ? ui("移入回收站的文档保留历史与原件，可在这里还原。") : ui("导入文件或新建本地资料，在行动中引用。")}</p></div>}
  </section>;
}
