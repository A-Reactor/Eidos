"use client";
import { useInterfaceText } from "@/components/shell/useInterfaceText";


// ============================================================
// Eidos · 区域过渡画面
// ============================================================
// 玩家跨区域移动时展示：
//   1. 地区高空俯视图（从 visualConfig.regionOverviews 获取）
//   2. 区域名称 + 描述
//   3. 点击继续或自动过渡 → 进入具体场景
// ============================================================

import { useState, useEffect, useCallback } from "react";
import { useGameStore } from "@/store/game-store";

interface Props {
  regionName: string;
  regionDescription: string;
  onContinue: () => void;
}

export function RegionTransition({ regionName, regionDescription, onContinue }: Props) {
  const ui = useInterfaceText();
  const currentWorld = useGameStore((s) => s.currentWorld);
  const [overviewUrl, setOverviewUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showSceneInfo, setShowSceneInfo] = useState(false);

  // 加载已有区域俯视图
  useEffect(() => {
    const config = currentWorld?.visualConfig;
    const overview = config?.regionOverviews?.[regionName];
    if (!overview) { setLoading(false); return; }

    // 先检查缓存
    const cacheKey = `/generated/${currentWorld!.id}/regions/${encodeURIComponent(regionName)}.png`;

    // 尝试从缓存加载
    const img = new Image();
    img.onload = () => {
      setOverviewUrl(cacheKey);
      setLoading(false);
    };
    img.onerror = () => {
      setLoading(false);
    };
    img.src = cacheKey;
  }, [regionName, currentWorld?.id]);

  // 1.5 秒后自动显示场景信息
  useEffect(() => {
    const timer = setTimeout(() => setShowSceneInfo(true), 1500);
    return () => clearTimeout(timer);
  }, []);

  // 键盘/点击继续
  const handleContinue = useCallback(() => {
    onContinue();
  }, [onContinue]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        handleContinue();
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [handleContinue]);

  return (
    <div
      className="fixed inset-0 z-30 bg-zinc-950 flex flex-col items-center justify-center cursor-pointer"
      onClick={handleContinue}
    >
      {/* 俯视图 */}
      <div className="relative w-full max-w-[960px] aspect-video mb-6 overflow-hidden bg-zinc-900">
        {loading ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-8 h-8 border-2 border-zinc-700 border-t-amber-400/60 rounded-full animate-spin" />
          </div>
        ) : overviewUrl ? (
          <img
            src={overviewUrl}
            alt={regionName}
            className="w-full h-full object-cover animate-in fade-in duration-1000"
            style={{ imageRendering: "pixelated" }}
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-zinc-700 text-sm">
            {regionName} {ui("· 高空俯视")}</div>
        )}

        {/* 暗角 */}
        <div className="absolute inset-0 bg-gradient-to-t from-zinc-950 via-transparent to-transparent" />
      </div>

      {/* 区域名称 */}
      <h2 className="text-2xl font-light text-zinc-200 tracking-[0.1em] mb-3 animate-in fade-in slide-in-from-bottom-4 duration-700">
        {regionName}
      </h2>

      {/* 区域描述（延迟显示） */}
      <div
        className={`max-w-md text-center text-sm text-zinc-500 leading-relaxed transition-all duration-700 ${
          showSceneInfo ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"
        }`}
      >
        {regionDescription.slice(0, 200)}
      </div>

      {/* 继续提示 */}
      <div
        className={`mt-8 text-xs text-zinc-600 animate-pulse transition-all duration-700 ${
          showSceneInfo ? "opacity-100" : "opacity-0"
        }`}
      >
        {ui("点击或按空格键继续")}</div>
    </div>
  );
}
