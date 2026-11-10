'use client';
import { useInterfaceText } from "@/components/shell/useInterfaceText";

import { ActionButton } from '@/components/ui/ActionButton';
import { InfoChoice } from '@/components/ui/InfoChoice';
import { DocumentPreview } from './DocumentPreview';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { loadDocuments } from '@/lib/game/documents/repository';
import type { DocumentLink, DocumentRecord, DocumentScope } from '@/lib/game/documents/types';
import { playerDocuments } from '@/lib/game/documents/visibility';
import { useEscapeBack } from '@/components/ui/use-escape-back';

export function DocumentPicker({ scope, selected, defaultAllowWrite = false, onChange, onClose }: {
  scope: DocumentScope; selected: DocumentLink[]; defaultAllowWrite?: boolean;
  onChange: (links: DocumentLink[]) => void; onClose: () => void;
}) {
  const ui = useInterfaceText();
  const [permissions, setPermissions] = useState<Record<string, boolean>>({});
  const [preview, setPreview] = useState<DocumentLink | null>(null);
  const { documents, error } = useDocumentMenuFiles(scope);
  const root = useRef<HTMLDivElement>(null);
  useEscapeBack(root, () => { onClose(); document.querySelector<HTMLElement>('[data-document-picker-trigger]')?.focus(); }, !preview);
  useLayoutEffect(() => { root.current?.focus({ preventScroll: true }); }, []);
  useEffect(() => {
    if (preview) return;
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Element && !root.current?.contains(event.target) && !event.target.closest('[data-document-picker-trigger]')) onClose();
    };
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, [onClose, preview]);
  return <>
    <div ref={root} role="region" aria-label={ui("引用文档")} tabIndex={-1} className="eidos-document-menu eidos-refined-dialog" hidden={Boolean(preview)} onClick={event => event.stopPropagation()} onPointerDown={event => event.stopPropagation()} onKeyDown={event => {
      event.stopPropagation();
      if (event.key === 'Escape' && !event.defaultPrevented && !event.repeat && !event.nativeEvent.isComposing) { event.preventDefault(); onClose(); document.querySelector<HTMLElement>('[data-document-picker-trigger]')?.focus(); }
    }}>
      {error && <p role="alert" className="eidos-document-notice">{error}</p>}
      <ul className="eidos-document-menu-list">{playerDocuments(documents).map(doc => {
        const existing = selected.find(link => link.documentId === doc.id && link.revision === doc.currentRevision);
        const key = `${doc.id}:${doc.currentRevision}`;
        const allowWrite = permissions[key] ?? existing?.allowWrite ?? defaultAllowWrite;
        const link = { documentId: doc.id, revision: doc.currentRevision, title: doc.title, allowWrite };
        return <li key={doc.id}><InfoChoice label={doc.title} active={Boolean(existing)} disabled={Boolean(doc.referenceError)} infoDisabled={false} infoLabel={ui("预览 {0}", {"0": doc.title})} showIndicator={false}
          onInfo={() => setPreview(link)} onSelect={() => { onChange([...selected.filter(item => item.documentId !== doc.id), link]); onClose(); }}
          trailing={<ActionButton icon={allowWrite ? 'edit' : 'editOff'} label={ui("允许本次修改 {0}", {"0": doc.title})} aria-pressed={allowWrite} title={`${allowWrite ? ui("允许修改，点击设为只读") : ui("只读，点击允许修改")}：${doc.title}`} className="eidos-document-menu-permission" disabled={Boolean(doc.referenceError)} onClick={() => {
            setPermissions(previous => ({ ...previous, [key]: !allowWrite }));
            if (existing) onChange(selected.map(item => item.documentId === doc.id ? { ...item, allowWrite: !allowWrite } : item));
          }} />} /></li>;
      })}</ul>
      {!playerDocuments(documents).length && <p className="eidos-file-empty">{ui("文档库为空")}</p>}
    </div>
    {preview && <DocumentPreview scope={scope} documentRef={preview} onClose={() => setPreview(null)} />}
  </>;
}

function useDocumentMenuFiles(scope: DocumentScope) {
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [error, setError] = useState('');
  const alive = useRef(false), request = useRef(0);
  const reload = useCallback(async () => { const id = ++request.current; try { const docs = await loadDocuments(scope); if (alive.current && id === request.current) setDocuments(docs); } catch (cause) { if (alive.current) setError(cause instanceof Error ? cause.message : '读取文档失败'); } }, [scope]);
  useEffect(() => {
    alive.current = true;
    queueMicrotask(() => void reload());
    window.addEventListener('eidos-documents-updated', reload);
    return () => { alive.current = false; window.removeEventListener('eidos-documents-updated', reload); };
  }, [reload]);
  return { documents, error };
}
