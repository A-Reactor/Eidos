export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WorldRect {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export interface ViewportState {
  scale: number;
  origin: Point;
}

interface TransformInput extends ViewportState {
  plotRect: Rect;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Fit actual drawing bounds once; world-space padding would grow again with zoom. */
export function fitWorldViewport({ plotRect, bounds, minScale, maxScale }: {
  plotRect: Rect; bounds: WorldRect; minScale: number; maxScale: number;
}): ViewportState {
  const padding = Math.min(24, Math.min(plotRect.width, plotRect.height) * .1);
  const spanX = Math.max(.1, bounds.maxX - bounds.minX);
  const spanY = Math.max(.1, bounds.maxY - bounds.minY);
  const scale = clamp(Math.min((plotRect.width - padding * 2) / spanX, (plotRect.height - padding * 2) / spanY), minScale, maxScale);
  return { scale, origin: {
    x: plotRect.width / 2 - (bounds.minX + bounds.maxX) / 2 * scale,
    y: plotRect.height / 2 - (bounds.minY + bounds.maxY) / 2 * scale,
  } };
}

export function createViewportTransform({ plotRect, scale, origin }: TransformInput) {
  return {
    worldToScreen(point: Point): Point {
      return {
        x: plotRect.x + origin.x + point.x * scale,
        y: plotRect.y + origin.y + point.y * scale,
      };
    },
    screenToWorld(point: Point): Point {
      return {
        x: (point.x - plotRect.x - origin.x) / scale,
        y: (point.y - plotRect.y - origin.y) / scale,
      };
    },
  };
}

export function zoomViewportAt({
  plotRect,
  viewport,
  screenPoint,
  factor,
  minScale,
  maxScale,
}: {
  plotRect: Rect;
  viewport: ViewportState;
  screenPoint: Point;
  factor: number;
  minScale: number;
  maxScale: number;
}): ViewportState {
  const transform = createViewportTransform({ plotRect, ...viewport });
  const worldPoint = transform.screenToWorld(screenPoint);
  const nextScale = clamp(viewport.scale * factor, minScale, maxScale);

  return {
    scale: nextScale,
    origin: {
      x: screenPoint.x - plotRect.x - worldPoint.x * nextScale,
      y: screenPoint.y - plotRect.y - worldPoint.y * nextScale,
    },
  };
}

export function getVisibleWorldRect({
  plotRect,
  viewport,
  bufferWorld = 0,
}: {
  plotRect: Rect;
  viewport: ViewportState;
  bufferWorld?: number;
}): WorldRect {
  const transform = createViewportTransform({ plotRect, ...viewport });
  const topLeft = transform.screenToWorld({ x: plotRect.x, y: plotRect.y });
  const bottomRight = transform.screenToWorld({
    x: plotRect.x + plotRect.width,
    y: plotRect.y + plotRect.height,
  });

  return {
    minX: Math.min(topLeft.x, bottomRight.x) - bufferWorld,
    maxX: Math.max(topLeft.x, bottomRight.x) + bufferWorld,
    minY: Math.min(topLeft.y, bottomRight.y) - bufferWorld,
    maxY: Math.max(topLeft.y, bottomRight.y) + bufferWorld,
  };
}

export function buildVisibleTicks({ min, max, step }: { min: number; max: number; step: number }): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max) || !Number.isFinite(step) || step <= 0) return [];
  const ticks: number[] = [];
  const start = Math.ceil(min / step) * step;
  const precision = step < 1 ? 6 : 3;

  for (let value = start; value <= max + step * 0.0001; value += step) {
    ticks.push(Number(value.toFixed(precision)));
  }

  return ticks;
}

export function chooseNiceStep(scale: number, targetPixels = 72): number {
  const raw = targetPixels / Math.max(scale, 0.0001);
  const power = 10 ** Math.floor(Math.log10(raw));
  const normalized = raw / power;

  if (normalized <= 1) return power;
  if (normalized <= 2) return 2 * power;
  if (normalized <= 5) return 5 * power;
  return 10 * power;
}
