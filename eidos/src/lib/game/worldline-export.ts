import { actionEntryCues } from './action-entry';
import { reindexPresentations } from './presentation';
import { collectDocumentBundle, restoreDocumentBundle, validateDocumentBundle, validateResourceBundle, assertDocumentReferences, remapDocumentReferences } from './documents/transfer';
import { documentScopeKey, currentDocumentScope } from './model-documents';
import type { DocumentScope } from './documents/types';
import type { ArchiveScopeSource } from './archive-scope';
import { resourceReferences, readModResource, storeModResource } from './plugins/workspace';
import { collectModMail, restoreModMail } from './plugins/mailbox';
import { normalizeVoiceConfig, normalizeVoiceAssets, type VoiceConfig, type VoiceAsset } from "./momoi/model";
// ============================================================
// Eidos · 世界线导出 / 导入逻辑
// ============================================================
// 导出：从世界线树收集节点 + 对应的 CAS 快照/分段 → WorldLineExport
// 导入：将 WorldLineExport 还原为 WorldLineNode 树 + CAS 存储
// ============================================================

import type {
  WorldLineNode,
  WorldLineMeta,
  WorldLineExport,
  WorldSnapshot,
  WorldDefinition,
} from "./types";
import { computeContentHash, storeBlob } from "./cas-storage";
import type { StorySegment } from '@/lib/ai/types';
import type { Presentation } from './presentation';

// ============================================================
// 导出
// ============================================================

export interface ExportTreeOptions {
  documentScope?: DocumentScope; archiveScope?: ArchiveScopeSource;
  voiceAssets?: Record<string, VoiceAsset>;
  voiceConfig?: VoiceConfig;
  meta: WorldLineMeta;
  allNodes: Record<string, WorldLineNode>;
  world: WorldDefinition;
  playerName: string;
  /** 要导出的根节点 ID */
  rootNodeId: string;
  /** 额外选中的节点 ID（必须都是 rootNodeId 的子孙） */
  selectedNodeIds?: string[];
  /** 加载快照的函数（由 store 注入） */
  loadSnapshot: (hash: string) => Promise<WorldSnapshot | null>;
  /** 加载分段的函数 */
  loadSegments: (hash: string) => Promise<any[] | null>;
  loadBlobs?: (hashes: string[]) => Promise<Map<string, unknown | null>>;
}

function portablePresentations(nodes:Record<string,WorldLineNode>,ids:Set<string>):Map<string,Presentation> {
  const events=[...ids].flatMap(id=>[...(nodes[id].entry ? actionEntryCues(nodes[id].entry!,id) : []),...(nodes[id].presentation?.cues ?? [])]);
  const retained=new Set(events.filter(cue=>ids.has(cue.targetNode)).map(cue=>cue.id));
  // Restore chains are executable only if their original event is in this archive.
  let changed=true;
  while(changed) {
    changed=false;
    for(const cue of events) if(retained.has(cue.id) && cue.effect.kind==='restore' && !retained.has(cue.effect.effectId!)) {
      retained.delete(cue.id);changed=true;
    }
  }
  const result=new Map<string,Presentation>();
  for(const id of ids) {
    const p=nodes[id].presentation;if(!p) continue;
    const detached=p.cues.filter(cue=>!retained.has(cue.id));
    if(!detached.length) {result.set(id,p);continue;}
    const keep=<T>(values:Record<string,T>)=>Object.fromEntries(Object.entries(values).filter(([key])=>retained.has(key)));
    // The arrival already owns its resolved display. Keep external effects as
    // provenance rather than inventing missing story nodes in a standalone export.
    result.set(id,{...p,cues:p.cues.filter(cue=>retained.has(cue.id)),detachedCues:[...(p.detachedCues ?? []),...detached],
      fired:keep(p.fired),armed:keep(p.armed),order:keep(p.order ?? {}),motion:keep(p.motion ?? {})});
  }
  return result;
}

/**
 * 收集子树中的所有节点 ID（含 nodeId 自身）。
 */
export function collectSubtreeNodeIds(
  allNodes: Record<string, WorldLineNode>,
  rootNodeId: string
): string[] {
  const result: string[] = [];
  const stack = [rootNodeId];
  const seen = new Set<string>();
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    const node = allNodes[id];
    if (!node) continue;
    result.push(id);
    for (const childId of node.childIds) {
      stack.push(childId);
    }
  }
  return result;
}

/**
 * 检查 nodeId 是否是 ancestorId 的子孙。
 */
export function isDescendantOf(
  allNodes: Record<string, WorldLineNode>,
  nodeId: string,
  ancestorId: string
): boolean {
  let current = allNodes[nodeId]?.parentId;
  const seen = new Set<string>();
  while (current) {
    if (current === ancestorId) return true;
    if (seen.has(current)) return false;
    seen.add(current);
    current = allNodes[current]?.parentId;
  }
  return false;
}

/**
 * 从世界线树导出选定节点的内容为 WorldLineExport。
 */
export async function buildWorldLineExport(
  opts: ExportTreeOptions
): Promise<WorldLineExport> {
  const {
    meta,
    allNodes,
    world,
    playerName,
    rootNodeId,
    selectedNodeIds = [],
    loadSnapshot,
    loadSegments,
  } = opts;

  if (!allNodes[rootNodeId]) throw new Error('导出根节点缺失');
  // The full root subtree already contains selected descendants; visit it only once.
  const allExportIds = new Set(collectSubtreeNodeIds(allNodes, rootNodeId));
  if (allNodes[rootNodeId].parentId && allExportIds.has(allNodes[rootNodeId].parentId!)) throw new Error('世界线存在循环连接');
  for (const id of allExportIds) for (const child of allNodes[id].childIds) {
    if (!allNodes[child]) throw new Error(`世界线节点 ${child} 缺失`);
    if (allNodes[child].parentId !== id) throw new Error('世界线父子连接不一致');
  }
  for (const nid of selectedNodeIds) {
    if (!allExportIds.has(nid)) {
      throw new Error(`节点 ${nid} 不是根节点 ${rootNodeId} 的子孙节点`);
    }
  }

  // 3. 收集节点 + 对应的快照/分段
  const nodes: WorldLineNode[] = [];
  const snapshots: Record<string, WorldSnapshot> = {};
  const segments: Record<string, any[]> = {};
  const snapshotHashMap = new Map<string, string>();  // hash → loaded (dedup)
  const segmentHashMap = new Map<string, string>();
  const hashes = [...new Set([...allExportIds].flatMap(id => [allNodes[id].snapshotHash, allNodes[id].entry?.snapshotHash, allNodes[id].segmentHash].filter((hash):hash is string=>Boolean(hash))))];
  const contents = opts.loadBlobs ? await opts.loadBlobs(hashes) : null;
  const presentations=portablePresentations(allNodes,allExportIds);

  let lastGameTime = { day: 0, hour: 8, minute: 0 };

  for (const nid of allExportIds) {
    const node = allNodes[nid];
    if (!node) continue;
    nodes.push({ ...node,...(presentations.has(nid) ? {presentation:presentations.get(nid)} : {}) });

    for(const hash of [node.snapshotHash,node.entry?.snapshotHash]) if(hash && !snapshotHashMap.has(hash)) {
      const snap=(contents ? contents.get(hash) : await loadSnapshot(hash)) as WorldSnapshot | null;
      if(!snap) throw new Error(`节点 ${nid} 的快照原件缺失`);
      snapshots[hash]=snap;snapshotHashMap.set(hash,hash);
    }

    // Load segments (if not already loaded)
    if (node.segmentHash && !segmentHashMap.has(node.segmentHash)) {
      const segs = (contents ? contents.get(node.segmentHash) : await loadSegments(node.segmentHash)) as StorySegment[] | null;
      if (!segs) throw new Error(`节点 ${nid} 的正文原件缺失`);
      if (segs) {
        segments[node.segmentHash] = segs;
        segmentHashMap.set(node.segmentHash, node.segmentHash);
      }
    }

    // Track last game time
    if (
      node.gameTime.day > lastGameTime.day ||
      (node.gameTime.day === lastGameTime.day &&
        node.gameTime.hour > lastGameTime.hour)
    ) {
      lastGameTime = { ...node.gameTime };
    }
  }

  const documents = opts.documentScope ? await collectDocumentBundle({ scopes: [opts.documentScope], nodes: { nodes, snapshots } }) : undefined;
  const modResources: NonNullable<WorldLineExport['modResources']> = {};
  for (const [id, ref] of resourceReferences({ snapshots, nodes })) if (!documents?.resources[id]) modResources[id] = await readModResource(ref);
  const modMail = opts.documentScope ? await collectModMail(world.id, opts.documentScope.playthroughId, opts.archiveScope ?? {}) : undefined;
  for (const mails of Object.values(modMail ?? {})) for (const mail of Object.values(mails)) if (!documents?.resources[mail.resource.id]) modResources[mail.resource.id] = await readModResource(mail.resource);
  // 4. 组装导出数据
  return {
    ...(documents?.records.length ? { documents } : {}),
    ...(Object.keys(modResources).length ? { modResources } : {}),
    ...(modMail && Object.keys(modMail).length ? { modMail } : {}),
    voiceAssets: normalizeVoiceAssets(opts.voiceAssets),
    voiceConfig: normalizeVoiceConfig(opts.voiceConfig),
    formatVersion: "wl_export_v1",
    exportedAt: new Date().toISOString(),
    world,
    player: {
      name: playerName,
    },
    nodes,
    snapshots,
    segments,
    metadata: {
      rootNodeId,
      nodeCount: nodes.length,
      branchCount: nodes.filter((n) => n.childIds.length > 1).length,
      lastGameTime,
    },
  };
}

// ============================================================
// 导入
// ============================================================

export interface ImportWorldLineResult {
  worldLineId: string;
  meta: WorldLineMeta;
  allNodes: Record<string, WorldLineNode>;
}

/**
 * 验证 WorldLineExport 格式是否有效。
 */
export function validateExport(data: unknown): data is WorldLineExport {
  if (!data || typeof data !== "object") return false;
  const d = data as Record<string, unknown>;
  if (d.formatVersion !== "wl_export_v1") return false;
  if (!d.world || typeof d.world !== "object") return false;
  if (!Array.isArray(d.nodes) || d.nodes.length === 0) return false;
  if (!d.snapshots || typeof d.snapshots !== "object") return false;
  if (!d.metadata || typeof d.metadata !== "object") return false;
  const meta = d.metadata as Record<string, unknown>;
  if (!meta.rootNodeId || typeof meta.rootNodeId !== "string") return false;
  return true;
}

/**
 * 从 WorldLineExport 重建树结构。
 * 将节点存入 CAS 并将所有数据写入本地存储。
 */
export async function importWorldLineExport(
  data: WorldLineExport,
  worldId: string,
  playthroughId: string,
  archiveScope: ArchiveScopeSource = {}
): Promise<ImportWorldLineResult> {
  data = structuredClone(data);
  const priorPresentationNodes=Object.fromEntries(data.nodes.map(node=>[node.id,node]));
  for (const node of data.nodes) {
    if (node.snapshotHash && !data.snapshots[node.snapshotHash]) throw new Error('世界线快照缺失');
    if (node.segmentHash && !data.segments[node.segmentHash]) throw new Error('世界线分段缺失');
    if(node.entry && (node.entry.version!==1 || !node.entry.id || !Array.isArray(node.entry.changes) || !data.snapshots[node.entry.snapshotHash])) throw new Error('世界线入场信息或快照缺失');
  }
  await validateResourceBundle(data.modResources ?? {});
  for (const id of resourceReferences({ snapshots: data.snapshots, nodes: data.nodes }).keys()) if (!data.modResources?.[id] && !data.documents?.resources[id]) throw new Error('世界线缺少文件原件');
  for (const mails of Object.values(data.modMail ?? {})) for (const mail of Object.values(mails)) if (!data.modResources?.[mail.resource.id] && !data.documents?.resources[mail.resource.id]) throw new Error('世界线缺少邮件原件');
  if (data.documents) {
    await validateDocumentBundle(data.documents);
    const scopes = new Map(data.documents.records.map(d => [documentScopeKey(d.scope), d.scope]));
    for (const group of data.documents.legacy ?? []) scopes.set(documentScopeKey(group.scope), group.scope);
    if (scopes.size > 1) throw new Error('世界线文档必须属于同一来源周目');
    const old = [...scopes.values()][0];
    assertDocumentReferences({ nodes: data.nodes, snapshots: data.snapshots, segments: data.segments }, old ?? { worldId, playthroughId }, data.documents);
    if (old) {
      const dest = currentDocumentScope({ currentWorld: { id: worldId }, currentPlaythroughId: playthroughId, ...archiveScope })!;
      const mapping = await restoreDocumentBundle(data.documents, new Map([[documentScopeKey(old), dest]]));
      data.nodes = remapDocumentReferences(data.nodes, old, mapping, dest);
      data.snapshots = remapDocumentReferences(data.snapshots, old, mapping, dest);
      data.segments = remapDocumentReferences(data.segments, old, mapping, dest);
    }
  }
  for (const [id, resource] of Object.entries(data.modResources ?? {})) if ((await storeModResource(resource)).id !== id) throw new Error('世界线文件内容与版本不一致');
  if (data.modMail) await restoreModMail(data.modMail, worldId, playthroughId, archiveScope);
  // Remapping document IDs changes content: never publish it under a source hash.
  const snapshotHashes = new Map<string, string>(), segmentHashes = new Map<string, string>();
  for (const [sourceHash, snapshot] of Object.entries(data.snapshots)) {
    const hash = await computeContentHash(snapshot);
    await storeBlob(hash, "snapshot", snapshot);
    snapshotHashes.set(sourceHash, hash);
  }
  for (const [sourceHash, segments] of Object.entries(data.segments)) {
    const hash = await computeContentHash(segments);
    await storeBlob(hash, "segments", segments);
    segmentHashes.set(sourceHash, hash);
  }
  const allNodes: Record<string, WorldLineNode> = {};
  for (const node of data.nodes) allNodes[node.id] = { ...node,
    ...(node.entry ? {entry:{...node.entry,snapshotHash:snapshotHashes.get(node.entry.snapshotHash)!}} : {}),
    snapshotHash: snapshotHashes.get(node.snapshotHash) ?? node.snapshotHash,
    segmentHash: segmentHashes.get(node.segmentHash) ?? node.segmentHash };

  const indexed=reindexPresentations(allNodes,Object.fromEntries(data.nodes.map(node=>[node.id,data.segments[node.segmentHash] as StorySegment[]])),priorPresentationNodes);
  Object.assign(allNodes,indexed);

  // 4. 创建 WorldLineMeta
  const now = Date.now();
  const worldLineId = `worldline_${now}_${Math.random().toString(36).slice(2, 8)}`;

  const meta: WorldLineMeta = {
    ...(data.world.gameplayPluginHistory ? { gameplayPluginHistory: data.world.gameplayPluginHistory } : {}),
    id: worldLineId,
    playthroughId,
    worldId,
    rootNodeId: data.metadata.rootNodeId,
    allNodeIds: data.nodes.map((n) => n.id),
    currentNodeId: data.metadata.rootNodeId,
    branchCount: data.metadata.branchCount,
    totalSteps: data.metadata.nodeCount,
    createdAt: now,
    updatedAt: now,
  };

  return { worldLineId, meta, allNodes };
}
