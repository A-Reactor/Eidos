"use client";
import { useInterfaceText } from "@/components/shell/useInterfaceText";

import { useLayoutEffect, useRef, useState } from 'react';
import { segmentRailLayout } from '@/lib/ui/stage-layout';

interface Props { focused?: boolean; isShowingSegments: boolean; segmentIndex: number; segmentsLength: number; onSelect: (index: number) => void }
export function SegmentNav({ focused = true, isShowingSegments, segmentIndex, segmentsLength, onSelect }: Props) {
  const ui = useInterfaceText();
  const rail = useRef<HTMLElement>(null);
  const [height, setHeight] = useState(0);
  const [rem, setRem] = useState(16);
  const drag = useRef<{ id: number; offset: number } | null>(null);
  useLayoutEffect(() => {
    const node = rail.current;
    if (!node) return;
    const stage = node.closest('[data-story-stage]'), dock = stage?.querySelector('[data-stage-lower-bound]');
    const measure = () => {
      const top = node.getBoundingClientRect().top;
      const bottom = dock?.getBoundingClientRect().top ?? (stage?.getBoundingClientRect().bottom ?? window.innerHeight) - 100;
      const available = Math.max(0, bottom - top - 20);
      if (available) { node.style.height = `${available}px`; setHeight(available); }
      setRem(parseFloat(getComputedStyle(document.documentElement).fontSize) || 16);
    };
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    if (stage) observer?.observe(stage); if (dock) observer?.observe(dock);
    window.addEventListener('resize', measure);
    return () => { observer?.disconnect(); window.removeEventListener('resize', measure); };
  }, [segmentsLength]);
  if (!segmentsLength) return null;
  const layout = segmentRailLayout(height, segmentsLength, isShowingSegments, rem);
  const continuous = height > 0 && layout.continuous;
  const current = isShowingSegments ? Math.min(segmentIndex, segmentsLength - 1) : segmentsLength - 1;
  const travel = Math.max(0, height - 2 * layout.padding - layout.thumb);
  const selectAt = (y: number, offset = layout.thumb / 2) => {
    if (!rail.current || !travel) return;
    const ratio = (y - rail.current.getBoundingClientRect().top - layout.padding - offset) / travel;
    const index = Math.max(0, Math.min(segmentsLength - 1, Math.round(ratio * (segmentsLength - 1))));
    if (index !== current || !isShowingSegments) onSelect(index);
  };
  return <nav ref={rail} aria-label={ui("叙事段落进度")} className="eidos-segment-rail" data-continuous={continuous}>
    {continuous ? <div className="eidos-segment-slider eidos-focus" role="slider" tabIndex={0} aria-label={ui("叙事段落")} aria-orientation="vertical"
      aria-valuemin={1} aria-valuemax={segmentsLength} aria-valuenow={current + 1} aria-valuetext={ui("第 {0} 段，共 {1} 段", {"0": current + 1, "1": segmentsLength})}
      onClick={e => e.stopPropagation()} onPointerDown={e => {
        if (e.button !== 0) return;
        e.preventDefault(); e.stopPropagation();
        const thumb = e.currentTarget.firstElementChild!.getBoundingClientRect();
        const offset = e.clientY >= thumb.top && e.clientY <= thumb.bottom ? e.clientY - thumb.top : layout.thumb / 2;
        drag.current = { id: e.pointerId, offset }; e.currentTarget.setPointerCapture(e.pointerId); selectAt(e.clientY, offset);
      }} onPointerMove={e => { if (drag.current?.id === e.pointerId) selectAt(e.clientY, drag.current.offset); }}
      onPointerUp={e => { if (drag.current?.id === e.pointerId) { drag.current = null; e.currentTarget.releasePointerCapture(e.pointerId); } }}
      onLostPointerCapture={() => { drag.current = null; }}
      onKeyDown={e => {
        const next = ({ ArrowUp: current - 1, ArrowDown: current + 1, Home: 0, End: segmentsLength - 1, PageUp: current - 10, PageDown: current + 10 } as Record<string, number>)[e.key];
        if (next === undefined) return;
        e.preventDefault(); e.stopPropagation(); onSelect(Math.max(0, Math.min(segmentsLength - 1, next)));
      }}>
      <span aria-hidden="true" className="eidos-segment-slider__thumb" data-active={isShowingSegments && focused} style={{ top: current / Math.max(1, segmentsLength - 1) * travel }} />
    </div> : <div className="eidos-segment-rail__track">
      {Array.from({ length: segmentsLength }, (_, index) => <button key={index} aria-label={ui("播放第 {0} 段", {"0": index + 1})} aria-current={focused && isShowingSegments && index === segmentIndex ? 'step' : undefined} onClick={() => onSelect(index)} className={`eidos-focus eidos-segment-nav__dot ${focused && isShowingSegments && index === segmentIndex ? 'is-active' : !isShowingSegments || index < segmentIndex ? 'is-read' : ''}`} />)}
    </div>}
  </nav>;
}
