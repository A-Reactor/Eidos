"use client";
import { useInterfaceText } from "@/components/shell/useInterfaceText";

import { SpeakerExpression } from "./SpeakerExpression";

import type { StorySegment } from "@/lib/ai/types";
import { useLayoutEffect, useRef } from 'react';
import { fitStageCopy } from '@/lib/ui/stage-layout';
import { NarrativeText } from './NarrativeText';

interface SegmentGlyphFieldProps {
  passageKey?: string; playbackKey?:string; animate?:boolean;
  nodeId?: string; segmentIndex?: number; originId?:string;
  sourceComplete?: boolean;
  currentSegment: StorySegment | null;
  displayedText: string;
  sceneName: string;
  dialogueTextMode?: "full" | "index";
}

interface SegmentGlyphModel {
  tone: "dialogue" | "narration";
  mode: "DIALOGUE" | "NARRATION";
  label: string;
  primary: string;
  excerpt: string;
  marker: "D" | "N";
}

export function buildSegmentGlyphModel({
  currentSegment,
  displayedText,
  sceneName,
  dialogueTextMode = "full",
}: SegmentGlyphFieldProps): SegmentGlyphModel {
  const source = (displayedText || currentSegment?.text || sceneName || "EIDOS");
  const normalized = source;

  const isDialogue = currentSegment?.type === "dialogue";
  const mode = isDialogue ? "DIALOGUE" : "NARRATION";
  const primary = isDialogue
    ? currentSegment?.speaker || "NPC"
    : "旁白";
  const excerpt = isDialogue && dialogueTextMode === "index"
    ? [
        currentSegment?.emotion ? `EMOTION ${currentSegment.emotion.toUpperCase()}` : "VOICE CHANNEL",
        sceneName ? `SCENE ${sceneName}` : "LIVE",
      ].join(" / ")
    : normalized || "等待叙事输入。";

  return {
    tone: isDialogue ? "dialogue" : "narration",
    mode,
    label: `${primary} / ${mode}`,
    primary,
    excerpt,
    marker: isDialogue ? "D" : "N",
  };
}

export function SegmentGlyphField(props: SegmentGlyphFieldProps) {
  const ui = useInterfaceText();
  // Idle scenes need a location anchor; repeating a narration title adds no reading context.
  const model = buildSegmentGlyphModel(props);
  const fieldRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const field = fieldRef.current, stage = field?.closest('[data-story-stage]');
    if (!field || !stage) return;
    const dock = stage.querySelector('[data-stage-lower-bound]');
    let frame = 0, active = true;
    const measure = () => {
      const excerpt = field.querySelector<HTMLElement>('.eidos-segment-glyph-field__excerpt');
      const label = field.querySelector<HTMLElement>('.eidos-segment-glyph-field__label');
      if (!excerpt || !label) { field.style.removeProperty('transform'); return; }
      const bounds = field.getBoundingClientRect(), stageBounds = stage.getBoundingClientRect();
      const baseline = stageBounds.top + field.offsetTop;
      const number = stage.querySelector('.eidos-day-marker strong')?.getBoundingClientRect();
      const lineHeight = parseFloat(getComputedStyle(excerpt).lineHeight) || 32;
      const fit = fitStageCopy({ top: baseline, bottom: (dock?.getBoundingClientRect().top || stageBounds.bottom - 100) - 20,
        labelCenterOffset: label.getBoundingClientRect().top - bounds.top + label.offsetHeight / 2,
        nodeCenter: number?.height ? number.top + number.height / 2 : stageBounds.top + 100,
        textOffset: excerpt.getBoundingClientRect().top - bounds.top,
        textHeight: excerpt.scrollHeight, lineHeight });
      field.style.transform = `translateY(-${fit.rise}px)`;
      excerpt.style.setProperty('-webkit-line-clamp', String(fit.lines));
    };
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(measure); };
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule);
    observer?.observe(stage); observer?.observe(field); if (dock) observer?.observe(dock);
    window.addEventListener('resize', schedule);
    void document.fonts?.ready.then(() => { if (active) schedule(); });
    return () => { active = false; cancelAnimationFrame(frame); observer?.disconnect(); window.removeEventListener('resize', schedule); };
  }, [model.excerpt, model.primary, props.sceneName]);

  return (
    <div
      ref={fieldRef}
      aria-label={ui("当前段落字形场")}
      className={`eidos-segment-glyph-field is-${model.tone}`}
    >
      <div className="eidos-segment-glyph-field__plate">
        <div className="eidos-segment-glyph-field__copy">
          <div className="eidos-segment-glyph-field__label">{props.currentSegment ? model.mode : ui("SCENE / 现场")}</div>
          <div className="eidos-segment-glyph-field__title"><NarrativeText originId={props.originId} playbackKey={props.playbackKey} animate={props.animate} nodeId={props.nodeId} segmentIndex={props.segmentIndex} occurrence={props.passageKey} text={props.currentSegment ? model.primary : props.sceneName} effects={props.currentSegment?.textEffects} target="speaker" /><SpeakerExpression segment={props.currentSegment} /></div>
          {props.currentSegment && <div className="eidos-segment-glyph-field__scene">{props.sceneName}</div>}
          {props.currentSegment && !(model.tone === 'dialogue' && props.dialogueTextMode === 'index') && <div className="eidos-segment-glyph-field__excerpt"><NarrativeText originId={props.originId} playbackKey={props.playbackKey} animate={props.animate} nodeId={props.nodeId} segmentIndex={props.segmentIndex} occurrence={props.passageKey} sourceComplete={props.sourceComplete} text={props.currentSegment.textEffects?.length && !props.displayedText ? "" : model.excerpt} searchSources={props.currentSegment.searchSources} source={props.currentSegment.text} effects={props.currentSegment.textEffects} /></div>}
        </div>
      </div>
    </div>
  );
}
