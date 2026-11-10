// ============================================================
// Eidos · 世界线布局计算引擎
// ============================================================
// 纯函数：将 WorldLineNode 树转换为 2D 布局坐标。
// 天数由上至下排列，分支左右平衡展开。
// 展开某天时该天区域局部放大（所有步骤节点可见），其他天保持紧凑。
// ============================================================

import type { WorldLineNode } from "./types";

// ============================================================
// 类型定义
// ============================================================

/** 布局节点 */
export interface LayoutNode {
  id: string;
  day: number;
  step: number; // 日内序号（1-based，该天第几个节点）
  depth: number; // 绝对步数 stepNumber，从根算起
  parentId: string | null;
  childIds: string[];
  trackIndex: number; // 0 = 主路径, 1+ = 分支轨道
  trackDirection: "main" | "left" | "right";
  subColumn: number; // 0 = 主线或第一个分支列，1+ = 碰撞避让后的子列
  x: number;
  y: number;
}

/** 布局连线 */
export interface LayoutEdge {
  from: string;
  to: string;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  type: "main" | "branch";
}

/** 天列布局 */
export interface DayColumnLayout {
  day: number;
  nodes: LayoutNode[];
  startY: number;
  endY: number;
  isExpanded: boolean;
}

/** 完整布局结果 */
export interface WorldLineLayout {
  nodes: LayoutNode[];
  edges: LayoutEdge[];
  dayColumns: DayColumnLayout[];
  bounds: {
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
    width: number;
    height: number;
  };
}

// ============================================================
// 布局常量
// ============================================================

export const LAYOUT = {
  NODE_SIZE: 32,
  NODE_GAP: 8,
  DAY_GAP: 24,
  COL_WIDTH: 200,
  HEADER_HEIGHT: 40,
  COMPACT_HEIGHT: 28,
  CANVAS_PADDING: 48,
} as const;

// ============================================================
// 轨道分配
// ============================================================

interface Track {
  index: number;
  direction: "main" | "left" | "right";
  nodes: string[]; // 该轨道上的节点 ID（按深度排序）
}

interface TrackAssignment {
  /** nodeId → trackIndex */
  nodeTracks: Map<string, number>;
  /** trackIndex → Track */
  tracks: Map<number, Track>;
}

/**
 * 遍历树，为每个节点分配轨道。
 *
 * 主路径（childIds[0]）在轨道 0。
 * 每个分支（childIds[1:]）创建新轨道，左右交替，保持视觉平衡。
 * 分支的子分支继续向外扩展。
 */
function assignTracks(
  allNodes: Record<string, WorldLineNode>,
  rootNodeId: string
): TrackAssignment {
  const nodeTracks = new Map<string, number>();
  const tracks = new Map<number, Track>();

  // 创建主轨道
  const mainTrack: Track = { index: 0, direction: "main", nodes: [] };
  tracks.set(0, mainTrack);

  // BFS 队列：(nodeId, parentTrackIndex, parentDirection)
  // 对于分支根节点，needNewTrack=true 表示需要分配新轨道
  const queue: Array<{
    nodeId: string;
    trackIndex: number;
    needNewTrack: boolean;
  }> = [{ nodeId: rootNodeId, trackIndex: 0, needNewTrack: false }];

  let nextTrackIndex = 1;

  while (queue.length > 0) {
    const { nodeId, trackIndex, needNewTrack } = queue.shift()!;
    const node = allNodes[nodeId];
    if (!node) continue;

    let assignedTrack: number;

    if (needNewTrack) {
      // 创建新轨道，方向左右交替
      const dir: "left" | "right" =
        nextTrackIndex % 2 === 1 ? "right" : "left";
      const newTrack: Track = {
        index: nextTrackIndex,
        direction: dir,
        nodes: [],
      };
      tracks.set(nextTrackIndex, newTrack);
      assignedTrack = nextTrackIndex;
      nextTrackIndex++;
    } else {
      assignedTrack = trackIndex;
    }

    nodeTracks.set(nodeId, assignedTrack);
    const track = tracks.get(assignedTrack);
    if (track) {
      track.nodes.push(nodeId);
    }

    // 子节点：第一个子节点在同一轨道，其余创建新轨道
    for (let i = 0; i < node.childIds.length; i++) {
      const childId = node.childIds[i];
      // 跳过不存在的子节点（数据不一致的防御）
      if (!allNodes[childId]) continue;

      if (i === 0) {
        // 主线延续：同一轨道
        queue.push({
          nodeId: childId,
          trackIndex: assignedTrack,
          needNewTrack: false,
        });
      } else {
        // 分支根：创建新轨道
        queue.push({
          nodeId: childId,
          trackIndex: -1, // 将被重新分配
          needNewTrack: true,
        });
      }
    }
  }

  return { nodeTracks, tracks };
}

// ============================================================
// 子列分配（碰撞避让）
// ============================================================

/**
 * 为相同方向的多个分支轨道分配 subColumn，避免视觉碰撞。
 *
 * 规则：
 * - 主线（track 0）始终 subColumn = 0
 * - 同方向的分支轨道按深度范围排序
 * - 两个轨道的深度范围重叠（间距 < 1 步）时，后者分配到下一个 subColumn
 * - 每个 subColumn 最多容纳一个不重叠的轨道
 */
function assignSubColumns(
  assignment: TrackAssignment,
  allNodes: Record<string, WorldLineNode>
): Map<string, number> {
  const subColumns = new Map<string, number>();

  // 主线所有节点 subColumn = 0
  const mainTrack = assignment.tracks.get(0);
  if (mainTrack) {
    for (const nid of mainTrack.nodes) {
      subColumns.set(nid, 0);
    }
  }

  // 按方向分组分支轨道
  const dirGroups: { dir: "left" | "right"; tracks: Track[] }[] = [
    { dir: "left", tracks: [] },
    { dir: "right", tracks: [] },
  ];

  for (const [, track] of assignment.tracks) {
    if (track.direction === "left") dirGroups[0].tracks.push(track);
    else if (track.direction === "right") dirGroups[1].tracks.push(track);
  }

  for (const { tracks } of dirGroups) {
    if (tracks.length === 0) continue;

    // 按最小深度排序
    tracks.sort((a, b) => {
      const aMin = Math.min(...a.nodes.map((nid) => allNodes[nid]?.stepNumber ?? Infinity));
      const bMin = Math.min(...b.nodes.map((nid) => allNodes[nid]?.stepNumber ?? Infinity));
      return aMin - bMin;
    });

    /**
     * 获取轨道的深度范围 { min, max }
     */
    function getDepthRange(trackNodes: string[]): { min: number; max: number } {
      const depths = trackNodes
        .map((nid) => allNodes[nid]?.stepNumber)
        .filter((d): d is number => d !== undefined && d !== null);
      if (depths.length === 0) return { min: 0, max: 0 };
      return { min: Math.min(...depths), max: Math.max(...depths) };
    }

    // 已分配的 subColumn → 该列占用者的深度范围
    const columnOccupants: { subColumn: number; depthMin: number; depthMax: number }[] = [];

    for (const track of tracks) {
      const range = getDepthRange(track.nodes);

      // 找到第一个不与已有占用者重叠的 subColumn
      let bestSubCol = 0;
      let found = false;
      while (!found) {
        const conflict = columnOccupants.some(
          (occ) =>
            occ.subColumn === bestSubCol &&
            // 重叠判断：间距 < 1 步即视为碰撞
            range.max >= occ.depthMin - 1 &&
            occ.depthMax >= range.min - 1
        );
        if (!conflict) {
          found = true;
        } else {
          bestSubCol++;
        }
      }

      columnOccupants.push({
        subColumn: bestSubCol,
        depthMin: range.min,
        depthMax: range.max,
      });

      // 将轨道所有节点映射到 subColumn
      for (const nid of track.nodes) {
        subColumns.set(nid, bestSubCol);
      }
    }
  }

  return subColumns;
}

// ============================================================
// 坐标计算
// ============================================================

/**
 * 计算所有节点的 (x, y) 坐标。
 *
 * Y 轴：天数由上至下。展开的天每个节点独立占一行，其他天紧凑显示。
 * X 轴：由轨道方向和轨道索引决定。
 */
function computePositions(
  allNodes: Record<string, WorldLineNode>,
  assignment: TrackAssignment,
  expandedDayKey: number | null,
  subColumnMap: Map<string, number>
): {
  layoutNodes: Map<string, LayoutNode>;
  dayColumns: DayColumnLayout[];
} {
  const { nodeTracks, tracks } = assignment;
  const layoutNodes = new Map<string, LayoutNode>();

  // 收集所有节点的 dayNumber
  const nodeDayMap = new Map<string, number>();
  const allNodeIds = new Set(nodeTracks.keys());
  for (const nid of allNodeIds) {
    const node = allNodes[nid];
    if (node) nodeDayMap.set(nid, node.dayNumber);
  }

  // 获取所有天的集合，排序
  const days = new Set<number>();
  for (const day of nodeDayMap.values()) {
    days.add(day);
  }
  const sortedDays = Array.from(days).sort((a, b) => a - b);

  // 确定每个节点在当天内的序号
  const dayNodeGroups = new Map<number, string[]>();
  for (const day of sortedDays) {
    const dayNodeIds: string[] = [];
    for (const nid of allNodeIds) {
      if (nodeDayMap.get(nid) === day) {
        dayNodeIds.push(nid);
      }
    }
    // 按 stepNumber 排序
    dayNodeIds.sort(
      (a, b) =>
        (allNodes[a]?.stepNumber ?? 0) - (allNodes[b]?.stepNumber ?? 0)
    );
    dayNodeGroups.set(day, dayNodeIds);
  }

  // 计算 Y 坐标
  let currentY = LAYOUT.CANVAS_PADDING;
  const dayColumns: DayColumnLayout[] = [];

  for (const day of sortedDays) {
    const dayNodeIds = dayNodeGroups.get(day) ?? [];
    const isExpanded = expandedDayKey === day;

    const dayStartY = currentY;
    currentY += LAYOUT.HEADER_HEIGHT;

    // 当天内节点按 depth(stepNumber) 分组（展开时每个 depth 一行，收起时全部在一行）
    if (isExpanded) {
      // 展开模式：每个节点独立占一行
      for (let i = 0; i < dayNodeIds.length; i++) {
        const nid = dayNodeIds[i];
        const node = allNodes[nid];
        if (!node) continue;

        const trackIndex = nodeTracks.get(nid) ?? 0;
        const track = tracks.get(trackIndex);
        const direction = track?.direction ?? "main";

        const ln: LayoutNode = {
          id: nid,
          day,
          step: i + 1, // 1-based within day
          depth: node.stepNumber,
          parentId: node.parentId,
          childIds: node.childIds,
          trackIndex,
          trackDirection: direction,
          subColumn: subColumnMap.get(nid) ?? 0,
          x: 0, // X 稍后计算
          y: currentY,
        };

        layoutNodes.set(nid, ln);
        currentY += LAYOUT.NODE_SIZE + LAYOUT.NODE_GAP;
      }
    } else {
      // 紧凑模式：所有节点压缩到一行
      for (let i = 0; i < dayNodeIds.length; i++) {
        const nid = dayNodeIds[i];
        const node = allNodes[nid];
        if (!node) continue;

        const trackIndex = nodeTracks.get(nid) ?? 0;
        const track = tracks.get(trackIndex);
        const direction = track?.direction ?? "main";

        const ln: LayoutNode = {
          id: nid,
          day,
          step: i + 1,
          depth: node.stepNumber,
          parentId: node.parentId,
          childIds: node.childIds,
          trackIndex,
          trackDirection: direction,
          subColumn: subColumnMap.get(nid) ?? 0,
          x: 0,
          y: currentY,
        };

        layoutNodes.set(nid, ln);
      }
      currentY += LAYOUT.COMPACT_HEIGHT;
    }

    const dayEndY = currentY;
    currentY += LAYOUT.DAY_GAP;

    dayColumns.push({
      day,
      nodes: dayNodeIds
        .map((nid) => layoutNodes.get(nid)!)
        .filter(Boolean),
      startY: dayStartY,
      endY: dayEndY,
      isExpanded,
    });
  }

  // 计算 X 坐标（使用 subColumn 而非 trackIndex 做列偏移）
  for (const [, ln] of layoutNodes) {
    if (ln.trackDirection === "main") {
      ln.x = 0;
    } else {
      const sign = ln.trackDirection === "left" ? -1 : 1;
      ln.x = sign * (ln.subColumn + 1) * LAYOUT.COL_WIDTH;
    }
  }

  return { layoutNodes, dayColumns };
}

// ============================================================
// 边界计算
// ============================================================

function computeBounds(
  layoutNodes: Map<string, LayoutNode>,
  dayColumns: DayColumnLayout[]
): WorldLineLayout["bounds"] {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  for (const [, ln] of layoutNodes) {
    const halfNode = LAYOUT.NODE_SIZE / 2;
    if (ln.x - halfNode < minX) minX = ln.x - halfNode;
    if (ln.x + halfNode > maxX) maxX = ln.x + halfNode;
    if (ln.y < minY) minY = ln.y;
    if (ln.y + LAYOUT.NODE_SIZE > maxY) maxY = ln.y + LAYOUT.NODE_SIZE;
  }

  // 为 DayHeader 也留空间
  if (dayColumns.length > 0) {
    const firstDay = dayColumns[0];
    if (firstDay.startY < minY) minY = firstDay.startY;
    const lastDay = dayColumns[dayColumns.length - 1];
    if (lastDay.endY > maxY) maxY = lastDay.endY;
  }

  return {
    minX: Math.min(minX, 0),
    maxX: Math.max(maxX, 0),
    minY,
    maxY,
    width: maxX - minX + LAYOUT.CANVAS_PADDING * 2,
    height: maxY - minY + LAYOUT.CANVAS_PADDING,
  };
}

// ============================================================
// 生成连线
// ============================================================

function generateEdges(
  layoutNodes: Map<string, LayoutNode>,
  allNodes: Record<string, WorldLineNode>
): LayoutEdge[] {
  const edges: LayoutEdge[] = [];

  for (const [, ln] of layoutNodes) {
    if (!ln.parentId) continue;
    const parentLn = layoutNodes.get(ln.parentId);
    if (!parentLn) continue;

    const node = allNodes[ln.id];
    if (!node) continue;

    // 父节点底部中心 → 子节点顶部中心
    const parentCenterX = parentLn.x;
    const parentBottomY = parentLn.y + LAYOUT.NODE_SIZE;
    const childCenterX = ln.x;
    const childTopY = ln.y;

    // 同轨道 = 主线连线；不同轨道 = 分支连线
    const type = parentLn.trackIndex === ln.trackIndex ? "main" : "branch";

    edges.push({
      from: parentLn.id,
      to: ln.id,
      fromX: parentCenterX,
      fromY: parentBottomY,
      toX: childCenterX,
      toY: childTopY,
      type,
    });
  }

  return edges;
}

// ============================================================
// 主入口
// ============================================================

/**
 * 计算世界线的 2D 布局。
 *
 * @param allNodes  所有节点（Record<nodeId, WorldLineNode>）
 * @param rootNodeId 根节点 ID
 * @param expandedDayKey 当前展开的天（null = 全部紧凑）
 * @returns 完整的布局结果，包含坐标、连线和天列信息
 */
export function computeWorldLineLayout(
  allNodes: Record<string, WorldLineNode>,
  rootNodeId: string,
  expandedDayKey: number | null = null
): WorldLineLayout {
  // 空树防御
  if (!rootNodeId || Object.keys(allNodes).length === 0) {
    return {
      nodes: [],
      edges: [],
      dayColumns: [],
      bounds: { minX: 0, maxX: 0, minY: 0, maxY: 0, width: 0, height: 0 },
    };
  }

  // 1. 分配轨道
  const assignment = assignTracks(allNodes, rootNodeId);

  // 1.5. 分配子列（碰撞避让）
  const subColumnMap = assignSubColumns(assignment, allNodes);

  // 2. 计算坐标
  const { layoutNodes, dayColumns } = computePositions(
    allNodes,
    assignment,
    expandedDayKey,
    subColumnMap
  );

  // 3. 生成连线
  const edges = generateEdges(layoutNodes, allNodes);

  // 4. 计算边界
  const bounds = computeBounds(layoutNodes, dayColumns);

  // 5. 收集结果
  const nodes: LayoutNode[] = Array.from(layoutNodes.values());

  return { nodes, edges, dayColumns, bounds };
}
