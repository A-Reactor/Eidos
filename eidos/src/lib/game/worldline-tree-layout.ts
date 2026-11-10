import type { WorldLineNode } from "./types";

export interface WorldlineTrack {
  idx: number;
  dir: "main" | "left" | "right";
  nodeIds: string[];
  guideX: number;
}

/** Capture a stable tree without changing saved links; missing and repeated links are skipped. */
export function orderedTree(allNodes: Record<string, WorldLineNode>, rootId: string): Map<string, string[]> {
  const tree = new Map<string, string[]>(), seen = new Set([rootId]), pending = [rootId];
  for (let cursor = 0; cursor < pending.length; cursor++) {
    const node = allNodes[pending[cursor]];
    if (!node) continue;
    const children = [...new Set(node.childIds)].map(id => allNodes[id]).filter(child => child && !seen.has(child.id))
      .sort((a, b) => Number.isFinite(a.createdAt) && Number.isFinite(b.createdAt) ? a.createdAt - b.createdAt : 0);
    tree.set(node.id, children.map(child => child.id));
    children.forEach(child => { seen.add(child.id); pending.push(child.id); });
  }
  return tree;
}

interface SubtreeSpan { min: number; max: number; children: Array<{ id: string; offset: number }> }
/** Reserve whole subtrees, so descendants cannot reach back into another family's rails. */
function measureSubtrees(tree: Map<string, string[]>, sides: Map<string, number>): Map<string, SubtreeSpan> {
  const spans = new Map<string, SubtreeSpan>();
  for (const [id, children] of [...tree].reverse()) {
    const span: SubtreeSpan = { min: 0, max: 0, children: [] };
    let previousDistance = 0;
    children.forEach((child, index) => {
      const inner = spans.get(child)!;
      const side = sides.get(child) ?? 1;
      const needed = side < 0 ? inner.max - span.min + 1 : span.max - inner.min + 1;
      const distance = index === 0 ? 0 : Math.max(needed, previousDistance);
      const offset = side * distance;
      span.children.push({ id: child, offset });
      span.min = Math.min(span.min, offset + inner.min);
      span.max = Math.max(span.max, offset + inner.max);
      previousDistance = distance;
    });
    spans.set(id, span);
  }
  return spans;
}

export function assignWorldlineTracks(allNodes: Record<string, WorldLineNode>, tree: Map<string, string[]>, rootId: string, spacing: number): WorldlineTrack[] {
  // A fork can have only one alternative. Alternate across forks, not per parent.
  const alternatives = [...tree.values()].flatMap(children => children.slice(1))
    .sort((a, b) => allNodes[a].createdAt - allNodes[b].createdAt);
  const sides = new Map(alternatives.map((id, index) => [id, index % 2 ? 1 : -1]));
  const spans = measureSubtrees(tree, sides);
  if (!spans.has(rootId)) return [];
  const tracks: WorldlineTrack[] = [{ idx: 0, dir: "main", nodeIds: [], guideX: 0 }];
  // Both passes are iterative, so long playthroughs do not consume the JS call stack.
  const pending = [{ nid: rootId, tid: 0 }];
  for (let cursor = 0; cursor < pending.length; cursor++) {
    const { nid, tid } = pending[cursor];
    tracks[tid].nodeIds.push(nid);
    spans.get(nid)!.children.forEach(({ id, offset }, index) => {
      if (index === 0) { pending.push({ nid: id, tid }); return; }
      const guideX = tracks[tid].guideX + offset * spacing, idx = tracks.length;
      tracks.push({ idx, dir: guideX < 0 ? "left" : "right", nodeIds: [], guideX });
      pending.push({ nid: id, tid: idx });
    });
  }
  return tracks;
}
