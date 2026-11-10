// ============================================================
// Eidos · 世界线几何引擎（坐标体系 v2）
// ============================================================
// 设计规范：
// 1. 引导线连接左侧 "-" 的内端点（即空白区左边界）
// 2. 横杆 = "-" + "  " + "-"，无文字
// 3. 层间距 = 2×横杆厚度，展开时 5×
// 4. 分支连线从父横杆端点 → 子引导线（子引导线向上延伸一层）
// 5. 子节点按创建先后左右交替；按整棵子树边界留空，不穿过父级其他分支
// 6. 收缩时点击包围矩形展开，展开时点击步号标签
// ============================================================

import type { WorldLineNode } from "./types";
import { orderedTree, assignWorldlineTracks, type WorldlineTrack } from "./worldline-tree-layout";

// ============================================================
// 几何常量
// ============================================================

export const GEO = {
  THICKNESS: 3,            // 横杆 "-" 粗细 (px)
  LAYER_GAP: 1,            // 层间距（收缩时）
  DASH_W: 4,               // "-" 宽度
  GAP_W: 8,               // 空白区宽 = 2 × DASH_W
  BAR_H: 1,                // 横杆高度 = THICKNESS
  /** 横杆总宽 = DASH_W + GAP_W + DASH_W */
  get BAR_W() { return this.DASH_W + this.GAP_W + this.DASH_W; },
  GUIDE_SPACING: 40,       // 引导线 X 间距
  CANVAS_PAD: 40,          // 画布边距
  DEFAULT_SCALE: 4.0,       // 默认缩放（可手动调整）
  DAY_GAP_EXTRA: 10,       // 天之间额外间距
  EXPAND: 5,               // 展开缩放倍数（只放大层间距）
  EXPAND_WINDOW: 15,       // 展开窗口步数（点击位置上下各半）
} as const;

/** 展开窗口描述 */
export interface ExpandWindow {
  day: number;
  centerStep: number;  // 点击位置最近的步号
}

/** 一个步号的层高（含下方间距） */
function stepSpan(expanded: boolean): number {
  return GEO.BAR_H + (expanded ? GEO.LAYER_GAP * GEO.EXPAND : GEO.LAYER_GAP);
}

/** 判断某步号是否在展开窗口内 */
function isExpanded(step: number, win: ExpandWindow | null): boolean {
  if (!win) return false;
  const half = Math.floor(GEO.EXPAND_WINDOW / 2);
  return step >= win.centerStep - half && step <= win.centerStep + half;
}

// ============================================================
// 图元类型
// ============================================================

export interface GeoGuideLine {
  id: string;
  /** 引导线 X = 空白区左边界 = 左 "-" 右端点 */
  x: number;
  y1: number;
  y2: number;
  direction: "main" | "left" | "right";
  isMain: boolean;
}

export interface GeoBar {
  stepNumber: number;
  dayNumber: number;
  nodeId: string;
  /** 引导线 X（左 dash 内端点） */
  guideX: number;
  /** 横杆中心 Y */
  y: number;
  isCurrent: boolean;
  isSelected: boolean;
  hasBranches: boolean;
}

/** 收缩时组合节点的包围矩形（点击展开用） */
export interface GeoClickRect {
  trackIdx: number;
  dayNumber: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface GeoBranchConn {
  fromX: number;
  fromY: number;
  toGuideX: number;
  toY: number;
  fromNodeId: string;
  toNodeId: string;
  direction: "left" | "right";
  isCurrent: boolean;
}

export interface GeoDaySep {
  y: number;
  dayNumber: number;
  minX: number;
  maxX: number;
}

export interface GeoStepLabel {
  stepNumber: number;
  x: number;
  y: number;
  nodeId: string;
  isCurrent: boolean;
  dayNumber: number;
  /** 引导线 X（左边界），用于绘制从引导线到步号右侧的宽点击区域 */
  guideX: number;
  /** 步号所在行的高度 */
  rowH: number;
}

/** 收缩时每个组合节点的天标签 */
export interface GeoDayLabel {
  /** 标签中心 X */
  x: number;
  y: number;
  dayNumber: number;
  /** true = 标签在矩形内部上方；false = 标签在矩形外部下方 */
  inside: boolean;
}

export interface WorldlineGeometry {
  guideLines: GeoGuideLine[];
  bars: GeoBar[];
  clickRects: GeoClickRect[];
  branchConns: GeoBranchConn[];
  daySeps: GeoDaySep[];
  stepLabels: GeoStepLabel[];
  dayLabels: GeoDayLabel[];
  bounds: { minX: number; maxX: number; minY: number; maxY: number; w: number; h: number };
}

// ============================================================
// 引导线分配（含碰撞避让）
// ============================================================

// ============================================================
// 主入口
// ============================================================

export function computeWorldlineGeometry(
  allNodes: Record<string, WorldLineNode>,
  rootId: string,
  currentId: string,
  selectedId: string | null,
  expandedWin: ExpandWindow | null
): WorldlineGeometry {
  const empty = { guideLines: [], bars: [], clickRects: [], branchConns: [], daySeps: [], stepLabels: [], dayLabels: [], bounds: { minX: 0, maxX: 0, minY: 0, maxY: 0, w: 0, h: 0 } };
  if (!allNodes[rootId]) return empty;

  const tree = orderedTree(allNodes, rootId);
  const tracks = assignWorldlineTracks(allNodes, tree, rootId, GEO.GUIDE_SPACING);

  const trackByNode = new Map<string, WorldlineTrack>();
  for (const t of tracks) for (const nid of t.nodeIds) trackByNode.set(nid, t);

  const reachable = [...tree.keys()].map(id => allNodes[id]);
  const stepExpanded = (step: number, day: number) => expandedWin?.day === day && isExpanded(step, expandedWin);
  const nodeY = new Map<string, number>([[rootId, GEO.CANVAS_PAD]]);
  // Dates belong to individual branches. Grouping the whole tree by date can move
  // a child above its parent, so every position follows its actual ancestry.
  for (const [id, children] of tree) {
    const parent = allNodes[id];
    const nextY = nodeY.get(id)! + stepSpan(stepExpanded(parent.stepNumber, parent.dayNumber));
    children.forEach(child => nodeY.set(child, nextY));
  }
  const dayMap = new Map<number, { nodes: WorldLineNode[] }>();
  for (const node of reachable) {
    if (!dayMap.has(node.dayNumber)) dayMap.set(node.dayNumber, { nodes: [] });
    dayMap.get(node.dayNumber)!.nodes.push(node);
  }
  const sortedDays = [...dayMap.keys()].sort((a, b) => a - b);
  const yFor = (node: WorldLineNode) => nodeY.get(node.id)!;
  const bottomFor = (node: WorldLineNode) => yFor(node) + stepSpan(stepExpanded(node.stepNumber, node.dayNumber));
  const dayEnd = (day: number) => Math.max(...dayMap.get(day)!.nodes.map(bottomFor));

  // Bar 生成
  const bars: GeoBar[] = [];
  for (const n of reachable) {
    const t = trackByNode.get(n.id);
    if (!t) continue;
    const sy = yFor(n);
    const h = stepSpan(stepExpanded(n.stepNumber, n.dayNumber));
    bars.push({
      stepNumber: n.stepNumber, dayNumber: n.dayNumber, nodeId: n.id,
      guideX: t.guideX,
      y: sy + h / 2, // 横杆在步高中心
      isCurrent: n.id === currentId, isSelected: n.id === selectedId,
      hasBranches: n.childIds.length > 1,
    });
  }

  // 引导线（从首步到末步；分支引导线向上延伸一层以对接分支连线）
  const guideLines: GeoGuideLine[] = [];
  for (const t of tracks) {
    if (t.nodeIds.length === 0) continue;
    const first = allNodes[t.nodeIds[0]];
    const last = allNodes[t.nodeIds[t.nodeIds.length - 1]];
    if (!first || !last) continue;
    const lh = stepSpan(stepExpanded(last.stepNumber, last.dayNumber));
    guideLines.push({
      id: `g-${t.idx}`, x: t.guideX,
      y1: yFor(first),
      y2: yFor(last) + lh,
      direction: t.dir, isMain: t.dir === "main",
    });
  }

  // 分支连线
  const branchConns: GeoBranchConn[] = [];
  for (const n of reachable) {
    const children = tree.get(n.id) ?? [];
    if (children.length <= 1) continue;
    const pt = trackByNode.get(n.id);
    if (!pt) continue;
    const py = yFor(n);
    const ph = stepSpan(stepExpanded(n.stepNumber, n.dayNumber));
    const parentBarY = py + ph / 2;

    for (const cid of children) {
      const child = allNodes[cid];
      if (!child) continue;
      const ct = trackByNode.get(cid);
      if (!ct || ct.idx === pt.idx) continue;
      const direction = ct.guideX < pt.guideX ? "left" : "right";
      const cy = yFor(child);

      // 从父横杆 dash 外端点出发
      const fromX = direction === "left"
        ? pt.guideX - GEO.DASH_W                    // 左 dash 左端点
        : pt.guideX + GEO.GAP_W + GEO.DASH_W;       // 右 dash 右端点

      branchConns.push({
        fromX, fromY: parentBarY,
        toGuideX: ct.guideX, toY: cy - 1,
        fromNodeId: n.id, toNodeId: cid,
        direction,
        isCurrent: n.id === currentId || cid === currentId,
      });
    }
  }

  // 点击包围矩形
  const clickRects: GeoClickRect[] = [];
  for (const day of sortedDays) {
    const g = dayMap.get(day)!;
    const trackDays = new Map<number, { minStep: number; maxStep: number; guideX: number }>();
    for (const n of g.nodes) {
      const t = trackByNode.get(n.id);
      if (!t) continue;
      if (!trackDays.has(t.idx)) {
        trackDays.set(t.idx, { minStep: Infinity, maxStep: -Infinity, guideX: t.guideX });
      }
      const td = trackDays.get(t.idx)!;
      if (n.stepNumber < td.minStep) td.minStep = n.stepNumber;
      if (n.stepNumber > td.maxStep) td.maxStep = n.stepNumber;
    }
    for (const [tidx, td] of trackDays) {
      const left = td.guideX - GEO.DASH_W;
      const right = td.guideX + GEO.GAP_W + GEO.DASH_W;
      const y1 = Math.min(...g.nodes.filter(n => trackByNode.get(n.id)?.idx === tidx).map(yFor));
      const y2 = Math.max(...g.nodes.filter(n => trackByNode.get(n.id)?.idx === tidx).map(bottomFor));
      clickRects.push({
        trackIdx: tidx, dayNumber: day,
        x: left - 1, y: y1 - 1,
        w: right - left + 2, h: y2 - y1 + 2,
      });
    }
  }

  // 天分隔
  const daySeps: GeoDaySep[] = [];
  for (let i = 0; i < sortedDays.length - 1; i++) {
    const day = sortedDays[i];
    const y = dayEnd(day);
    // 计算所有引导线的最小/最大 X
    let mx = Infinity, Mx = -Infinity;
    for (const gl of guideLines) {
      if (gl.x < mx) mx = gl.x;
      if (gl.x > Mx) Mx = gl.x;
    }
    daySeps.push({ y, dayNumber: day + 1, minX: mx - GEO.DASH_W, maxX: Mx + GEO.GAP_W + GEO.DASH_W });
  }

  // 步号标签（展开时显示在空白区右侧）
  // 步号标签（展开窗口内的步号）
  const stepLabels: GeoStepLabel[] = [];
  if (expandedWin !== null) {
    for (const n of reachable) {
      if (!stepExpanded(n.stepNumber, n.dayNumber)) continue;
      const t = trackByNode.get(n.id);
      if (!t) continue;
      const sy = yFor(n);
      const h = stepSpan(true);
      stepLabels.push({
        stepNumber: n.stepNumber,
        x: t.guideX + GEO.GAP_W - 2,
        y: sy + h / 2,
        nodeId: n.id,
        isCurrent: n.id === currentId,
        dayNumber: n.dayNumber,
        guideX: t.guideX,
        rowH: h,
      });
    }
  }

  // 收缩/未展开时天标签
  const dayLabels: GeoDayLabel[] = [];
  if (expandedWin === null) {
    for (const day of sortedDays) {
      const g = dayMap.get(day)!;
      const trackRanges = new Map<number, { minStep: number; maxStep: number; guideX: number; count: number }>();
      for (const n of g.nodes) {
        const t = trackByNode.get(n.id);
        if (!t) continue;
        if (!trackRanges.has(t.idx)) trackRanges.set(t.idx, { minStep: Infinity, maxStep: -Infinity, guideX: t.guideX, count: 0 });
        const tr = trackRanges.get(t.idx)!;
        if (n.stepNumber < tr.minStep) tr.minStep = n.stepNumber;
        if (n.stepNumber > tr.maxStep) tr.maxStep = n.stepNumber;
        tr.count++;
      }
      for (const [tidx, tr] of trackRanges) {
        const inside = tr.count > 10;
        const y1 = Math.min(...g.nodes.filter(n => trackByNode.get(n.id)?.idx === tidx).map(yFor));
        const y2 = Math.max(...g.nodes.filter(n => trackByNode.get(n.id)?.idx === tidx).map(bottomFor));
        dayLabels.push({
          x: tr.guideX,
          y: inside ? (y1 + y2) / 2 : y2 + 8,
          dayNumber: day,
          inside,
        });
      }
    }
  }

  // 边界
  const allX = [...bars.map((b) => b.guideX - GEO.DASH_W), ...bars.map((b) => b.guideX + GEO.GAP_W + GEO.DASH_W), 0];
  const minX = Math.min(...allX) - GEO.CANVAS_PAD;
  const maxX = Math.max(...allX) + GEO.CANVAS_PAD;
  const maxY = Math.max(0, ...reachable.map(bottomFor)) + GEO.CANVAS_PAD;

  return { guideLines, bars, clickRects, branchConns, daySeps, stepLabels, dayLabels, bounds: { minX, maxX, minY: 0, maxY, w: maxX - minX, h: maxY } };
}
