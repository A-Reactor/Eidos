"use client";
import { useInterfaceText } from "@/components/shell/useInterfaceText";


import { useState, useEffect } from "react";
import type { WorldGenerationProfile } from "@/lib/ai/world-generation-profile";
import { WORLD_FILL_SECTIONS } from '@/lib/game/world-fill-progress';

// ============================================================
// KEI 创作追踪 — 玩家可见的世界建造日志
// ============================================================

// 流式追踪：JSON 字段 → 中文进度消息（KEI 叙事风格）
export const FIELD_MESSAGES: Record<string, string> = {
  name: "KEI 为这个世界想了个名字",
  subtitle: "KEI 正在为某件事挠头",
  overview: "KEI 为这个世界描绘了轮廓",
  regions: "KEI 正在地图上挥洒热情",
  npcs: "KEI 正在刻画人们的肖像",
  npcSpeechProfiles: "KEI 正在细化人们的声音与语气",
  identityOptions: "KEI 正在为你留一扇门",
  mapRoutes: "KEI 正在确认道路的去向",
  contradictions: "KEI 正在找戏剧性之所在",
  history: "KEI 正在创造历史！",
  clues: "KEI 正在为世界编织线索的大网",
  currencyName: "KEI 翻看了一下空空如也的经费",
  calendarEra: "KEI 看了一眼手表",
  timeline: "KEI 正在整理世界可能的走向",
};

export function CreationProgress({ error, liveMessage, isThinking, estimatedTokens, onStop, startTime, receivedChars, completedFields, currentField, hasGameplay = false }: {
  error: string | null;
  generationProfile?: WorldGenerationProfile;
  liveMessage?: string | null; isThinking?: boolean;
  estimatedTokens?: { prompt: number; completion: number; total: number } | null;
  onStop?: () => void; startTime?: number | null;
  receivedChars: number; completedFields: string[]; eventCount: number; currentField?: string; hasGameplay?: boolean;
}) {
  const ui = useInterfaceText();
  const [elapsedSec, setElapsedSec] = useState(0);
  useEffect(() => {
    if (!startTime || !onStop) return;
    const tick = () => setElapsedSec(Math.floor((Date.now() - startTime) / 1000));
    tick(); const timer = setInterval(tick, 1000); return () => clearInterval(timer);
  }, [startTime, onStop]);
  const fieldMessage = currentField && FIELD_MESSAGES[currentField] || [...completedFields].reverse().map(field => FIELD_MESSAGES[field]).find(Boolean);
  // Status advances only when the stream reports actual content, never with wall-clock time.
  const subtitle = isThinking ? "KEI 正在思考…" : liveMessage ?? fieldMessage ?? "KEI 在给这个世界起名字…";
  const filled = new Set(completedFields);
  const sections = WORLD_FILL_SECTIONS.filter(section => section.id !== 'gameModeConfig' || hasGameplay || filled.has('gameModeConfig') || currentField === 'gameModeConfig');
  const count = sections.filter(section => section.fields.every(field => filled.has(field))).length;
  const percentage = Math.round(count / sections.length * 100);
  const active = currentField === 'mapRoutes' ? 'regions' : currentField === 'npcSpeechProfiles' ? 'npcs' : currentField;
  return <div className="eidos-creation-progress" aria-label={ui("世界生成进度")}>
    <div className="eidos-creation-progress-header">
      <p className="min-w-0 flex-1 text-sm font-medium" aria-live="polite">{subtitle}</p>
      <span className="eidos-creation-clock" aria-label={ui("已用 {0}分{1}秒", {"0": Math.floor(elapsedSec / 60), "1": elapsedSec % 60})} title={ui("{0} 字符{1}", {"0": receivedChars.toLocaleString(), "1": estimatedTokens ? ` · 约 ${estimatedTokens.total.toLocaleString()} tokens` : ''})}>{Math.floor(elapsedSec / 60)}:{String(elapsedSec % 60).padStart(2, '0')}</span>
      {onStop && <button onClick={onStop} aria-label={ui("停止生成（保留已有内容）")} className="eidos-world-create__ghost eidos-creation-stop">{ui("停止")}</button>}
    </div>
    <div>
      <div className="flex items-center justify-between gap-2 text-[11px] opacity-60"><span>{ui("内容填充")}</span><span>{percentage}%</span></div>
      <div role="progressbar" aria-label={ui("世界内容")} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percentage} aria-valuetext={ui("{0}/{1} 项已填充", {"0": count, "1": sections.length})} className="mt-1 h-1 overflow-hidden bg-current/10">
        <div className="h-full bg-[var(--eidos-accent)] transition-[width]" style={{ width: `${percentage}%` }} />
      </div>
    </div>
    <div role="list" aria-label={ui("内容填充状态")} className="eidos-creation-fill-sections">
      {sections.map(section => {
        const writing = section.fields.some(field => field === active), done = section.fields.every(field => filled.has(field));
        const state = writing ? '正在填充' : done ? '已填充' : '待填充';
        return <span key={section.id} role="listitem" aria-label={`${section.label}：${state}`} data-state={writing ? 'writing' : done ? 'filled' : 'pending'}>{(writing || !done) && <span aria-hidden="true">{writing ? '·' : '○'}</span>}{ui(section.label)}</span>;
      })}
    </div>
    {error && <p role="alert" className="text-xs text-[color:var(--eidos-accent)]">{error}</p>}
  </div>;
}

