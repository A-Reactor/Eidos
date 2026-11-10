import { describe, expect, it } from "vitest";

import {
  buildVisibleTicks,
  createViewportTransform,
  fitWorldViewport,
  zoomViewportAt,
} from "@/components/game/worldline/worldline-viewport";

describe("worldline viewport math", () => {
  const plotRect = { x: 52, y: 28, width: 900, height: 600 };

  it("maps between world coordinates and fixed screen coordinates", () => {
    const transform = createViewportTransform({
      plotRect,
      scale: 40,
      origin: { x: 200, y: 120 },
    });

    expect(transform.worldToScreen({ x: 2, y: 3 })).toEqual({ x: 332, y: 268 });
    expect(transform.screenToWorld({ x: 332, y: 268 })).toEqual({ x: 2, y: 3 });
  });

  it("zooms around the cursor without moving the underlying world point", () => {
    const initial = { scale: 40, origin: { x: 200, y: 120 } };
    const screenPoint = { x: 332, y: 268 };
    const before = createViewportTransform({ plotRect, ...initial }).screenToWorld(screenPoint);

    const next = zoomViewportAt({
      plotRect,
      viewport: initial,
      screenPoint,
      factor: 2,
      minScale: 12,
      maxScale: 240,
    });

    const after = createViewportTransform({ plotRect, ...next }).screenToWorld(screenPoint);
    expect(next).toEqual({ scale: 80, origin: { x: 120, y: 0 } });
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
  });

  it("builds only the tick values visible in the current world range", () => {
    expect(buildVisibleTicks({ min: -2.2, max: 3.3, step: 1 })).toEqual([-2, -1, 0, 1, 2, 3]);
  });
});

describe('fit worldline to the available paper', () => {
  it.each([
    [{ x: 36, y: 36, width: 354, height: 110 }, { minX: -.18, maxX: .38, minY: -.45, maxY: .5 }],
    [{ x: 36, y: 36, width: 280, height: 110 }, { minX: -10, maxX: 30, minY: 0, maxY: 500 }],
    [{ x: 36, y: 36, width: 900, height: 600 }, { minX: -4, maxX: 7, minY: -3, maxY: 6 }],
  ])('keeps every drawing edge inside both narrow and desktop viewports', (plotRect, bounds) => {
    const viewport = fitWorldViewport({ plotRect, bounds, minScale: .01, maxScale: 220 });
    const transform = createViewportTransform({ plotRect, ...viewport });
    const topLeft = transform.worldToScreen({ x: bounds.minX, y: bounds.minY });
    const bottomRight = transform.worldToScreen({ x: bounds.maxX, y: bounds.maxY });
    expect(topLeft.x).toBeGreaterThan(plotRect.x);
    expect(topLeft.y).toBeGreaterThan(plotRect.y);
    expect(bottomRight.x).toBeLessThan(plotRect.x + plotRect.width);
    expect(bottomRight.y).toBeLessThan(plotRect.y + plotRect.height);
    expect((topLeft.x + bottomRight.x) / 2).toBeCloseTo(plotRect.x + plotRect.width / 2);
    expect((topLeft.y + bottomRight.y) / 2).toBeCloseTo(plotRect.y + plotRect.height / 2);
  });
  it('uses the short phone viewport without double padding or the old clipping floor', () => {
    const plotRect = { x: 36, y: 36, width: 354, height: 110 };
    expect(fitWorldViewport({ plotRect, bounds: { minX: -.18, maxX: .38, minY: -.45, maxY: .5 }, minScale: .01, maxScale: 220 }).scale).toBeGreaterThan(90);
    expect(fitWorldViewport({ plotRect, bounds: { minX: 0, maxX: 2, minY: 0, maxY: 500 }, minScale: .01, maxScale: 220 }).scale).toBeLessThan(16);
  });
});
