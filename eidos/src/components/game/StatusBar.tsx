"use client";
import { useInterfaceText } from "@/components/shell/useInterfaceText";


import { useGameStore } from "@/store/game-store";
import { gameTimeToCalendar, formatCalendar, timeOfDay } from "@/lib/game/calendar";

const weatherLabels: Record<string, string> = {
  "晴": "晴", "多云": "多云", "阴": "阴", "雨": "雨", "雾": "雾", "风": "风", "雪": "雪",
};

interface StatusBarProps {
  showQuests: boolean;
  onToggleQuests: () => void;
  onToggleMap: () => void;
}

type RegionWithScenes = {
  scenes?: Record<string, { name?: string }>;
};

export function StatusBar({ showQuests, onToggleQuests, onToggleMap }: StatusBarProps) {
  const ui = useInterfaceText();
  const gameTime = useGameStore((s) => s.gameTime);
  const currentScene = useGameStore((s) => s.currentScene);
  const currentSceneId = useGameStore((s) => s.currentSceneId);
  const currentWorld = useGameStore((s) => s.currentWorld);
  const encyclopedia = useGameStore((s) => s.encyclopedia);
  const weather = useGameStore((s) => s.weather);
  const statusEffects = useGameStore((s) => s.protagonistState.statusEffects);

  return (
    <div className="eidos-nativebar flex shrink-0 items-center justify-between px-5 py-2">
      <div className="flex items-center gap-3 font-mono text-[10px] uppercase tracking-[0.14em] text-white/62">
        <span className="font-sans text-xs normal-case tracking-normal text-white tabular-nums">
          {formatCalendar(gameTimeToCalendar(gameTime))} · {timeOfDay(gameTime.hour)} {String(gameTime.hour).padStart(2, "0")}:{String(gameTime.minute).padStart(2, "0")}
        </span>
        <span className="text-xs" title={weather}>
          {weatherLabels[weather] || weather}
        </span>
        {/* 场景名 — 点击打开地图 */}
        <button
          onClick={onToggleMap}
          className="eidos-focus max-w-[240px] truncate border-l-2 border-[color:var(--eidos-accent)] pl-2 text-left text-white/68 transition-colors hover:text-white"
          title={ui("点击打开地图 (M)")}
        >
          {(() => {
            if (currentScene?.name) {
              return currentScene.region && currentScene.region !== currentScene.name
                ? `${currentWorld?.regions[currentScene.region]?.name ?? currentScene.region} · ${currentScene.name}`
                : currentScene.name;
            }
            // currentScene 为空 → 从世界数据或百科查找
            if (currentSceneId && currentWorld) {
              for (const region of Object.values(currentWorld.regions)) {
                const sc = (region as RegionWithScenes).scenes?.[currentSceneId];
                if (sc?.name) return sc.name;
              }
            }
            const enc = encyclopedia.find(e => e.id === currentSceneId && e.type === "location");
            if (enc?.name) return enc.name;
            return currentSceneId || "未知地点";
          })()}
        </button>
        {statusEffects.length > 0 && (
          <>
            <span className="text-zinc-700">·</span>
            {statusEffects.map((eff) => (
              <span
                key={eff.name}
                title={eff.source ? `${eff.source}` : eff.name}
                className={`text-[10px] px-1.5 py-0.5 border ${
                  eff.intensity === "severe" ? "text-red-400/80 border-red-500/25" :
                  eff.intensity === "moderate" ? "text-amber-400/80 border-amber-500/25" :
                  "text-zinc-400/70 border-zinc-600/30"
                }`}
              >
                {eff.name}
              </span>
            ))}
          </>
        )}
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={onToggleQuests}
          title={ui("任务 (Q)")}
          className={`text-[10px] px-2 py-1 border transition-colors cursor-pointer ${
            showQuests ? "text-white border-[color:var(--eidos-accent)]/50 bg-[color:var(--eidos-accent)]/18" : "text-white/56 border-white/14 hover:border-white/30 hover:text-white"
          }`}
        >
          {ui("任务")}<span className="text-zinc-700 ml-0.5">Q</span>
        </button>
      </div>
    </div>
  );
}
