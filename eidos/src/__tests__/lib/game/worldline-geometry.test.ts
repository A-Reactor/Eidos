import { expect, it } from 'vitest';
import { computeWorldlineGeometry } from '@/lib/game/worldline-geometry';
import type { WorldLineNode } from '@/lib/game/types';

function tree() {
  const nodes: Record<string, WorldLineNode> = {};
  function add(id: string, parentId: string | null) {
    const step = parentId ? nodes[parentId].stepNumber + 1 : 0;
    nodes[id] = { id, parentId, childIds: [], stepNumber: step, dayNumber: Math.floor(step / 20), gameTime: { day: Math.floor(step / 20), hour: 8, minute: step % 20 },
      playerInput: id, aiResponse: id, summary: '', generationComplete: true, worldImpacts: [], snapshotHash: '', segmentHash: '', sceneId: '', sceneName: '', timeSpent: { day: 0, hour: 0, minute: 1 }, createdAt: Object.keys(nodes).length };
    if (parentId) nodes[parentId].childIds.push(id);
    return id;
  }
  add('root', null); add('main', 'root'); add('later-main', 'main'); add('end', 'later-main');
  add('late-fork', 'later-main'); add('late-end', 'late-fork');
  add('early-fork', 'root'); add('early-end', 'early-fork');
  add('nested', 'early-fork'); add('nested-end', 'nested');
  add('last-sibling', 'root');
  return { nodes, add };
}
const layout = (nodes: Record<string, WorldLineNode>, current = 'end', expanded: { day: number; centerStep: number } | null = null) => computeWorldlineGeometry(nodes, 'root', current, current, expanded);
const positions = (geometry: ReturnType<typeof layout>) => Object.fromEntries(geometry.bars.map(b => [b.nodeId, b.guideX]));

it('keeps continuations straight and places later alternatives beyond older subtree envelopes', () => {
  const { nodes, add } = tree();
  add('fourth', 'root'); add('fifth', 'root');
  const x = positions(layout(nodes));
  expect([x.root, x.main, x['later-main'], x.end]).toEqual([0, 0, 0, 0]);
  expect(x['early-fork']).toBeGreaterThan(0);
  expect(x['last-sibling']).toBeGreaterThan(x['early-fork']);
  expect(x.fourth).toBeLessThan(0);
  expect(x.fifth).toBeGreaterThan(x['last-sibling']);
  expect(x['early-end']).toBe(x['early-fork']);
  expect(x['nested-end']).toBe(x.nested);
});
it('alternates alternatives globally and keeps older siblings at least as close', () => {
  const { nodes, add } = tree();
  add('nested-right', 'early-fork'); add('nested-left-again', 'early-fork');
  const geometry = layout(nodes), x = positions(geometry), parent = x['early-fork'];
  const children = nodes['early-fork'].childIds.map(id => x[id]);
  expect(children[0]).toBe(parent);
  expect(children[1]).toBeLessThan(parent);
  expect(children[2]).toBeLessThan(parent);
  expect(children[3]).toBeGreaterThan(parent);
  const distances = children.map(value => Math.abs(value - parent));
  expect(distances).toEqual([...distances].sort((a, b) => a - b));
  for (const conn of geometry.branchConns) {
    expect(conn.direction).toBe(x[conn.toNodeId] < x[conn.fromNodeId] ? 'left' : 'right');
  }
});
it('does not reorder when selecting or expanding, and leaves older direct siblings in place when appending a choice', () => {
  const { nodes, add } = tree(), original = structuredClone(nodes), before = positions(layout(nodes));
  expect(positions(layout(nodes, 'nested-end', { day: 0, centerStep: 3 }))).toEqual(before);
  expect(nodes).toEqual(original);
  add('new-choice', 'root');
  const after = positions(layout(nodes));
  for (const id of original.root.childIds) expect(after[id]).toBe(before[id]);
  expect(after['new-choice']).toBeLessThan(after['early-fork']);
});
it('orders by child creation time with saved order as tie-breaker, independently of record insertion order', () => {
  const { nodes } = tree();
  const expected = positions(layout(nodes));
  nodes.root.childIds.reverse();
  const reversed = Object.fromEntries(Object.entries(nodes).reverse());
  expect(positions(layout(reversed))).toEqual(expected);
  nodes.root.childIds.unshift('missing');
  expect(positions(layout(nodes)).main).toBe(0);
  nodes['last-sibling'].createdAt = nodes['early-fork'].createdAt;
  nodes.root.childIds = ['main', 'last-sibling', 'early-fork'];
  const tied = positions(layout(nodes));
  expect(tied['last-sibling']).toBeGreaterThan(0);
  expect(tied['early-fork']).toBeLessThan(0);
  expect(Math.abs(tied['last-sibling'])).toBeLessThanOrEqual(Math.abs(tied['early-fork']));
});
it('handles a long chain without recursion and keeps distinct branches on distinct rails', () => {
  const { nodes, add } = tree();
  let parent = 'nested-end';
  for (let i = 0; i < 1500; i++) parent = add(`long-${i}`, parent);
  const result = layout(nodes);
  expect(result.bars).toHaveLength(Object.keys(nodes).length);
  expect(new Set(result.guideLines.map(g => g.x)).size).toBe(result.guideLines.length);
  expect(result.guideLines.every(g => Number.isFinite(g.y2))).toBe(true);
  expect(positions(result)[parent]).toBe(positions(result).nested);
});

function assertSeparateSubtrees(nodes: Record<string, WorldLineNode>) {
  const geometry = layout(nodes), x = positions(geometry);
  function extent(id: string) {
    const values: number[] = [], pending = [id], seen = new Set<string>();
    while (pending.length) {
      const next = pending.pop()!;
      if (!nodes[next] || seen.has(next)) continue;
      seen.add(next); values.push(x[next]); pending.push(...nodes[next].childIds);
    }
    return { min: Math.min(...values), max: Math.max(...values) };
  }
  for (const conn of geometry.branchConns) {
    const min = Math.min(conn.fromX, conn.toGuideX), max = Math.max(conn.fromX, conn.toGuideX);
    for (const guide of geometry.guideLines) {
      const crosses = guide.x > min && guide.x < max && guide.y1 <= conn.fromY && guide.y2 >= conn.fromY;
      expect(crosses, `${conn.fromNodeId}->${conn.toNodeId} crosses ${guide.id}`).toBe(false);
    }
  }
  for (const parent of Object.values(nodes)) {
    const children = parent.childIds.map(id => nodes[id]).filter(Boolean).sort((a, b) => a.createdAt - b.createdAt);
    const ranges = children.map(child => extent(child.id));
    for (let i = 0; i < ranges.length; i++) for (let j = i + 1; j < ranges.length; j++) {
      expect(ranges[i].max < ranges[j].min || ranges[j].max < ranges[i].min, `${parent.id}: ${children[i].id} overlaps ${children[j].id}`).toBe(true);
    }
    for (let i = 1; i < children.length; i++) {
      expect(x[children[i].id] < x[parent.id] ? ranges[i].max < x[parent.id] : ranges[i].min > x[parent.id], `${children[i].id} crosses its parent rail`).toBe(true);
      expect(Math.abs(x[children[i].id] - x[parent.id])).toBeGreaterThanOrEqual(Math.abs(x[children[i - 1].id] - x[parent.id]));
    }
  }
}
it('reserves the entire child subtree instead of letting it cross its parent continuation or sibling trees', () => {
  const { nodes, add } = tree();
  add('nested-right', 'early-fork'); add('nested-left-again', 'early-fork');
  add('right-inner', 'last-sibling'); add('right-outer', 'last-sibling');
  assertSeparateSubtrees(nodes);
});
it('keeps sibling subtree envelopes separate in a densely nested tree', () => {
  const { nodes, add } = tree();
  let seed = 41;
  for (let i = 0; i < 100; i++) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const ids = Object.keys(nodes); add(`extra-${i}`, ids[seed % ids.length]);
  }
  assertSeparateSubtrees(nodes);
});

it('balances separate binary forks across both sides of the continuation', () => {
  const { nodes } = tree();
  delete nodes['last-sibling'];
  nodes.root.childIds = nodes.root.childIds.filter(id => id !== 'last-sibling');
  const geometry = layout(nodes);
  const directions = geometry.branchConns.map(conn => conn.direction);
  expect(directions).toContain('left');
  expect(directions).toContain('right');
});

it('places each child after its own parent when sibling branches reach different dates', () => {
  const { nodes } = tree();
  nodes['early-fork'].dayNumber = 2;
  nodes['early-end'].dayNumber = 2;
  nodes.nested.dayNumber = 2;
  nodes['nested-end'].dayNumber = 2;
  nodes.end.dayNumber = 1;
  const geometry = layout(nodes);
  const byId = new Map(geometry.bars.map(bar => [bar.nodeId, bar]));
  for (const node of Object.values(nodes)) {
    if (node.parentId) expect(byId.get(node.id)!.y, node.id).toBeGreaterThan(byId.get(node.parentId)!.y);
  }
  expect(byId.get('late-fork')!.y).toBe(byId.get('end')!.y);
});
