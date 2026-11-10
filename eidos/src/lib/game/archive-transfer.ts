import { collectDocumentBundle, restoreDocumentBundle, validateDocumentBundle, validateResourceBundle, assertDocumentReferences, remapDocumentReferences, type DocumentBundle } from './documents/transfer';
import { currentDocumentScope, documentScopeKey, type SavedModelDocument } from './model-documents';
import { hashAndStore } from './cas-storage';
import { getSceneById } from "./scene-utils";
import { rebaseEntryContext } from './world-entry';
import { readVoiceResources, writeVoiceResources } from "./momoi/resource-storage";
import { normalizeVoiceAssets, type VoiceAsset } from "./momoi/model";
import type { GameSave, PlaythroughMeta, SaveSlot, SerializedGameState, WorldDefinition, WorldLineMeta, WorldLineNode } from "./types";
import { loadFromDB, loadMeta, saveToDB, saveMeta, updateMeta, autoSaveDataKey } from "./storage";
import { scopeStorageKey, type ArchiveScopeSource } from "./archive-scope";
import { loadBlobs, storeBlob, type BlobType } from "./cas-storage";
import type { ImportSourceFile } from "./import-records";
import { resourceReferences, readModResource, storeModResource, type ModResource } from './plugins/workspace';
import { collectModMail, restoreModMail, type ModMailBundle } from './plugins/mailbox';

export interface ArchiveRecovery {
  version: "eidos_archive_v1";
  documents?: DocumentBundle;
  legacyDocuments?: SavedModelDocument[];
  playthroughs: PlaythroughMeta[];
  saves: GameSave[];
  trees: Array<{ meta: WorldLineMeta; nodes: Record<string, WorldLineNode> }>;
  blobs: Record<string, { type: BlobType; data: unknown }>;
  voiceResources?: Record<string, Record<string, VoiceAsset>>;
  modResources?: Record<string, ModResource>;
  modMail?: Record<string, ModMailBundle>;
}

export async function collectArchiveRecovery(worldId: string, continuities: Array<PlaythroughMeta & { saves?: SaveSlot[] }>, scope: ArchiveScopeSource): Promise<ArchiveRecovery> {
  const key = (value: string) => scopeStorageKey(scope, value);
  const result: ArchiveRecovery = { version: "eidos_archive_v1", playthroughs: [], saves: [], trees: [], blobs: {} };
  const treeIndex = await loadMeta<WorldLineMeta[]>(key(`worldline_index_${worldId}`)) ?? [];
  for (const { saves = [], ...pt } of continuities) {
    result.playthroughs.push(pt);
    const mail = await collectModMail(worldId, pt.id, scope);
    if (Object.keys(mail).length) (result.modMail ??= {})[pt.id] = mail;
    const voices = await readVoiceResources(key(JSON.stringify([worldId, pt.id])));
    if (Object.keys(voices).length) (result.voiceResources ??= {})[pt.id] = voices;
    for (const slot of saves) {
      const path = slot.id.startsWith("autosave_prev_") ? `autosave_prev_data_${pt.id}` : slot.id.startsWith("autosave_") ? autoSaveDataKey(pt.id) : `save_data_${slot.id}`;
      const save = await loadFromDB(key(path)) as GameSave | null;
      if (!save?.state || save.world?.id !== worldId) throw new Error(`存档「${slot.name}」内容缺失，无法完成备份`);
      result.saves.push({ ...save, meta: slot });
    }
    pt.worldLineId = treeIndex.find((tree) => tree.playthroughId === pt.id)?.id ?? pt.worldLineId;
    if (!pt.worldLineId) continue;
    const tree = await loadMeta<ArchiveRecovery["trees"][number]>(key(`worldline_data_${pt.worldLineId}`));
    if (!tree) throw new Error(`周目「${pt.name}」世界线缺失，无法完成备份`);
    result.trees.push(tree);
  }
  const needed = new Map<string, BlobType>();
  for (const tree of result.trees) for (const node of Object.values(tree.nodes)) {
    if (node.snapshotHash) needed.set(node.snapshotHash, 'snapshot');
    if (node.segmentHash) needed.set(node.segmentHash, 'segments');
  }
  const contents = await loadBlobs([...needed.keys()]);
  for (const [hash, type] of needed) {
    const data = contents.get(hash);
    if (!data) throw new Error('世界线内容缺失，无法完成备份');
    result.blobs[hash] = { type, data };
  }

  const documents: DocumentBundle = { version: 'eidos_documents_v1', records: [], resources: {} };
  for (const pt of result.playthroughs) {
    const docScope = currentDocumentScope({ currentWorld: { id: worldId }, currentPlaythroughId: pt.id, ...scope })!;
    const trees = result.trees.filter(tree => tree.meta.playthroughId === pt.id), saves = result.saves.filter(save => save.meta.playthroughId === pt.id);
    const hashes = new Set(trees.flatMap(tree => Object.values(tree.nodes).flatMap(node => [node.snapshotHash, node.segmentHash])).filter(Boolean));
    const blobs = [...hashes].map(hash => result.blobs[hash]?.data);
    const portion = await collectDocumentBundle({ scopes: [docScope], nodes: { trees, saves, blobs } });
    documents.records.push(...portion.records); Object.assign(documents.resources, portion.resources);
    if (portion.legacy?.length) (documents.legacy ??= []).push(...portion.legacy);
  }
  if (documents.records.length) result.documents = documents;
  for (const pt of result.playthroughs) {
    const docScope = currentDocumentScope({ currentWorld: { id: worldId }, currentPlaythroughId: pt.id, ...scope })!;
    for (const tree of result.trees.filter(tree => tree.meta.playthroughId === pt.id)) {
      assertDocumentReferences(tree.nodes, docScope, documents);
      for (const node of Object.values(tree.nodes)) if (node.snapshotHash) assertDocumentReferences(result.blobs[node.snapshotHash]?.data, docScope, documents);
    }
    for (const save of result.saves.filter(save => save.meta.playthroughId === pt.id)) assertDocumentReferences(save.state, docScope, documents);
  }
  for (const [id, ref] of resourceReferences({ saves: result.saves, blobs: result.blobs, trees: result.trees })) { if (!documents.resources[id]) (result.modResources ??= {})[id] = await readModResource(ref); }
  for (const bundle of Object.values(result.modMail ?? {})) for (const mails of Object.values(bundle)) for (const mail of Object.values(mails)) (result.modResources ??= {})[mail.resource.id] = await readModResource(mail.resource);
  return result;
}

export function readArchiveRecovery(files: ImportSourceFile[], world: WorldDefinition): ArchiveRecovery | null {
  const find = (path: string) => files.find((file) => file.path.replaceAll("\\", "/") === path || file.path.replaceAll("\\", "/").endsWith(`/${path}`));
  const archive = find("library/recovery.json");
  if (archive) {
    const data = JSON.parse(archive.content) as ArchiveRecovery;
    if (data.version !== "eidos_archive_v1" || !Array.isArray(data.playthroughs) || !Array.isArray(data.saves) || !Array.isArray(data.trees) || !data.blobs) throw new Error("无效的周目备份");
    const ids = new Set(data.playthroughs.map((pt) => pt.id));
    if (ids.size !== data.playthroughs.length || data.playthroughs.some((pt) => pt.worldId !== world.id) || data.saves.some((save) => !save.state || !ids.has(save.meta?.playthroughId) || save.world?.id !== world.id)) throw new Error("备份中的存档关联无效");
    if (data.playthroughs.some((pt) => pt.worldLineId && !data.trees.some((tree) => tree.meta?.id === pt.worldLineId && tree.meta.playthroughId === pt.id))) throw new Error("备份缺少周目的世界线");
    for (const tree of data.trees) {
      if (!ids.has(tree.meta.playthroughId) || !tree.nodes[tree.meta.rootNodeId] || !tree.nodes[tree.meta.currentNodeId]) throw new Error("备份中的世界线无效");
      for (const node of Object.values(tree.nodes)) {
        if ((node.snapshotHash && !data.blobs[node.snapshotHash]) || (node.segmentHash && !data.blobs[node.segmentHash])) throw new Error("备份缺少世界线内容");
      }
    }
    for (const id of resourceReferences({ saves: data.saves, blobs: data.blobs, trees: data.trees }).keys()) if (!data.modResources?.[id] && !data.documents?.resources[id]) throw new Error('备份缺少模组材料原件');
    return data;
  }
  const restore = find("restore/state.json");
  if (!restore) return null;
  const state = JSON.parse(restore.content) as SerializedGameState;
  const docFile = find('documents/library.json'), documents = docFile ? JSON.parse(docFile.content) as DocumentBundle : undefined;
  const oldDocs = find('documents/index.json'), legacyDocuments = !documents && oldDocs ? JSON.parse(oldDocs.content) as SavedModelDocument[] : undefined;
  const sourcePts = new Set([...(documents?.records.map(d => d.scope.playthroughId) ?? []), ...(documents?.legacy?.map(g => g.scope.playthroughId) ?? [])]);
  if (sourcePts.size > 1) throw new Error('游戏记录文档包含多个周目');
  const sourcePt = [...sourcePts][0] ?? 'records';
  const materials = find('restore/mod-resources.json');
  const modResources = materials ? JSON.parse(materials.content) as Record<string, ModResource> : undefined;
  for (const id of resourceReferences(state).keys()) if (!modResources?.[id] && !documents?.resources[id]) throw new Error('游戏记录缺少模组材料原件');
  if (!state.playerName || !state.currentSceneId || !Array.isArray(state.history) || !state.gameTime) throw new Error("游戏记录缺少可恢复的进度");
  const now = Date.now();
  const scene = getSceneById({ ...world, mapState: state.mapState }, state.currentSceneId);
  if (!scene) throw new Error("恢复位置不属于此世界");
  const pt: PlaythroughMeta = { id: sourcePt, worldId: world.id, name: "导入的游戏记录", createdAt: now, updatedAt: now, playerName: state.playerName, actionCount: state.history.length, gameTime: state.gameTime, currentSceneName: scene.name, status: "active", totalPlayDuration: 0, worldLineId: "" };
  const meta: SaveSlot = { id: "records", name: "记录恢复点", createdAt: now, updatedAt: now, worldId: world.id, worldName: world.name, playthroughId: pt.id, playerName: state.playerName, gameTime: state.gameTime, actionCount: state.history.length, currentSceneName: scene.name, preview: state.history.at(-1)?.summary ?? "导入的进度", playDuration: 0, type: "manual" };
  return { version: "eidos_archive_v1", playthroughs: [pt], saves: [{ meta, world, state }], trees: [], blobs: {}, ...(documents ? { documents } : {}), ...(legacyDocuments ? { legacyDocuments } : {}), ...(modResources ? { modResources } : {}) };
}

function appendIndex<T extends { id: string }>(key: string, entries: T[]) {
  return updateMeta<T[]>(key, current => {
    const ids = new Set(current?.map(entry => entry.id));
    return [...(current ?? []), ...entries.filter(entry => !ids.has(entry.id))];
  });
}

/** Manual imports get fresh IDs. Bundled content uses stable IDs so interrupted installation can be retried. */
export async function restoreArchiveRecovery(data: ArchiveRecovery, world: WorldDefinition, scope: ArchiveScopeSource, preset = false) {
  const key = (value: string) => scopeStorageKey(scope, value);
  const idFor = (type: string, source: string) => `${type}_${preset ? `preset_${world.id}_${source}` : crypto.randomUUID()}`;
  const ptIds = new Map(data.playthroughs.map((pt) => [pt.id, idFor('pt', pt.id)]));
  const treeIds = new Map(data.trees.map((tree) => [tree.meta.id, idFor('worldline', tree.meta.id)]));
  await validateResourceBundle(data.modResources ?? {});
  for (const id of resourceReferences({ saves: data.saves, blobs: data.blobs, trees: data.trees }).keys()) if (!data.modResources?.[id] && !data.documents?.resources[id]) throw new Error('备份缺少文件原件');
  for (const bundle of Object.values(data.modMail ?? {})) for (const mails of Object.values(bundle)) for (const mail of Object.values(mails)) if (!data.modResources?.[mail.resource.id] && !data.documents?.resources[mail.resource.id]) throw new Error('备份缺少邮件原件');
  let mapping = new Map<string, import('./documents/types').DocumentRef>();
  const sourceScopes = data.documents ? [...new Map([...data.documents.records.map(d => d.scope), ...(data.documents.legacy?.map(g => g.scope) ?? [])].map(s => [documentScopeKey(s), s])).values()] : [];
  const scopes = new Map(sourceScopes.map(old => {
    const newPt = ptIds.get(old.playthroughId);
    if (!newPt || data.playthroughs.find(pt => pt.id === old.playthroughId)?.worldId !== old.worldId || sourceScopes.some(s => s.playthroughId === old.playthroughId && documentScopeKey(s) !== documentScopeKey(old))) throw new Error('文档关联了备份以外的周目或卷宗');
    return [documentScopeKey(old), currentDocumentScope({ currentWorld: world, currentPlaythroughId: newPt, ...scope })!] as const;
  }));
  if (data.documents) {
    await validateDocumentBundle(data.documents);
    for (const pt of data.playthroughs) {
      const old = sourceScopes.find(s => s.playthroughId === pt.id) ?? { worldId: pt.worldId, playthroughId: pt.id, archiveId: 'main' };
      for (const save of data.saves.filter(s => s.meta.playthroughId === old.playthroughId)) assertDocumentReferences(save.state, old, data.documents);
      for (const tree of data.trees.filter(t => t.meta.playthroughId === old.playthroughId)) {
        assertDocumentReferences(tree.nodes, old, data.documents);
        for (const node of Object.values(tree.nodes)) if (node.snapshotHash) assertDocumentReferences(data.blobs[node.snapshotHash]?.data, old, data.documents);
      }
    }
    mapping = await restoreDocumentBundle(data.documents, scopes);
  }
  const remap = <T>(value: T, ptId: string): T => {
    const old = sourceScopes.find(s => s.playthroughId === ptId);
    return old ? remapDocumentReferences(value, old, mapping, scopes.get(documentScopeKey(old))) : structuredClone(value);
  };
  for (const [id, resource] of Object.entries(data.modResources ?? {})) {
    const restored = await storeModResource(resource);
    if (restored.id !== id) throw new Error('备份的材料版本与原件不一致');
  }
  for (const [oldId, mail] of Object.entries(data.modMail ?? {})) {
    const newId = ptIds.get(oldId);
    if (newId) await restoreModMail(mail, world.id, newId, scope);
  }
  for (const [oldId, voices] of Object.entries(data.voiceResources ?? {})) {
    const newId = ptIds.get(oldId);
    if (newId) await writeVoiceResources(key(JSON.stringify([world.id, newId])), normalizeVoiceAssets(voices));
  }
  for (const [hash, blob] of Object.entries(data.blobs)) await storeBlob(hash, blob.type, blob.data);
  const trees = data.trees.map((tree) => ({ ...tree, nodes: remap(tree.nodes, tree.meta.playthroughId), meta: { ...tree.meta, id: treeIds.get(tree.meta.id)!, worldId: world.id, playthroughId: ptIds.get(tree.meta.playthroughId)! } }));
  for (let i = 0; i < trees.length; i++) for (const node of Object.values(trees[i].nodes)) {
    for (const field of ['snapshotHash', 'segmentHash'] as const) {
      if (!node[field]) continue;
      const blob = data.blobs[node[field]];
      if (!blob) throw new Error('世界线内容缺失');
      const content = remap(blob.data, data.trees[i].meta.playthroughId);
      if (JSON.stringify(content) !== JSON.stringify(blob.data)) node[field] = await hashAndStore(blob.type, content);
    }
  }
  for (const tree of trees) {
    const treeKey = key(`worldline_data_${tree.meta.id}`);
    if (preset) await updateMeta<typeof tree>(treeKey, current => current ?? tree);
    else await saveMeta(treeKey, tree);
  }
  await appendIndex(key(`worldline_index_${world.id}`), trees.map(tree => tree.meta));
  const slots: SaveSlot[] = [];
  for (const save of data.saves) {
    // Import each automatic checkpoint as an independent manual restore point.
    const meta: SaveSlot = { ...save.meta, id: idFor('save', save.meta.id), type: "manual", worldId: world.id, worldName: world.name, playthroughId: ptIds.get(save.meta.playthroughId)! };
    const linkedState = remap(save.state, save.meta.playthroughId);
    const state = linkedState.entryContext ? { ...linkedState, entryContext: rebaseEntryContext(linkedState.entryContext, save.world.id, world.id) } : linkedState;
    const saveKey = key(`save_data_${meta.id}`);
    if (!preset || !await loadFromDB(saveKey)) await saveToDB(saveKey, { ...save, state, meta, world });
    slots.push(meta);
  }
  const playthroughs = data.playthroughs.map((pt) => ({ ...pt, id: ptIds.get(pt.id)!, worldId: world.id, worldLineId: treeIds.get(pt.worldLineId) ?? "" }));
  await appendIndex(key("playthrough_index"), playthroughs);
  await appendIndex(key("save_index"), slots);
  if (data.legacyDocuments?.length && playthroughs[0]) {
    const documentScope = currentDocumentScope({ currentWorld: world, currentPlaythroughId: playthroughs[0].id, ...scope })!;
    await saveToDB(documentScopeKey(documentScope), data.legacyDocuments);
  }
  return { playthroughs, saves: slots };
}
