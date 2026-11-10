// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { afterEach, expect, it } from 'vitest';
import { collectDocumentBundle, restoreDocumentBundle, remapDocumentReferences, validateDocumentBundle } from '@/lib/game/documents/transfer';
import { importDocument, saveLocalDocument } from '@/lib/game/documents/ingest';
import { loadDocuments, readDocument } from '@/lib/game/documents/repository';
import { documentScopeKey } from '@/lib/game/model-documents';
import { _resetDB } from '@/lib/game/storage';
import { buildRiftCityStartState } from '@/lib/test/fixtures';
import { collectArchiveRecovery, restoreArchiveRecovery, readArchiveRecovery } from '@/lib/game/archive-transfer';
import { buildExportPackage, collectExportData } from '@/lib/game/export-records';
import { buildWorldLineExport, importWorldLineExport } from '@/lib/game/worldline-export';
import { useGameStore } from '@/store/game-store';
import type { WorldLineExport, WorldLineMeta, WorldLineNode } from '@/lib/game/types';
import { actionInputIdentity } from '@/lib/game/documents/action-draft';

afterEach(() => { _resetDB(); localStorage.clear(); });
const scope = () => ({ worldId: crypto.randomUUID(), playthroughId: crypto.randomUUID(), archiveId: 'main' });
it('round trips full originals, old versions and unreferenced library entries without duplicating resources or crossing scopes', async () => {
  const a = scope(), other = { ...a, archiveId: 'sandbox:private' }, dest = scope();
  const one = await importDocument(a, new File(['\ufeff完整原文\r\n末尾'], '原件.txt'));
  const two = await saveLocalDocument(a, { title: '修改版', content: '新正文', previous: one });
  await saveLocalDocument(a, { title: '未引用的资料', content: '新正文' });
  await saveLocalDocument(other, { title: '隔离的资料', content: '秘密' });
  const bundle = await collectDocumentBundle({ scopes: [a], nodes: [{ inputDocuments: [one], outputDocuments: [two] }] });
  expect(bundle.records).toHaveLength(2); expect(Object.keys(bundle.resources)).toHaveLength(3);
  const mapping = await restoreDocumentBundle(bundle, new Map([[documentScopeKey(a), dest]]));
  const restored = remapDocumentReferences({ inputDocuments: [one], outputDocuments: [two], inputIdentity: actionInputIdentity('核对', [one]) }, a, mapping);
  expect((await readDocument(dest, restored.inputDocuments[0])).resource.text).toBe('完整原文\r\n末尾');
  expect((await readDocument(dest, restored.outputDocuments[0])).resource.text).toBe('新正文');
  expect((await loadDocuments(dest)).some(d => d.title === '隔离的资料')).toBe(false);
  const again = await restoreDocumentBundle(bundle, new Map([[documentScopeKey(a), dest]]));
  const copy = remapDocumentReferences(one, a, again);
  expect(copy.documentId).not.toBe(restored.inputDocuments[0].documentId); expect(copy.revision).toBe(one.revision);
});
it('validates every referenced version and content hash before writing destination metadata', async () => {
  const a = scope(), b = scope(), doc = await saveLocalDocument(a, { title: '完整文档', content: '正文' });
  const bundle = await collectDocumentBundle({ scopes: [a], nodes: [] });
  const missing = structuredClone(bundle); delete missing.resources[doc.revision];
  await expect(restoreDocumentBundle(missing, new Map([[documentScopeKey(a), b]]))).rejects.toThrow(); expect(await loadDocuments(b)).toEqual([]);
  const wrong = structuredClone(bundle); wrong.resources[doc.revision].text = '伪造的内容';
  await expect(validateDocumentBundle(wrong)).rejects.toThrow();
  await expect(collectDocumentBundle({ scopes: [a], nodes: [{ outputDocuments: [{ ...doc, revision: 'missing' }] }] })).rejects.toThrow('版本');
});
it('carries the library through record packages and world archive recovery into a fresh playthrough', async () => {
  const { world, snapshot } = buildRiftCityStartState(), s = { worldId: world.id, playthroughId: crypto.randomUUID(), archiveId: 'main' };
  const doc = await saveLocalDocument(s, { title: '备份文档', content: '备份全文结尾' });
  const documents = await collectDocumentBundle({ scopes: [s], nodes: [] });
  const state = { ...snapshot, playerName: '玩家', currentSceneId: snapshot.currentSceneId, gameTime: snapshot.currentGameTime, history: [], sceneNarrative: '', inventory: [{ documentRef: doc }] };
  const pkg = buildExportPackage(collectExportData(world, '玩家', []), { restoreState: state as any, documentBundle: documents });
  const recovery = readArchiveRecovery(pkg.files, world)!;
  expect(recovery.documents?.records).toHaveLength(1);
  const imported = await restoreArchiveRecovery(recovery, world, { sandboxMode: true, sandboxDossierId: 'docs' });
  const dest = { worldId: world.id, playthroughId: imported.playthroughs[0].id, archiveId: 'sandbox:docs' };
  expect((await loadDocuments(dest))[0].title).toBe('备份文档');
  const worldBackup = await collectArchiveRecovery(world.id, [{ ...imported.playthroughs[0], saves: imported.saves }], { sandboxMode: true, sandboxDossierId: 'docs' });
  expect(worldBackup.documents?.records).toHaveLength(1);
});
it('exports a self-contained worldline with documents and workspace resources and restores its pinned links', async () => {
  const { world } = buildRiftCityStartState(); useGameStore.setState(useGameStore.getInitialState()); useGameStore.getState().setCurrentWorld(world);
  const s = { worldId: world.id, playthroughId: crypto.randomUUID(), archiveId: 'main' }; useGameStore.setState({ currentPlaythroughId: s.playthroughId }); await useGameStore.getState().initWorldLine(s.playthroughId, world.id);
  const doc = await saveLocalDocument(s, { title: '世界线资料', content: '文档全文' });
  const { storeResource, readResource } = await import('@/lib/game/workspace/resources');
  const extra = await storeResource({ name: 'extra.txt', mimeType: 'text/plain', text: '工作区额外原文' });
  const state = useGameStore.getState(), snapshot = { ...state.createSnapshot(), workspaceState: { 'outputs/old/extra.txt': extra } }, root = { ...state.currentNode!, snapshotHash: 'snapshot', inputDocuments: [doc] };
  const exported = await buildWorldLineExport({ meta: state.worldLine!, allNodes: { [root.id]: root }, world, playerName: '玩家', rootNodeId: root.id, documentScope: s, loadSnapshot: async () => snapshot, loadSegments: async () => [] });
  expect(exported.documents?.records).toHaveLength(1); expect(exported.modResources?.[extra.id].text).toBe('工作区额外原文');
  const destId = crypto.randomUUID(), result = await importWorldLineExport(exported, world.id, destId);
  const dest = { ...s, playthroughId: destId };
  expect((await readDocument(dest, result.allNodes[root.id].inputDocuments![0])).resource.text).toBe('文档全文');
  expect((await loadDocuments(s))[0].scope).toEqual(s);
  const { loadBlob } = await import('@/lib/game/cas-storage');
  const restoredSnapshot = await loadBlob(result.allNodes[root.id].snapshotHash) as typeof snapshot;
  expect((await readResource(restoredSnapshot.workspaceState['outputs/old/extra.txt'])).text).toBe('工作区额外原文');
});
it('keeps identical business IDs in separate source scopes distinct when explicitly merging into one destination', async () => {
  const a = scope(), b = scope(), dest = scope();
  const left = await saveLocalDocument(a, { title: '左侧资料', content: '左侧正文' });
  const right = await saveLocalDocument(b, { title: '右侧资料', content: '右侧正文' });
  const bundle = await collectDocumentBundle({ scopes: [a, b] });
  bundle.records.find(d => d.id === right.documentId)!.id = left.documentId;
  const mapping = await restoreDocumentBundle(bundle, new Map([[documentScopeKey(a), dest], [documentScopeKey(b), dest]]));
  const aRef = remapDocumentReferences(left, a, mapping), bRef = remapDocumentReferences({ ...right, documentId: left.documentId }, b, mapping);
  expect(aRef.documentId).not.toBe(bRef.documentId);
  expect((await readDocument(dest, aRef)).resource.text).toBe('左侧正文'); expect((await readDocument(dest, bRef)).resource.text).toBe('右侧正文');
});
it('preserves legacy raw response parts including bodies above the reference limit', async () => {
  const { saveModelDocument, loadModelDocuments } = await import('@/lib/game/model-documents');
  const a = scope(), dest = scope(), content = 'x'.repeat(4 * 1024 * 1024 + 1), rawOutput = '{raw response}';
  const old = await saveModelDocument(a, { title: '旧格式恢复', format: 'markdown', content, rawOutput, recovered: true }, '原始要求');
  const bundle = await collectDocumentBundle({ scopes: [a] });
  const mapping = await restoreDocumentBundle(bundle, new Map([[documentScopeKey(a), dest]]));
  const restored = remapDocumentReferences({ documentId: old.id, revision: `legacy_${old.id}` }, a, mapping);
  expect((await readDocument(dest, restored)).resource.text).toBe(content);
  expect((await loadModelDocuments(dest))[0].parts[0].rawOutput).toBe(rawOutput);
  await restoreDocumentBundle(bundle, new Map([[documentScopeKey(a), dest]]));
  expect((await collectDocumentBundle({ scopes: [dest] })).records).toHaveLength(2);
});

it('never stores a collision-remapped snapshot under its original content hash', async () => {
  const { world, snapshot } = buildRiftCityStartState(), a = scope(), collision = scope(), clean = scope();
  a.worldId = collision.worldId = clean.worldId = world.id;
  const doc = await saveLocalDocument(a, { title: '可移植文档', content: '完整原文' });
  const bundle = await collectDocumentBundle({ scopes: [a] });
  await restoreDocumentBundle(bundle, new Map([[documentScopeKey(a), collision]]));
  const { computeContentHash, loadBlob } = await import('@/lib/game/cas-storage');
  const original = { ...snapshot, inventory: [{ documentRef: doc }] }, hash = await computeContentHash(original);
  const node = { id: 'root', parentId: null, childIds: [], snapshotHash: hash, segmentHash: '' };
  const exported = { world, metadata: { rootNodeId: node.id, branchCount: 1, nodeCount: 1 }, nodes: [node], snapshots: { [hash]: original }, segments: {}, documents: bundle } as unknown as WorldLineExport;
  const first = await importWorldLineExport(exported, world.id, collision.playthroughId);
  expect(first.allNodes.root.snapshotHash).not.toBe(hash);
  const second = await importWorldLineExport(exported, world.id, clean.playthroughId);
  const restored = await loadBlob(second.allNodes.root.snapshotHash) as typeof original;
  expect(restored).toEqual(original);
  expect((await readDocument(clean, restored.inventory[0].documentRef)).resource.text).toBe('完整原文');
});
it('rejects missing worldline content before publishing imported documents', async () => {
  const a = scope(), dest = scope(), { world } = buildRiftCityStartState();
  const doc = await saveLocalDocument(a, { title: '完整文档', content: '正文' });
  const documents = await collectDocumentBundle({ scopes: [a] });
  const exported = { world, metadata: { rootNodeId: 'root' }, nodes: [{ id: 'root', snapshotHash: 'missing', inputDocuments: [doc] }], snapshots: {}, segments: {}, documents } as unknown as WorldLineExport;
  await expect(importWorldLineExport(exported, dest.worldId, dest.playthroughId)).rejects.toThrow(/快照.*缺失/);
  expect(await loadDocuments(dest)).toEqual([]);
});

it('round trips ordinary worldlines with an empty document library', async () => {
  const { world, snapshot } = buildRiftCityStartState(), s = scope();
  const node = { id: 'root', parentId: null, childIds: [], snapshotHash: 'snapshot', segmentHash: '', gameTime: snapshot.currentGameTime } as unknown as WorldLineNode;
  const exported = await buildWorldLineExport({ meta: { rootNodeId: node.id } as WorldLineMeta, allNodes: { root: node }, world, playerName: '玩家', rootNodeId: node.id, documentScope: s, loadSnapshot: async () => snapshot, loadSegments: async () => [] });
  expect(exported.documents).toBeUndefined();
  await expect(importWorldLineExport(exported, world.id, crypto.randomUUID())).resolves.toHaveProperty('allNodes.root');
  exported.documents = await collectDocumentBundle({ scopes: [s] });
  const result = await importWorldLineExport(exported, world.id, crypto.randomUUID());
  expect(result.allNodes.root).toBeDefined();
});
