import { describe, expect, it } from "vitest";

import { parseWorldImportFiles } from "@/lib/game/import-records";
import {
  buildWorldArchiveExportPackage,
  buildWorldOnlyExportPackage,
} from "@/lib/game/world-export";
import type { PlaythroughMeta, SaveSlot, WorldDefinition } from "@/lib/game/types";

function makeWorld(): WorldDefinition {
  return {
    id: "paper-city",
    name: "纸城",
    subtitle: "折叠的历史",
    overview: "一座由档案构成的城市。",
    regions: {
      core: {
        id: "core",
        description: "核心区",
        scenes: {
          hall: {
            id: "hall",
            name: "门厅",
            region: "core",
            initialDescription: "纸页像潮水一样堆在门后。",
            connections: [],
            npcs: [],
            secrets: [],
            detailLevel: 10,
            discoveredSecrets: [],
          },
        },
      },
    },
    npcs: {},
    contradictions: [],
    history: [],
    timeline: [],
    clues: [],
    systemPromptBase: "你是 ALICE。",
    identityPrompt: "",
    isPlayerCreated: true,
    createdAt: 1,
  };
}

function makeContinuity(): PlaythroughMeta & { saves: SaveSlot[] } {
  const playthrough = {
    id: "pt-paper",
    worldId: "paper-city",
    name: "第一连续性",
    updatedAt: 2,
    playerName: "林",
    gameTime: { day: 1, hour: 8, minute: 0 },
    actionCount: 3,
    status: "active",
  } as PlaythroughMeta;
  const save = {
    id: "save-paper",
    worldId: "paper-city",
    playthroughId: playthrough.id,
    name: "入口",
    updatedAt: 3,
    gameTime: playthrough.gameTime,
    currentSceneName: "门厅",
    actionCount: 3,
    preview: "推开档案馆的门。",
  } as SaveSlot;

  return { ...playthrough, saves: [save] };
}

describe("world export packages", () => {
  it('uses English default names and labels while preserving the original world name', () => {
    const world = { ...makeWorld(), name: 'Cité 紙の城' };
    const generatedAt = '2026-06-29T00:00:00.000Z';
    const settings = buildWorldOnlyExportPackage(world, { generatedAt });
    const archive = buildWorldArchiveExportPackage({ world, generatedAt });
    expect(settings.rootName).toBe('Cité_紙の城_world_2026-06-29T00-00-00');
    expect(archive.rootName).toBe('Cité_紙の城_world_archive_2026-06-29T00-00-00');
    expect(archive.files.find(file => file.path === 'summary.md')?.content).toContain('# Cité 紙の城 — World export');
    expect(parseWorldImportFiles(archive.files).world).toEqual(world);
  });

  it("builds an importable world-only package", () => {
    const pkg = buildWorldOnlyExportPackage(makeWorld(), {
      generatedAt: "2026-06-29T00:00:00.000Z",
      rootName: "纸城_世界",
    });
    const paths = pkg.files.map((file) => file.path);

    expect(pkg.rootName).toBe("纸城_世界");
    expect(paths).toEqual(expect.arrayContaining(["manifest.json", "summary.md", "world/world.json"]));

    const manifest = JSON.parse(pkg.files.find((file) => file.path === "manifest.json")!.content);
    expect(manifest.formatVersion).toBe("eidos_export_package_v2");
    expect(manifest.packageKind).toBe("world");
    expect(manifest.counts.worlds).toBe(1);
    expect(manifest.counts.playthroughs).toBe(0);
    expect(manifest.privacy.includesPlayerText).toBe(false);

    const parsed = parseWorldImportFiles(pkg.files.map(({ path, content }) => ({ path, content })));
    expect(parsed.world.id).toBe("paper-city");
    expect(parsed.hasRestoreState).toBe(false);
  });

  it("exports meta channel manifest for worlds that declare reality channels", () => {
    const pkg = buildWorldOnlyExportPackage({
      ...makeWorld(),
      metaChannelManifest: {
        id: "manifest_gentle",
        title: "温柔同行",
        tone: "gentle",
        channels: [
          {
            id: "external_letter",
            kind: "text",
            promptToPlayer: "拖入一封外部信件。",
            worldInterpretation: "边界外的信件。",
            allowedConsumers: ["Niko"],
            consequenceTemplate: "角色把信件理解为玩家的帮助。",
            refusalFallback: "角色接受沉默。",
          },
        ],
        forbiddenMoves: ["不得读取未授权文件"],
      },
    }, {
      generatedAt: "2026-06-29T00:00:00.000Z",
      rootName: "纸城_现实通道",
    });

    const paths = pkg.files.map((file) => file.path);
    expect(paths).toContain("meta-reality/manifest.json");

    const manifest = JSON.parse(pkg.files.find((file) => file.path === "manifest.json")!.content);
    expect(manifest.privacy.includesMetaReality).toBe(true);
    const metaManifest = JSON.parse(pkg.files.find((file) => file.path === "meta-reality/manifest.json")!.content);
    expect(metaManifest.title).toBe("温柔同行");
  });

  it("builds a world archive package with continuity and save indexes", () => {
    const continuity = makeContinuity();
    const pkg = buildWorldArchiveExportPackage({
      world: makeWorld(),
      continuities: [continuity],
      generatedAt: "2026-06-29T00:00:00.000Z",
      rootName: "纸城_世界与周目",
    });
    const manifest = JSON.parse(pkg.files.find((file) => file.path === "manifest.json")!.content);
    const playthroughs = JSON.parse(pkg.files.find((file) => file.path === "library/playthroughs.json")!.content);
    const saves = JSON.parse(pkg.files.find((file) => file.path === "library/saves.json")!.content);

    expect(manifest.packageKind).toBe("world_archive");
    expect(manifest.counts.playthroughs).toBe(1);
    expect(manifest.counts.saves).toBe(1);
    expect(manifest.counts.actions).toBe(3);
    expect(playthroughs[0]).toMatchObject({ id: "pt-paper", worldId: "paper-city" });
    expect(saves[0]).toMatchObject({ id: "save-paper", playthroughId: "pt-paper" });
  });
});
