"use client";
import { useInterfaceText } from "@/components/shell/useInterfaceText";

import { plainDocumentText } from '@/lib/game/documents/inline-links';
import { actionActivityText, type ActionActivityPhase } from '@/lib/game/action-activity';
import { WorkspaceReceipts } from './WorkspaceReceipts';
import type { WorkspaceToolResult } from '@/lib/game/workspace/types';
import { NodeDocumentLinks } from './DocumentLinks';
import { matchesActionInput } from '@/lib/game/documents/action-draft';
import type { DocumentLink } from '@/lib/game/documents/types';
import { SpeakerExpression } from "./SpeakerExpression";
import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { StorySegment } from '@/lib/ai/types';
import { useGameStore } from '@/store/game-store';
import { useRecordEdgeSwipe } from '@/components/ui/use-record-edge-swipe';
import { presentationCues } from '@/lib/game/presentation';
import { NarrativeText } from './NarrativeText';
import { useRecordPlaybackScroll } from './use-record-playback-scroll';

export type RecordLanding = { pageKey: number } & ({ edge: 'top' | 'bottom' } | { scrollTop: number });

interface Props {
  displayNodeId?: string | null; playbackKey?:string; originId?:string;
  inputDocuments?: DocumentLink[]; outputDocuments?: DocumentLink[]; onDocumentPreviewChange?(open: boolean): void;
  draftIndex?: number; workspaceAttempt?: WorkspaceToolResult[]; onResolveWorkspace?(segment: number): void;
  landing?: RecordLanding | null;
  replyPhase?: ActionActivityPhase;
  focused?: boolean;
  visualLayout?: boolean;
  direction?: "up" | "down"; pageKey: number; segments: StorySegment[]; segmentIndex: number; showing: boolean;
  revealedCount?: number; reviewing?: boolean; playerInput?: string; onPlay?: (index: number) => void;
  transient?: { onReturn: () => void };
  allowNavigationWhileLoading?: boolean;
  pendingPreviousId?: string;
  onPendingNext?: () => void;
  loading: boolean; fallback: string; actions: string[]; notice?: string | null;
  onAction: (action: string) => void; onReplay: (segment: StorySegment) => void;
  onNavigate: (nodeId: string, direction: "up" | "down") => Promise<void>; onFocusChange: (focused: boolean) => void;
}

/** Keep the previous page mounted only for its exit animation, without focus or actions. */
function RecordPages({ pageKey, children, direction }: { pageKey: number; children: ReactNode; direction: 'up' | 'down' }) {
  const previous = useRef({ key: pageKey, content: children });
  const [outgoing, setOutgoing] = useState<ReactNode>(null);
  useLayoutEffect(() => {
    if (previous.current.key !== pageKey) setOutgoing(previous.current.content);
    previous.current = { key: pageKey, content: children };
  }, [pageKey, children]);
  useEffect(() => {
    if (!outgoing) return;
    const timer = setTimeout(() => setOutgoing(null), 320);
    return () => clearTimeout(timer);
  }, [outgoing]);
  return <div className="eidos-record-pages" data-direction={direction}>
    {outgoing && <div className="eidos-record-page is-outgoing" inert aria-hidden="true">{outgoing}</div>}
    <div key={pageKey} className={`eidos-record-page ${outgoing ? 'is-entering' : ''}`}>{children}</div>
  </div>;
}

export function ActionRecordPanel(props: Props) {
  const ui = useInterfaceText();
  const { segments, segmentIndex, showing, loading, fallback, actions } = props;
  const choicePrefix=useId();
  // A provisional or missing record has no accepted children; borrowing the live head crosses branches.
  const node = useGameStore(state => props.displayNodeId === undefined ? state.currentNode : state.allNodes[props.displayNodeId ?? ''] ?? null);
  const nodes = useGameStore(state => state.allNodes);
  const [branch, setBranch] = useState<{ nodeId: string; ids: string[] } | null>(null);
  const choices = branch?.nodeId === node?.id ? branch?.ids ?? [] : [];
  const [choice, setChoice] = useState(0);
  const [busy, setBusy] = useState(false);
  const navigationBlocked = busy || loading && !props.allowNavigationWhileLoading;
  const previousId = props.pendingPreviousId ?? (node ? nodes[node.id]?.parentId : null);
  const lock = useRef(false);
  const root = useRef<HTMLElement>(null);
  const [expandedNode, setExpandedNode] = useState<string | null>(null);
  const visible = showing && !props.reviewing ? segments.slice(0, Math.max(props.revealedCount ?? 0, segmentIndex + 1)) : segments;
  const complete = (!showing || Boolean(props.reviewing) && segmentIndex === segments.length - 1) && !loading;
  // 同一行动可能重试产生多个节点，回顾只列一个可继续的分支。
  const seen = new Set<string>();
  const children = (props.transient ? [] : node ? nodes[node.id]?.childIds ?? [] : []).filter(id => {
    const child = nodes[id];
    const action = child ? child.inputIdentity ?? (child.inputDocuments?.length ? `${child.playerInput.trim()}:${JSON.stringify(child.inputDocuments)}` : child.playerInput.trim()) : undefined;
    // Equal choices reached through different entry snapshots are distinct experiences.
    const identity = JSON.stringify([child?.entry?.id ?? null, action]);
    if (action === undefined || seen.has(identity)) return false;
    seen.add(identity); return true;
  });
  const hasChoiceEffects=(action:string)=>visible.some(s=>s.textEffects?.some(e=>e.target==='choice' && e.quote===action)) || presentationCues(nodes,node?.id).some(c=>c.active && c.field==='choice' && c.effect.quote===action);
  const remainingActions = [...new Set(actions)].filter(action => !children.some(id => matchesActionInput(nodes[id], action)));
  const expansionKey = `${node?.id ?? ""}:${props.pageKey}`;
  const expanded = !children.length || expandedNode === expansionKey;
  const move = async (id: string, nextDirection: 'up' | 'down') => {
    if (navigationBlocked || lock.current) return;
    lock.current = true; setBusy(true); setBranch(null);
    try { await props.onNavigate(id, nextDirection); } finally { lock.current = false; setBusy(false); root.current?.focus({ preventScroll: true }); }
  };
  const previous = () => { if (props.transient) { props.transient.onReturn(); return; } if (previousId && nodes[previousId]) void move(previousId, 'up'); };
  const next = () => {
    if (props.onPendingNext) { props.onPendingNext(); return; }
    if (children.length > 1) { setBranch({ nodeId: node!.id, ids: children }); setChoice(0); root.current?.focus({ preventScroll: true }); }
    else if (children[0]) void move(children[0], 'down');
  };
  useRecordEdgeSwipe(root, { enabled: !navigationBlocked && !choices.length,
    previous: Boolean(props.transient || previousId && nodes[previousId]), next: Boolean(props.onPendingNext || children.length),
    onPrevious: previous, onNext: next });
  useEffect(() => { root.current?.querySelector<HTMLElement>('[aria-label="选择后续分支"] [aria-pressed="true"]')?.scrollIntoView?.({ block: "nearest", behavior: "smooth" }); }, [choices, choice]);
  useRecordPlaybackScroll(root, { pageKey: props.pageKey, landing: props.landing, loading, complete, showing,
    segmentIndex, focused: props.focused, visualLayout: props.visualLayout, actionsCount: actions.length,
    content: props.visualLayout ? segments[segmentIndex]?.text : undefined });
  return <section ref={root} data-action-record tabIndex={0} aria-label={ui("行动记录")} className="eidos-action-record"
    onFocusCapture={() => props.onFocusChange(true)} onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget)) props.onFocusChange(false); }}
    onPointerDown={event => { if (!(event.target as HTMLElement).closest('button, input, [role="button"], [role="separator"]')) root.current?.focus({ preventScroll: true }); }}
    onKeyDown={event => {
      if (event.nativeEvent.isComposing || event.repeat || navigationBlocked) return;
      if (choices.length && ['ArrowUp', 'ArrowDown', ' ', 'Enter', 'Escape'].includes(event.key)) {
        event.preventDefault(); event.stopPropagation();
        if (event.key === 'Escape') setBranch(null);
        else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') setChoice(index => (index + (event.key === 'ArrowUp' ? -1 : 1) + choices.length) % choices.length);
        else void move(choices[choice], 'down');
      } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        event.preventDefault(); event.stopPropagation(); if (event.key === 'ArrowUp') previous(); else next();
      }
    }}>
    <nav className="eidos-record-navigation" aria-label={ui("行动记录切换")}>
      <button aria-label={ui("上一行动记录")} disabled={navigationBlocked || (!props.transient && (!previousId || !nodes[previousId]))} onClick={previous}>↑</button>
      <button aria-label={ui("下一行动记录")} disabled={navigationBlocked || !props.onPendingNext && !children.length} onClick={next}>↓</button>
    </nav>
    <RecordPages pageKey={props.pageKey} direction={props.direction ?? "down"}>
      <div className="eidos-record-scroll">
        <article className="eidos-story-paper flex w-full flex-col px-9 py-8" data-transient={Boolean(props.transient)}>
          <div className="font-mono text-[10px] uppercase tracking-[.34em] text-black/42">CURRENT RECORD</div>
          <h2 className="mt-6 text-3xl font-semibold tracking-[-.06em]">{props.transient ? ui("行动未执行") : ui("行动记录")}</h2>
          {props.transient && <p className="mt-3 text-xs text-black/50">{ui("这次尝试不会写入历史。修改输入重试，或返回原节点。")}</p>}
          {props.playerInput && <div className="mt-4 text-sm leading-7 text-black/55" aria-label={ui("玩家行动")}>→ <NarrativeText text={props.playerInput} /></div>}
          <NodeDocumentLinks inputs={props.playerInput?.includes('document://') ? [] : props.inputDocuments} outputs={node?.workspaceBranch ? [] : props.outputDocuments} onPreviewChange={props.onDocumentPreviewChange} />
          {props.notice && <p role="status" className="mt-4 border-l-2 border-current pl-3 text-sm leading-7">{props.notice}</p>}
          <div className="mt-5 space-y-4">
            {visible.length ? visible.map((segment, index) => <div key={index} data-current-record-segment={index === segmentIndex && showing && (props.visualLayout || props.focused !== false) ? "" : undefined} data-record-segment={index} className={segment.type === 'dialogue' ? 'eidos-record-dialogue' : ''}>
              {segment.type === 'dialogue' && <button className="eidos-focus eidos-record-speaker" onClick={() => props.onReplay(segment)} disabled={loading} title={ui("重播这句对话")}><NarrativeText originId={props.originId} playbackKey={props.playbackKey} animate={!props.reviewing} nodeId={props.displayNodeId} segmentIndex={index} occurrence={`${props.pageKey}:${index}`} text={segment.speaker || 'NPC'} effects={segment.textEffects} target="speaker" /><SpeakerExpression segment={segment} /></button>}
              <p role={props.onPlay ? 'button' : undefined} tabIndex={props.onPlay ? 0 : undefined}
                onClick={() => { if (!window.getSelection()?.toString()) props.onPlay?.(index); }}
                onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); props.onPlay?.(index); } }}
                data-reading-text data-reading-dialogue={segment.type === 'dialogue' ? '' : undefined} className="whitespace-pre-line text-sm leading-[1.95] eidos-text-primary selection:bg-amber-500/20">{segment.type === 'dialogue' && '「'}<NarrativeText originId={props.originId} playbackKey={props.playbackKey} animate={!props.reviewing} nodeId={props.displayNodeId} segmentIndex={index} occurrence={`${props.pageKey}:${index}`} sourceComplete={index !== props.draftIndex} searchSources={segment.searchSources} text={segment.text} effects={segment.textEffects} />{segment.type === 'dialogue' && '」'}</p>
              {!loading && <WorkspaceReceipts node={props.transient ? undefined : node} attempt={props.transient ? props.workspaceAttempt : undefined} segmentIndex={index} showConflict={index === visible.length - 1 && Boolean(node?.workspaceBranch?.mergeFailure && node.workspaceBranch.mergeFailure.segmentIndex >= visible.length)} onResolve={props.onResolveWorkspace} />}
            </div>) : !loading && <p className="whitespace-pre-line text-sm leading-[1.95] eidos-text-primary">{fallback}</p>}
            {loading && <p role="status" aria-label={ui("行动回复状态")} className="py-4 text-sm leading-[1.95] text-black/50 motion-safe:animate-pulse">{actionActivityText[props.replyPhase ?? 'waiting']}</p>}
          </div>
          {!props.transient && complete && actions.length > 0 && <div data-current-record-segment={!showing ? '' : undefined} className="eidos-record-options" aria-label={ui("推荐行动")}>
            <button className="eidos-focus text-sm text-[var(--eidos-accent)]" aria-expanded={expanded} onClick={() => setExpandedNode(expanded ? null : expansionKey)}>{ui("推荐行动")}</button>
            {expanded && remainingActions.map((action, index) => action === plainDocumentText(action)
              ? <button key={index} aria-label={visible.some(s => s.textEffects?.some(e => e.target === 'choice' && e.quote === action)) || presentationCues(nodes,node?.id).some(c => c.active && c.field === 'choice' && c.effect.quote === action) ? undefined : action} className="eidos-focus eidos-record-option" onClick={() => props.onAction(action)}><span aria-hidden="true">→ </span><NarrativeText originId={props.originId} playbackKey={props.playbackKey} animate={!props.reviewing} nodeId={props.displayNodeId} segmentIndex={0} occurrence={`${props.pageKey}:choice:${index}`} text={action} effects={visible.flatMap(segment => segment.textEffects ?? [])} target="choice" /></button>
              : <div key={index} className="eidos-record-option" onClick={() => props.onAction(action)}><button aria-label={hasChoiceEffects(action) ? undefined : plainDocumentText(action)} aria-labelledby={hasChoiceEffects(action) ? `${choicePrefix}:${index}` : undefined} className="eidos-focus" type="button"><span aria-hidden="true">→ </span></button><span id={`${choicePrefix}:${index}`}><NarrativeText originId={props.originId} playbackKey={props.playbackKey} animate={!props.reviewing} nodeId={props.displayNodeId} segmentIndex={0} occurrence={`${props.pageKey}:choice:${index}`} text={action} effects={visible.flatMap(segment => segment.textEffects ?? [])} target="choice" /></span></div>)}
          </div>}
          {props.transient && <button className="eidos-focus eidos-record-option mt-6" onClick={props.transient.onReturn}>{ui("← 返回原节点")}</button>}
          {(complete || choices.length > 0) && children.length > 0 && <div className="eidos-record-options" role="group" aria-label={ui("选择后续分支")}>
            <div className="mb-2 text-xs text-black/50">{ui("已走过的分支")}</div>
            {children.map(id => <button key={id} aria-pressed={choices.length > 0 && choices[choice] === id} className="eidos-focus eidos-record-option" disabled={loading || busy} onFocus={() => { if (choices.length) setChoice(choices.indexOf(id)); }} onClick={() => void move(id, 'down')}><span aria-hidden="true">→ </span>{plainDocumentText(nodes[id]?.playerInput || ui("故事开始"))}{nodes[id]?.inputDocuments?.length && !nodes[id].playerInput.includes('document://') ? <small className="block text-xs opacity-60">{ui("引用 →")} {nodes[id].inputDocuments!.map(link => link.title).join(ui("、"))}</small> : null}</button>)}
          </div>}
        </article>
      </div>
    </RecordPages>
  </section>;
}
