'use client';
import { Fragment, useState, type ReactNode } from 'react';
import { useGameStore } from '@/store/game-store';
import { currentDocumentScope } from '@/lib/game/model-documents';
import type { DocumentRef } from '@/lib/game/documents/types';
import { DocumentPreview } from './DocumentPreview';
import { inlineTextTokens } from '@/lib/game/web-citations';
import { uniqueWebSources, type WebSource } from '@/lib/game/web-context';
import { WebSourcePreview } from './WebSourcePreview';

export function InlineDocumentText({ text, source = text, renderText = text => text, renderLabel = text => text, webSources = true, sourceComplete = true, searchSources }: { text: string; source?: string; renderText?(text: string,offset:number): ReactNode; renderLabel?(text:string,offset:number):ReactNode; webSources?: boolean; sourceComplete?: boolean; searchSources?: WebSource[] }) {
  const [opened, setOpened] = useState<DocumentRef | null>(null);
  const [websitesOpen, setWebsitesOpen] = useState(false);
  const world = useGameStore(s => s.currentWorld), playthroughId = useGameStore(s => s.currentPlaythroughId);
  const sandboxMode = useGameStore(s => s.sandboxMode), sandboxDossierId = useGameStore(s => s.sandboxDossierId);
  const scope = currentDocumentScope({ currentWorld: world, currentPlaythroughId: playthroughId, sandboxMode, sandboxDossierId });
  const tokens = inlineTextTokens(source, webSources).filter(token => token.start < text.length);
  const websites = webSources ? uniqueWebSources(searchSources?.length ? searchSources : tokens.filter(token => token.kind === 'web' && token.complete).map(token => ({ label: token.label, url: token.target }))) : [];
  return <>{tokens.map((token, index) => {
    const before = text.slice(index ? tokens[index - 1].end : 0, token.start);
    const label = token.label.slice(0, Math.max(0, text.length - token.labelStart));
    return <Fragment key={token.start}>{renderText(before,index ? tokens[index-1].end : 0)}{token.kind === 'web'
      ? renderLabel(label,token.labelStart)
      : token.ref && scope
      ? <a className="eidos-focus eidos-inline-document" href={token.target} onClick={event => { event.preventDefault(); event.stopPropagation(); setOpened(token.ref!); }} onKeyDown={event => event.stopPropagation()}>{renderLabel(label,token.start+1)}</a>
      : <span>{renderLabel(label,token.start+1)}</span>}</Fragment>;
  })}{renderText(text.slice(tokens.at(-1)?.end ?? 0),tokens.at(-1)?.end ?? 0)}{websites.length > 0 && sourceComplete && text.length >= source.length && <sup className="eidos-search-source-count"><button type="button" className="eidos-focus eidos-inline-source" aria-label={`查看搜索来源（${websites.length} 个网页）`} onClick={event => { event.stopPropagation(); setWebsitesOpen(true); }} onKeyDown={event => event.stopPropagation()}>{websites.length}</button></sup>}{opened && scope && <DocumentPreview scope={scope} documentRef={opened} onClose={() => setOpened(null)} />}{websitesOpen && <WebSourcePreview sources={websites} onClose={() => setWebsitesOpen(false)} />}</>;
}
