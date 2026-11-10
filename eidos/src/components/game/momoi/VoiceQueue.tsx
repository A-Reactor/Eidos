"use client";
import { useInterfaceText } from "@/components/shell/useInterfaceText";

import { useState } from "react";
import { useGameStore } from "@/store/game-store";
import { EidosButton } from "@/components/ui/EidosScreen";
import { getVoiceLibrary } from "@/lib/game/momoi/runtime";
const labels = { manual: "手动播放", current: "当前对话", next: "即将播放", prefetch: "预生成", batch: "批量补齐", speculative: "候选预热" };
export function VoiceQueue() {
  const ui = useInterfaceText();
  const items = useGameStore(s => s.voiceQueue);
  const [error, setError] = useState("");
  const running = items.find(item => item.status === "running");
  const waiting = items.filter(item => item.status === "waiting");
  async function cancel(id?: string) {
    try { (await getVoiceLibrary()).cancelWaiting(id); setError(""); }
    catch (error) { setError(error instanceof Error ? error.message : ui("取消失败")); }
  }
  if (!items.length && !error) return null;
  return <section aria-label={ui("语音生成队列")} className="border border-current/15 p-3 space-y-2">
    <p role="status" className="text-xs">{running ? ui("正在生成 · {0}", {"0": running.speaker || ui("对话")}) : ui("等待生成")} {ui("· 排队")}{waiting.length} {ui("段")}</p>
    {running && <p className="text-xs opacity-60 truncate" title={running.text}>{running.text}</p>}
    {waiting.length > 0 && <details><summary className="cursor-pointer text-xs">{ui("查看等待任务")}</summary><ul className="space-y-2 py-2">{waiting.map(item => <li key={item.id} className="flex gap-3 items-center text-xs">
      <span className="min-w-0 flex-1 truncate" title={item.text}>{ui(labels[item.priority])} · {item.speaker || ui("对话")}：{item.text}</span>
      <EidosButton aria-label={ui("取消等待：{0}", {"0": item.text})} onClick={() => void cancel(item.id)}>{ui("取消")}</EidosButton>
    </li>)}</ul><EidosButton onClick={() => void cancel()}>{ui("取消全部等待")}</EidosButton></details>}
    <p className="text-[11px] leading-5 opacity-50">{ui("当前对话优先；已经开始的生成会完成并保存。取消批次中的等待任务也会停止该批次的后续任务。")}</p>
    {error && <p role="alert" className="text-xs">{error}</p>}
  </section>;
}
