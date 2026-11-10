'use client';
import { useInterfaceText } from "@/components/shell/useInterfaceText";

import { useEffect, useState } from 'react';
import type { DocumentRef, DocumentScope } from '@/lib/game/documents/types';
import { readDocument } from '@/lib/game/documents/repository';
import { DocumentMarkdown } from '@/components/ui/DocumentMarkdown';
import { downloadFile, sanitizeExportName } from '@/lib/game/export-records';
import { ActionButton } from '@/components/ui/ActionButton';
import { BackButton } from '@/components/ui/BackButton';
import { DocumentDialog } from './DocumentDialog';

export function DocumentPreview({ scope, documentRef, onClose }: { scope: DocumentScope; documentRef: DocumentRef; onClose(): void }) {
  const ui = useInterfaceText();
  useEffect(() => {
    const id = crypto.randomUUID();
    const notify = (open: boolean) => window.dispatchEvent(new CustomEvent('eidos-document-preview-state', { detail: { id, open } }));
    notify(true); return () => { notify(false); };
  }, []);
  const [shown, setShown] = useState<Awaited<ReturnType<typeof readDocument>> | null>(null), [error, setError] = useState('');
  useEffect(() => {
    let alive = true;
    void readDocument(scope, documentRef).then(value => { if (alive) setShown(value); }, cause => { if (alive) setError(cause instanceof Error ? cause.message : ui("读取失败")); });
    return () => { alive = false; };
  }, [ui, scope, documentRef]);
  const format = shown?.record.versions[documentRef.revision]?.format;
  return <DocumentDialog title={ui("文档预览")} heading={shown?.record.title ?? ui("文档预览")} onClose={onClose} className="eidos-document-preview" footer={<><BackButton header label={ui("返回剧情")} onClick={onClose} /><div className="eidos-file-dialog-actions">{shown && <ActionButton icon="export" label={ui("导出文档")} onClick={() => downloadFile(shown.resource.text ?? '', `${sanitizeExportName(shown.record.title)}.${format === 'markdown' ? 'md' : 'txt'}`, shown.resource.mimeType)} />}</div></>}>
    <article className={`eidos-document-preview-body eidos-document-prose${format === 'markdown' ? ' eidos-markdown' : ''}`}>{error ? <p role="alert">{error}</p> : !shown ? <p role="status">{ui("读取文档…")}</p> : format === 'markdown' ? <DocumentMarkdown content={shown.resource.text ?? ''} image={shown.record.versions[documentRef.revision]?.originalResource} /> : <pre>{shown.resource.text}</pre>}</article>
  </DocumentDialog>;
}
