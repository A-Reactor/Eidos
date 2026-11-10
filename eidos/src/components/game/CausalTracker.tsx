"use client";
import { useInterfaceText } from "@/components/shell/useInterfaceText";


import { useState, useMemo } from "react";
import { useGameStore } from "@/store/game-store";
import type { CausalProjection, RippleEffect } from "@/lib/game/types";

/** 按状态分组的排序权重 */
const STATUS_ORDER: Record<RippleEffect["status"], number> = {
  pending: 0,
  fulfilled: 1,
  defied: 2,
  expired: 3,
};

const STATUS_LABEL: Record<RippleEffect["status"], string> = {
  pending: "待验证",
  fulfilled: "已实现",
  defied: "已打破",
  expired: "已过期",
};

const STATUS_COLOR: Record<RippleEffect["status"], string> = {
  pending: "text-amber-400 border-amber-500/30 bg-amber-950/10",
  fulfilled: "text-emerald-400 border-emerald-500/30 bg-emerald-950/10",
  defied: "text-zinc-500 border-zinc-600/30 bg-zinc-900/20 line-through",
  expired: "text-red-400/70 border-red-500/20 bg-red-950/5",
};

const STATUS_DOT: Record<RippleEffect["status"], string> = {
  pending: "bg-amber-400",
  fulfilled: "bg-emerald-400",
  defied: "bg-zinc-500",
  expired: "bg-red-400/60",
};

/**
 * 因果追踪面板 — 显示所有因果预测的生命周期。
 * 嵌入在 IntelWall（情报墙）中使用。
 */
export function CausalTracker() {
  const ui = useInterfaceText();
  const causalProjections = useGameStore((s) => s.causalProjections);
  const getCausalStats = useGameStore((s) => s.getCausalStats);
  const gameTime = useGameStore((s) => s.gameTime);

  const stats = useMemo(() => {
    try { return getCausalStats(); } catch { return null; }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [causalProjections]);

  // 展开/收起的 ripple ID
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // 扁平化所有 ripple，按状态 + 剩余时间排序
  const allRipples = useMemo(() => {
    const ripples: Array<{ projection: CausalProjection; ripple: RippleEffect }> = [];
    for (const cp of causalProjections) {
      for (const r of cp.rippleEffects) {
        ripples.push({ projection: cp, ripple: r });
      }
    }
    // pending 优先，然后按状态权重排序，同状态按 estimatedTime 升序
    ripples.sort((a, b) => {
      const orderDiff = STATUS_ORDER[a.ripple.status] - STATUS_ORDER[b.ripple.status];
      if (orderDiff !== 0) return orderDiff;
      // pending 按预计时间升序（最近的在前）
      if (a.ripple.status === "pending" && b.ripple.status === "pending") {
        const aMins = a.ripple.estimatedTime.day * 24 * 60 + a.ripple.estimatedTime.hour * 60;
        const bMins = b.ripple.estimatedTime.day * 24 * 60 + b.ripple.estimatedTime.hour * 60;
        return aMins - bMins;
      }
      // 其余按置信度降序
      return b.ripple.confidence - a.ripple.confidence;
    });
    return ripples;
  }, [causalProjections]);

  if (!stats || stats.totalPredictions === 0) {
    return (
      <section>
        <h3 className="text-sm text-zinc-400 font-medium border-b border-zinc-800 pb-2 mb-3">
          {ui("因果涟漪")}</h3>
        <p className="text-xs text-zinc-600 italic">
          {ui("暂无因果预测。随着故事推进，KEI 会推演玩家行动的连锁反应。")}</p>
      </section>
    );
  }

  const currentMins = gameTime.day * 24 * 60 + gameTime.hour * 60;

  return (
    <section>
      {/* 标题 + 统计摘要 */}
      <div className="flex items-center justify-between border-b border-zinc-800 pb-2 mb-3">
        <h3 className="text-sm text-zinc-400 font-medium">{ui("因果涟漪")}</h3>
        <div className="flex items-center gap-3 text-[10px] tabular-nums">
          <span className="text-amber-400">{stats.pending} {ui("待验证")}</span>
          <span className="text-emerald-400">{stats.fulfilled} {ui("已实现")}</span>
          <span className="text-zinc-500">{stats.defied} {ui("打破")}</span>
          <span className="text-red-400/70">{stats.expired} {ui("过期")}</span>
          {stats.totalPredictions > 0 && (
            <span className="text-zinc-600">
              {ui("· 均置信度")}{Math.round(stats.avgConfidence * 100)}%
            </span>
          )}
        </div>
      </div>

      {/* 预测列表 */}
      <div className="space-y-1.5 max-h-[400px] overflow-y-auto">
        {allRipples.map(({ projection, ripple }) => {
          const isExpanded = expandedId === ripple.id;
          const remainingMins =
            ripple.estimatedTime.day * 24 * 60 + ripple.estimatedTime.hour * 60 - currentMins;
          const remainingText =
            ripple.status !== "pending"
              ? ""
              : remainingMins < 0
                ? ui("已过期")
                : remainingMins < 60
                  ? ui("{0}分钟后", {"0": remainingMins})
                  : remainingMins < 24 * 60
                    ? ui("{0}小时后", {"0": Math.floor(remainingMins / 60)})
                    : ui("{0}天后", {"0": Math.floor(remainingMins / (24 * 60))});

          return (
            <div
              key={ripple.id}
              className={`border rounded px-3 py-2 cursor-pointer transition-colors ${STATUS_COLOR[ripple.status]}`}
              onClick={() => setExpandedId(isExpanded ? null : ripple.id)}
            >
              {/* 摘要行 */}
              <div className="flex items-start gap-2">
                <span
                  className={`inline-block w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 ${STATUS_DOT[ripple.status]}`}
                />
                <div className="flex-1 min-w-0">
                  <p className="text-xs leading-relaxed line-clamp-2">
                    {ripple.projectedOutcome}
                  </p>
                  <div className="flex items-center gap-2 mt-1 text-[10px] opacity-60">
                    <span>{STATUS_LABEL[ripple.status]}</span>
                    {ripple.status === "pending" && remainingText && (
                      <>
                        <span>·</span>
                        <span>{remainingText}</span>
                      </>
                    )}
                    <span>·</span>
                    <span>
                      {ui("第")}{ripple.estimatedTime.day}{ui("天")}{ripple.estimatedTime.hour}{ui("时")}</span>
                    <span>·</span>
                    <span>{Math.round(ripple.confidence * 100)}%</span>
                  </div>
                </div>
              </div>

              {/* 展开详情 */}
              {isExpanded && (
                <div className="mt-2 pt-2 border-t border-zinc-700/30 text-[10px] space-y-1">
                  <div className="flex gap-2">
                    <span className="text-zinc-500 shrink-0">{ui("触发行动:")}</span>
                    <span className="text-zinc-400">{ripple.triggerAction}</span>
                  </div>
                  {ripple.involvedNpcs.length > 0 && (
                    <div className="flex gap-2">
                      <span className="text-zinc-500 shrink-0">{ui("涉及 NPC:")}</span>
                      <span className="text-zinc-400">{ripple.involvedNpcs.join(", ")}</span>
                    </div>
                  )}
                  {ripple.involvedScenes.length > 0 && (
                    <div className="flex gap-2">
                      <span className="text-zinc-500 shrink-0">{ui("涉及场景:")}</span>
                      <span className="text-zinc-400">{ripple.involvedScenes.join(", ")}</span>
                    </div>
                  )}
                  {ripple.resolutionNote && (
                    <div className="flex gap-2">
                      <span className="text-zinc-500 shrink-0">{ui("验证说明:")}</span>
                      <span className="text-zinc-400">{ripple.resolutionNote}</span>
                    </div>
                  )}
                  <div className="flex gap-2">
                    <span className="text-zinc-500 shrink-0">{ui("生成于:")}</span>
                    <span className="text-zinc-500">
                      {ui("第")}{projection.generatedAt.day}{ui("天")}{projection.generatedAt.hour}{ui("时")}</span>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
