// ============================================================
// Eidos 游戏记录导出包测试
// ============================================================

import { describe, expect, it } from "vitest";
import {
  buildExportPackage,
  collectExportData,
  toMarkdown,
} from "@/lib/game/export-records";
import type { ActionRecord, SerializedGameState, WorldDefinition } from "@/lib/game/types";
import { buildTestSaveState } from '@/lib/test/fixtures';

function makeWorld(): WorldDefinition {
  return {
    id: "rift-city",
    name: "裂隙之城",
    subtitle: "测试导出",
    overview: "一个用于导出测试的世界。",
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
            npcs: ["观测员埃琳娜"],
            secrets: [],
            detailLevel: 10,
            discoveredSecrets: [],
          },
        },
      },
    },
    npcs: {
      "观测员埃琳娜": "负责观测裂隙的研究员。",
    },
    contradictions: [],
    history: [],
    clues: [],
    timeline: [],
    isPlayerCreated: false,
    createdAt: 1,
    systemPromptBase: "你是 ALICE。",
    identityPrompt: "",
    calendarEra: "新历",
  };
}

function makeAction(index: number): ActionRecord {
  return {
    id: `action-${index}`,
    timestamp: 1000 + index,
    gameTime: { day: 1, hour: 9, minute: index },
    sceneId: "plaza",
    sceneName: "中央广场",
    playerInput: `行动 ${index}`,
    aiResponse: `叙事回应 ${index}`,
    summary: `摘要 ${index}`,
    timeSpent: { day: 0, hour: 0, minute: 5 },
    worldImpacts: [`影响 ${index}`],
    availableActions: ["继续观察"],
    snapshot: null,
  };
}

describe("buildExportPackage", () => {
  it("splits one bulky export into a directory-style file manifest", () => {
    const world = makeWorld();
    const data = collectExportData(world, "测试玩家", [
      makeAction(1),
      makeAction(2),
    ]);
    const pkg = buildExportPackage(data, {
      rootName: "裂隙之城_记录",
      personalityAuditJson: JSON.stringify({ version: "audit_v1", entries: [] }),
      uzqAuditJson: JSON.stringify({ version: "uzq_audit_v1", entries: [] }),
    });
    const paths = pkg.files.map((file) => file.path).sort();

    expect(pkg.rootName).toBe("裂隙之城_记录");
    expect(paths).toEqual(
      expect.arrayContaining([
        "manifest.json",
        "summary.md",
        "world/world.json",
        "history/index.json",
        "history/action-0001.json",
        "history/action-0001.md",
        "history/action-0002.json",
        "telemetry/summary.json",
        "audits/personality-audit.json",
        "audits/uzq-audit.json",
      ]),
    );
    const action = pkg.files.find((file) => file.path === "history/action-0001.md")!.content;
    expect(action).toContain('### Action 1');
    expect(action).toContain('**Player action**');
    expect(action).toContain('> 行动 1');
    expect(action).toContain('叙事回应 1');
    expect(action).toContain('Elapsed time: 5 min');
    expect(pkg.files.find(file => file.path === 'summary.md')?.content).toContain('- Player: 测试玩家');
    expect(toMarkdown(data)).toContain('## Interaction history');
    expect(buildExportPackage(data).rootName).toMatch(/^裂隙之城_records_/u);

    const manifest = JSON.parse(pkg.files.find((file) => file.path === "manifest.json")!.content);
    // v2 manifest: files 是对象数组 [{path, crc32, bytes}]，检查路径是否包含
    const manifestPaths = manifest.files.map((f: Record<string, unknown>) => f.path);
    expect(manifestPaths).toContain("audits/uzq-audit.json");
  });

  it("produces manifest v2 with file checksums and privacy fields", () => {
    const world = makeWorld();
    const data = collectExportData(world, "测试玩家", [makeAction(1)]);
    const pkg = buildExportPackage(data, {
      rootName: "测试导出",
      restoreState: { playerName: "测试", currentScene: "plaza" } as never,
    });

    const manifest = JSON.parse(pkg.files.find((file) => file.path === "manifest.json")!.content);

    // v2 格式字段
    expect(manifest.formatVersion).toBe("eidos_export_package_v2");
    expect(manifest.packageKind).toBe("playthrough");
    expect(manifest.app.name).toBe("Eidos");
    expect(manifest.app.version).toBeDefined();
    expect(manifest.generatedAt).toBeDefined();

    // 世界信息
    expect(manifest.world.id).toBe("rift-city");
    expect(manifest.world.name).toBe("裂隙之城");

    // 计数
    expect(manifest.counts.actions).toBe(1);

    // 隐私标记
    expect(manifest.privacy.apiKeysRedacted).toBe(true);
    expect(manifest.privacy.includesPlayerText).toBe(true);
    expect(manifest.privacy.includesSourceDocuments).toBe(false);

    // 恢复锚点
    expect(manifest.restore.stateFile).toBe("restore/state.json");

    // 文件清单（v2 格式：对象数组，含 crc32 和 bytes）
    expect(Array.isArray(manifest.files)).toBe(true);
    const manifestEntry = manifest.files.find((f: Record<string, unknown>) => f.path === "manifest.json");
    expect(manifestEntry).toBeDefined();
    const worldEntry = manifest.files.find((f: Record<string, unknown>) => f.path === "world/world.json");
    expect(worldEntry).toBeDefined();
    expect(typeof worldEntry.crc32).toBe("string");
    expect(worldEntry.crc32.length).toBe(8);
    expect(typeof worldEntry.bytes).toBe("number");
    expect(worldEntry.bytes).toBeGreaterThan(0);
  });

  it("exports sandbox snapshot index and tool execution audit when provided", () => {
    const world = makeWorld();
    const data = collectExportData(world, "测试玩家", [makeAction(1)]);
    const pkg = buildExportPackage(data, {
      rootName: "沙箱导出",
      sandboxSnapshotsJson: JSON.stringify({ version: "sandbox_snapshots_v1", records: [] }),
      sandboxToolExecutionsJson: JSON.stringify({ version: "sandbox_tool_audit_v1", entries: [] }),
    });
    const paths = pkg.files.map((file) => file.path);

    expect(paths).toContain("sandbox/snapshots/index.json");
    expect(paths).toContain("sandbox/tool-executions.json");
    expect(pkg.files.find((file) => file.path === "sandbox/tool-executions.json")?.content)
      .toContain("sandbox_tool_audit_v1");

    const manifest = JSON.parse(pkg.files.find((file) => file.path === "manifest.json")!.content);
    const manifestPaths = manifest.files.map((file: Record<string, unknown>) => file.path);
    expect(manifestPaths).toContain("sandbox/snapshots/index.json");
    expect(manifestPaths).toContain("sandbox/tool-executions.json");
  });

  it("exports meta reality artifacts, boundary events, and manifest from restore state", () => {
    const world = makeWorld();
    const data = collectExportData(world, "测试玩家", [makeAction(1)]);
    const restoreState: SerializedGameState = {
      ...buildTestSaveState(world),
      playerName: "测试玩家",
      currentSceneId: "plaza",
      realityArtifacts: [
        {
          id: "ra_1",
          kind: "image",
          label: "sea.png",
          consent: { grantedAt: 100, scope: "summary_only", revocable: true },
          summary: "一张来自边界外的海面图像。",
          visibleTo: ["Niko"],
          introducedAtWorldLineNodeId: "node_1",
          safetyNotes: [],
          createdAt: 100,
        },
      ],
      boundaryEvents: [
        {
          id: "be_1",
          type: "artifact_introduced",
          actor: "player",
          artifactId: "ra_1",
          worldLineNodeId: "node_1",
          visibleConsequences: ["Niko 第一次看见了海。"],
          hiddenAudit: ["玩家主动导入图片。"],
          createdAt: 101,
        },
      ],
      metaChannelManifest: {
        id: "manifest_gentle",
        title: "温柔同行",
        tone: "gentle",
        channels: [],
        forbiddenMoves: ["不得声称读取桌面"],
      },
    };

    const pkg = buildExportPackage(data, {
      rootName: "现实边界导出",
      restoreState,
    });
    const paths = pkg.files.map((file) => file.path);

    expect(paths).toEqual(expect.arrayContaining([
      "meta-reality/artifacts.json",
      "meta-reality/boundary-events.json",
      "meta-reality/manifest.json",
    ]));
    expect(pkg.files.find((file) => file.path === "meta-reality/artifacts.json")?.content)
      .toContain("sea.png");

    const manifest = JSON.parse(pkg.files.find((file) => file.path === "manifest.json")!.content);
    expect(manifest.privacy.includesMetaReality).toBe(true);
    const manifestPaths = manifest.files.map((file: Record<string, unknown>) => file.path);
    expect(manifestPaths).toContain("meta-reality/artifacts.json");
  });
});

it('exports complete model documents and raw responses with the record package', () => {
  const content='长文档。'.repeat(300)+'文档末尾';
  const pkg=buildExportPackage(collectExportData(makeWorld(),'玩家',[]),{modelDocuments:[{
    id:'doc',title:'报告',format:'markdown',content,createdAt:1,updatedAt:1,request:'分析',parts:[{content,rawOutput:'原始返回',request:'分析',createdAt:1}]
  }]});
  expect(pkg.files.find(file=>file.path==='documents/document-0001.md')?.content).toContain(content);
  expect(pkg.files.find(file=>file.path==='documents/document-0001-raw.json')?.content).toContain('原始返回');
  expect(JSON.parse(pkg.files.find(file=>file.path==='documents/index.json')!.content)[0].content).toBe(content);
});
