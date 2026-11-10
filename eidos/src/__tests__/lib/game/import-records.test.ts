// ============================================================
// Eidos 世界导入测试
// ============================================================

import { describe, expect, it } from "vitest";
import {
  buildImportPreview,
  finalizeImportedWorld,
  parseWorldImportFiles,
  type ImportSourceFile,
} from "@/lib/game/import-records";
import type { WorldDefinition } from "@/lib/game/types";

function makeWorld(overrides: Partial<WorldDefinition> = {}): WorldDefinition {
  return {
    id: "rift-city",
    name: "裂隙之城",
    subtitle: "测试世界",
    overview: "一个用于导入测试的世界。",
    regions: {
      core: {
        id: "core",
        description: "核心区",
        scenes: {
          plaza: {
            id: "plaza",
            name: "中央广场",
            region: "core",
            initialDescription: "广场上有一座偏移的日晷。",
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
    ...overrides,
  };
}

function source(path: string, payload: unknown): ImportSourceFile {
  return {
    path,
    content: JSON.stringify(payload),
  };
}

describe("parseWorldImportFiles", () => {
  it('keeps authored identity entries through import and ID rebasing', () => {
    const identityOptions = [{ id: 'visitor', name: '访客', description: '来自港口', openingNarrative: '你停在广场的日晷前。', startingScene: 'plaza' }];
    const result = parseWorldImportFiles([source('world.json', makeWorld({ identityOptions }))]);
    const imported = finalizeImportedWorld(result.world, { existingWorldIds: new Set([result.world.id]), importedAt: 123 });
    expect(imported.id).not.toBe(result.world.id);
    expect(imported.identityOptions).toEqual(identityOptions);
  });
  it("extracts the world definition from an Eidos records package", () => {
    const world = makeWorld();
    const result = parseWorldImportFiles([
      source("manifest.json", {
        formatVersion: "eidos_records_package_v1",
        files: ["world/world.json", "restore/state.json"],
      }),
      source("world/world.json", world),
      source("restore/state.json", { playerName: "林" }),
    ]);

    expect(result.sourceKind).toBe("records_package");
    expect(result.world.name).toBe("裂隙之城");
    expect(result.hasRestoreState).toBe(true);
  });

  it("accepts a standalone world json file", () => {
    const result = parseWorldImportFiles([
      source("world.json", makeWorld({ id: "paper-city", name: "纸城" })),
    ]);

    expect(result.sourceKind).toBe("world_json");
    expect(result.world.id).toBe("paper-city");
    expect(result.hasRestoreState).toBe(false);
  });

  it("preserves source archive data on imported worlds", () => {
    const result = parseWorldImportFiles([
      source("world.json", makeWorld({
        sourceMode: "source_archive",
        sourceArchive: {
          corpus: {
            id: "corpus_1",
            documents: [],
            language: "zh-CN",
            createdAt: 1,
          },
          evidence: [],
          ledger: {
            id: "ledger_1",
            title: "资料档案",
            summary: "来自玩家资料。",
            entities: [],
            relationships: [],
            events: [],
            worldRules: [],
            unresolvedQuestions: [],
            contradictions: [],
            sourceCoverage: {
              documentCount: 1,
              evidenceCount: 0,
              highConfidenceCount: 0,
            },
          },
          adaptationPlan: {
            mode: "faithful",
            playablePremise: "来自玩家资料。",
            lockedFacts: [],
            allowedInventions: [],
            forbiddenInventions: [],
            bridgeContent: [],
          },
        },
      })),
    ]);

    expect(result.world.sourceMode).toBe("source_archive");
    expect(result.world.sourceArchive?.ledger.title).toBe("资料档案");
  });

  it("recognizes flattened fallback download names", () => {
    const result = parseWorldImportFiles([
      source("裂隙之城_记录__manifest.json", {
        formatVersion: "eidos_records_package_v1",
        files: ["world/world.json"],
      }),
      source("裂隙之城_记录__world__world.json", makeWorld()),
    ]);

    expect(result.sourceKind).toBe("records_package");
    expect(result.world.id).toBe("rift-city");
  });

  it("rejects missing or malformed world data", () => {
    expect(() =>
      parseWorldImportFiles([source("manifest.json", {
        formatVersion: "eidos_records_package_v1",
        files: ["world/world.json"],
      })]),
    ).toThrow(/world/i);

    expect(() => parseWorldImportFiles([source("world.json", { name: "" })]))
      .toThrow(/world/i);
  });
});

describe("buildImportPreview", () => {
  it("detects meta reality files in import packages", () => {
    const preview = buildImportPreview([
      source("manifest.json", {
        formatVersion: "eidos_export_package_v2",
        packageKind: "world",
        counts: { playthroughs: 0, actions: 0 },
        privacy: {
          includesAiTelemetry: false,
          includesSourceDocuments: false,
          includesMetaReality: true,
        },
      }),
      source("world/world.json", makeWorld()),
      source("meta-reality/manifest.json", {
        id: "manifest_gentle",
        title: "温柔同行",
        tone: "gentle",
        channels: [],
        forbiddenMoves: [],
      }),
    ]);

    expect(preview.hasMetaReality).toBe(true);
    expect(preview.fileCount).toBe(3);
  });
});

describe("finalizeImportedWorld", () => {
  it("marks imports as player-created and preserves non-conflicting ids", () => {
    const imported = finalizeImportedWorld(makeWorld(), {
      existingWorldIds: new Set(["builtin"]),
      importedAt: 100,
    });

    expect(imported.id).toBe("rift-city");
    expect(imported.isPlayerCreated).toBe(true);
    expect(imported.createdAt).toBe(100);
  });

  it("generates a duplicate-safe id when the imported world already exists", () => {
    const imported = finalizeImportedWorld(makeWorld(), {
      existingWorldIds: new Set(["rift-city", "rift-city_imported_100"]),
      importedAt: 100,
    });

    expect(imported.id).toBe("rift-city_imported_100_2");
    expect(imported.name).toBe("裂隙之城");
  });

  it("keeps source archive data when finalizing imported worlds", () => {
    const imported = finalizeImportedWorld(makeWorld({
      sourceMode: "source_archive",
      sourceArchive: {
        corpus: { id: "corpus_1", documents: [], language: "zh-CN", createdAt: 1 },
        evidence: [],
        ledger: {
          id: "ledger_1",
          title: "资料档案",
          summary: "来自玩家资料。",
          entities: [],
          relationships: [],
          events: [],
          worldRules: [],
          unresolvedQuestions: [],
          contradictions: [],
          sourceCoverage: { documentCount: 1, evidenceCount: 0, highConfidenceCount: 0 },
        },
        adaptationPlan: {
          mode: "faithful",
          playablePremise: "来自玩家资料。",
          lockedFacts: [],
          allowedInventions: [],
          forbiddenInventions: [],
          bridgeContent: [],
        },
      },
    }), {
      existingWorldIds: new Set(),
      importedAt: 100,
    });

    expect(imported.sourceArchive?.ledger.id).toBe("ledger_1");
    expect(imported.createdAt).toBe(100);
  });
});
