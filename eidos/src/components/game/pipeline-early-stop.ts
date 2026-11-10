export interface NarrativeProgress {
  isShowingSegments: boolean;
  segmentIndex: number;
  segmentsLength: number;
}

export interface InterruptMetadata {
  generationComplete: false;
  interruptedAtSegment: number;
  totalSegmentsGenerated: number;
}

export function isBeforeReadBoundary(index: number, furthestVisited: number, textThroughSegment: string, previouslyReadText = ''): boolean {
  return index < furthestVisited || previouslyReadText.length > textThroughSegment.length;
}

export function shouldInterruptNarrative(progress: NarrativeProgress): boolean {
  return progress.isShowingSegments
    && progress.segmentsLength > 0
    && progress.segmentIndex >= 0
    && progress.segmentIndex < progress.segmentsLength - 1;
}

export function buildInterruptMetadata(progress: Pick<NarrativeProgress, "segmentIndex" | "segmentsLength">): InterruptMetadata {
  return {
    generationComplete: false,
    interruptedAtSegment: Math.max(0, progress.segmentIndex),
    totalSegmentsGenerated: Math.max(0, progress.segmentsLength),
  };
}
