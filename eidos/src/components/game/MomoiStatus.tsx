"use client";
import { useGameStore } from "@/store/game-store";
import { voiceStatusLabel } from "@/lib/game/momoi/service-status";
export function MomoiStatus({ onOpenPanel }: { onOpenPanel?: () => void }) {
  const enabled = useGameStore(s => s.momoiSettings.enabled);
  const status = useGameStore(voiceStatusLabel);
  const error = useGameStore(s => s.voiceError);
  const label = `对话语音 · ${status}`;
  return <button onClick={onOpenPanel} title={error ?? label} aria-label={label} className="eidos-focus eidos-micro-action px-2 py-1 text-[10px]" data-active={enabled}>MOMOI · {status}</button>;
}
