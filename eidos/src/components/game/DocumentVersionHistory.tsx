'use client';
import { useInterfaceText } from "@/components/shell/useInterfaceText";

import { useEffect, useRef, useState } from 'react';
import { ArchiveScreen } from '@/components/ui/ArchiveScreen';
import { ActionButton } from '@/components/ui/ActionButton';
import { BackButton } from '@/components/ui/BackButton';
import { DocumentMarkdown } from '@/components/ui/DocumentMarkdown';
import { useGameStore } from '@/store/game-store';
import { currentDocumentScope, documentScopeKey } from '@/lib/game/model-documents';
import { loadDocuments, readDocument, restoreDocumentVersion } from '@/lib/game/documents/repository';
import { lineDiff } from '@/lib/game/documents/line-diff';
import type { DocumentLink, DocumentRecord, DocumentScope } from '@/lib/game/documents/types';

export function DocumentVersionHistory({ scope, initial, onBack, onRestored }: { scope: DocumentScope; initial: DocumentRecord; onBack(): void; onRestored(link: DocumentLink): Promise<void> }) {
  const ui = useInterfaceText();
  const [record, setRecord] = useState(initial), [revision, setRevision] = useState(initial.currentRevision);
  const [texts, setTexts] = useState<{ old: string; current: string } | null>(null);
  const [full, setFull] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const alive = useRef(false), lock = useRef(false), generation = useRef(0);
  const nodes = useGameStore(s => s.allNodes);
  const pending = new Set(Object.values(nodes).flatMap(node => node.workspaceBranch?.documents.filter(d => d.link.documentId === record.id && d.segmentIndex > node.workspaceBranch!.mergedThrough).map(d => d.link.revision) ?? []));
  const versions = Object.entries(record.versions).filter(([id, v]) => id === record.currentRevision || !v.pending && !pending.has(id)).sort((a, b) => b[1].createdAt - a[1].createdAt);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    const request = ++generation.current;
    Promise.all([readDocument(scope, { documentId: record.id, revision }), readDocument(scope, { documentId: record.id, revision: record.currentRevision })])
      .then(([old, current]) => { if (alive.current && request === generation.current) setTexts({ old: old.resource.text ?? '', current: current.resource.text ?? '' }); }, cause => { if (alive.current && request === generation.current) setError(cause instanceof Error ? cause.message : ui("版本读取失败")); });
  }, [ui, scope, record, revision]);
  const reload = async () => {
    try { const doc = (await loadDocuments(scope)).find(d => d.id === record.id); if (!doc) throw new Error(ui("文档已不在当前资料库")); if (alive.current) { setTexts(null); setRecord(doc); setRevision(doc.currentRevision); setError(''); } }
    catch (cause) { if (alive.current) setError(cause instanceof Error ? cause.message : ui("载入失败")); }
  };
  const restore = async () => {
    if (lock.current) return; lock.current = true; setBusy(true); setError('');
    const nodeId = useGameStore.getState().currentNode?.id;
    try {
      const link = await restoreDocumentVersion(scope, { current: { documentId: record.id, revision: record.currentRevision }, source: { documentId: record.id, revision }, isCurrent: () => {
        const state = useGameStore.getState(), active = currentDocumentScope(state);
        return alive.current && !state.isLoading && state.currentNode?.id === nodeId && Boolean(active && documentScopeKey(active) === documentScopeKey(scope));
      } });
      if (alive.current) await onRestored(link);
    } catch (cause) { if (alive.current) setError(cause instanceof Error ? cause.message : ui("恢复失败")); }
    finally { lock.current = false; if (alive.current) setBusy(false); }
  };
  const difference = texts ? lineDiff(texts.current, texts.old) : null, version = record.versions[revision];
  return <ArchiveScreen className="eidos-document-page" label={ui("版本历史")} title={record.title} subtitle={ui("本地版本 · 恢复后保留所有旧引用")} onBack={onBack} backLabel={ui("返回文档")} action={<BackButton label={ui("返回文档")} onClick={onBack} />}>
    <main className="eidos-document-reader">
      {error && <p role="alert" className="eidos-document-notice">{error}</p>}
      <div className="eidos-file-segmented" role="group" aria-label={ui("文档历史版本")}>{versions.map(([id, v], index) => <button key={id} type="button" className="eidos-focus eidos-dossier-action" aria-pressed={id === revision} disabled={busy} onClick={() => { if (id !== revision) { setTexts(null); setRevision(id); } setError(''); }}>
        {id === record.currentRevision ? ui("当前版本") : ui("历史版本 {0}", {"0": versions.length - index})} · {v.title ?? record.title} · {new Date(v.createdAt).toLocaleString()}{v.restoredFrom && ui(" · 恢复")}
      </button>)}</div>
      <div className="eidos-document-actions"><ActionButton icon="compare" label={full ? ui("查看差异") : ui("查看历史全文")} iconOnly={false} onClick={() => setFull(v => !v)} /><ActionButton icon="refresh" label={ui("重新载入版本")} onClick={() => void reload()} disabled={busy} /></div>
      {texts && version ? full ? <article aria-label={ui("历史版本正文")} className="eidos-document-prose">{version.format === 'markdown' ? <DocumentMarkdown content={texts.old} image={version.originalResource} /> : <pre className="whitespace-pre-wrap">{texts.old}</pre>}</article>
        : <section aria-label={ui("版本差异")}><p className="eidos-file-hint">{ui("当前：")}{record.title} {ui("→ 所选：")}{version.title ?? record.title}</p>{difference?.identical ? <p>{ui("正文一致，请核对名称与原件。")}</p> : <pre className="eidos-file-diff">{difference?.rows.map((row, i) => <span key={i} data-diff={row.kind}>{row.kind === 'removed' ? '− ' : row.kind === 'added' ? '+ ' : '  '}{row.text}{'\n'}</span>)}</pre>}{Boolean(difference?.omitted) && <p>{ui("另有")}{difference?.omitted} {ui("行差异，可查看历史全文。")}</p>}</section> : <p role="status">{ui("正在读取版本…")}</p>}
    </main>
    <footer className="eidos-document-footer"><ActionButton icon="history" label={ui("恢复此版本")} text="恢复此版本" iconOnly={false} disabled={busy || !texts || revision === record.currentRevision} onClick={() => void restore()} /></footer>
  </ArchiveScreen>;
}
