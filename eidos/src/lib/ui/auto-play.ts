export function autoPlayLimitReached(completed: number, limit: number): boolean {
  return limit > 0 && completed >= limit;
}

export function canAutoPlay({ draft, panelOpen, phase }: { draft: string; panelOpen: boolean; phase: string }): boolean {
  return !draft.trim() && !panelOpen && phase === "playing";
}
