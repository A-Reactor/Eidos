"use client";
import { useInterfaceText } from "@/components/shell/useInterfaceText";

import { plainDocumentText } from '@/lib/game/documents/inline-links';

// ============================================================
// StepNode — 单个步骤节点按钮
// 显示绝对步数 + 摘要，点击选中后 InspectorPanel 展示详情
// ============================================================

import type { LayoutNode } from "@/lib/game/worldline-layout";

interface StepNodeProps {
  layoutNode: LayoutNode;
  summary: string;
  playerInput: string;
  isCurrent: boolean;
  isSelected: boolean;
  hasBranch: boolean;
  isMainTrack: boolean;
  onClick: () => void;
}

export function StepNode({
  layoutNode,
  summary,
  playerInput,
  isCurrent,
  isSelected,
  hasBranch,
  isMainTrack,
  onClick,
}: StepNodeProps) {
  const ui = useInterfaceText();
  // 边框颜色优先级：选中 > 当前 > 分支 > 默认
  const borderColor = isSelected
    ? "border-blue-400/50 bg-blue-950/15"
    : isCurrent
    ? "border-amber-500/50 bg-amber-950/20"
    : hasBranch && isMainTrack
    ? "border-amber-600/30 bg-amber-950/10"
    : "border-zinc-700 bg-zinc-900/50 hover:border-zinc-600";

  const dotColor = isCurrent
    ? "bg-amber-400"
    : isSelected
    ? "bg-blue-400"
    : hasBranch
    ? "bg-amber-600/60"
    : "bg-zinc-600";

  const stepLabel = ui("第{0}步", {"0": layoutNode.depth});

  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 px-2 py-1 border transition-colors cursor-pointer w-full text-left ${borderColor}`}
    >
      {/* 节点圆点 */}
      <span
        className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 ${dotColor}`}
      />

      {/* 步号 */}
      <span
        className={`text-[10px] tabular-nums shrink-0 w-10 ${
          isCurrent
            ? "text-amber-400/80"
            : isSelected
            ? "text-blue-400/80"
            : "text-zinc-500"
        }`}
      >
        {stepLabel}
      </span>

      {/* 摘要 */}
      <span className="text-[10px] text-zinc-500 truncate flex-1">
        {plainDocumentText(playerInput ?? '').slice(0, 40) || ui("故事开始")}
      </span>

      {/* 标记 */}
      <span className="flex items-center gap-0.5 shrink-0">
        {isCurrent && (
          <span className="text-[7px] text-amber-400/50 border border-amber-500/20 px-0.5">
            {ui("当前")}</span>
        )}
        {hasBranch && (
          <span className="text-[9px] text-amber-500/40" title={ui("有分支")}>
            ⑃
          </span>
        )}
      </span>
    </button>
  );
}
