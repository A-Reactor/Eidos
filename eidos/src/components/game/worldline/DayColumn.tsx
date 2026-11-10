"use client";
import { useInterfaceText } from "@/components/shell/useInterfaceText";


// ============================================================
// DayColumn — 单天列（按深度对齐）
// 展开时：所有 track（主线 + 左分支 + 右分支）按 depth 对齐到同一行。
// 例如 depth=17 的主线节点和 depth=17 的分支节点在同一 Y 行。
// 收起时：紧凑显示深度范围。
// ============================================================

import type { DayColumnLayout } from "@/lib/game/worldline-layout";
import type { WorldLineNode } from "@/lib/game/types";
import { DayHeader } from "./DayHeader";
import { StepNode } from "./StepNode";
import { LAYOUT } from "@/lib/game/worldline-layout";

interface DayColumnProps {
  column: DayColumnLayout;
  allNodes: Record<string, WorldLineNode>;
  currentNodeId: string;
  selectedNodeId: string | null;
  onToggleExpand: (day: number) => void;
  onSelectNode: (nodeId: string) => void;
}

interface DepthRow {
  depth: number;
  main: string | null;    // nodeId in main track
  left: string[];         // nodeId per subColumn: left[subCol] = nodeId or ""
  right: string[];        // nodeId per subColumn: right[subCol] = nodeId or ""
  leftCount: number;      // number of left sub-columns (for rendering)
  rightCount: number;     // number of right sub-columns (for rendering)
}

export function DayColumn({
  column,
  allNodes,
  currentNodeId,
  selectedNodeId,
  onToggleExpand,
  onSelectNode,
}: DayColumnProps) {
  const isExpanded = column.isExpanded;

  // 按 depth 分组所有节点（跨所有 track，每个 subColumn 独立槽位）
  const depthMap = new Map<number, { main: string | null; left: Map<number, string>; right: Map<number, string> }>();
  let maxLeftSubCol = 0;
  let maxRightSubCol = 0;
  for (const ln of column.nodes) {
    const entry = depthMap.get(ln.depth) ?? { main: null, left: new Map(), right: new Map() };
    if (ln.trackDirection === "main") {
      entry.main = ln.id;
    } else if (ln.trackDirection === "left") {
      entry.left.set(ln.subColumn, ln.id);
      if (ln.subColumn > maxLeftSubCol) maxLeftSubCol = ln.subColumn;
    } else {
      entry.right.set(ln.subColumn, ln.id);
      if (ln.subColumn > maxRightSubCol) maxRightSubCol = ln.subColumn;
    }
    depthMap.set(ln.depth, entry);
  }

  // 排序的深度行 → 转为固定长度数组
  const depthRows: DepthRow[] = Array.from(depthMap.entries())
    .sort(([a], [b]) => a - b)
    .map(([depth, entry]) => {
      const leftArr: string[] = [];
      for (let i = 0; i <= maxLeftSubCol; i++) {
        leftArr.push(entry.left.get(i) || "");
      }
      const rightArr: string[] = [];
      for (let i = 0; i <= maxRightSubCol; i++) {
        rightArr.push(entry.right.get(i) || "");
      }
      return {
        depth,
        main: entry.main,
        left: leftArr,
        right: rightArr,
        leftCount: maxLeftSubCol + 1,
        rightCount: maxRightSubCol + 1,
      };
    });

  const isCurrentDay = column.nodes.some((n) => n.id === currentNodeId);

  // 总体深度范围（Header 显示用）
  const allDepths = depthRows.map((r) => r.depth);
  const headerMin = allDepths.length > 0 ? allDepths[0] : 0;
  const headerMax = allDepths.length > 0 ? allDepths[allDepths.length - 1] : 0;

  return (
    <div className="flex flex-col shrink-0">
      {/* DayHeader */}
      <DayHeader
        day={column.day}
        nodeCount={column.nodes.length}
        isExpanded={isExpanded}
        isCurrent={isCurrentDay}
        minStep={headerMin}
        maxStep={headerMax}
        onClick={() => onToggleExpand(column.day)}
      />

      {/* 节点列表 */}
      {isExpanded ? (
        <div className="flex flex-col">
          {depthRows.map((row, i) => {
            // 节点间连接线（跨行时显示）
            const prevRow = i > 0 ? depthRows[i - 1] : null;
            const hasMainGap = prevRow && row.depth !== (prevRow.depth ?? 0) + 1;

            return (
              <div key={`depth-${row.depth}`} className="flex flex-col">
                {/* 深度间距（如果深度不连续，插入空隙） */}
                {hasMainGap && (
                  <div style={{ height: LAYOUT.NODE_GAP }}>
                    {/* 为每个子列渲染间隙线 */}
                    <div className="flex items-start gap-1">
                      {Array.from({ length: row.leftCount }).map((_, si) => (
                        <div key={`gap-left-${si}`} className="flex-1 flex justify-end">
                          <div className="w-px h-full mx-auto bg-zinc-800/30" />
                        </div>
                      ))}
                      <div className="flex-1 flex justify-center" style={{ maxWidth: 200 }}>
                        <div className="w-px h-full mx-auto bg-zinc-800/50" />
                      </div>
                      {Array.from({ length: row.rightCount }).map((_, si) => (
                        <div key={`gap-right-${si}`} className="flex-1 flex justify-start">
                          <div className="w-px h-full mx-auto bg-zinc-800/30" />
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* 节点间连接线（正常间距） */}
                {i > 0 && !hasMainGap && prevRow && (
                  <div style={{ height: LAYOUT.NODE_GAP, position: "relative" }}>
                    {/* 竖线层：轨道内垂直连接 */}
                    <div className="flex items-start gap-1" style={{ height: "100%" }}>
                      {/* 左分支子列连接线 */}
                      {Array.from({ length: row.leftCount }).map((_, si) => (
                        <div key={`conn-left-${si}`} className="flex-1 flex justify-end" style={{ height: "100%" }}>
                          {row.left[si] && prevRow.left[si] && (
                            <div className="w-px h-full bg-zinc-700/50" />
                          )}
                        </div>
                      ))}
                      {/* 主线连接 */}
                      <div className="flex-1 flex justify-center" style={{ height: "100%", maxWidth: 200 }}>
                        {row.main && prevRow.main && (
                          <div
                            className={`w-px h-full ${
                              (row.main === currentNodeId || prevRow.main === currentNodeId)
                                ? "bg-amber-600/40"
                                : "bg-zinc-800"
                            }`}
                          />
                        )}
                      </div>
                      {/* 右分支子列连接线 */}
                      {Array.from({ length: row.rightCount }).map((_, si) => (
                        <div key={`conn-right-${si}`} className="flex-1 flex justify-start" style={{ height: "100%" }}>
                          {row.right[si] && prevRow.right[si] && (
                            <div className="w-px h-full bg-zinc-700/50" />
                          )}
                        </div>
                      ))}
                    </div>

                    {/* 横线层：fork 分叉桥接线（主线 fork → 各分支子列首节点） */}
                    {prevRow.main && (() => {
                      const prevNode = allNodes[prevRow.main];
                      if (!prevNode || prevNode.childIds.length <= 1) return null;

                      // 收集有分支子节点出现在当前行的子列
                      const rightTargets: number[] = [];
                      const leftTargets: number[] = [];
                      for (let ci = 1; ci < prevNode.childIds.length; ci++) {
                        const childId = prevNode.childIds[ci];
                        for (let s = 0; s < row.right.length; s++) {
                          if (row.right[s] === childId) { rightTargets.push(s); break; }
                        }
                        for (let s = 0; s < row.left.length; s++) {
                          if (row.left[s] === childId) { leftTargets.push(s); break; }
                        }
                      }

                      if (rightTargets.length === 0 && leftTargets.length === 0) return null;

                      const hasCurrent =
                        prevRow.main === currentNodeId ||
                        rightTargets.some(s => row.right[s] === currentNodeId) ||
                        leftTargets.some(s => row.left[s] === currentNodeId);

                      return (
                        <div className="absolute inset-0 flex items-center pointer-events-none">
                          <div className="flex items-start gap-1 w-full" style={{ height: "100%" }}>
                            {/* 左子列 fork 桥接 */}
                            {Array.from({ length: row.leftCount }).map((_, si) => {
                              const subIdx = row.leftCount - 1 - si;
                              const isTarget = leftTargets.includes(subIdx);
                              const isTargetCurrent = isTarget && row.left[subIdx] === currentNodeId;
                              return (
                                <div key={`fk-left-${si}`} className="flex-1 flex justify-end" style={{ height: "100%" }}>
                                  {isTarget && (
                                    <div className="relative w-full">
                                      {/* 水平桥接线 */}
                                      <div
                                        className="absolute left-0 right-0 top-1/2"
                                        style={{
                                          height: 0,
                                          borderTop: `1px solid ${isTargetCurrent ? "rgba(245,158,11,0.4)" : "rgba(113,113,122,0.3)"}`,
                                        }}
                                      />
                                      {/* 垂直下桩（连到子节点顶部） */}
                                      <div
                                        className="absolute left-1/2 top-1/2"
                                        style={{
                                          width: 1,
                                          height: "50%",
                                          background: isTargetCurrent
                                            ? "rgba(245,158,11,0.4)"
                                            : "rgba(113,113,122,0.3)",
                                        }}
                                      />
                                    </div>
                                  )}
                                </div>
                              );
                            })}

                            {/* 主线槽（fork 起点，上方竖桩 + 横线起点） */}
                            <div className="flex-1 flex justify-center" style={{ height: "100%", maxWidth: 200 }}>
                              {(leftTargets.length > 0 || rightTargets.length > 0) && (
                                <div className="relative w-full" style={{ height: "100%" }}>
                                  {/* 水平桥接线 */}
                                  <div
                                    className="absolute left-0 right-0 top-1/2"
                                    style={{
                                      height: 0,
                                      borderTop: `1px solid ${prevRow.main === currentNodeId ? "rgba(245,158,11,0.4)" : "rgba(113,113,122,0.3)"}`,
                                    }}
                                  />
                                  {/* 垂直上桩（连到父节点底部） */}
                                  <div
                                    className="absolute left-1/2 top-0"
                                    style={{
                                      width: 1,
                                      height: "50%",
                                      background: prevRow.main === currentNodeId
                                        ? "rgba(245,158,11,0.4)"
                                        : "rgba(113,113,122,0.3)",
                                    }}
                                  />
                                </div>
                              )}
                            </div>

                            {/* 右子列 fork 桥接 */}
                            {Array.from({ length: row.rightCount }).map((_, si) => (
                              <div key={`fk-right-${si}`} className="flex-1 flex justify-start" style={{ height: "100%" }}>
                                {rightTargets.includes(si) && (
                                  <div className="relative w-full">
                                    {/* 水平桥接线 */}
                                    <div
                                      className="absolute left-0 right-0 top-1/2"
                                      style={{
                                        height: 0,
                                        borderTop: `1px solid ${row.right[si] === currentNodeId ? "rgba(245,158,11,0.4)" : "rgba(113,113,122,0.3)"}`,
                                      }}
                                    />
                                    {/* 垂直下桩（连到子节点顶部） */}
                                    <div
                                      className="absolute left-1/2 top-1/2"
                                      style={{
                                        width: 1,
                                        height: "50%",
                                        background: row.right[si] === currentNodeId
                                          ? "rgba(245,158,11,0.4)"
                                          : "rgba(113,113,122,0.3)",
                                      }}
                                    />
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                )}

                {/* 深度行：多列布局（左子列 + 主线 + 右子列） */}
                <div className="flex items-start gap-1" style={{ minHeight: LAYOUT.NODE_SIZE }}>
                  {/* 左分支子列（从外到内排列，subCol 大的在最左） */}
                  {Array.from({ length: row.leftCount }).map((_, si) => {
                    const subIdx = row.leftCount - 1 - si; // 反转：最外层最先渲染
                    const nodeId = row.left[subIdx];
                    const node = nodeId ? allNodes[nodeId] : null;
                    const hasChildBranches = node ? node.childIds.length > 1 : false;
                    return (
                      <div key={`left-${subIdx}`} className="flex-1 flex justify-end">
                        {node ? (
                          <div className="w-full max-w-[180px]">
                            <StepNode
                              layoutNode={column.nodes.find((n) => n.id === nodeId)!}
                              summary={node.summary}
                              playerInput={node.playerInput}
                              isCurrent={node.id === currentNodeId}
                              isSelected={node.id === selectedNodeId}
                              hasBranch={hasChildBranches}
                              isMainTrack={false}
                              onClick={() => onSelectNode(node.id)}
                            />
                          </div>
                        ) : (
                          <div className="w-full max-w-[180px]" />
                        )}
                      </div>
                    );
                  })}

                  {/* 主线槽（居中） */}
                  <div className="flex-1 flex justify-center" style={{ maxWidth: 200 }}>
                    {row.main && (() => {
                      const node = allNodes[row.main];
                      if (!node) return null;
                      const hasChildBranches = node.childIds.length > 1;
                      return (
                        <div className="w-full">
                          <StepNode
                            layoutNode={column.nodes.find((n) => n.id === row.main)!}
                            summary={node.summary}
                            playerInput={node.playerInput}
                            isCurrent={node.id === currentNodeId}
                            isSelected={node.id === selectedNodeId}
                            hasBranch={hasChildBranches}
                            isMainTrack
                            onClick={() => onSelectNode(node.id)}
                          />
                        </div>
                      );
                    })()}
                  </div>

                  {/* 右分支子列（从内到外排列，subCol 小的先渲染） */}
                  {Array.from({ length: row.rightCount }).map((_, si) => {
                    const nodeId = row.right[si];
                    const node = nodeId ? allNodes[nodeId] : null;
                    const hasChildBranches = node ? node.childIds.length > 1 : false;
                    return (
                      <div key={`right-${si}`} className="flex-1 flex justify-start">
                        {node ? (
                          <div className="w-full max-w-[180px]">
                            <StepNode
                              layoutNode={column.nodes.find((n) => n.id === nodeId)!}
                              summary={node.summary}
                              playerInput={node.playerInput}
                              isCurrent={node.id === currentNodeId}
                              isSelected={node.id === selectedNodeId}
                              hasBranch={hasChildBranches}
                              isMainTrack={false}
                              onClick={() => onSelectNode(node.id)}
                            />
                          </div>
                        ) : (
                          <div className="w-full max-w-[180px]" />
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        /* 紧凑模式：每条 track 独立显示一个块，按左/中/右排列 */
        (() => {
          // 按 track 分组，计算每条 track 的深度范围
          const trackGroups: { dir: "left" | "main" | "right"; depths: number[]; isCurrent: boolean }[] = [];
          const byTrack = new Map<string, number[]>();
          for (const ln of column.nodes) {
            const key = ln.trackDirection;
            if (!byTrack.has(key)) byTrack.set(key, []);
            byTrack.get(key)!.push(ln.depth);
          }

          for (const [dir, depths] of byTrack) {
            depths.sort((a, b) => a - b);
            trackGroups.push({
              dir: dir as "left" | "main" | "right",
              depths,
              isCurrent: column.nodes.some(
                (n) => n.trackDirection === dir && n.id === currentNodeId
              ),
            });
          }

          // 分离左/主/右
          const leftTracks = trackGroups.filter((t) => t.dir === "left");
          const mainTrack = trackGroups.find((t) => t.dir === "main");
          const rightTracks = trackGroups.filter((t) => t.dir === "right");

          return (
            <div className="flex items-start gap-1 py-1">
              {/* 左分支块 */}
              <div className="flex-1 flex flex-col items-end gap-1">
                {leftTracks.map((t, i) => (
                  <CollapsedBlock
                    key={`left-${i}`}
                    minDepth={t.depths[0]}
                    maxDepth={t.depths[t.depths.length - 1]}
                    count={t.depths.length}
                    isCurrent={t.isCurrent}
                    isBranch
                  />
                ))}
              </div>

              {/* 主线块（居中） */}
              <div className="flex-1 flex flex-col items-center" style={{ maxWidth: 200 }}>
                {mainTrack && (
                  <CollapsedBlock
                    minDepth={mainTrack.depths[0]}
                    maxDepth={mainTrack.depths[mainTrack.depths.length - 1]}
                    count={mainTrack.depths.length}
                    isCurrent={mainTrack.isCurrent}
                    isBranch={false}
                  />
                )}
              </div>

              {/* 右分支块 */}
              <div className="flex-1 flex flex-col items-start gap-1">
                {rightTracks.map((t, i) => (
                  <CollapsedBlock
                    key={`right-${i}`}
                    minDepth={t.depths[0]}
                    maxDepth={t.depths[t.depths.length - 1]}
                    count={t.depths.length}
                    isCurrent={t.isCurrent}
                    isBranch
                  />
                ))}
              </div>
            </div>
          );
        })()
      )}
    </div>
  );
}

// ============================================================
// CollapsedBlock — 收起态的单条轨道块
// ============================================================

function CollapsedBlock({
  minDepth,
  maxDepth,
  count,
  isCurrent,
  isBranch,
}: {
  minDepth: number;
  maxDepth: number;
  count: number;
  isCurrent: boolean;
  isBranch: boolean;
}) {
  const ui = useInterfaceText();
  return (
    <div
      className={`flex items-center gap-1 px-2 py-0.5 border text-[10px] tabular-nums ${
        isCurrent
          ? "border-amber-500/40 bg-amber-950/15 text-amber-400/80"
          : isBranch
          ? "border-zinc-700/50 bg-zinc-900/20 text-zinc-500"
          : "border-zinc-700/50 bg-zinc-900/20 text-zinc-400"
      }`}
    >
      <span className={isBranch ? "text-amber-600/40" : "text-zinc-600"}>
        {isBranch ? "⑃" : "·"}
      </span>
      <span>
        {minDepth === maxDepth
          ? ui("步{0}", {"0": minDepth})
          : ui("步{0}–{1}", {"0": minDepth, "1": maxDepth})}
      </span>
      {count > 1 && (
        <span className="text-[8px] text-zinc-600">×{count}</span>
      )}
      {isCurrent && (
        <span className="text-[7px] text-amber-400/60 border border-amber-500/20 px-0.5 ml-0.5">
          {ui("当前")}</span>
      )}
    </div>
  );
}
