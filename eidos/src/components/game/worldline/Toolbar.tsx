"use client";
import { useInterfaceText } from "@/components/shell/useInterfaceText";


// ============================================================
// Toolbar — 世界线浏览器顶部工具栏
// ============================================================

interface ToolbarProps {
  playerName: string;
  totalSteps: number;
  branchCount: number;
  onBack: () => void;
}

export function Toolbar({
  playerName,
  totalSteps,
  branchCount,
  onBack,
}: ToolbarProps) {
  const ui = useInterfaceText();
  return (
    <header className="eidos-worldline-rail eidos-worldline-toolbar">
      <div>
        <h2>{ui("世界线")}</h2>
        <p className="eidos-worldline-meta">
          <span>{playerName}</span><span>{totalSteps} {ui("步记录")}</span><span>{branchCount} {ui("条分歧")}</span>
        </p>
      </div>
      <div className="eidos-worldline-toolbar-end">
        <div className="eidos-worldline-help">
          <p>{ui("拖拽移动 · 点击日期展开 · Ctrl / ⌘ + 滚轮缩放")}</p>
          <div className="eidos-worldline-legend"><span><i data-mark="selected" aria-hidden="true" />{ui("选中")}</span><span><i data-mark="current" aria-hidden="true" />{ui("当前进度")}</span></div>
        </div>
        <button
          onClick={onBack}
          className="eidos-focus eidos-archive-button"
        >
          {ui("返回游戏")}</button>
      </div>
    </header>
  );
}
