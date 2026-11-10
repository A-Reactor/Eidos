"use client";
import { useInterfaceText } from "@/components/shell/useInterfaceText";

import { plainDocumentText } from '@/lib/game/documents/inline-links';

import { useState, useMemo, useCallback, useRef } from "react";
import { useGameStore } from "@/store/game-store";
import type { WorldLineNode, WorldLineGroup } from "@/lib/game/types";

// ============================================================
// WorldLineView — 世界线树状图
// 收纳模式：天节点小块 + 连线
// 点击展开：原块拉伸，竖排步列表 + 日记
// ============================================================

const DAY_DIGITS = ["零","一","二","三","四","五","六","七","八","九","十"];

export function WorldLineView() {
  const ui = useInterfaceText();
  const setPhase = useGameStore((s) => s.setPhase);
  const worldLine = useGameStore((s) => s.worldLine);
  const allNodes = useGameStore((s) => s.allNodes);
  const getNodeGroups = useGameStore((s) => s.getNodeGroups);
  const playerName = useGameStore((s) => s.playerName);
  const diary = useGameStore((s) => s.diary);

  const [expandedDayKey, setExpandedDayKey] = useState<string | null>(null);
  const [openDiaries, setOpenDiaries] = useState<Set<number>>(new Set());

  // Drag scroll
  const treeRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0, scrollX: 0, scrollY: 0 });
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    const el = treeRef.current; if (!el) return;
    setIsDragging(true);
    dragStart.current = { x: e.clientX, y: e.clientY, scrollX: el.scrollLeft, scrollY: el.scrollTop };
  }, []);
  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDragging) return;
    const el = treeRef.current; if (!el) return;
    el.scrollLeft = dragStart.current.scrollX - (e.clientX - dragStart.current.x);
    el.scrollTop = dragStart.current.scrollY - (e.clientY - dragStart.current.y);
  }, [isDragging]);
  const handleMouseUp = useCallback(() => setIsDragging(false), []);

  const groups = useMemo(() => {
    try { return getNodeGroups(); } catch { return []; }
  }, [getNodeGroups, worldLine?.totalSteps]);

  if (!worldLine || Object.keys(allNodes).length === 0) {
    return (
      <div className="eidos-worldline h-full flex flex-col">
        <div className="eidos-worldline-rail flex items-center justify-between border-b px-6 py-4">
          <h2 className="text-xl font-light tracking-[0.1em] text-[color:var(--eidos-worldline-current)]">{ui("世界线")}</h2>
          <button onClick={() => useGameStore.getState().goBack()} className="eidos-focus eidos-dossier-action px-4 py-2 text-sm">{ui("返回游戏")}</button>
        </div>
        <div className="flex-1 flex items-center justify-center">
          <p className="text-[color:var(--eidos-worldline-label)]">{ui("还没有世界线数据")}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="eidos-worldline h-full flex flex-col">
      <div className="eidos-worldline-rail flex items-center justify-between border-b px-6 py-4 shrink-0">
        <div>
          <h2 className="text-xl font-light tracking-[0.1em] text-[color:var(--eidos-worldline-current)]">{ui("世界线 · 决策树")}</h2>
          <p className="text-xs text-[color:var(--eidos-worldline-label)] mt-1">{playerName} · {worldLine.totalSteps} {ui("步 ·")}{worldLine.branchCount} {ui("分支")}</p>
        </div>
        <button onClick={() => useGameStore.getState().goBack()} className="eidos-focus eidos-dossier-action px-4 py-2 text-sm">{ui("返回游戏")}</button>
      </div>

      <div
        ref={treeRef}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        className={`flex-1 overflow-auto select-none ${isDragging ? "cursor-grabbing" : "cursor-grab"}`}
      >
        <div className="p-8 flex gap-6 min-w-max items-start">
          {/* Main trunk */}
          <TrunkColumn
            groups={groups}
            allNodes={allNodes}
            diary={diary}
            currentNodeId={worldLine.currentNodeId}
            expandedDayKey={expandedDayKey}
            openDiaries={openDiaries}
            onToggle={(key) => setExpandedDayKey(expandedDayKey === key ? null : key)}
            onToggleDiary={(day) => {
              const next = new Set(openDiaries);
              if (next.has(day)) next.delete(day); else next.add(day);
              setOpenDiaries(next);
            }}
          />

          {/* Branch trunks */}
          {groups.map((g) =>
            g.branchRootIds.map((brId) => (
              <BranchTrunk
                key={brId}
                rootId={brId}
                allNodes={allNodes}
                diary={diary}
                currentNodeId={worldLine.currentNodeId}
                expandedDayKey={expandedDayKey}
                openDiaries={openDiaries}
                onToggle={(key) => setExpandedDayKey(expandedDayKey === key ? null : key)}
                onToggleDiary={(day) => {
                  const next = new Set(openDiaries);
                  if (next.has(day)) next.delete(day); else next.add(day);
                  setOpenDiaries(next);
                }}
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================================
// TrunkColumn — 主干的竖排天节点列
// ============================================================

function TrunkColumn({
  groups, allNodes, diary, currentNodeId,
  expandedDayKey, openDiaries, onToggle, onToggleDiary,
}: {
  groups: WorldLineGroup[];
  allNodes: Record<string, WorldLineNode>;
  diary: Array<{ day: number; entries: string[]; summary: string }>;
  currentNodeId: string;
  expandedDayKey: string | null;
  openDiaries: Set<number>;
  onToggle: (key: string) => void;
  onToggleDiary: (day: number) => void;
}) {
  return (
    <div className="flex flex-col items-center gap-0 shrink-0">
      {groups.map((group, gi) => {
        const nodes = group.nodeIds.map((nid) => allNodes[nid]).filter(Boolean).sort((a, b) => a.stepNumber - b.stepNumber);
        if (nodes.length === 0) return null;

        const key = `main_${group.day}`;
        const isExpanded = expandedDayKey === key;
        const isCurrent = allNodes[currentNodeId]?.dayNumber === group.day;
        const de = diary.find((d) => d.day === group.day);
        const diaryOpen = openDiaries.has(group.day);

        return (
          <div key={group.day} className="flex flex-col items-center">
            <DayBlock
              day={group.day}
              nodes={nodes}
              diaryEntry={de ?? null}
              diaryOpen={diaryOpen}
              isCurrent={isCurrent}
              isExpanded={isExpanded}
              isMainPath={true}
              currentNodeId={currentNodeId}
              branchRootIds={group.branchRootIds}
              allNodes={allNodes}
              onToggle={() => onToggle(key)}
              onToggleDiary={() => onToggleDiary(group.day)}
            />
            {/* Connector to next day */}
            {gi < groups.length - 1 && (
              <div className="flex justify-center h-6">
                <div className={`w-px h-full ${isCurrent ? "bg-[color:var(--eidos-yellow)]" : "bg-[color:var(--eidos-worldline-guide-soft)]"}`} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ============================================================
// BranchTrunk — 分支列
// ============================================================

function BranchTrunk({
  rootId, allNodes, diary, currentNodeId,
  expandedDayKey, openDiaries, onToggle, onToggleDiary,
}: {
  rootId: string;
  allNodes: Record<string, WorldLineNode>;
  diary: Array<{ day: number; entries: string[]; summary: string }>;
  currentNodeId: string;
  expandedDayKey: string | null;
  openDiaries: Set<number>;
  onToggle: (key: string) => void;
  onToggleDiary: (day: number) => void;
}) {
  // Collect branch chain → group by day
  const chain: WorldLineNode[] = [];
  let cur: WorldLineNode | null = allNodes[rootId] ?? null;
  while (cur) {
    chain.push(cur);
    cur = cur.childIds.length > 0 ? (allNodes[cur.childIds[0]] ?? null) : null;
  }
  if (chain.length === 0) return null;

  const dayMap = new Map<number, WorldLineNode[]>();
  for (const n of chain) {
    const d = n.dayNumber;
    if (!dayMap.has(d)) dayMap.set(d, []);
    dayMap.get(d)!.push(n);
  }
  const days = Array.from(dayMap.entries()).sort(([a], [b]) => a - b);

  return (
    <div className="flex flex-col items-center gap-0 shrink-0">
      {days.map(([day, nodes], di) => {
        const key = `branch_${rootId}_${day}`;
        const isExpanded = expandedDayKey === key;
        const isCurrent = allNodes[currentNodeId]?.dayNumber === day;
        const de = diary.find((d) => d.day === day);
        const diaryOpen = openDiaries.has(day);

        return (
          <div key={day} className="flex flex-col items-center">
            <DayBlock
              day={day}
              nodes={nodes}
              diaryEntry={de ?? null}
              diaryOpen={diaryOpen}
              isCurrent={isCurrent}
              isExpanded={isExpanded}
              isMainPath={false}
              currentNodeId={currentNodeId}
              branchRootIds={[]}
              allNodes={allNodes}
              onToggle={() => onToggle(key)}
              onToggleDiary={() => onToggleDiary(day)}
            />
            {di < days.length - 1 && (
              <div className="flex justify-center h-6">
                <div className={`w-px h-full ${isCurrent ? "bg-[color:var(--eidos-yellow)]" : "bg-[color:var(--eidos-worldline-guide-soft)]"}`} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ============================================================
// DayBlock — 核心：可拉伸天模块
// 收起时 3 行（第/X/天），展开时拉伸为 N 行步列表
// ============================================================

function DayBlock({
  day, nodes, diaryEntry, diaryOpen, isCurrent, isExpanded, isMainPath,
  currentNodeId, branchRootIds, allNodes,
  onToggle, onToggleDiary,
}: {
  day: number;
  nodes: WorldLineNode[];
  diaryEntry: { day: number; entries: string[]; summary: string } | null;
  diaryOpen: boolean;
  isCurrent: boolean;
  isExpanded: boolean;
  isMainPath: boolean;
  currentNodeId: string;
  branchRootIds: string[];
  allNodes: Record<string, WorldLineNode>;
  onToggle: () => void;
  onToggleDiary: () => void;
}) {
  const ui = useInterfaceText();
  const dayLabel = DAY_DIGITS[day] || String(day);

  // Build step rows for expanded mode
  const stepRows: Array<{ type: "step"; node: WorldLineNode } | { type: "diary-toggle" } | { type: "diary-entry"; entry: string } | { type: "diary-summary"; text: string } | { type: "separator" }> = [];

  for (const node of nodes) {
    stepRows.push({ type: "step", node });
  }
  // Diary section
  if (diaryEntry && diaryEntry.entries.length > 0) {
    stepRows.push({ type: "separator" });
    stepRows.push({ type: "diary-toggle" });
    if (diaryOpen) {
      for (const entry of diaryEntry.entries) {
        stepRows.push({ type: "diary-entry", entry });
      }
      if (diaryEntry.summary) {
        stepRows.push({ type: "diary-summary", text: diaryEntry.summary });
      }
    }
  }

  return (
    <button
      onClick={onToggle}
      className={`flex border transition-colors cursor-pointer shrink-0 ${
        isCurrent ? "border-[color:var(--eidos-yellow)] bg-[color:var(--eidos-worldline-frame-fill)]" :
        isExpanded ? "border-[color:var(--eidos-blue)] bg-[color:var(--eidos-worldline-frame-fill)]" :
        "border-[color:var(--eidos-worldline-frame-stroke)] bg-[color:var(--eidos-worldline-frame-fill)] hover:border-[color:var(--eidos-worldline-guide)]"
      }`}
    >
      {/* Left label column */}
      <div className="flex flex-col items-center px-2 py-1.5 border-r border-[color:var(--eidos-worldline-guide-soft)] shrink-0 w-8">
        <span className="text-[10px] text-[color:var(--eidos-worldline-label)]">{ui("第")}</span>
        <span className={`text-sm font-medium my-1 ${isCurrent ? "text-[color:var(--eidos-yellow)]" : "text-[color:var(--eidos-worldline-current)]"}`}>{dayLabel}</span>
        <span className="text-[10px] text-[color:var(--eidos-worldline-label)]">{ui("天")}</span>
        {isExpanded && (
          <>
            {/* Separator + 日记 markers in left column */}
            {diaryEntry && diaryEntry.entries.length > 0 && (
              <>
                <span className="text-[10px] text-[color:var(--eidos-worldline-label)] mt-1">--</span>
                <span className="text-[10px] text-[color:var(--eidos-yellow)] mt-0.5">{ui("日")}</span>
                <span className="text-[10px] text-[color:var(--eidos-yellow)]">{ui("记")}</span>
                <span className="text-[10px] text-[color:var(--eidos-worldline-label)] mt-0.5">--</span>
              </>
            )}
            {/* Spacer for remaining steps */}
            {diaryEntry && diaryOpen && (
              <>
                {diaryEntry.entries.map((_, j) => (
                  <span key={j} className="text-[10px] text-[color:var(--eidos-worldline-guide-soft)] mt-0.5">·</span>
                ))}
                {diaryEntry.summary && <span className="text-[10px] text-[color:var(--eidos-worldline-guide-soft)] mt-0.5">·</span>}
              </>
            )}
          </>
        )}
      </div>

      {/* Right content column */}
      <div className="flex flex-col py-1.5 min-w-[140px]">
        {!isExpanded ? (
          /* Collapsed: just show step range */
          <div className="flex items-center gap-1 px-2 h-full">
            <span className={`text-[10px] tabular-nums ${isCurrent ? "text-[color:var(--eidos-yellow)]" : "text-[color:var(--eidos-worldline-label)]"}`}>
              {ui("步")}{nodes[0].stepNumber}-{nodes[nodes.length - 1].stepNumber}
            </span>
            {branchRootIds.length > 0 && <span className="text-[9px] text-[color:var(--eidos-yellow)] ml-1">⑃</span>}
            {diaryEntry && <span className="text-[9px] text-[color:var(--eidos-yellow)] ml-1">{ui("记")}</span>}
          </div>
        ) : (
          /* Expanded: show each step */
          <div className="flex flex-col gap-0">
            {stepRows.map((row, i) => {
              if (row.type === "step") {
                const node = row.node;
                const isNodeCurrent = node.id === currentNodeId;
                // Check if this step has a branch
                const hasBranch = branchRootIds.some((brid) => {
                  const brNode = allNodes[brid];
                  return brNode && brNode.stepNumber === node.stepNumber;
                });

                return (
                  <div key={node.id} className="flex items-center gap-1.5 px-2 h-6">
                    <span className={`inline-block w-1 h-1 rounded-full shrink-0 ${
                      isNodeCurrent ? "bg-[color:var(--eidos-yellow)]" : branchRootIds.length > 0 && hasBranch ? "bg-[color:var(--eidos-yellow)]" : "bg-[color:var(--eidos-worldline-node-mark)]"
                    }`} />
                    <span className={`text-[10px] tabular-nums shrink-0 ${isNodeCurrent ? "text-[color:var(--eidos-yellow)]" : "text-[color:var(--eidos-worldline-label)]"}`}>
                      {ui("第")}{node.stepNumber}{ui("步")}</span>
                    <span className="text-[10px] text-[color:var(--eidos-worldline-label)] truncate flex-1">
                      {plainDocumentText(node.summary || node.playerInput || "").slice(0, 20)}
                    </span>
                    {isNodeCurrent && (
                      <span className="text-[8px] text-[color:var(--eidos-yellow)] border border-[color:var(--eidos-yellow)] px-1 shrink-0">{ui("当前")}</span>
                    )}
                    {hasBranch && (
                      <span className="text-[8px] text-[color:var(--eidos-yellow)] shrink-0">⑃</span>
                    )}
                  </div>
                );
              }
              if (row.type === "separator") {
                return <div key={`sep_${i}`} className="h-px bg-[color:var(--eidos-worldline-guide-soft)] mx-2 my-0.5" />;
              }
              if (row.type === "diary-toggle") {
                return (
                  <div
                    key={`diary_toggle`}
                    onClick={(e) => { e.stopPropagation(); onToggleDiary(); }}
                    className="flex items-center gap-1.5 px-2 h-6 cursor-pointer hover:bg-[color:var(--eidos-worldline-frame-fill)]"
                  >
                    <span className="text-[10px] text-[color:var(--eidos-worldline-label)]">{diaryOpen ? "▾" : "▸"}</span>
                    <span className="text-[10px] text-[color:var(--eidos-yellow)]">{ui("日记 ·")}{diaryEntry!.entries.length} {ui("条")}</span>
                  </div>
                );
              }
              if (row.type === "diary-entry") {
                return (
                  <div key={`diary_${i}`} className="px-4 py-0.5">
                    <p className="text-[9px] text-[color:var(--eidos-worldline-label)] leading-relaxed">{row.entry}</p>
                  </div>
                );
              }
              if (row.type === "diary-summary") {
                return (
                  <div key={`diary_summary`} className="px-4 py-0.5">
                    <p className="text-[9px] text-[color:var(--eidos-worldline-label)] italic leading-relaxed border-l-2 border-[color:var(--eidos-worldline-guide-soft)] pl-2">{row.text}</p>
                  </div>
                );
              }
              return null;
            })}
          </div>
        )}
      </div>
    </button>
  );
}
