'use client';
import { useInterfaceText } from "@/components/shell/useInterfaceText";

import { useEffect } from 'react';
import { DocumentDialog } from './DocumentDialog';
import type { WebSource } from '@/lib/game/web-context';

export function WebSourcePreview({ sources, onClose }: { sources: WebSource[]; onClose(): void }) {
  const ui = useInterfaceText();
  useEffect(() => {
    const id = crypto.randomUUID();
    const notify = (open: boolean) => window.dispatchEvent(new CustomEvent('eidos-document-preview-state', { detail: { id, open } }));
    notify(true); return () => { notify(false); };
  }, []);
  return <DocumentDialog title={ui("引用来源")} onClose={onClose} className="eidos-web-source-preview">
    <p className="eidos-web-source-preview__host">{ui("共")}{sources.length} {ui("个网页")}</p>
    <ol className="eidos-web-source-list">{sources.map(({ label, url }) => <li key={url}>
      {label && <p className="eidos-web-source-preview__title">{label}</p>}
      <p className="eidos-web-source-preview__host">{new URL(url).hostname}</p>
      <a className="eidos-focus eidos-web-source-preview__link" href={url} target="_blank" rel="noopener noreferrer">{ui("打开原网页 ↗")}</a>
    </li>)}</ol>
  </DocumentDialog>;
}
