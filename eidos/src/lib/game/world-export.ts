import { withoutLegacyProgress } from './legacy-progress';
import type { ArchiveRecovery } from "./archive-transfer";
// ============================================================
// Eidos · 世界书库导出包
// ============================================================
// 世界定义包可复用设定；世界与周目包额外包含完整存档、世界线树及 CAS 内容。
// 当前对局的叙事和诊断记录由 export-records 导出。

import { sanitizeExportName, type ExportPackage, type ExportPackageFile } from "./export-records";
import type { PlaythroughMeta, SaveSlot, WorldDefinition } from "./types";
import { crc32 } from "./zip-writer";

export interface BuildWorldExportOptions {
  cardFiles?: ExportPackageFile[];
  generatedAt?: string;
  rootName?: string;
}

export interface BuildWorldArchiveExportInput extends BuildWorldExportOptions {
  world: WorldDefinition;
  recovery?: ArchiveRecovery;
  continuities?: Array<PlaythroughMeta & { saves?: SaveSlot[] }>;
}

type WorldPackageKind = "world" | "world_archive";

export function buildWorldOnlyExportPackage(
  world: WorldDefinition,
  options: BuildWorldExportOptions = {},
): ExportPackage {
  return buildWorldPackage({
    kind: "world",
    world,
    continuities: [],
    generatedAt: options.generatedAt,
    rootName: options.rootName,
    cardFiles: options.cardFiles,
  });
}

export function buildWorldArchiveExportPackage(
  input: BuildWorldArchiveExportInput,
): ExportPackage {
  return buildWorldPackage({
    kind: "world_archive",
    world: input.world,
    continuities: input.continuities ?? [],
    recovery: input.recovery,
    generatedAt: input.generatedAt,
    rootName: input.rootName,
    cardFiles: input.cardFiles,
  });
}

function buildWorldPackage(input: {
  cardFiles?: ExportPackageFile[];
  recovery?: ArchiveRecovery;
  kind: WorldPackageKind;
  world: WorldDefinition;
  continuities: Array<PlaythroughMeta & { saves?: SaveSlot[] }>;
  generatedAt?: string;
  rootName?: string;
}): ExportPackage {
  input = { ...input, world: withoutLegacyProgress(input.world) };
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const rootName = sanitizeExportName(
    input.rootName ??
      `${input.world.name || "world"}_${input.kind}_${timestampForName(generatedAt)}`,
  );
  const files: ExportPackageFile[] = [];

  addText(
    files,
    "summary.md",
    buildSummaryMarkdown(input.world, input.continuities, input.kind, generatedAt),
  );
  addJson(files, "world/world.json", input.world);
  addJson(files, "world/regions.json", input.world.regions);
  addJson(files, "world/npcs.json", input.world.npcs);
  addMetaRealityFiles(files, input.world);

  if (input.kind === "world_archive") {
    const playthroughs = input.continuities.map(({ saves: _saves, ...playthrough }) => playthrough);
    const saves = input.continuities.flatMap((playthrough) => playthrough.saves ?? []);
    addJson(files, "library/playthroughs.json", playthroughs);
    addJson(files, "library/saves.json", saves);
  }

  if (input.recovery) addJson(files, "library/recovery.json", input.recovery);
  addSourceArchiveFiles(files, input.world);
  files.push(...(input.cardFiles ?? []));

  const manifest = buildManifest({
    kind: input.kind,
    world: input.world,
    continuities: input.continuities,
    generatedAt,
    contentFiles: files,
  });

  return {
    rootName,
    files: [
      {
        path: "manifest.json",
        content: JSON.stringify(manifest, null, 2),
        mimeType: "application/json;charset=utf-8",
      },
      ...files,
    ],
  };
}

function buildManifest(input: {
  kind: WorldPackageKind;
  world: WorldDefinition;
  continuities: Array<PlaythroughMeta & { saves?: SaveSlot[] }>;
  generatedAt: string;
  contentFiles: ExportPackageFile[];
}): Record<string, unknown> {
  const encoder = new TextEncoder();
  const saves = input.continuities.flatMap((playthrough) => playthrough.saves ?? []);
  const hasSourceArchive =
    input.world.sourceMode === "source_archive" && Boolean(input.world.sourceArchive);
  const hasMetaReality = Boolean(input.world.metaChannelManifest);

  const fileEntries = input.contentFiles.map((file) => {
    const bytes = encoder.encode(file.content);
    return {
      path: file.path,
      crc32: crc32(bytes).toString(16).padStart(8, "0"),
      bytes: bytes.length,
    };
  });

  return {
    formatVersion: "eidos_export_package_v2",
    packageKind: input.kind,
    generatedAt: input.generatedAt,
    app: { name: "Eidos", version: "0.1.0" },
    world: {
      id: input.world.id,
      name: input.world.name,
      subtitle: input.world.subtitle,
    },
    counts: {
      worlds: 1,
      playthroughs: input.continuities.length,
      saves: saves.length,
      actions: input.continuities.reduce(
        (sum, playthrough) => sum + Math.max(0, playthrough.actionCount ?? 0),
        0,
      ),
    },
    privacy: {
      apiKeysRedacted: true,
      includesPlayerText: input.kind === "world_archive" && saves.length > 0,
      includesSourceDocuments: hasSourceArchive,
      includesAiTelemetry: false,
      includesMetaReality: hasMetaReality,
    },
    restore: {
      stateFile: null,
      historyIndexFile: null,
    },
    files: [
      { path: "manifest.json", crc32: "00000000", bytes: 0 },
      ...fileEntries,
    ],
  };
}

function addMetaRealityFiles(files: ExportPackageFile[], world: WorldDefinition) {
  if (!world.metaChannelManifest) return;
  addJson(files, "meta-reality/manifest.json", world.metaChannelManifest);
}

function addSourceArchiveFiles(files: ExportPackageFile[], world: WorldDefinition) {
  if (world.sourceMode !== "source_archive" || !world.sourceArchive) return;
  const archive = world.sourceArchive;

  addJson(files, "source-archive/corpus.json", archive.corpus);
  if (archive.reconstruction) addJson(files, "source-archive/reconstruction.json", archive.reconstruction);
  addJson(files, "source-archive/evidence.json", archive.evidence);
  addJson(files, "source-archive/canon-ledger.json", archive.ledger);
  addJson(files, "source-archive/adaptation-plan.json", archive.adaptationPlan);
  if (archive.uzqSeeds && archive.uzqSeeds.length > 0) {
    addJson(files, "source-archive/uzq-seeds.json", archive.uzqSeeds);
  }
}

function buildSummaryMarkdown(
  world: WorldDefinition,
  continuities: Array<PlaythroughMeta & { saves?: SaveSlot[] }>,
  kind: WorldPackageKind,
  generatedAt: string,
): string {
  const saveCount = continuities.reduce(
    (sum, playthrough) => sum + (playthrough.saves?.length ?? 0),
    0,
  );
  const actionCount = continuities.reduce(
    (sum, playthrough) => sum + Math.max(0, playthrough.actionCount ?? 0),
    0,
  );
  const lines = [
    `# ${world.name} — World export`,
    "",
    `- Exported at: ${generatedAt}`,
    `- Package type: ${kind === "world" ? "World definition" : "World definition, playthroughs, and saves"}`,
    `- World ID: ${world.id}`,
    `- Playthroughs: ${continuities.length}`,
    `- Saves: ${saveCount}`,
    `- Actions: ${actionCount}`,
    "",
    "## Package contents",
    "",
    "- `manifest.json` lists files and format versions.",
    "- `world/` contains the importable world definition.",
  ];

  if (kind === "world_archive") {
    lines.push("- `library/` contains playthroughs, saves, and timeline data for resuming play from the world library.");
  }
  if (world.sourceMode === "source_archive" && world.sourceArchive) {
    lines.push("- `source-archive/` contains the original source archive.");
  }
  if (world.metaChannelManifest) {
    lines.push("- `meta-reality/` contains the reality-channel manifest.");
  }

  return lines.join("\n");
}

function addJson(files: ExportPackageFile[], path: string, payload: unknown) {
  files.push({
    path,
    content: JSON.stringify(payload, null, 2),
    mimeType: "application/json;charset=utf-8",
  });
}

function addText(
  files: ExportPackageFile[],
  path: string,
  content: string,
  mimeType = "text/markdown;charset=utf-8",
) {
  files.push({ path, content, mimeType });
}

function timestampForName(iso: string): string {
  return iso.replace(/[:.]/g, "-").slice(0, 19);
}
