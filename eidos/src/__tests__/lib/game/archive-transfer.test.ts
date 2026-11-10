import { beforeEach, describe, expect, it, vi } from "vitest";
import { collectArchiveRecovery, readArchiveRecovery, restoreArchiveRecovery } from "@/lib/game/archive-transfer";
import { buildWorldArchiveExportPackage } from "@/lib/game/world-export";
import { buildExportPackage, collectExportData } from "@/lib/game/export-records";
import { parseWorldImportFiles } from "@/lib/game/import-records";
import type { GameSave, PlaythroughMeta, WorldDefinition, WorldLineMeta, WorldLineNode } from "@/lib/game/types";
import { scopeStorageKey } from "@/lib/game/archive-scope";
import { buildEntryContext } from '@/lib/game/world-entry';

const { db, blobs } = vi.hoisted(() => ({ db: new Map<string, unknown>(), blobs: new Map<string, unknown>() }));
vi.mock("@/lib/game/storage", () => ({
  loadFromDB: async (key: string) => db.get(key) ?? null,
  loadMeta: async (key: string) => db.get(key) ?? null,
  saveToDB: async (key: string, value: unknown) => { db.set(key, structuredClone(value)); },
  saveMeta: async (key: string, value: unknown) => { db.set(key, structuredClone(value)); },
  updateMeta: async (key: string, update: (value: unknown) => unknown) => { db.set(key, structuredClone(update(db.get(key) ?? null))); },
  autoSaveDataKey: (id: string) => `autosave_data_${id}`,
}));
vi.mock("@/lib/game/cas-storage", () => ({
  loadBlob: vi.fn(async (hash: string) => blobs.get(hash) ?? null),
  loadBlobs: vi.fn(async (hashes: string[]) => new Map(hashes.map(hash => [hash, blobs.get(hash) ?? null]))),
  storeBlob: async (hash: string, _type: string, value: unknown) => { blobs.set(hash, value); },
}));

const world = { id: "world", name: "世界", subtitle: "", overview: "设定", regions: { region: { scenes: { scene: { id: "scene", name: "入口" } } } }, npcs: {}, contradictions: [], history: [], timeline: [], clues: [], systemPromptBase: "", identityPrompt: "", isPlayerCreated: true, createdAt: 1 } as unknown as WorldDefinition;
const pt = { id: "pt", worldId: world.id, name: "周目", worldLineId: "", gameTime: { day: 1, hour: 8, minute: 0 } } as PlaythroughMeta;
const save = { meta: { id: "autosave_pt", worldId: world.id, playthroughId: pt.id, name: "检查点" }, world, state: { playerName: "玩家", currentSceneId: "scene", gameTime: pt.gameTime, history: [], sceneNarrative: "保留的叙事" } } as unknown as GameSave;
const meta = { id: "tree", worldId: world.id, playthroughId: pt.id, rootNodeId: "root", currentNodeId: "root" } as WorldLineMeta;
const node = { id: "root", snapshotHash: "snapshot", segmentHash: "segments", childIds: [] } as unknown as WorldLineNode;
const scope = { sandboxMode: false, sandboxDossierId: null };

beforeEach(() => { db.clear(); blobs.clear(); });

describe("archive transfer", () => {
  it('rebinds the saved identity to the explicitly imported world while preserving its original opening', async () => {
    const entryContext = buildEntryContext({ world, playerName: '小雾', startingSceneId: 'scene', option: { id: 'asagiri', name: '朝雾', description: '档案管理员', openingNarrative: '朝雾看着旧店招。', startingScene: 'scene' } });
    const source = { ...save, state: { ...save.state, entryContext } };
    const recovery = { version: 'eidos_archive_v1' as const, playthroughs: [pt], saves: [source], trees: [], blobs: {} };
    const result = await restoreArchiveRecovery(recovery, { ...world, id: 'new-world' }, scope);
    const restored = db.get(`save_data_${result.saves[0].id}`) as GameSave;
    expect(restored.state.entryContext).toEqual({ ...entryContext, worldId: 'new-world' });
    expect(source.state.entryContext.worldId).toBe('world');
  });
  it("round trips full saves and worldline blobs with new IDs in the selected scope", async () => {
    db.set("autosave_data_pt", save);
    db.set("worldline_index_world", [meta]);
    db.set("worldline_data_tree", { meta, nodes: { root: node } });
    blobs.set("snapshot", { playerName: "玩家" }); blobs.set("segments", [{ text: "叙事" }]);
    const recovery = await collectArchiveRecovery(world.id, [{ ...pt, saves: [save.meta] }], scope);
    expect(recovery.playthroughs[0].worldLineId).toBe("tree");
    const pkg = buildWorldArchiveExportPackage({ world, continuities: [{ ...pt, saves: [save.meta] }], recovery });
    const files = pkg.files.map((file) => ({ ...file, path: `folder/${file.path}` }));
    const parsed = parseWorldImportFiles(files);
    const restoredData = readArchiveRecovery(files, parsed.world)!;
    const imported = { ...world, id: "new-world" };
    const sandbox = { sandboxMode: true, sandboxDossierId: "test" };
    const result = await restoreArchiveRecovery(restoredData, imported, sandbox);
    expect(result.playthroughs[0].id).not.toBe(pt.id);
    expect(result.saves[0].type).toBe("manual");
    const restored = db.get(scopeStorageKey(sandbox, `save_data_${result.saves[0].id}`)) as GameSave;
    expect(restored.state).toEqual(save.state);
    expect(restored.world.id).toBe("new-world");
    expect(restored.meta.playthroughId).toBe(result.playthroughs[0].id);
    expect(db.get("autosave_data_pt")).toEqual(save);
    const tree = db.get(scopeStorageKey(sandbox, `worldline_data_${result.playthroughs[0].worldLineId}`)) as { meta: WorldLineMeta };
    expect(tree.meta.currentNodeId).toBe("root");
    expect(tree.meta.playthroughId).toBe(result.playthroughs[0].id);
    expect(blobs.get("segments")).toEqual([{ text: "叙事" }]);
  });

  it("turns an exported game record into a loadable restore point", async () => {
    const pkg = buildExportPackage(collectExportData(world, "玩家", []), { restoreState: save.state });
    const recovery = readArchiveRecovery(pkg.files, world)!;
    const first = await restoreArchiveRecovery(recovery, world, scope);
    const second = await restoreArchiveRecovery(recovery, world, scope);
    expect(first.saves[0].id).not.toBe(second.saves[0].id);
    expect(first.saves[0].playerName).toBe("玩家");
    expect((db.get(`save_data_${first.saves[0].id}`) as GameSave).state.sceneNarrative).toBe("保留的叙事");
    expect(db.get("save_index")).toHaveLength(2);
  });

  it("rejects missing save contents instead of exporting an unusable index", async () => {
    await expect(collectArchiveRecovery(world.id, [{ ...pt, saves: [save.meta] }], scope)).rejects.toThrow("内容缺失");
  });

  it("rejects broken references before writing an import", () => {
    const recovery = { version: "eidos_archive_v1", playthroughs: [pt], saves: [{ ...save, meta: { ...save.meta, playthroughId: "absent" } }], trees: [], blobs: {} };
    expect(() => readArchiveRecovery([{ path: "library/recovery.json", content: JSON.stringify(recovery) }], world)).toThrow("关联无效");
    expect(db.size).toBe(0);
  });
});

it('loads archive CAS blocks once in batches even when many nodes share a snapshot',async()=>{
 const {loadBlob,loadBlobs}=await import('@/lib/game/cas-storage');vi.mocked(loadBlob).mockClear();vi.mocked(loadBlobs).mockClear();
 db.set('worldline_index_world',[meta]);
 const nodes=Object.fromEntries(Array.from({length:200},(_,i)=>[`n${i}`,{...node,id:`n${i}`} ]));
 db.set('worldline_data_tree',{meta,nodes});blobs.set('snapshot',{playerName:'玩家'});blobs.set('segments',[{text:'正文'}]);
 const result=await collectArchiveRecovery(world.id,[{...pt,worldLineId:'tree'}],scope);
 expect(Object.keys(result.blobs).sort()).toEqual(['segments','snapshot']);
 expect(loadBlob).not.toHaveBeenCalled();expect(loadBlobs).toHaveBeenCalledOnce();
});
