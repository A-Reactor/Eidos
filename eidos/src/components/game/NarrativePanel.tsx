"use client";
import { useInterfaceText } from "@/components/shell/useInterfaceText";

import { SpeakerExpression } from "./SpeakerExpression";

import type { StorySegment } from "@/lib/ai/types";

interface NarrativePanelProps {
  currentSegment: StorySegment | null;
  sceneNarrative: string;
  isLoading: boolean;
  displayedText: string;
  /** 全部 segments（用于右侧"当前记录"累积展示） */
  segments: StorySegment[];
  /** 当前已阅读到的 segment 索引（右侧只展示 0..segmentIndex） */
  segmentIndex: number;
}

export function NarrativePanel({
  currentSegment,
  sceneNarrative,
  isLoading,
  displayedText,
  segments,
  segmentIndex,
}: NarrativePanelProps) {
  const ui = useInterfaceText();
  const hasSegments = segments.length > 0;

  // 无 segment / 加载中
  if (!currentSegment && !hasSegments) {
    const fallback = sceneNarrative || "世界仍保持观测。";
    return (
      <div className="eidos-story-paper flex w-full flex-col px-9 py-8">
        <div className="font-mono text-[10px] uppercase tracking-[0.34em] text-black/42">
          SCENE RECORD
        </div>
        <h2 className="mt-8 text-3xl font-semibold leading-[1.05] tracking-[-.06em] text-black/85">{ui("场景记录")}</h2>
        <p data-reading-text className={`mt-5 whitespace-pre-line text-sm leading-[1.95] tracking-[0.01em] selection:bg-amber-500/20 ${
          isLoading ? "text-black/42 animate-pulse" : "eidos-text-primary"
        }`}>
          {fallback}
        </p>
        <div className="mt-auto border-t border-black/18 pt-3 font-mono text-[10px] font-bold uppercase tracking-[0.22em] text-[color:var(--eidos-accent)]">
          ALICE / NARRATIVE FEED
        </div>
      </div>
    );
  }

  // 累积展示：从第 0 段到当前 segmentIndex 的所有已阅读 segment
  const visibleSegments = hasSegments
    ? segments.slice(0, segmentIndex + 1)
    : [];

  return (
    <div className="eidos-story-paper flex w-full flex-col px-9 py-8 animate-in fade-in slide-in-from-bottom-2 duration-300">
      <div className="font-mono text-[10px] uppercase tracking-[0.34em] text-black/42">
        CURRENT RECORD / ACCUMULATED
      </div>
      <h2 className="mt-8 text-3xl font-semibold leading-[1.05] tracking-[-.06em] text-black/85">{ui("当前记录")}</h2>
      <div className="mt-5 space-y-4">
        {visibleSegments.map((seg, index) => {
          const isLast = index === visibleSegments.length - 1;
          if (seg.type === "dialogue") {
            return (
              <div key={index} className="border-l-4 border-[color:var(--eidos-accent)] pl-4">
                <div className="font-mono text-[9px] font-black uppercase tracking-[0.24em] text-[color:var(--eidos-accent)]">
                  {seg.speaker || "NPC"}<SpeakerExpression segment={seg} /> / DIALOGUE
                </div>
                <p data-reading-text data-reading-dialogue className="mt-2 whitespace-pre-line text-sm leading-[1.9] tracking-[0.01em] eidos-text-primary selection:bg-amber-500/20">
                  &ldquo;{seg.text}&rdquo;
                  {isLast && (
                    <span className="inline-block w-[2px] h-[1.1em] bg-[color:var(--eidos-accent)] align-middle ml-0.5 animate-pulse" />
                  )}
                </p>
              </div>
            );
          }
          return (
            <p data-reading-text key={index} className="whitespace-pre-line text-sm leading-[1.95] tracking-[0.01em] eidos-text-primary selection:bg-amber-500/20">
              {seg.text}
              {isLast && (
                <span className="inline-block w-[2px] h-[1.1em] bg-[color:var(--eidos-accent)] align-middle ml-0.5 animate-pulse" />
              )}
            </p>
          );
        })}
      </div>
      <div className="mt-auto border-t border-black/18 pt-3 font-mono text-[10px] font-bold uppercase tracking-[0.22em] text-[color:var(--eidos-accent)]">
        ALICE / NARRATIVE FEED
      </div>
    </div>
  );
}
