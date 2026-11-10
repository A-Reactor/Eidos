import type { ExpandWindow } from "@/lib/game/worldline-geometry";

export interface StepRulerBar {
  dayNumber: number;
  stepNumber: number;
  nodeId: string;
  y: number;
}

export interface StepRulerMarker {
  key: string;
  stepNumber: number;
  y: number;
  isExpanded: boolean;
}

export function resolveCenterExpandWindow(
  current: ExpandWindow | null,
  centeredDay: number,
  centeredStep: number,
  threshold = 2
): ExpandWindow | null {
  if (!current || current.day !== centeredDay) return current;
  if (Math.abs(current.centerStep - centeredStep) < threshold) return current;
  return { day: current.day, centerStep: centeredStep };
}

export function buildStepRulerMarkers({
  bars,
  expandedDay,
  tickYs,
  minGapPx,
}: {
  bars: StepRulerBar[];
  expandedDay: number | null;
  tickYs?: number[];
  minGapPx: number;
}): StepRulerMarker[] {
  const markerMap = new Map<string, StepRulerMarker>();

  if (tickYs && tickYs.length > 0) {
    const sortedBars = [...bars].sort((a, b) => a.y - b.y || a.stepNumber - b.stepNumber);
    for (const tickY of tickYs) {
      let candidate: StepRulerBar | null = null;
      for (const bar of sortedBars) {
        if (bar.y > tickY) break;
        candidate = bar;
      }
      if (!candidate) continue;
      const key = `${candidate.dayNumber}:${candidate.stepNumber}`;
      if (markerMap.has(key)) continue;
      markerMap.set(key, {
        key,
        stepNumber: candidate.stepNumber,
        y: tickY,
        isExpanded: expandedDay === candidate.dayNumber,
      });
    }
  } else {
    for (const bar of bars) {
      const key = `${bar.dayNumber}:${bar.stepNumber}`;
      if (markerMap.has(key)) continue;
      markerMap.set(key, {
        key,
        stepNumber: bar.stepNumber,
        y: bar.y,
        isExpanded: expandedDay === bar.dayNumber,
      });
    }
  }

  return [...markerMap.values()]
    .sort((a, b) => a.y - b.y)
    .filter((marker, index, markers) => (
      marker.isExpanded ||
      index === 0 ||
      marker.y - markers[index - 1].y >= minGapPx
    ));
}
