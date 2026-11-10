"use client";
import { useInterfaceText } from "@/components/shell/useInterfaceText";


import { useGameStore } from '@/store/game-store';

function tokens(value: number): string {
  return value >= 1_000_000 ? `${(value / 1_000_000).toFixed(1)}M` : value >= 1000 ? `${(value / 1000).toFixed(1)}K` : String(value);
}

export function AliceContextMeter() {
  const ui = useInterfaceText();
  const context = useGameStore(s => s.currentWorld ? s.worldAliceContext[s.currentWorld.id] : undefined);
  const ratio = context?.windowTokens ? context.inputTokens / context.windowTokens : null;
  const percent = ratio === null ? null : Math.max(0, ratio * 100);
  const fill = Math.min(100, percent ?? 0);
  const label = context ? `${context.estimated ? '估算 ' : ''}${tokens(context.inputTokens)} / ${context.windowTokens ? tokens(context.windowTokens) : ui("上限未知")}` : '等待首次行动';
  const tooltip = ui("ALICE 上下文{0} · {1}{2}", {"0": percent === null ? '' : ` ${percent.toFixed(1)}%`, "1": label, "2": context ? ` · ${context.modelId}` : ''});
  return <div className="eidos-context-meter" title={tooltip}>
    <div role="progressbar" aria-label={ui("ALICE 输入上下文占用")} aria-valuemin={0} aria-valuemax={100}
      aria-valuenow={percent === null ? undefined : Math.round(fill * 10) / 10} aria-valuetext={tooltip}
      className="eidos-context-meter__track"><span style={{ width: `${fill}%` }} /></div>
  </div>;
}
