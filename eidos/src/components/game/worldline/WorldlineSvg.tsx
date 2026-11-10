"use client";
import { useInterfaceText } from "@/components/shell/useInterfaceText";


// ============================================================
// WorldlineSvg — fixed viewport coordinate renderer
// ============================================================
// The canvas behaves like a graphing surface: the paper is fixed
// to the interface, while world coordinates are projected into it.
// ============================================================

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  WheelEvent as ReactWheelEvent,
} from "react";
import type { GeoBar, WorldlineGeometry } from "@/lib/game/worldline-geometry";
import { GEO } from "@/lib/game/worldline-geometry";
import {
  buildVisibleTicks,
  chooseNiceStep,
  clamp,
  createViewportTransform,
  fitWorldViewport,
  getVisibleWorldRect,
  zoomViewportAt,
  type Point,
  type Rect,
  type ViewportState,
  type WorldRect,
} from "./worldline-viewport";
import { buildStepRulerMarkers } from "./worldline-interactions";

interface Props {
  geometry: WorldlineGeometry;
  expandedDay?: number | null;
  onExpandDay: (day: number, centerStep: number) => void;
  onViewportCenter?: (day: number, centerStep: number) => void;
  onSelectNode: (nodeId: string) => void;
  focusTarget?: { nodeId: string; request: number } | null;
  /** When supplied, the parent owns the fit button and increments this on an explicit request. */
  fitRequest?: number;
}

const TRACK_UNIT = GEO.GUIDE_SPACING;
const MIN_SCALE = .01;
const MAX_SCALE = 220;
const RULER_SIZE = 36;
const GRID_BUFFER_UNITS = 3;
const STEP_LABEL_MIN_SCALE = 80;
const STEP_LABEL_OFFSET_PX = 8;
const STEP_LABEL_BASELINE_OFFSET_PX = 4;
const STEP_LABEL_FONT_SIZE_PX = 11;
const STEP_LABEL_HITBOX_WIDTH_PX = 34;
const STEP_LABEL_HITBOX_HEIGHT_PX = 18;
const STEP_LABEL_HITBOX_X_OFFSET_PX = -6;
const STEP_LABEL_HITBOX_Y_OFFSET_PX = -10;
const STEP_RULER_MIN_GAP_PX = 13;
const ACCENT = "var(--eidos-accent)";
const ACCENT_SOFT = "color-mix(in srgb, var(--eidos-accent) 48%, transparent)";
const ACCENT_FAINT = "color-mix(in srgb, var(--eidos-accent) 12%, transparent)";

interface SemanticBar extends GeoBar {
  branchDirections: Array<"left" | "right">;
  trackX: number;
  centerX: number;
  y: number;
  leftDashStartX: number;
  leftDashEndX: number;
  rightDashStartX: number;
  rightDashEndX: number;
}

interface SemanticGuide {
  id: string;
  x: number;
  minY: number;
  maxY: number;
  isMain: boolean;
}

interface SemanticBranch {
  id: string;
  from: Point;
  to: Point;
  direction: "left" | "right";
  isCurrent: boolean;
}

interface SemanticDayFrame {
  id: string;
  dayNumber: number;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  labelX: number;
}

interface SemanticWorldline {
  bars: SemanticBar[];
  guides: SemanticGuide[];
  branches: SemanticBranch[];
  dayFrames: SemanticDayFrame[];
  stepLabels: Array<{ nodeId: string; stepNumber: number; guideX: number; y: number; isCurrent: boolean }>;
  bounds: WorldRect;
}

function barColor(isCurrent: boolean, isSelected: boolean): string {
  if (isSelected) return ACCENT;
  if (isCurrent) return "var(--eidos-worldline-current)";
  return "var(--eidos-worldline-bar)";
}

function branchColor(isCurrent: boolean): string {
  return isCurrent ? ACCENT_SOFT : "var(--eidos-worldline-guide-soft)";
}

function formatTick(value: number): string {
  if (Math.abs(value) < 0.000001) return "0";
  if (Math.abs(value - Math.round(value)) < 0.000001) return String(Math.round(value));
  return value.toFixed(1);
}

function localPoint(container: HTMLDivElement, point: { clientX: number; clientY: number }): Point {
  const rect = container.getBoundingClientRect();
  return { x: point.clientX - rect.left, y: point.clientY - rect.top };
}

function intersects(a: WorldRect, b: WorldRect): boolean {
  return a.maxX >= b.minX && a.minX <= b.maxX && a.maxY >= b.minY && a.minY <= b.maxY;
}

function semanticX(value: number): number {
  return value / TRACK_UNIT;
}

function semanticY(geometryY: number): number {
  return (geometryY - GEO.CANVAS_PAD) / TRACK_UNIT;
}

function nearestStepForY(bars: SemanticBar[], y: number): number {
  let bestStep = 0;
  let bestDistance = Infinity;
  for (const bar of bars) {
    const distance = Math.abs(bar.y - y);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestStep = bar.stepNumber;
    }
  }
  return bestStep;
}

function semanticBar(bar: GeoBar): SemanticBar {
  return {
    ...bar,
    branchDirections: [],
    trackX: semanticX(bar.guideX),
    centerX: semanticX(bar.guideX + GEO.GAP_W / 2),
    y: semanticY(bar.y),
    leftDashStartX: semanticX(bar.guideX - GEO.DASH_W),
    leftDashEndX: semanticX(bar.guideX),
    rightDashStartX: semanticX(bar.guideX + GEO.GAP_W),
    rightDashEndX: semanticX(bar.guideX + GEO.GAP_W + GEO.DASH_W),
  };
}

function buildSemanticWorldline(geometry: WorldlineGeometry): SemanticWorldline {
  const bars = geometry.bars.map(semanticBar);
  const barsByNode = new Map(bars.map((bar) => [bar.nodeId, bar]));
  const trackStarts = new Map<number, number>();
  for (const conn of geometry.branchConns) {
    const parent = barsByNode.get(conn.fromNodeId);
    if (parent) trackStarts.set(conn.toGuideX, parent.y);
  }

  // One fork can open on both sides; its hints must follow actual destination tracks.
  for (const conn of geometry.branchConns) {
    const bar = barsByNode.get(conn.fromNodeId);
    const direction = conn.toGuideX < conn.fromX ? "left" : "right";
    if (bar && !bar.branchDirections.includes(direction)) bar.branchDirections.push(direction);
  }

  const guides = geometry.guideLines.map((guide) => {
    const guideBars = bars.filter((bar) => bar.guideX === guide.x);
    const ys = guideBars.length > 0 ? guideBars.map((bar) => bar.y) : [0];
    return {
      id: guide.id,
      x: semanticX(guide.x),
      // Decorative padding must not extend a child rail above its own fork.
      minY: Math.max(Math.min(...ys) - 0.45, trackStarts.get(guide.x) ?? -Infinity),
      maxY: Math.max(...ys) + 0.45,
      isMain: guide.isMain,
    };
  });

  const branches = geometry.branchConns.flatMap((conn, index): SemanticBranch[] => {
    const fromBar = barsByNode.get(conn.fromNodeId);
    const toBar = barsByNode.get(conn.toNodeId);
    if (!fromBar || !toBar) return [];
    return [{
      id: `${conn.fromNodeId}-${conn.toNodeId}-${index}`,
      from: { x: semanticX(conn.fromX), y: fromBar.y },
      to: { x: semanticX(conn.toGuideX), y: toBar.y },
      direction: conn.direction,
      isCurrent: conn.isCurrent,
    }];
  });

  const dayFrameMap = new Map<string, SemanticDayFrame>();
  for (const bar of bars) {
    const key = `${bar.dayNumber}:${bar.trackX}`;
    const start = trackStarts.get(bar.guideX);
    const minY = Math.max(bar.y - 0.36, start === undefined ? -Infinity : start + 0.02);
    const previous = dayFrameMap.get(key);
    const next: SemanticDayFrame = previous ?? {
      id: key,
      dayNumber: bar.dayNumber,
      minX: bar.leftDashStartX - 0.08,
      maxX: bar.rightDashEndX + 0.08,
      minY,
      maxY: bar.y + 0.36,
      labelX: bar.centerX,
    };

    next.minX = Math.min(next.minX, bar.leftDashStartX - 0.08);
    next.maxX = Math.max(next.maxX, bar.rightDashEndX + 0.08);
    next.minY = Math.min(next.minY, minY);
    next.maxY = Math.max(next.maxY, bar.y + 0.36);
    dayFrameMap.set(key, next);
  }

  const dayFrames = [...dayFrameMap.values()];
  const stepLabels = geometry.stepLabels.flatMap((label) => {
    const bar = barsByNode.get(label.nodeId);
    if (!bar) return [];
    return [{
      nodeId: label.nodeId,
      stepNumber: label.stepNumber,
      guideX: semanticX(label.guideX),
      y: bar.y,
      isCurrent: label.isCurrent,
    }];
  });

  const xs = bars.length ? [
    ...bars.flatMap(bar => [bar.leftDashStartX, bar.rightDashEndX]),
    ...dayFrames.flatMap(frame => [frame.minX, frame.maxX]),
    ...branches.flatMap(branch => [branch.from.x, branch.to.x]),
  ] : [0, 1];
  const ys = bars.length ? [
    ...guides.flatMap(guide => [guide.minY, guide.maxY]),
    ...dayFrames.flatMap(frame => [frame.minY, frame.maxY]),
    ...branches.flatMap(branch => [branch.from.y, branch.to.y]),
  ] : [0, 1];

  return { bars, guides, branches, dayFrames, stepLabels, bounds: {
    minX: Math.min(...xs), maxX: Math.max(...xs),
    minY: Math.min(...ys), maxY: Math.max(...ys),
  } };
}

function semanticRectForFrame(frame: SemanticDayFrame): WorldRect {
  return { minX: frame.minX, maxX: frame.maxX, minY: frame.minY, maxY: frame.maxY };
}

function renderCutRectPath(x1: number, y1: number, x2: number, y2: number, cut = 8): string {
  const c = Math.min(cut, Math.max(0, (x2 - x1) / 3), Math.max(0, (y2 - y1) / 3));
  return `M ${x1 + c} ${y1} H ${x2} V ${y2 - c} L ${x2 - c} ${y2} H ${x1} V ${y1 + c} Z`;
}

export function WorldlineSvg({
  geometry,
  expandedDay = null,
  onExpandDay,
  onViewportCenter,
  onSelectNode,
  focusTarget,
  fitRequest,
}: Props) {
  const ui = useInterfaceText();
  const containerRef = useRef<HTMLDivElement>(null);
  const measuredSize = useRef({ width: 0, height: 0 });
  const dragStart = useRef<{ pointerId: number; x: number; y: number; origin: Point } | null>(null);
  const touches = useRef(new Map<number, Point>());
  const suppressTouchClick = useRef(false);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [viewport, setViewport] = useState<ViewportState | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [focusedTarget, setFocusedTarget] = useState<Props['focusTarget']>(null);
  const [fittedRequest, setFittedRequest] = useState(fitRequest);

  const semantic = useMemo(() => buildSemanticWorldline(geometry), [geometry]);
  const plotRect = useMemo<Rect>(() => ({
    x: RULER_SIZE,
    y: RULER_SIZE,
    width: Math.max(0, size.width - RULER_SIZE),
    height: Math.max(0, size.height - RULER_SIZE),
  }), [size.height, size.width]);

  const initialViewport = useMemo<ViewportState>(() => {
    const bar = semantic.bars.find(item => item.isCurrent) ?? semantic.bars[0];
    return { scale: MAX_SCALE, origin: {
      x: plotRect.width / 2 - (bar?.centerX ?? 0) * MAX_SCALE,
      y: plotRect.height / 2 - (bar?.y ?? 0) * MAX_SCALE,
    } };
  }, [plotRect, semantic]);

  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;

    const updateSize = () => {
      const rect = node.getBoundingClientRect();
      const previous = measuredSize.current;
      if (rect.width === previous.width && rect.height === previous.height) return;
      if (previous.width > 0 && previous.height > 0) {
        // Resizing the split pane must preserve the graph's world-space center.
        setViewport(current => current ? { ...current, origin: {
          x: current.origin.x + (rect.width - previous.width) / 2,
          y: current.origin.y + (rect.height - previous.height) / 2,
        } } : null);
      }
      measuredSize.current = { width: rect.width, height: rect.height };
      setSize({ width: rect.width, height: rect.height });
    };

    updateSize();
    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(updateSize);
      observer.observe(node);
      return () => observer.disconnect();
    }
    window.addEventListener("resize", updateSize);
    return () => window.removeEventListener("resize", updateSize);
  }, []);

  const handleFit = useCallback(() => {
    if (plotRect.width <= 0 || plotRect.height <= 0) return;
    setViewport(fitWorldViewport({ plotRect, bounds: semantic.bounds, minScale: MIN_SCALE, maxScale: MAX_SCALE }));
  }, [plotRect, semantic.bounds]);

  const handleWheel = useCallback((event: ReactWheelEvent<HTMLDivElement>) => {
    if (plotRect.width <= 0 || plotRect.height <= 0) return;
    event.preventDefault();
    const node = containerRef.current;
    if (!node) return;
    const screenPoint = localPoint(node, event);

    if (event.ctrlKey || event.metaKey) {
      const factor = Math.exp(-event.deltaY * 0.01);
      setViewport((current) => {
        const active = current ?? initialViewport;
        return zoomViewportAt({
          plotRect,
          viewport: active,
          screenPoint,
          factor,
          minScale: MIN_SCALE,
          maxScale: MAX_SCALE,
        });
      });
      return;
    }

    setViewport((current) => {
      const active = current ?? initialViewport;
      return {
        ...active,
        origin: {
          x: active.origin.x - event.deltaX,
          y: active.origin.y - event.deltaY,
        },
      };
    });
  }, [plotRect, initialViewport]);

  const handlePointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const target = event.target as Element;
    if (target.closest('button')) return;
    const interactive = Boolean(target.closest("[data-worldline-interactive='true'], button"));
    if (event.pointerType !== 'touch') suppressTouchClick.current = false;
    if (event.pointerType === 'touch' && !target.closest('button')) {
      if (!touches.current.size) suppressTouchClick.current = false;
      touches.current.set(event.pointerId, localPoint(event.currentTarget, event));
      if (touches.current.size >= 2) {
        dragStart.current = null; suppressTouchClick.current = true;
        event.currentTarget.setPointerCapture(event.pointerId); setIsDragging(true); return;
      }
    }
    if (interactive && event.pointerType !== 'touch') return;
    if (plotRect.width <= 0 || plotRect.height <= 0) return;
    const active = viewport ?? initialViewport;

    // Keep a simple node tap targeted at the node; touch implicitly captures its original target.
    if (!interactive) event.currentTarget.setPointerCapture(event.pointerId);
    dragStart.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      origin: active.origin,
    };
    setIsDragging(true);
  }, [plotRect, viewport, initialViewport]);

  const handlePointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'touch' && touches.current.has(event.pointerId)) {
      const before = [...touches.current.values()];
      touches.current.set(event.pointerId, localPoint(event.currentTarget, event));
      const after = [...touches.current.values()];
      if (before.length >= 2) {
        event.preventDefault();
        const distance = (points: Point[]) => Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y);
        const center = (points: Point[]) => ({ x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2 });
        const oldCenter = center(before), nextCenter = center(after), oldDistance = distance(before);
        if (oldDistance > 0) setViewport(current => {
          const zoomed = zoomViewportAt({ plotRect, viewport: current ?? initialViewport, screenPoint: oldCenter,
            factor: distance(after) / oldDistance, minScale: MIN_SCALE, maxScale: MAX_SCALE });
          return { ...zoomed, origin: { x: zoomed.origin.x + nextCenter.x - oldCenter.x, y: zoomed.origin.y + nextCenter.y - oldCenter.y } };
        });
        return;
      }
    }
    const drag = dragStart.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (event.pointerType === 'touch' && Math.hypot(event.clientX - drag.x, event.clientY - drag.y) > 6) suppressTouchClick.current = true;

    setViewport((current) => {
      const active = current ?? initialViewport;
      return {
        ...active,
        origin: {
          x: drag.origin.x + event.clientX - drag.x,
          y: drag.origin.y + event.clientY - drag.y,
        },
      };
    });
  }, [initialViewport, plotRect]);

  const handlePointerUp = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'touch') {
      touches.current.delete(event.pointerId);
      if (touches.current.size === 1) {
        const [pointerId, point] = [...touches.current][0];
        const bounds = event.currentTarget.getBoundingClientRect();
        dragStart.current = { pointerId, x: point.x + bounds.left, y: point.y + bounds.top, origin: (viewport ?? initialViewport).origin };
        return;
      }
    }
    const drag = dragStart.current;
    if (drag?.pointerId === event.pointerId) {
      dragStart.current = null;
      setIsDragging(false);
    }
  }, [viewport, initialViewport]);

  const activeViewport = viewport ?? initialViewport;

  // An explicit fit resets framing; resizing the split pane keeps the existing pan and zoom.
  if (fitRequest !== undefined && fittedRequest !== fitRequest && plotRect.width > 0 && plotRect.height > 0) {
    setFittedRequest(fitRequest);
    setViewport(fitWorldViewport({ plotRect, bounds: semantic.bounds, minScale: MIN_SCALE, maxScale: MAX_SCALE }));
  }

  // Apply explicit navigation before painting; ordinary selection/geometry updates keep the player's pan.
  if (focusTarget && focusedTarget !== focusTarget && plotRect.width > 0 && plotRect.height > 0) {
    const bar = semantic.bars.find(candidate => candidate.nodeId === focusTarget.nodeId);
    if (bar) {
      setFocusedTarget(focusTarget);
      setViewport(previous => {
        const active = previous ?? initialViewport;
        return { ...active, origin: { x: plotRect.width / 2 - bar.centerX * active.scale, y: plotRect.height / 2 - bar.y * active.scale } };
      });
    }
  }
  const transform = createViewportTransform({ plotRect, ...activeViewport });
  const visibleWorld = getVisibleWorldRect({ plotRect, viewport: activeViewport, bufferWorld: GRID_BUFFER_UNITS });
  const majorStep = chooseNiceStep(activeViewport.scale, 92);
  const xTicks = buildVisibleTicks({ min: visibleWorld.minX, max: visibleWorld.maxX, step: majorStep });
  const yTicks = buildVisibleTicks({ min: visibleWorld.minY, max: visibleWorld.maxY, step: majorStep });
  const xMinorTicks = buildVisibleTicks({ min: visibleWorld.minX, max: visibleWorld.maxX, step: majorStep / 5 });
  const yMinorTicks = buildVisibleTicks({ min: visibleWorld.minY, max: visibleWorld.maxY, step: majorStep / 5 });
  const visibleBars = semantic.bars.filter((bar) => intersects(
    { minX: bar.leftDashStartX - 0.7, maxX: bar.rightDashEndX + 0.7, minY: bar.y - 0.8, maxY: bar.y + 0.8 },
    visibleWorld
  ));
  const visibleFrames = semantic.dayFrames.filter((frame) => intersects(semanticRectForFrame(frame), visibleWorld));
  const visibleBranches = semantic.branches.filter((branch) => intersects({
    minX: Math.min(branch.from.x, branch.to.x) - 1,
    maxX: Math.max(branch.from.x, branch.to.x) + 1,
    minY: Math.min(branch.from.y, branch.to.y) - 1,
    maxY: Math.max(branch.from.y, branch.to.y) + 1,
  }, visibleWorld));
  const visibleGuides = semantic.guides.filter((guide) => intersects({
    minX: guide.x - 0.1,
    maxX: guide.x + 0.1,
    minY: guide.minY,
    maxY: guide.maxY,
  }, visibleWorld));
  const xAxisY = transform.worldToScreen({ x: 0, y: 0 }).y;
  const yAxisX = transform.worldToScreen({ x: 0, y: 0 }).x;
  const showXAxis = xAxisY >= plotRect.y && xAxisY <= plotRect.y + plotRect.height;
  const showYAxis = yAxisX >= plotRect.x && yAxisX <= plotRect.x + plotRect.width;
  const barThickness = clamp(activeViewport.scale * semanticX(GEO.THICKNESS), 2, 4.5);
  const nodeRadius = clamp(activeViewport.scale * 0.05, 3.5, 6.5);
  const showStepLabels = activeViewport.scale >= STEP_LABEL_MIN_SCALE;
  const yStepMarkers = buildStepRulerMarkers({
    expandedDay,
    minGapPx: STEP_RULER_MIN_GAP_PX,
    tickYs: yTicks.map((tick) => transform.worldToScreen({ x: 0, y: tick }).y),
    bars: visibleBars.map((bar) => ({
      dayNumber: bar.dayNumber,
      stepNumber: bar.stepNumber,
      nodeId: bar.nodeId,
      y: transform.worldToScreen({ x: 0, y: bar.y }).y,
    })),
  });

  useEffect(() => {
    if (expandedDay === null || !onViewportCenter) return;
    if (plotRect.width <= 0 || plotRect.height <= 0) return;
    const viewportTransform = createViewportTransform({ plotRect, ...activeViewport });
    const centerWorld = viewportTransform.screenToWorld({
      x: plotRect.x + plotRect.width / 2,
      y: plotRect.y + plotRect.height / 2,
    });
    const dayBars = semantic.bars.filter((bar) => bar.dayNumber === expandedDay);
    if (dayBars.length === 0) return;
    onViewportCenter(expandedDay, nearestStepForY(dayBars, centerWorld.y));
  }, [activeViewport, expandedDay, onViewportCenter, plotRect, semantic.bars]);

  if (semantic.bars.length === 0) {
    return (
      <div className="eidos-worldline-canvas flex-1 flex items-center justify-center bg-transparent">
        <p className="text-sm text-zinc-500">{ui("还没有世界线数据")}</p>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      data-worldline-scale={activeViewport.scale}
      className={`eidos-worldline-canvas relative flex-1 overflow-hidden bg-transparent ${isDragging ? "cursor-grabbing select-none" : "cursor-grab"}`}
      onWheel={handleWheel}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onClickCapture={event => {
        // Releasing a pinch must not select a node under the fingers.
        if (suppressTouchClick.current && event.detail > 0) { event.preventDefault(); event.stopPropagation(); suppressTouchClick.current = false; }
      }}
    >
      {fitRequest === undefined && <button
        type="button"
        className="eidos-worldline-fit eidos-focus"
        onClick={handleFit}
      >
        {ui("适应视图")}</button>}
      <svg width="100%" height="100%" className="block">
        <defs>
          <clipPath id="worldline-plot-clip">
            <rect x={plotRect.x} y={plotRect.y} width={plotRect.width} height={plotRect.height} />
          </clipPath>
        </defs>

        <rect x={0} y={0} width={size.width} height={size.height} fill="var(--eidos-worldline-canvas-fill)" />
        <rect x={plotRect.x} y={plotRect.y} width={plotRect.width} height={plotRect.height} fill="transparent" />

        <g clipPath="url(#worldline-plot-clip)">
          {xMinorTicks.map((tick) => {
            const x = transform.worldToScreen({ x: tick, y: 0 }).x;
            return (
              <line
                key={`xm-${tick}`}
                x1={x}
                y1={plotRect.y}
                x2={x}
                y2={plotRect.y + plotRect.height}
                stroke="var(--eidos-worldline-grid)"
                strokeWidth={0.7}
              />
            );
          })}
          {yMinorTicks.map((tick) => {
            const y = transform.worldToScreen({ x: 0, y: tick }).y;
            return (
              <line
                key={`ym-${tick}`}
                x1={plotRect.x}
                y1={y}
                x2={plotRect.x + plotRect.width}
                y2={y}
                stroke="var(--eidos-worldline-grid)"
                strokeWidth={0.7}
              />
            );
          })}
          {xTicks.map((tick) => {
            const x = transform.worldToScreen({ x: tick, y: 0 }).x;
            return (
              <line
                key={`x-${tick}`}
                x1={x}
                y1={plotRect.y}
                x2={x}
                y2={plotRect.y + plotRect.height}
                stroke="var(--eidos-worldline-guide-soft)"
                strokeWidth={1}
              />
            );
          })}
          {yTicks.map((tick) => {
            const y = transform.worldToScreen({ x: 0, y: tick }).y;
            return (
              <line
                key={`y-${tick}`}
                x1={plotRect.x}
                y1={y}
                x2={plotRect.x + plotRect.width}
                y2={y}
                stroke="var(--eidos-worldline-guide-soft)"
                strokeWidth={1}
              />
            );
          })}

          {showXAxis && (
            <g>
              <line
                x1={plotRect.x}
                y1={xAxisY}
                x2={plotRect.x + plotRect.width - 9}
                y2={xAxisY}
                stroke="var(--eidos-worldline-label-strong)"
                strokeWidth={1.15}
              />
              <path
                d={`M ${plotRect.x + plotRect.width - 2} ${xAxisY} L ${plotRect.x + plotRect.width - 11} ${xAxisY - 4} L ${plotRect.x + plotRect.width - 11} ${xAxisY + 4} Z`}
                fill="var(--eidos-worldline-label-strong)"
                opacity={0.75}
              />
            </g>
          )}
          {showYAxis && (
            <g>
              <line
                x1={yAxisX}
                y1={plotRect.y}
                x2={yAxisX}
                y2={plotRect.y + plotRect.height - 9}
                stroke="var(--eidos-worldline-label-strong)"
                strokeWidth={1.15}
              />
              <path
                d={`M ${yAxisX} ${plotRect.y + plotRect.height - 2} L ${yAxisX - 4} ${plotRect.y + plotRect.height - 11} L ${yAxisX + 4} ${plotRect.y + plotRect.height - 11} Z`}
                fill="var(--eidos-worldline-label-strong)"
                opacity={0.75}
              />
            </g>
          )}

          {visibleGuides.map((guide) => {
            const x = transform.worldToScreen({ x: guide.x, y: 0 }).x;
            const y1 = transform.worldToScreen({ x: guide.x, y: guide.minY }).y;
            const y2 = transform.worldToScreen({ x: guide.x, y: guide.maxY }).y;
            return (
              <g key={guide.id} data-worldline-guide={guide.id}>
                <line
                  x1={x}
                  y1={y1}
                  x2={x}
                  y2={y2}
                  stroke={guide.isMain ? "var(--eidos-worldline-guide)" : "var(--eidos-worldline-guide-soft)"}
                  strokeWidth={guide.isMain ? 1.4 : 1}
                  strokeDasharray={guide.isMain ? undefined : "4 6"}
                />
                {guide.isMain && (
                  <line
                    x1={x + activeViewport.scale * semanticX(GEO.GAP_W / 2)}
                    y1={y1}
                    x2={x + activeViewport.scale * semanticX(GEO.GAP_W / 2)}
                    y2={y2}
                    stroke={ACCENT_FAINT}
                    strokeWidth={1}
                  />
                )}
              </g>
            );
          })}

          {visibleBranches.map((branch) => {
            const from = transform.worldToScreen(branch.from);
            const to = transform.worldToScreen(branch.to);
            const d = `M ${from.x} ${from.y} H ${to.x} V ${to.y}`;
            return (
              <path
                key={branch.id}
                d={d}
                stroke={branchColor(branch.isCurrent)}
                strokeWidth={branch.isCurrent ? 1.6 : 1}
                strokeDasharray={branch.isCurrent ? undefined : "5 5"}
                fill="none"
              />
            );
          })}

          {visibleFrames.map((frame) => {
            const topLeft = transform.worldToScreen({ x: frame.minX, y: frame.minY });
            const bottomRight = transform.worldToScreen({ x: frame.maxX, y: frame.maxY });
            const path = renderCutRectPath(topLeft.x, topLeft.y, bottomRight.x, bottomRight.y, 7);
            return (
              <g key={frame.id} data-worldline-frame={frame.id} data-worldline-interactive="true">
                <path
                  d={path}
                  fill="var(--eidos-worldline-frame-fill)"
                  stroke="var(--eidos-worldline-frame-stroke)"
                  strokeWidth={1}
                  className="eidos-worldline-clickrect cursor-pointer transition-colors"
                  onClick={(event: ReactMouseEvent<SVGPathElement>) => {
                    const node = containerRef.current;
                    if (!node) return;
                    const point = localPoint(node, event);
                    const world = transform.screenToWorld(point);
                    const dayBars = semantic.bars.filter((bar) => bar.dayNumber === frame.dayNumber);
                    setViewport(activeViewport);
                    onExpandDay(frame.dayNumber, nearestStepForY(dayBars.length > 0 ? dayBars : semantic.bars, world.y));
                  }}
                />
                {bottomRight.y - topLeft.y > 26 && (
                  <text
                    x={transform.worldToScreen({ x: frame.labelX, y: frame.maxY }).x}
                    y={bottomRight.y + 14}
                    textAnchor="middle"
                    fill="var(--eidos-worldline-label)"
                    fontSize={11}
                    fontFamily="monospace"
                    className="pointer-events-none"
                  >
                    {ui("第")}{frame.dayNumber}{ui("天")}</text>
                )}
              </g>
            );
          })}

          {visibleBars.map((bar) => {
            const leftDashStart = transform.worldToScreen({ x: bar.leftDashStartX, y: bar.y });
            const leftDashEnd = transform.worldToScreen({ x: bar.leftDashEndX, y: bar.y });
            const rightDashStart = transform.worldToScreen({ x: bar.rightDashStartX, y: bar.y });
            const rightDashEnd = transform.worldToScreen({ x: bar.rightDashEndX, y: bar.y });
            const center = transform.worldToScreen({ x: bar.centerX, y: bar.y });
            const color = barColor(bar.isCurrent, bar.isSelected);
            return (
              <g
                key={bar.nodeId}
                data-node-id={bar.nodeId}
                data-worldline-interactive="true"
                className="cursor-pointer"
                role="button"
                aria-label={ui("第{0}步，第{1}天{2}", {"0": bar.stepNumber, "1": bar.dayNumber, "2": bar.isCurrent ? ui("，当前进度") : ""})}
                aria-pressed={bar.isSelected}
                tabIndex={center.y >= plotRect.y && center.y <= plotRect.y + plotRect.height && center.x >= plotRect.x && center.x <= plotRect.x + plotRect.width ? 0 : -1}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" && event.key !== " ") return;
                  event.preventDefault();
                  event.stopPropagation();
                  onSelectNode(bar.nodeId);
                }}
                onClick={(event) => {
                  event.stopPropagation();
                  onSelectNode(bar.nodeId);
                }}
              >
                <title>{ui("第{0}步 · 第{1}天{2}", {"0": bar.stepNumber, "1": bar.dayNumber, "2": bar.isCurrent ? ui(" · 当前进度") : ""})}</title>
                {(bar.isCurrent || bar.isSelected) && (
                  <>
                    <circle
                      cx={center.x}
                      cy={center.y}
                      r={nodeRadius + 3}
                      fill="transparent"
                      stroke={bar.isCurrent ? "var(--eidos-worldline-current)" : ACCENT}
                      strokeWidth={1.25}
                    />
                    <circle
                      cx={center.x}
                      cy={center.y}
                      r={nodeRadius}
                      fill={bar.isSelected ? ACCENT : "var(--eidos-worldline-current)"}
                    />
                  </>
                )}
                {bar.branchDirections.map((direction) => {
                  const edgeX = direction === "left" ? leftDashStart.x - 7 : rightDashEnd.x + 7;
                  const tipX = edgeX + (direction === "left" ? -8 : 8);
                  return (
                  <path
                    key={direction}
                    data-branch-direction={direction}
                    d={`M ${edgeX} ${center.y - 5} L ${tipX} ${center.y} L ${edgeX} ${center.y + 5}`}
                    fill="none"
                    stroke={ACCENT_SOFT}
                    strokeWidth={1.2}
                    className="pointer-events-none"
                  />
                  );
                })}
                <rect
                  x={Math.min(leftDashStart.x, leftDashEnd.x)}
                  y={center.y - barThickness / 2}
                  width={Math.abs(leftDashEnd.x - leftDashStart.x)}
                  height={barThickness}
                  fill={color}
                />
                <rect
                  x={Math.min(rightDashStart.x, rightDashEnd.x)}
                  y={center.y - barThickness / 2}
                  width={Math.abs(rightDashEnd.x - rightDashStart.x)}
                  height={barThickness}
                  fill={color}
                />
              </g>
            );
          })}

          {showStepLabels && semantic.stepLabels.map((label) => {
            // gapCenter = guideX + GAP_W/2（语义坐标）→ 屏幕坐标，即左"−"和右"−"的正中间
            const gapCenterX = label.guideX + GEO.GAP_W / TRACK_UNIT / 2;
            const point = transform.worldToScreen({ x: gapCenterX, y: label.y });
            const labelX = point.x;
            const labelY = point.y + STEP_LABEL_BASELINE_OFFSET_PX;
            const hitboxX = point.x - STEP_LABEL_HITBOX_WIDTH_PX / 2;
            const hitboxY = point.y + STEP_LABEL_HITBOX_Y_OFFSET_PX;
            if (
              hitboxX > plotRect.x + plotRect.width ||
              hitboxX + STEP_LABEL_HITBOX_WIDTH_PX < plotRect.x ||
              hitboxY > plotRect.y + plotRect.height ||
              hitboxY + STEP_LABEL_HITBOX_HEIGHT_PX < plotRect.y
            ) return null;
            return (
              <g
                key={`label-${label.nodeId}`}
                data-worldline-interactive="true"
                className="cursor-pointer"
                onClick={(event) => {
                  event.stopPropagation();
                  onSelectNode(label.nodeId);
                }}
              >
                <rect
                  x={hitboxX}
                  y={hitboxY}
                  width={STEP_LABEL_HITBOX_WIDTH_PX}
                  height={STEP_LABEL_HITBOX_HEIGHT_PX}
                  fill="transparent"
                />
                <text
                  x={labelX}
                  y={labelY}
                  textAnchor="middle"
                  fill={label.isCurrent ? ACCENT : "var(--eidos-worldline-label-strong)"}
                  fontSize={STEP_LABEL_FONT_SIZE_PX}
                  fontFamily="monospace"
                  pointerEvents="none"
                >
                  {label.stepNumber}
                </text>
              </g>
            );
          })}
        </g>

        <g className="pointer-events-none">
          <rect data-worldline-ruler="top" x={plotRect.x} y={0} width={plotRect.width} height={RULER_SIZE} fill="var(--eidos-worldline-ruler-fill)" />
          <rect data-worldline-ruler="left" x={0} y={plotRect.y} width={RULER_SIZE} height={plotRect.height} fill="var(--eidos-worldline-ruler-fill)" />
          <rect x={0} y={0} width={RULER_SIZE} height={RULER_SIZE} fill="var(--eidos-worldline-ruler-corner)" />
          <line x1={plotRect.x} y1={RULER_SIZE - 0.5} x2={plotRect.x + plotRect.width} y2={RULER_SIZE - 0.5} stroke="var(--eidos-worldline-frame-stroke)" />
          <line x1={RULER_SIZE - 0.5} y1={plotRect.y} x2={RULER_SIZE - 0.5} y2={plotRect.y + plotRect.height} stroke="var(--eidos-worldline-frame-stroke)" />

          {xTicks.map((tick) => {
            const x = transform.worldToScreen({ x: tick, y: 0 }).x;
            if (x < plotRect.x || x > plotRect.x + plotRect.width) return null;
            return (
              <g key={`xr-${tick}`}>
                <line x1={x} y1={RULER_SIZE - 9} x2={x} y2={RULER_SIZE} stroke="var(--eidos-worldline-label)" />
                <text
                  x={x}
                  y={RULER_SIZE / 2 + 3.5}
                  textAnchor="middle"
                  fill="var(--eidos-worldline-label-strong)"
                  fontSize={10}
                  fontFamily="monospace"
                >
                  {formatTick(tick)}
                </text>
              </g>
            );
          })}

          {yStepMarkers.map((marker) => {
            if (marker.y < plotRect.y || marker.y > plotRect.y + plotRect.height) return null;
            return (
              <g key={`yr-step-${marker.key}`}>
                <line x1={RULER_SIZE - 9} y1={marker.y} x2={RULER_SIZE} y2={marker.y} stroke="var(--eidos-worldline-label)" />
                <text
                  x={RULER_SIZE - 13}
                  y={marker.y + 3.5}
                  textLength={String(marker.stepNumber).length > 3 ? RULER_SIZE - 14 : undefined}
                  lengthAdjust="spacingAndGlyphs"
                  textAnchor="end"
                  fill="var(--eidos-worldline-label-strong)"
                  fontSize={10}
                  fontFamily="monospace"
                >
                  {marker.stepNumber}
                </text>
              </g>
            );
          })}

        </g>
      </svg>
    </div>
  );
}
