"use client";

// ============================================================
// SvgLines — SVG 连线层
// 覆盖在节点层上方，绘制主线（垂直）和分支（弯折）连线
// ============================================================

import { useMemo } from "react";
import type { LayoutEdge } from "@/lib/game/worldline-layout";
import { LAYOUT } from "@/lib/game/worldline-layout";

interface SvgLinesProps {
  edges: LayoutEdge[];
  bounds: { width: number; height: number; minX: number; minY: number };
  currentNodeId: string;
  selectedNodeId: string | null;
}

/**
 * 生成 SVG path 的 d 属性。
 * 主线：垂直直线。
 * 分支：三次贝塞尔曲线（水平弯折）。
 */
function computePathD(edge: LayoutEdge): string {
  const { fromX, fromY, toX, toY, type } = edge;

  if (type === "main") {
    // 垂直直线：父节点底部中心 → 子节点顶部中心
    return `M ${fromX} ${fromY} L ${toX} ${toY}`;
  }

  // 分支连线：水平弯折贝塞尔曲线
  const midY = (fromY + toY) / 2;
  return [
    `M ${fromX} ${fromY}`,
    `C ${fromX} ${midY}, ${toX} ${midY}, ${toX} ${toY}`,
  ].join(" ");
}

export function SvgLines({
  edges,
  bounds,
  currentNodeId,
  selectedNodeId,
}: SvgLinesProps) {
  // 平移坐标使画布居中
  const offsetX = -bounds.minX + LAYOUT.CANVAS_PADDING;

  // 按类型和状态分类连线
  const styledEdges = useMemo(() => {
    return edges.map((edge) => {
      let className: string;
      const isCurrent =
        edge.from === currentNodeId || edge.to === currentNodeId;
      const isSelected =
        selectedNodeId &&
        (edge.from === selectedNodeId || edge.to === selectedNodeId);

      if (isSelected) {
        className = "stroke-blue-400/50";
      } else if (isCurrent) {
        className = "stroke-amber-500/40";
      } else if (edge.type === "branch") {
        className = "stroke-zinc-600";
      } else {
        className = "stroke-zinc-700";
      }

      return { ...edge, className };
    });
  }, [edges, currentNodeId, selectedNodeId]);

  if (edges.length === 0) return null;

  return (
    <svg
      className="absolute inset-0 pointer-events-none"
      style={{
        width: bounds.width + LAYOUT.CANVAS_PADDING * 2,
        height: bounds.height + LAYOUT.CANVAS_PADDING,
        minWidth: "100%",
        minHeight: "100%",
      }}
    >
      <g transform={`translate(${offsetX}, 0)`}>
        {styledEdges.map((edge) => (
          <path
            key={`${edge.from}-${edge.to}`}
            d={computePathD(edge)}
            className={edge.className}
            fill="none"
            strokeWidth={1}
            strokeDasharray={edge.type === "branch" ? "3 3" : undefined}
          />
        ))}
      </g>
    </svg>
  );
}
