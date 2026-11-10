"use client";
import { useInterfaceText } from "@/components/shell/useInterfaceText";

import { SpeakerExpression } from "./SpeakerExpression";

import type { StorySegment } from "@/lib/ai/types";
import { useGameStore } from "@/store/game-store";

interface DialogueBubbleProps {
  currentSegment: StorySegment | null;
  displayedText: string;
  isLoading: boolean;
  preActionInput: string;
  /** MOMOI 语音播放状态 */
  isVoicePlaying?: boolean;
  isVoiceGenerating?: boolean;
  /** 播放/重播当前语音 */
  onReplayVoice?: () => void;
}

export function DialogueBubble({
  currentSegment,
  displayedText,
  isVoicePlaying = false,
  isVoiceGenerating = false,
  onReplayVoice,
}: DialogueBubbleProps) {
  const ui = useInterfaceText();
  const momoiSettings = useGameStore((s) => s.momoiSettings);
  const voiceEnabled = momoiSettings.enabled;

  // 仅在当前段落为对话时显示
  if (!currentSegment || currentSegment.type !== "dialogue") return null;

  return (
    <div className="eidos-quote-ribbon animate-in fade-in slide-in-from-bottom-2 duration-200">
      <span className="font-mono text-[9px] font-extrabold uppercase tracking-[.14em]">
        {currentSegment.speaker || "NPC"}<SpeakerExpression segment={currentSegment} /> /
      </span>
      <span className="ml-2 line-clamp-2 max-w-[28rem] text-[12px] leading-5">
        “{displayedText}”
      </span>
      {voiceEnabled && onReplayVoice && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onReplayVoice();
          }}
          className={`eidos-focus ml-3 border border-white/20 px-1.5 py-0.5 text-[10px] ${
            isVoicePlaying || isVoiceGenerating ? "text-white" : "text-white/60 hover:text-white"
          }`}
          title={isVoiceGenerating ? ui("生成中...") : isVoicePlaying ? "播放中..." : "播放语音"}
        >
          ▶
        </button>
      )}
    </div>
  );
}
