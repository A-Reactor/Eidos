'use client';
import { useInterfaceText } from "@/components/shell/useInterfaceText";

import { useRef } from 'react';
import { buildModDocument } from '@/lib/game/plugins/mod-ui';
import type { ModStage } from '@/lib/game/plugins/workspace';

interface Props {
  offline?: boolean;
  stages: ModStage[]; token: string; scope: string;
  register(id: string, frame: HTMLIFrameElement | null): void;
  move(stage: ModStage): void;
  close(id: string): void;
}
export function ModAuxiliaryStages({ stages, token, scope, register, move, close, offline = false }: Props) {
  const ui = useInterfaceText();
  const drag = useRef<{ stage: ModStage; pointerX: number; pointerY: number } | null>(null);
  return <div className="eidos-mod-windows" aria-label={ui("模组辅助舞台")}>
    {stages.map(stage => <section key={stage.id} className="eidos-mod-window" style={{ left: stage.x, top: stage.y, width: stage.width, height: stage.height }} aria-label={stage.title}>
      <header onPointerDown={event => {
        if ((event.target as HTMLElement).closest('button')) return;
        drag.current = { stage, pointerX: event.clientX, pointerY: event.clientY }; event.currentTarget.setPointerCapture(event.pointerId);
      }} onPointerMove={event => {
        const start = drag.current;
        if (start) event.currentTarget.parentElement!.style.transform = `translate(${event.clientX - start.pointerX}px, ${event.clientY - start.pointerY}px)`;
      }} onPointerUp={event => {
        event.currentTarget.parentElement!.style.transform = '';
        const start = drag.current; drag.current = null;
        if (start) move({ ...start.stage, x: Math.max(0, start.stage.x + event.clientX - start.pointerX), y: Math.max(0, start.stage.y + event.clientY - start.pointerY) });
      }} onPointerCancel={event => { drag.current = null; event.currentTarget.parentElement!.style.transform = ''; }}><span>{stage.title}</span><button type="button" onClick={() => close(stage.id)} aria-label={ui("关闭{0}", {"0": stage.title})}>×</button></header>
      <iframe ref={element => register(stage.id, element)} title={ui("{0}辅助舞台", {"0": stage.title})} sandbox="allow-scripts" data-session={token} data-scope={scope} srcDoc={buildModDocument(stage.html, token, offline)}
        onLoad={event => event.currentTarget.contentWindow?.postMessage({ channel: 'eidos-mod-host-ready', token }, '*')} />
    </section>)}
  </div>;
}
