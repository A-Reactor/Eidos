// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { loadBlobs, hashAndStore, getCasStats } from '@/lib/game/cas-storage';
import { openStorageDB } from '@/lib/game/storage';
import { buildWorldLineExport, collectSubtreeNodeIds } from '@/lib/game/worldline-export';
import { buildRiftCityStartState } from '@/lib/test/fixtures';
import type { WorldLineNode, WorldLineMeta } from '@/lib/game/types';
beforeEach(() => vi.stubGlobal('crypto', webcrypto));
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it('reads unique CAS keys in bounded batches without changing loaded contents', async () => {
  const hashes = await Promise.all(Array.from({ length: 260 }, (_, i) => hashAndStore('segments', [{ type: 'narration', text: `第${i}页` }])));
  const db = await openStorageDB(), tx = vi.spyOn(db, 'transaction');
  const found = await loadBlobs([...hashes, ...hashes, 'missing']);
  expect(found.size).toBe(261); expect(found.get(hashes[259])).toEqual([{ type: 'narration', text: '第259页' }]); expect(found.get('missing')).toBeNull();
  expect(tx.mock.calls.length).toBe(3);
});
function tree(count: number) {
  const { world, snapshot } = buildRiftCityStartState(), nodes: Record<string, WorldLineNode> = {};
  for (let i = 0; i < count; i++) nodes[String(i)] = { id: String(i), parentId: i ? String(i-1) : null, childIds: i < count-1 ? [String(i+1)] : [], snapshotHash: `s${i}`, segmentHash: `p${i}`, gameTime: { day: i, hour: 8, minute: 0 } } as WorldLineNode;
  return { world, snapshot, nodes, meta: { id: 'long' } as WorldLineMeta };
}
it('exports a thousand-node branch with one batch-loader call and identical complete records', async () => {
  const { world, snapshot, nodes, meta } = tree(1000), entries = new Map<string, unknown>();
  for (let i = 0; i < 1000; i++) { entries.set(`s${i}`, snapshot); entries.set(`p${i}`, [{ type: 'narration', text: `正文${i}` }]); }
  const batch = vi.fn(async () => entries), individual = vi.fn(async () => null);
  const result = await buildWorldLineExport({ world, allNodes: nodes, meta, playerName: '旅客', rootNodeId: '0', loadBlobs: batch, loadSnapshot: individual, loadSegments: individual });
  expect(batch).toHaveBeenCalledTimes(1); expect(individual).not.toHaveBeenCalled(); expect(result.nodes).toHaveLength(1000);
  expect(Object.keys(result.snapshots)).toHaveLength(1000); expect(result.segments.p999).toEqual([{ type: 'narration', text: '正文999' }]);
});
it('fails visibly on missing referenced content rather than producing a partial archive', async () => {
  const { world, nodes, meta } = tree(1);
  await expect(buildWorldLineExport({ world, allNodes: nodes, meta, playerName: '', rootNodeId: '0', loadSnapshot: async () => null, loadSegments: async () => [] })).rejects.toThrow(/缺失/);
});
it('visits repeated child links once', () => {
  const { nodes } = tree(2); nodes['0'].childIds.push('1');
  expect(collectSubtreeNodeIds(nodes, '0')).toEqual(['0', '1']);
});
it('rejects cyclic and dangling graph links without looping or silently omitting nodes', async () => {
  const { world, nodes, meta } = tree(2), options = { world, allNodes: nodes, meta, playerName: '', rootNodeId: '0', loadSnapshot: async () => null, loadSegments: async () => [] };
  nodes['1'].childIds.push('missing');
  await expect(buildWorldLineExport(options)).rejects.toThrow(/节点.*缺失/);
  nodes['1'].childIds = ['0']; nodes['0'].parentId = '1';
  expect(collectSubtreeNodeIds(nodes, '0')).toEqual(['0', '1']);
  await expect(buildWorldLineExport(options)).rejects.toThrow(/循环/);
});
it('rejects aborted batch reads instead of returning a partially loaded map', async () => {
  const db = await openStorageDB(), original = db.transaction.bind(db);
  vi.spyOn(db, 'transaction').mockImplementation((...args: Parameters<IDBDatabase['transaction']>) => { const tx = original(...args); queueMicrotask(() => tx.abort()); return tx; });
  await expect(loadBlobs(['missing'])).rejects.toThrow(/取消/);
});
it('calculates CAS statistics without materializing all blob bodies at once', async () => {
  await Promise.all(Array.from({ length: 260 }, (_, i) => hashAndStore('segments', [{ type: 'narration', text: `统计${i}` }])));
  const db = await openStorageDB(), original = db.transaction.bind(db), all = vi.fn();
  vi.spyOn(db, 'transaction').mockImplementation((...args: Parameters<IDBDatabase['transaction']>) => { const tx = original(...args), getter = tx.objectStore.bind(tx); vi.spyOn(tx, 'objectStore').mockImplementation(name => { const store = getter(name); vi.spyOn(store, 'getAll').mockImplementation(all); return store; }); return tx; });
  expect((await getCasStats()).count).toBeGreaterThanOrEqual(260); expect(all).not.toHaveBeenCalled();
});
