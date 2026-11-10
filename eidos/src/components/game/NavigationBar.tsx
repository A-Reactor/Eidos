"use client";
import { useInterfaceText } from "@/components/shell/useInterfaceText";


import { useGameStore } from "@/store/game-store";

interface NavigationBarProps {
  autoAdvanceOn: boolean;
  streamMode: boolean;
  autoSpeed: number;
  generationBias: number;
  onToggleAuto: () => void;
  onToggleStream: () => void;
  onSpeedChange: (v: number) => void;
  onBiasChange: (v: number) => void;
}

export function NavigationBar({ autoAdvanceOn, streamMode, autoSpeed, generationBias, onToggleAuto, onToggleStream, onSpeedChange, onBiasChange }: NavigationBarProps) {
  const ui = useInterfaceText();
  const inventory = useGameStore((s) => s.inventory);
  const clues = useGameStore((s) => s.clues);
  const criticalFacts = useGameStore((s) => s.criticalFacts);
  const encyclopedia = useGameStore((s) => s.encyclopedia);
  const setPhase = useGameStore((s) => s.setPhase);
  const autoSave = useGameStore((s) => s.autoSave);
  const currentWorld = useGameStore((s) => s.currentWorld);
  const setGalleryWorld = useGameStore((s) => s.setGalleryWorld);

  const discoveredCount = clues.filter((c) => c.discovered).length;
  const encyclopediaCount = encyclopedia.filter((entry) => entry.type !== "npc").length;

  const navigateTo = (phase: "inventory" | "world_line_view" | "encyclopedia" | "settings" | "intel_wall" | "diary" | "gallery") => {
    autoSave().catch(() => {});
    setPhase(phase);
  };

  return (
    <div className="eidos-system-strip flex shrink-0 items-center justify-center gap-5 border-t border-white/10 px-5 py-1.5">
      <NavButton label={ui("背包")} hint="I" count={inventory.length} onClick={() => navigateTo("inventory")} />
      <NavButton label={ui("情报")} hint="J" count={discoveredCount + criticalFacts.length} total={clues.length} onClick={() => navigateTo("intel_wall")} />
      <NavButton label={ui("百科")} hint="E" count={encyclopediaCount} onClick={() => navigateTo("encyclopedia")} />
      <span className="text-zinc-800">│</span>
      <button onClick={() => navigateTo("world_line_view")} className="text-[11px] text-zinc-400 hover:text-zinc-200 transition-colors cursor-pointer">{ui("世界线")}</button>

      <button onClick={() => { if (currentWorld) { setGalleryWorld(currentWorld); autoSave(); setPhase("gallery"); } }} className="text-[11px] text-zinc-500 hover:text-zinc-300 transition-colors cursor-pointer">{ui("图像管理")}</button>
      <button onClick={() => navigateTo("settings")} className="text-[11px] text-zinc-500 hover:text-zinc-300 transition-colors cursor-pointer">{ui("设置")}</button>
      <span className="text-zinc-800">│</span>
      <button
        onClick={onToggleStream}
        title={ui("流式响应：逐字实时显示 AI 输出")}
        className={`eidos-focus border px-2 py-0.5 text-[10px] transition-colors cursor-pointer ${
          streamMode ? "text-white border-[color:var(--eidos-accent)]/50 bg-[color:var(--eidos-accent)]/16" : "text-zinc-500 border-white/10 hover:border-white/25"
        }`}
      >
        {ui("流式")}</button>
      <button
        onClick={onToggleAuto}
        title={ui("自动翻页：段落播完后自动推进")}
        className={`eidos-focus border px-2 py-0.5 text-[10px] transition-colors cursor-pointer ${
          autoAdvanceOn ? "text-white border-[color:var(--eidos-accent)]/50 bg-[color:var(--eidos-accent)]/16" : "text-zinc-500 border-white/10 hover:border-white/25"
        }`}
      >
        {ui("自动")}</button>
      {autoAdvanceOn && (
        <select
          value={autoSpeed}
          onChange={(e) => onSpeedChange(Number(e.target.value))}
          className="eidos-focus border border-white/12 bg-black/30 px-1 py-0.5 text-[10px] text-zinc-400 outline-none cursor-pointer hover:border-white/25"
        >
          <option value={500}>0.5s</option>
          <option value={1000}>1s</option>
          <option value={2000}>2s</option>
          <option value={3000}>3s</option>
          <option value={5000}>5s</option>
        </select>
      )}
      <span className="text-zinc-800">│</span>
      <span className="text-[10px] text-zinc-500 select-none">
        {ui("细节")}<input
          type="range" min={0} max={100} value={generationBias}
          onChange={(e) => onBiasChange(Number(e.target.value))}
          className="mx-1 h-3 w-16 cursor-pointer appearance-none rounded-full bg-zinc-800 align-middle accent-[color:var(--eidos-accent)] [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[color:var(--eidos-accent)]"
          title={ui("生成方向：{0}", {"0": generationBias < 35 ? ui("细节展示") : generationBias > 65 ? ui("任务推进") : ui("均衡")})}
        />{ui("推进")}</span>
      <span className="text-zinc-800">│</span>
      <button onClick={() => { autoSave(); setPhase("title"); }} className="text-[11px] text-zinc-500 hover:text-red-400 transition-colors cursor-pointer">{ui("退出")}</button>
    </div>
  );
}

function NavButton({ label, hint, count, total, onClick }: { label: string; hint: string; count: number; total?: number; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      title={`${label} (${hint})`}
      className="eidos-focus group flex items-center gap-1 text-[11px] text-zinc-400 transition-colors hover:text-zinc-100"
    >
      <span>{label}</span>
      <span className={`tabular-nums ${count > 0 ? "text-zinc-500" : "text-zinc-700"}`}>
        {total !== undefined ? `${count}/${total}` : count}
      </span>
      <span className="text-[9px] text-zinc-700 opacity-0 group-hover:opacity-100 transition-opacity">{hint}</span>
    </button>
  );
}
