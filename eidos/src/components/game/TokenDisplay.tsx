"use client";
import { useInterfaceText } from "@/components/shell/useInterfaceText";


import { useState, useEffect } from "react";
import { useGameStore } from "@/store/game-store";
import { _keiBusySince } from "@/lib/ai/kei-review";

interface TokenDisplayProps {
  showTokenDetail: boolean;
  onToggleToken: () => void;
  /** 加载计时器（秒），>0 时显示在 token 按钮左侧 */
  loadingElapsed?: number;
  /** 左侧额外的状态组件（如 MOMOI 启用按钮） */
  leftChildren?: React.ReactNode;
}

type DetailTab = "token" | "quality";

/**
 * Token 消耗追踪条（替代已删除的 HealthBar）
 *
 * 显示累计 token 用量和估算费用，点击展开详情。
 * 新增 KEI 质量 tab：显示审核纠正率等指标。
 */
export function TokenDisplay({ showTokenDetail, onToggleToken, loadingElapsed = 0, leftChildren }: TokenDisplayProps) {
  const ui = useInterfaceText();
  const tokensUsed = useGameStore((s) => s.tokensUsed);
  const estimatedCost = useGameStore((s) => s.estimatedCost);
  const tokenDetail = useGameStore((s) => s.tokenDetail);
  const protagonistState = useGameStore((s) => s.protagonistState);
  const keiQuality = useGameStore((s) => s.keiQuality);

  const [activeTab, setActiveTab] = useState<DetailTab>("token");

  // KEI 处理计时（AI 响应完成后 KEI 仍在后台整理时显示）
  const [keiElapsed, setKeiElapsed] = useState(0);
  useEffect(() => {
    const update = () => {
      if (loadingElapsed > 0 || !_keiBusySince) { setKeiElapsed(0); return; }
      setKeiElapsed(Math.floor((Date.now() - _keiBusySince) / 1000));
    };
    update();
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [loadingElapsed]);

  const totalOriginal =
    keiQuality.encyclopediaUpdatesOriginal +
    keiQuality.criticalFactsOriginal +
    keiQuality.questsOriginal;

  return (
    <div className="eidos-system-strip relative flex shrink-0 items-center gap-4 px-5 py-1.5 text-[10px]">
      {/* 主角状态（纯叙事，无数值） */}
      <span className="text-zinc-500">{ui("状态")}</span>
      <span className="text-zinc-300">{protagonistState.health}</span>
      <span className="text-zinc-700">·</span>
      <span className="text-zinc-400">{protagonistState.mood}</span>

      {protagonistState.notes && (
        <span className="text-zinc-600 truncate max-w-[180px] italic">{protagonistState.notes}</span>
      )}

      <span className="flex-1" />

      {/* 加载 / KEI 计时 — 绝对定位居中，不挤压右侧按钮 */}
      {loadingElapsed > 0 ? (
        <span className="absolute left-1/2 -translate-x-1/2 flex items-center gap-1.5 text-zinc-500 tabular-nums">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-zinc-500 animate-pulse" />
          {loadingElapsed < 60
            ? `${loadingElapsed}s`
            : `${Math.floor(loadingElapsed / 60)}m ${loadingElapsed % 60}s`}
        </span>
      ) : keiElapsed > 0 ? (
        <span className="absolute left-1/2 -translate-x-1/2 flex items-center gap-1.5 text-amber-500/70 tabular-nums text-[10px]">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
          {ui("KEI 整理中")}{keiElapsed}s
        </span>
      ) : null}

      {/* MOMOI 状态按钮 */}
      {leftChildren}

      {/* Token 用量 + 质量按钮 */}
      <span className="relative">
        <button
          onClick={onToggleToken}
          className="eidos-focus border border-white/12 px-2 py-0.5 text-[10px] text-white/52 transition-colors hover:border-white/30 hover:text-white"
          title={ui("Token 用量 / KEI 质量详情")}
        >
          {tokensUsed >= 1000 ? (tokensUsed / 1000).toFixed(1) + "k" : tokensUsed || "0"} token
          {estimatedCost > 0 && (
            <span className="text-zinc-600 ml-1">
              ¥{estimatedCost < 0.01 ? "<0.01" : estimatedCost.toFixed(2)}
            </span>
          )}
          {/* 质量指标摘要 */}
          {keiQuality.totalReviews > 0 && (
            <span className="text-zinc-600 ml-1">
              · {Math.round(keiQuality.correctionRate * 100)}{ui("%修正")}</span>
          )}
        </button>
        {showTokenDetail && (
          <div className="eidos-glass eidos-diagonal-cut absolute right-0 top-6 z-50 w-72 space-y-2 p-3 text-[10px] shadow-lg shadow-black/50">
            {/* Tab 切换 */}
            <div className="flex border-b border-zinc-800">
              <button
                onClick={() => setActiveTab("token")}
                className={`px-2 pb-1.5 cursor-pointer transition-colors ${
                  activeTab === "token"
                    ? "text-zinc-300 border-b border-zinc-400"
                    : "text-zinc-600 hover:text-zinc-400"
                }`}
              >
                {ui("Token 消耗")}</button>
              <button
                onClick={() => setActiveTab("quality")}
                className={`px-2 pb-1.5 cursor-pointer transition-colors ${
                  activeTab === "quality"
                    ? "text-zinc-300 border-b border-zinc-400"
                    : "text-zinc-600 hover:text-zinc-400"
                }`}
              >
                {ui("KEI 质量")}</button>
            </div>

            {/* Token Tab */}
            {activeTab === "token" && (
              <>
                <div className="text-zinc-400 font-medium border-b border-zinc-800 pb-1.5">{ui("Token 用量详情")}</div>
                <div className="space-y-1">
                  <div className="flex justify-between text-zinc-500">
                    <span>ALICE (Flash)</span>
                    <span>{ui("输入")}{(tokenDetail.alicePrompt / 1000).toFixed(1)}{ui("k · 输出")}{(tokenDetail.aliceCompletion / 1000).toFixed(1)}k</span>
                  </div>
                  <div className="flex justify-between text-zinc-500">
                    <span>KEI (Pro)</span>
                    <span>{ui("输入")}{(tokenDetail.keiPrompt / 1000).toFixed(1)}{ui("k · 输出")}{(tokenDetail.keiCompletion / 1000).toFixed(1)}k</span>
                  </div>
                  <div className="flex justify-between text-zinc-500">
                    <span>UZQ (Personality)</span>
                    <span>{ui("输入")}{(tokenDetail.uzqPrompt / 1000).toFixed(1)}{ui("k · 输出")}{(tokenDetail.uzqCompletion / 1000).toFixed(1)}k</span>
                  </div>
                </div>
                <div className="text-zinc-400 border-t border-zinc-800 pt-1.5 flex justify-between">
                  <span>{ui("总计")}</span>
                  <span>{(tokensUsed / 1000).toFixed(1)}k token · ¥{estimatedCost.toFixed(4)}</span>
                </div>
              </>
            )}

            {/* Quality Tab */}
            {activeTab === "quality" && (
              <>
                <div className="text-zinc-400 font-medium border-b border-zinc-800 pb-1.5">{ui("KEI 审核质量")}</div>
                {keiQuality.totalReviews === 0 ? (
                  <div className="text-zinc-600 italic py-2">{ui("暂无审核数据。KEI 审核会在游戏过程中自动触发。")}</div>
                ) : (
                  <div className="space-y-1.5">
                    <div className="flex justify-between text-zinc-500">
                      <span>{ui("审核次数")}</span>
                      <span>
                        {keiQuality.totalReviews}
                        <span className="text-zinc-600 ml-1">
                          ({keiQuality.approvedReviews} {ui("直接通过)")}</span>
                      </span>
                    </div>
                    <div className="flex justify-between text-zinc-500">
                      <span>{ui("百科修正率")}</span>
                      <span>
                        {keiQuality.encyclopediaUpdatesOriginal > 0
                          ? `${keiQuality.encyclopediaUpdatesChanged}/${keiQuality.encyclopediaUpdatesOriginal}`
                          : "—"}
                      </span>
                    </div>
                    <div className="flex justify-between text-zinc-500">
                      <span>{ui("关键信息")}</span>
                      <span>
                        {keiQuality.criticalFactsOriginal > 0
                          ? `${keiQuality.criticalFactsCorrected}/${keiQuality.criticalFactsOriginal}`
                          : "—"}
                      </span>
                    </div>
                    <div className="flex justify-between text-zinc-500">
                      <span>{ui("任务审核")}</span>
                      <span>
                        {keiQuality.questsOriginal > 0
                          ? `${keiQuality.questsCorrected}/${keiQuality.questsOriginal}`
                          : "—"}
                      </span>
                    </div>
                    <div className="text-zinc-400 border-t border-zinc-800 pt-1.5 flex justify-between">
                      <span>{ui("总修正率")}</span>
                      <span className={keiQuality.correctionRate > 0.3 ? "text-amber-400" : "text-emerald-400"}>
                        {Math.round(keiQuality.correctionRate * 100)}%
                        <span className="text-zinc-600 ml-1">({totalOriginal} {ui("条目)")}</span>
                      </span>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </span>
    </div>
  );
}
