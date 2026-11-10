'use client';
import { useInterfaceText } from "@/components/shell/useInterfaceText";

import { useEffect, useMemo, useState } from 'react';
import type { DocumentLink, DocumentRef } from '@/lib/game/documents/types';
import { currentDocumentScope, documentScopeKey } from '@/lib/game/model-documents';
import { useGameStore } from '@/store/game-store';
import { DocumentPreview } from './DocumentPreview';

export function DocumentLinks({ links, onOpen, label = '文档' }: { links: DocumentLink[]; onOpen(ref: DocumentRef): void; label?: '文档' | '引用' }) {
  const ui = useInterfaceText();
  return links.length ? <div className="eidos-document-links" aria-label={ui(label === '文档' ? ui("输出文档") : ui("引用资料"))}>{links.map(link => <button key={`${link.documentId}:${link.revision}`} type="button" className="eidos-focus" onClick={() => onOpen(link)}>{ui(label)} → {link.title}</button>)}</div> : null;
}
export function NodeDocumentLinks({ inputs = [], outputs = [], onPreviewChange }: { inputs?: DocumentLink[]; outputs?: DocumentLink[]; onPreviewChange?(open: boolean): void }) {
  const worldId = useGameStore(s => s.currentWorld?.id), playthroughId = useGameStore(s => s.currentPlaythroughId), archiveId = useGameStore(s => s.sandboxDossierId);
  const sandboxMode = useGameStore(s => s.sandboxMode);
  const scope = useMemo(() => currentDocumentScope(useGameStore.getState()), [worldId, playthroughId, archiveId, sandboxMode]);
  const [opened, setOpened] = useState<{ ref: DocumentRef; key: string } | null>(null);
  const key = scope ? documentScopeKey(scope) : '', active = opened?.key === key ? opened : null;
  useEffect(() => { onPreviewChange?.(Boolean(active)); return () => onPreviewChange?.(false); }, [active, onPreviewChange]);
  return <><DocumentLinks links={inputs} label="引用" onOpen={ref => setOpened({ ref, key })} /><DocumentLinks links={outputs} onOpen={ref => setOpened({ ref, key })} />
    {active && scope && <DocumentPreview scope={scope} documentRef={active.ref} onClose={() => setOpened(null)} />}</>;
}
