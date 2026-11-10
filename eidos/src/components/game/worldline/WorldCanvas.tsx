"use client";
import { useInterfaceText } from "@/components/shell/useInterfaceText";


// ============================================================
// WorldCanvas — 可拖拽滚动画布
// 天数由上至下排列，所有节点按 depth 对齐到同一行。
// DayColumn 内部处理左/主/右三列布局，无需外部拆分 track。
// ============================================================

import { useRef, useState, useCallback } from "react";
import type { WorldLineLayout } from "@/lib/game/worldline-layout";
import type { WorldLineNode } from "@/lib/game/types";
import { DayColumn } from "./DayColumn";
import { LAYOUT } from "@/lib/game/worldline-layout";

interface WorldCanvasProps {
  layout: WorldLineLayout;
  allNodes: Record<string, WorldLineNode>;
  currentNodeId: string;
  selectedNodeId: string | null;
  onToggleExpand: (day: number) => void;
  onSelectNode: (nodeId: string) => void;
}

export function WorldCanvas({
  layout,
  allNodes,
  currentNodeId,
  selectedNodeId,
  onToggleExpand,
  onSelectNode,
}: WorldCanvasProps) {
  const ui = useInterfaceText();
  const canvasRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0, scrollX: 0, scrollY: 0 });

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest("button")) return;
      const el = canvasRef.current;
      if (!el) return;
      setIsDragging(true);
      dragStart.current = {
        x: e.clientX,
        y: e.clientY,
        scrollX: el.scrollLeft,
        scrollY: el.scrollTop,
      };
    },
    []
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!isDragging) return;
      const el = canvasRef.current;
      if (!el) return;
      el.scrollLeft =
        dragStart.current.scrollX - (e.clientX - dragStart.current.x);
      el.scrollTop =
        dragStart.current.scrollY - (e.clientY - dragStart.current.y);
    },
    [isDragging]
  );

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  const { nodes, dayColumns } = layout;

  // 空状态
  if (nodes.length === 0 && dayColumns.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center bg-zinc-950">
        <p className="text-zinc-500 text-sm">{ui("还没有世界线数据")}</p>
      </div>
    );
  }

  // 合并同一天的所有 track 节点到一个 DayColumnLayout
  // DayColumn 内部会按 depth 对齐所有 track
  const mergedColumns = dayColumns;

  return (
    <div
      ref={canvasRef}
      className={`flex-1 overflow-auto world-canvas-scroll ${
        isDragging ? "cursor-grabbing select-none" : "cursor-grab"
      }`}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    >
      {/* 画布内容：居中，单列垂直流 */}
      <div
        className="flex flex-col items-center min-h-full"
        style={{
          padding: LAYOUT.CANVAS_PADDING,
          minWidth: 640,
        }}
      >
        <div className="flex flex-col" style={{ minWidth: 600, maxWidth: 700, width: "100%" }}>
          {mergedColumns.map((col) => (
            <DayColumn
              key={col.day}
              column={col}
              allNodes={allNodes}
              currentNodeId={currentNodeId}
              selectedNodeId={selectedNodeId}
              onToggleExpand={onToggleExpand}
              onSelectNode={onSelectNode}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
