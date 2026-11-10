"use client";
import { useInterfaceText } from "@/components/shell/useInterfaceText";

import { WorkspaceReceipts } from './WorkspaceReceipts';
import { receiptParagraphs } from '@/lib/game/workspace/receipt-placement';
import { InlineDocumentText } from './InlineDocumentText';
import { plainDocumentText } from '@/lib/game/documents/inline-links';
import { NodeDocumentLinks } from './DocumentLinks';
import { BackButton } from "@/components/ui/BackButton";
import { MobileReadingDivider } from './MobileReadingDivider';
import { useMobileLayout } from './use-mobile-layout';
import { useMobilePageTransition } from '@/components/ui/use-mobile-page-transition';
import { useMobileSwipe } from '@/components/ui/use-mobile-swipe';
import { useEscapeBack } from '@/components/ui/use-escape-back';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useGameStore } from '@/store/game-store';
import { getReadingPath, getReadingSnippet, getTextMatches } from '@/lib/game/player-reading';
import { loadReadingView, saveReadingView } from '@/lib/game/reading-view-state';
import { computeWorldlineGeometry, type ExpandWindow } from '@/lib/game/worldline-geometry';
import { recordPresentationText, recordPresentationRuns, presentationParagraphs } from '@/lib/game/presentation';
import { usePresentationArchive } from './use-presentation-archive';
import { ReadingText } from './ReadingText';
import { ExcerptEditor, type ExcerptDraft } from './ExcerptEditor';
import { rewindPolicy } from '@/lib/game/rewind';
import { WorldlineSvg } from './worldline/WorldlineSvg';
import { resolveCenterExpandWindow } from './worldline/worldline-interactions';
import { NodeActions } from './worldline/NodeActions';
import { usePanelWidth, PanelResizeHandle } from '@/components/ui/PanelResizeHandle';
import { captureReadingResizeAnchor, restoreReadingResizeAnchor, type ReadingResizeAnchor } from '@/lib/ui/reading-resize-anchor';
import { useReadingScrollSync } from './use-reading-scroll-sync';

const button = 'eidos-focus eidos-archive-button disabled:opacity-40';

export function ReadingScreen() {
  const scope = useGameStore(s => JSON.stringify([s.worldLine?.id ?? s.currentPlaythroughId ?? s.currentWorld?.id ?? 'local', s.currentNode?.id ?? null]));
  return <ReadingView key={scope} scope={scope} />;
}

function ReadingView({ scope }: { scope: string }) {
  const ui = useInterfaceText();
  const store = useGameStore();
  const nodes = store.allNodes, currentNode = store.currentNode;
  const [initial] = useState(() => loadReadingView(scope, currentNode?.id ?? null));
  const readerWidth = usePanelWidth('worldline-reader', 640);
  const [query, setQuery] = useState(initial.query);
  const [branch, setBranch] = useState(() => (initial.branch && store.allNodes[initial.branch] ? initial.branch : '') || (initial.expanded && nodes[initial.expanded] &&
    !getReadingPath(nodes, currentNode?.id ?? null).some(node => node.id === initial.expanded) ? initial.expanded : ''));
  const [location, setLocation] = useState(initial.location);
  const [selectedId, setSelectedId] = useState(initial.expanded);
  const [onlyExcerpts, setOnlyExcerpts] = useState(initial.onlyExcerpts);
  const [expandedWin, setExpandedWin] = useState<ExpandWindow | null>(null);
  const [focusTarget, setFocusTarget] = useState<{ nodeId: string; request: number } | null>(() =>
    initial.expanded && nodes[initial.expanded] ? { nodeId: initial.expanded, request: 0 } : null);
  const [fitRequest, setFitRequest] = useState(0);
  const mainRef = useRef<HTMLElement>(null);
  const resizeAnchor = useRef<ReadingResizeAnchor | null>(null);
  const paragraphs = useRef(new Map<string, HTMLParagraphElement>());
  const records = useRef(new Map<string, HTMLElement>());
  const [target, setTarget] = useState<{ nodeId: string; paragraph: number; focus?: boolean } | null>(null);
  const [draft, setDraft] = useState<ExcerptDraft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const currentId = store.allNodes[branch] ? branch : store.currentNode?.id ?? null;
  const path = useMemo(() => getReadingPath(nodes, currentId), [nodes, currentId]);
  const all = useMemo(() => Object.values(nodes), [nodes]);
  const selectedNode = path.find(node => node.id === selectedId) ?? path.at(-1) ?? null;
  const nativeText = store.currentWorld?.gameplayPlugins?.some(p => p.ui?.presentation === 'native-text');
  usePresentationArchive(all.map(node => node.id));
  const presentationNodes=store.allNodes, presentationOrigin=store.currentNode?.id;
  const textFor = useCallback((node: import("@/lib/game/types").WorldLineNode | null) => !node ? '' : nativeText && node.segmentHash && !node.presentation ? '' : recordPresentationText(node,presentationNodes,branch || presentationOrigin), [nativeText,presentationNodes,branch,presentationOrigin]);
  const restricted = !!rewindPolicy(store.currentWorld);
  const results = useMemo(() => {
    const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
    return terms.length ? all.filter(node => {
      const text = `${node.playerInput}\n${node.sceneName}\n${textFor(node)}`.toLocaleLowerCase();
      return terms.every(term => text.includes(term));
    }).sort((a, b) => b.createdAt - a.createdAt) : [];
  }, [all, query, textFor]);
  const locations = [...new Set(path.map(node => node.sceneName).filter(Boolean))];
  const excerpts = getReadingPath(store.allNodes, currentId).flatMap(node => (node.playerExcerpts ?? []).map(excerpt => ({ ...excerpt, node })));
  const geometry = useMemo(() => computeWorldlineGeometry(
    nodes, store.worldLine?.rootNodeId ?? path[0]?.id ?? '', currentNode?.id ?? '', selectedNode?.id ?? null, expandedWin,
  ), [nodes, store.worldLine?.rootNodeId, currentNode?.id, path, selectedNode?.id, expandedWin]);

  const saveView = () => saveReadingView(scope, {
    query, location, expanded: selectedNode?.id ?? null, onlyExcerpts, branch,
    scrollTop: mainRef.current?.scrollTop ?? 0,
  });
  useEffect(() => {
    saveReadingView(scope, { query, location, expanded: selectedId, onlyExcerpts, branch, scrollTop: mainRef.current?.scrollTop ?? 0 });
  }, [scope, query, location, selectedId, onlyExcerpts, branch]);
  useLayoutEffect(() => {
    if (initial.scrollTop && mainRef.current) mainRef.current.scrollTop = initial.scrollTop;
    else if (initial.expanded) records.current.get(initial.expanded)?.scrollIntoView?.({ block: 'start' });
  }, [initial]);
  useLayoutEffect(() => {
    const anchor = resizeAnchor.current;
    if (anchor && mainRef.current) restoreReadingResizeAnchor(mainRef.current, anchor);
  }, [readerWidth.width]);

  // Selecting history changes only the reading route. Restoring the game remains an explicit action.
  const locateNode = (nodeId: string, { paragraph = 0, source = 'navigation' }: {
    paragraph?: number; source?: 'navigation' | 'graph' | 'scroll';
  } = {}) => {
    const node = nodes[nodeId];
    if (!node) return;
    setSelectedId(nodeId);
    if (source !== 'graph') {
      setExpandedWin({ day: node.dayNumber, centerStep: node.stepNumber });
      setFocusTarget(previous => ({ nodeId, request: (previous?.request ?? 0) + 1 }));
    }
    // Reading scroll follows the graph without changing filters, the route, or the text's scroll position.
    if (source === 'scroll') return;
    if (nodeId === currentNode?.id) setBranch('');
    else if (!path.some(node => node.id === nodeId)) {
      let end = nodeId;
      const seen = new Set([end]);
      while (true) {
        const child = nodes[end].childIds.find(id => nodes[id] && !seen.has(id));
        if (!child) break;
        end = child; seen.add(end);
      }
      setBranch(end);
    }
    setOnlyExcerpts(false); setLocation('');
    setTarget({ nodeId, paragraph });
  };
  const { syncReadingScroll, preserveTextTarget } = useReadingScrollSync({
    viewportRef: mainRef, selectedNodeId: selectedNode?.id ?? null,
    onLocateNode: nodeId => locateNode(nodeId, { source: 'scroll' }),
  });
  useLayoutEffect(() => {
    if (!target) return;
    const paragraph = paragraphs.current.get(`${target.nodeId}:${target.paragraph}`);
    const element = paragraph ?? records.current.get(target.nodeId);
    if (target.focus !== false) element?.focus({ preventScroll: true });
    (target.paragraph === 0 ? records.current.get(target.nodeId) ?? element : element)?.scrollIntoView?.({ block: 'start' });
    preserveTextTarget();
  }, [target, preserveTextTarget]);
  const onExpandDay = useCallback((day: number, centerStep: number) => {
    setExpandedWin(previous => previous?.day === day ? null : { day, centerStep });
  }, []);
  const onViewportCenter = useCallback((day: number, centerStep: number) => {
    setExpandedWin(previous => resolveCenterExpandWindow(previous, day, centerStep));
  }, []);
  const persist = async () => {
    setBusy(true); setError(null);
    try { await store.persistWorldLineData(); }
    catch { setError('摘录尚未保存到磁盘，请重试。'); }
    finally { setBusy(false); }
  };
  const openSource = (nodeId: string, quote: string) => {
    setQuery('');
    const text = textFor(store.allNodes[nodeId]);
    locateNode(nodeId, { paragraph: Math.max(0, text.split(/\n\n+/).filter(Boolean).findIndex(p => p.includes(quote.split(/\n\n+/)[0]))) });
  };
  const locateCurrent = () => {
    const node = currentNode;
    if (!node) return;
    setQuery('');
    locateNode(node.id);
  };
  const startResizingReader = () => {
    // Reuse the same character until the player scrolls, including repeated drags back and forth.
    const viewport = mainRef.current, anchor = resizeAnchor.current;
    if (viewport && anchor && viewport.contains(anchor.range.startContainer) &&
      Math.abs(anchor.range.getBoundingClientRect().top - viewport.getBoundingClientRect().top - anchor.top) < .5) return;
    resizeAnchor.current = viewport ? captureReadingResizeAnchor(viewport) : null;
  };
  const root = useRef<HTMLElement>(null);
  const { mobile } = useMobileLayout(false);
  const transition = useMobilePageTransition(root, { mobile, onBack: () => { saveView(); store.goBack(); } });
  useEscapeBack(root, transition.back);
  useMobileSwipe(root, { direction: 'right', onSwipe: transition.back, onProgress: transition.progress, onCancel: transition.cancel });

  return <section ref={root} onTransitionEnd={transition.onTransitionEnd} className="eidos-worldline eidos-reading-screen eidos-swipe-page eidos-mobile-page flex h-full flex-col" aria-label={ui("世界线与回看")}>
    <header className="eidos-reading-header">
      <div className="eidos-reading-heading"><div className="eidos-reading-title"><span aria-hidden="true" /><h1>{ui("世界线")}</h1><p>{store.currentWorld?.name ?? ui("阅读与分支")}</p></div>
        {currentNode && <p className="eidos-reading-progress">{ui("当前进度 · 第")}{currentNode.stepNumber}{ui("步")}</p>}
      </div>
      <BackButton onClick={transition.back} />
    </header>
    <div className="eidos-reading-workspace" style={readerWidth.style}>
      <aside className="eidos-reading-navigator" aria-label={ui("分支导航")}>
        <div className="eidos-reading-nav-tools">
          <div className="eidos-reading-nav-top"><div className="eidos-reading-view-tools" role="group" aria-label={ui("世界线视图操作")}>
            <button className="eidos-focus eidos-archive-text-action" onClick={() => setFitRequest(value => value + 1)}>{ui("适应视图")}</button>
            <button className="eidos-focus eidos-archive-text-action disabled:opacity-40" disabled={!store.currentNode} onClick={locateCurrent}>{ui("回到当前节点")}</button>
          </div><span>{store.worldLine?.branchCount ?? all.filter(node => node.childIds.length > 1).length} {ui("条分歧")}</span></div>
          <input type="search" aria-label={ui("搜索原文")} placeholder={ui("搜索全部经历：原话、人物、地点")} value={query}
            onChange={event => setQuery(event.target.value)} className="eidos-focus eidos-reading-search" />
        </div>
        {query.trim() && <div className="eidos-reading-search-results" aria-label={ui("原文搜索结果")}>
          <p>{results.length ? ui("{0} 处相关经历", {"0": results.length}) : ui("没有找到相关原文。")}</p>
          {results.map(node => <button className="eidos-focus" key={node.id} onClick={() => {
            const text = textFor(node);
            locateNode(node.id, { paragraph: Math.max(0, text.split(/\n\n+/).filter(Boolean).findIndex(p => getTextMatches(p, query).length > 0)) });
          }}><span>{ui("第")}{node.stepNumber}{ui("步 ·")}{node.sceneName || ui("开场")}</span><small>{getReadingSnippet(textFor(node), query)}</small></button>)}
        </div>}
        <div className="eidos-reading-graph"><WorldlineSvg geometry={geometry} expandedDay={expandedWin?.day ?? null} onExpandDay={onExpandDay} onViewportCenter={onViewportCenter} focusTarget={focusTarget} fitRequest={fitRequest} onSelectNode={id => locateNode(id, { source: 'graph' })} />
          <div className="eidos-reading-legend"><span><i aria-hidden="true" />{ui("选中")}</span><span><b className="eidos-reading-current-dot" aria-hidden="true" />{ui("游戏进度")}</span></div>
        </div>
      </aside>
      <MobileReadingDivider />
      <section className="eidos-reading-reader" aria-label={ui("连续原文")}>
        <PanelResizeHandle label={ui("世界线与原文分隔线")} panel={readerWidth} onResizeStart={startResizingReader} />
        <div className="eidos-reading-reader-head">
          <p>{branch && store.allNodes[branch] ? ui("正在查阅另一条经历") : ui("正在查阅当前经历")}</p>
          {selectedNode && <div className="eidos-reading-management"><NodeActions key={selectedNode.id} node={selectedNode} restrictedRewind={restricted}
            onBacktrack={store.backtrackToNode} onDelete={async id => { await store.deleteSubtree(id); setBranch(''); setSelectedId(useGameStore.getState().currentNode?.id ?? null); }} /></div>}
        </div>
        <div className="eidos-reading-filters">
          {locations.length > 1 && <select className="eidos-focus" aria-label={ui("地点")} value={location} onChange={event => setLocation(event.target.value)}><option value="">{ui("所有地点")}</option>{locations.map(name => <option key={name}>{name}</option>)}</select>}
          {(excerpts.length > 0 || onlyExcerpts) && <button className="eidos-focus eidos-archive-text-action" onClick={() => setOnlyExcerpts(value => !value)}>{onlyExcerpts ? ui("全部原文") : ui("我的摘录")}</button>}
        </div>
        {error && <div role="alert" className="eidos-reading-notice eidos-archive-error">{error}<button className={button} disabled={busy} onClick={() => void persist()}>{ui("重试保存")}</button></div>}
        <main ref={mainRef} onScroll={() => { saveView(); syncReadingScroll(); }} className="eidos-reading-content">
          <div className="eidos-reading-records">
            {onlyExcerpts ? <>
              {excerpts.length === 0 && <p className="eidos-reading-empty">{ui("还没有摘录。可以在原文中记下你在意的段落。")}</p>}
              {excerpts.map(excerpt => <article key={excerpt.id} className="eidos-reading-excerpt">
                <blockquote className="whitespace-pre-wrap text-base leading-7">{excerpt.text}</blockquote>
                {excerpt.note && <p className="eidos-reading-note">{ui("我的备注：")}{excerpt.note}</p>}
                <p className="eidos-reading-record-meta my-3">{ui("第")}{excerpt.node.gameTime.day}{ui("天 ·")}{excerpt.node.sceneName}</p>
                <div className="flex flex-wrap gap-3"><button className={button} onClick={() => openSource(excerpt.node.id, excerpt.text)}>{ui("查看来源")}</button>
                  <button className={button} onClick={() => setDraft({ nodeId: excerpt.node.id, excerptId: excerpt.id, text: excerpt.text, note: excerpt.note })}>{ui("编辑备注")}</button>
                  <button className={button} disabled={busy} onClick={() => { store.removePlayerExcerpt(excerpt.node.id, excerpt.id); void persist(); }}>{ui("删除摘录")}</button></div>
              </article>)}
            </> : <>
              {path.length === 0 && <p className="eidos-reading-empty">{ui("故事开始后，已经读过的原文会留在这里。")}</p>}
              {path.filter(node => !location || node.sceneName === location).map(node => {
                const text = textFor(node);
                const selected = selectedNode?.id === node.id;
                const fileParagraphs = receiptParagraphs(node, store.allNodes, branch || store.currentNode?.id);
                return <article key={node.id} ref={element => { if (element) records.current.set(node.id, element); else records.current.delete(node.id); }} tabIndex={-1}
                  className="eidos-reading-record" data-reading-node-id={node.id} data-selected={selected} aria-label={ui("第{0}步原文", {"0": node.stepNumber})} onPointerDown={() => setSelectedId(node.id)} onFocusCapture={() => setSelectedId(node.id)}>
                  <p className="eidos-reading-record-meta">{ui("第")}{node.stepNumber}{ui("步 · 第")}{node.gameTime.day}{ui("天")}{String(node.gameTime.hour).padStart(2, '0')}:{String(node.gameTime.minute).padStart(2, '0')} · {node.sceneName || ui("开场")}</p>
                  <h2><InlineDocumentText text={node.playerInput || ui("故事开始")} /></h2>
                  {node.playerVisibleText === undefined && <p className="eidos-reading-record-meta mb-3">{ui("旧版原文记录 · 未记录阅读位置")}</p>}
                  {!text && <p className="eidos-reading-note">{ui("此处尚无可回看的已读正文。")}</p>}
                  {(text ? presentationParagraphs(recordPresentationRuns(node,store.allNodes,branch || store.currentNode?.id)) : []).map(({ text: paragraph, runs }, index) => <div className="eidos-reading-paragraph-group" key={index}>
                    <p tabIndex={-1} ref={element => { const key = `${node.id}:${index}`; if (element) paragraphs.current.set(key, element); else paragraphs.current.delete(key); }}
                      className="eidos-focus eidos-reading-paragraph"><ReadingText text={paragraph} query={query} runs={runs} /></p>
                    {/* Reserve the action's height so following another node cannot shift the prose while scrolling. */}
                    <button className="eidos-focus eidos-archive-text-action eidos-reading-excerpt-action" style={{ visibility: selected ? undefined : 'hidden' }} onClick={() => {
                      const selection = window.getSelection()?.toString().trim();
                      setDraft({ nodeId: node.id, originId:branch || presentationOrigin, text: selection && paragraph.includes(selection) ? selection : paragraph, note: '' });
                    }}>{ui("摘录这段")}</button>
                    {fileParagraphs[index]?.map(segmentIndex => <WorkspaceReceipts key={segmentIndex} node={node} segmentIndex={segmentIndex} />)}
                  </div>)}
                  <NodeDocumentLinks inputs={node.playerInput.includes('document://') ? [] : node.inputDocuments} outputs={node.workspaceBranch ? [] : node.outputDocuments} />
                  {node.childIds.filter(id => nodes[id]).length > 1 && <div className="eidos-reading-fork"><p>{ui("从这里还有其他经历")}</p><div>{node.childIds.filter(id => nodes[id]).map(id => <button key={id} className="eidos-focus eidos-archive-text-action" aria-pressed={path.some(n => n.id === id)} onClick={() => locateNode(id)}>{plainDocumentText(nodes[id].playerInput || ui("第{0}步", {"0": nodes[id].stepNumber}))}</button>)}</div></div>}
                </article>;
              })}
            </>}
          </div>
        </main>
      </section>
    </div>
    {draft && <ExcerptEditor draft={draft} onClose={() => setDraft(null)} />}
  </section>;
}
