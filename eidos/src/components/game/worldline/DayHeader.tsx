"use client";
import { useInterfaceText } from "@/components/shell/useInterfaceText";


// ============================================================
// DayHeader — 天页眉
// 文字 + 底部长单线，点击展开/收起
// ============================================================

const DAY_DIGITS = [
  "零", "一", "二", "三", "四", "五", "六", "七", "八", "九", "十",
];

interface DayHeaderProps {
  day: number;
  nodeCount: number;
  isExpanded: boolean;
  isCurrent: boolean;
  minStep: number;
  maxStep: number;
  onClick: () => void;
}

export function DayHeader({
  day,
  nodeCount,
  isExpanded,
  isCurrent,
  minStep,
  maxStep,
  onClick,
}: DayHeaderProps) {
  const ui = useInterfaceText();
  const dayLabel = DAY_DIGITS[day] ?? String(day);

  return (
    <button
      onClick={onClick}
      className="w-full cursor-pointer group py-2"
    >
      {/* 文字行 */}
      <div className="flex items-center gap-2 px-1">
        {/* 展开指示器 */}
        <span
          className={`text-[10px] transition-transform duration-200 shrink-0 ${
            isExpanded ? "rotate-90" : ""
          } ${isCurrent ? "text-amber-400" : "text-zinc-600 group-hover:text-zinc-400"}`}
        >
          ▸
        </span>

        {/* 天标签 */}
        <span
          className={`text-sm font-medium tracking-[0.15em] ${
            isCurrent ? "text-amber-300" : "text-zinc-300 group-hover:text-zinc-200"
          }`}
        >
          {ui("第")}{dayLabel}{ui("天")}</span>

        {/* 步骤范围 */}
        <span className="text-[10px] tabular-nums text-zinc-600 group-hover:text-zinc-500">
          {minStep === maxStep ? ui("步{0}", {"0": minStep}) : ui("步{0}–{1}", {"0": minStep, "1": maxStep})}
        </span>

        {/* 节点计数 */}
        <span className="text-[9px] text-zinc-700 group-hover:text-zinc-600 ml-auto">
          {nodeCount} {ui("节点")}</span>

        {/* 当前标记 */}
        {isCurrent && (
          <span className="text-[8px] text-amber-400/60 border border-amber-500/20 px-1 shrink-0">
            {ui("当前")}</span>
        )}
      </div>

      {/* 底部长线 */}
      <div
        className={`mt-1.5 border-t transition-colors ${
          isCurrent
            ? "border-amber-500/30"
            : "border-zinc-800 group-hover:border-zinc-700"
        }`}
      />
    </button>
  );
}
