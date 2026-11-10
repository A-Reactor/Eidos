import { withoutLegacyProgress } from './legacy-progress';
import { collectDocumentBundle, type DocumentBundle } from './documents/transfer';
import { loadModelDocuments, documentMarkdown, type DocumentScope, type SavedModelDocument } from './model-documents';
import { resourceReferences, readModResource, type ModResource } from './plugins/workspace';
// ============================================================
// Eidos · 游戏记录导出
// ============================================================
// 导出当前游戏会话的检查包：世界设定、行动历史、遥测、审计与恢复锚点。
// 旧的 JSON / Markdown 单文件函数仍保留；设置页导出使用目录式 package。
// 从 v2 开始，默认导出 .eidos.zip 单文件而非散落多文件下载。

import type {
  WorldDefinition,
  ActionRecord,
  GameTime,
  SerializedGameState,
} from "@/lib/game/types";
import type {
  TelemetryCallRecord,
  CausalLogEntry,
} from "@/store/slices/telemetry-slice";
import { crc32 } from "./zip-writer";
import { downloadPackageAsSingleFile } from "./package-download";
import { normalizeNpcDescription } from "./npc-description";
import { saveFile, type SaveFileResult } from './save-file';

// ============================================================
// 导出数据结构
// ============================================================

export interface ExportData {
  /** 导出元数据 */
  meta: {
    exportedAt: string;
    version: string;
    actionCount: number;
    totalGameDays: number;
  };
  /** 世界完整设定 */
  world: WorldDefinition;
  /** 玩家身份 */
  player: {
    name: string;
  };
  /** 互动历史（按时间顺序，精简版） */
  history: ExportActionRecord[];
  /** 运行时遥测数据（AI 调用记录等） */
  telemetry?: {
    aiCalls: TelemetryCallRecord[];
    causalLog: CausalLogEntry[];
    speculationHits: number;
    speculationMisses: number;
    segmentSkips: number;
    segmentSent: number;
  };
}

/** 精简后的行动记录（导出用，不含 snapshot 以减少阅读文件体积） */
export interface ExportActionRecord {
  index: number;
  id: string;
  timestamp: number;
  /** 游戏内时间 */
  gameTime: GameTime;
  /** 所在场景 */
  sceneId: string;
  sceneName: string;
  /** 玩家输入 */
  playerInput: string;
  /** AI 叙事响应（完整文本） */
  aiResponse: string;
  /** 一句话摘要 */
  summary: string;
  /** 时间消耗 */
  timeSpent: GameTime;
  /** 世界影响 */
  worldImpacts: string[];
  /** AI 推荐的后续选项 */
  availableActions?: string[];
  /** 此次行动获得的物品 */
  itemsGained?: string[];
  /** 此次行动发现的线索 */
  cluesDiscovered?: string[];
}

export interface ExportPackageFile {
  path: string;
  content: string;
  mimeType: string;
}

export interface ExportPackage {
  rootName: string;
  files: ExportPackageFile[];
}

export interface BuildExportPackageOptions {
  documentBundle?: DocumentBundle;
  modelDocuments?: SavedModelDocument[];
  modResources?: Record<string, ModResource>;
  rootName?: string;
  restoreState?: SerializedGameState;
  restoreHistory?: ActionRecord[];
  personalityAuditJson?: string;
  uzqAuditJson?: string;
  keiReviewAuditJson?: string;
  sandboxSnapshotsJson?: string;
  sandboxToolExecutionsJson?: string;
}

export interface ExportGameRecordsOptions {
  documentScope?: DocumentScope;
  telemetry?: ExportData["telemetry"];
  restoreState?: SerializedGameState;
  personalityAuditJson?: string;
  uzqAuditJson?: string;
  keiReviewAuditJson?: string;
  sandboxSnapshotsJson?: string;
  sandboxToolExecutionsJson?: string;
}

type ExportGameRecordsInput =
  | ExportData["telemetry"]
  | ExportGameRecordsOptions
  | undefined;

export type ExportPackageResult = "directory" | "downloads" | "cancelled";

interface FileSystemWritableLike {
  write(data: BlobPart): Promise<void>;
  close(): Promise<void>;
}

interface FileSystemFileHandleLike {
  createWritable(): Promise<FileSystemWritableLike>;
}

interface FileSystemDirectoryHandleLike {
  getDirectoryHandle(
    name: string,
    options?: { create?: boolean },
  ): Promise<FileSystemDirectoryHandleLike>;
  getFileHandle(
    name: string,
    options?: { create?: boolean },
  ): Promise<FileSystemFileHandleLike>;
}

type DirectoryPickerWindow = Window & {
  showDirectoryPicker?: () => Promise<FileSystemDirectoryHandleLike>;
};

// ============================================================
// 收集导出数据
// ============================================================

export function collectExportData(
  world: WorldDefinition,
  playerName: string,
  history: ActionRecord[],
  telemetry?: ExportData["telemetry"],
): ExportData {
  const now = new Date();
  const totalDays =
    history.length > 0 ? history[history.length - 1].gameTime.day : 0;

  const exportHistory: ExportActionRecord[] = history.map((record, index) => ({
    index: index + 1,
    id: record.id,
    timestamp: record.timestamp,
    gameTime: record.gameTime,
    sceneId: record.sceneId,
    sceneName: record.sceneName,
    playerInput: record.playerInput,
    aiResponse: record.aiResponse,
    summary: record.summary,
    timeSpent: record.timeSpent,
    worldImpacts: record.worldImpacts,
    availableActions: record.availableActions,
  }));

  return {
    meta: {
      exportedAt: now.toISOString(),
      version: "records_v2",
      actionCount: history.length,
      totalGameDays: totalDays,
    },
    world: withoutLegacyProgress(world),
    player: {
      name: playerName,
    },
    history: exportHistory,
    telemetry,
  };
}

// ============================================================
// 目录式导出包
// ============================================================

export function buildExportPackage(
  data: ExportData,
  options: BuildExportPackageOptions = {},
): ExportPackage {
  data = { ...data, world: withoutLegacyProgress(data.world) };
  const rootName = sanitizeExportName(
    options.rootName ?? `${data.world.name || "world"}_records_${timestampForName()}`,
  );
  const files: ExportPackageFile[] = [];
  const restoreHistory = options.restoreHistory ?? [];
  const snapshotCount = restoreHistory.filter((record) => record.snapshot).length;

  const addJson = (path: string, payload: unknown) => {
    files.push({
      path,
      content: JSON.stringify(payload, null, 2),
      mimeType: "application/json;charset=utf-8",
    });
  };
  const addText = (path: string, content: string, mimeType = "text/markdown;charset=utf-8") => {
    files.push({ path, content, mimeType });
  };

  addText("summary.md", toPackageSummaryMarkdown(data, {
    hasRestoreState: Boolean(options.restoreState),
    restoreHistoryCount: restoreHistory.length,
    snapshotCount,
  }));

  addJson("world/world.json", data.world);
  addJson("world/regions.json", data.world.regions);
  addJson("world/npcs.json", data.world.npcs);
  addJson("player/player.json", data.player);

  addJson(
    "history/index.json",
    data.history.map((record) => ({
      index: record.index,
      id: record.id,
      timestamp: record.timestamp,
      gameTime: record.gameTime,
      sceneId: record.sceneId,
      sceneName: record.sceneName,
      summary: record.summary,
    })),
  );
  for (const record of data.history) {
    addJson(`history/${actionFileStem(record.index)}.json`, record);
    addText(`history/${actionFileStem(record.index)}.md`, actionToMarkdown(record));
  }

  addJson("telemetry/summary.json", buildTelemetrySummary(data.telemetry));
  addJson("telemetry/ai-calls.json", data.telemetry?.aiCalls ?? []);
  addJson("telemetry/causal-log.json", data.telemetry?.causalLog ?? []);

  if (options.restoreState) {
    addJson("restore/state.json", withoutLegacyProgress(options.restoreState));
  }
  if (options.documentBundle) addJson('documents/library.json', options.documentBundle);
  if (options.modResources && Object.keys(options.modResources).length) addJson('restore/mod-resources.json', options.modResources);
  if (restoreHistory.length > 0) {
    addJson(
      "restore/history/index.json",
      restoreHistory.map((record, index) => ({
        index: index + 1,
        id: record.id,
        timestamp: record.timestamp,
        sceneId: record.sceneId,
        sceneName: record.sceneName,
        hasSnapshot: Boolean(record.snapshot),
      })),
    );
    for (const [index, record] of restoreHistory.entries()) {
      addJson(`restore/history/${actionFileStem(index + 1)}.json`, record);
    }
  }

  addMetaRealityFiles(files, data.world, options.restoreState);

  if (options.personalityAuditJson) {
    addText(
      "audits/personality-audit.json",
      ensureTrailingNewline(options.personalityAuditJson),
      "application/json;charset=utf-8",
    );
  }
  if (options.uzqAuditJson) {
    addText(
      "audits/uzq-audit.json",
      ensureTrailingNewline(options.uzqAuditJson),
      "application/json;charset=utf-8",
    );
  }
  if (options.keiReviewAuditJson) {
    addText("audits/kei-review-audit.json", ensureTrailingNewline(options.keiReviewAuditJson), "application/json;charset=utf-8");
  }
  if (options.sandboxSnapshotsJson) {
    addText(
      "sandbox/snapshots/index.json",
      ensureTrailingNewline(options.sandboxSnapshotsJson),
      "application/json;charset=utf-8",
    );
  }
  if (options.sandboxToolExecutionsJson) {
    addText(
      "sandbox/tool-executions.json",
      ensureTrailingNewline(options.sandboxToolExecutionsJson),
      "application/json;charset=utf-8",
    );
  }

  // 资料建档模式：将 sourceArchive 拆分为独立文件，方便玩家审查
  if (data.world.sourceMode === "source_archive" && data.world.sourceArchive) {
    const sa = data.world.sourceArchive;
    addJson("source-archive/corpus.json", sa.corpus);
    if (sa.reconstruction) addJson("source-archive/reconstruction.json", sa.reconstruction);
    addJson("source-archive/evidence.json", sa.evidence);
    addJson("source-archive/canon-ledger.json", sa.ledger);
    addJson("source-archive/adaptation-plan.json", sa.adaptationPlan);
    if (sa.uzqSeeds && sa.uzqSeeds.length > 0) {
      addJson("source-archive/uzq-seeds.json", sa.uzqSeeds);
    }
  }

  if (options.modelDocuments?.length) {
    addJson('documents/index.json', options.modelDocuments);
    options.modelDocuments.forEach((document, index) => {
      const id = String(index + 1).padStart(4, '0');
      addText(`documents/document-${id}.md`, documentMarkdown(document));
      addJson(`documents/document-${id}-raw.json`, document.parts);
    });
  }

  // 先构建文件列表（不含 manifest），再计算 manifest v2
  const manifestV2 = buildManifestV2({
    data,
    rootName,
    contentFiles: files,
    options,
    restoreHistoryCount: restoreHistory.length,
    snapshotCount,
  });

  return {
    rootName,
    files: [
      {
        path: "manifest.json",
        content: JSON.stringify(manifestV2, null, 2),
        mimeType: "application/json;charset=utf-8",
      },
      ...files,
    ],
  };
}

// ============================================================
// Manifest v2 构建
// ============================================================

interface ManifestV2Params {
  data: ExportData;
  rootName: string;
  contentFiles: ExportPackageFile[];
  options: BuildExportPackageOptions;
  restoreHistoryCount: number;
  snapshotCount: number;
}

/** 升级版 manifest —— `eidos_export_package_v2`，含文件校验、隐私标记和恢复锚点。 */
function buildManifestV2(params: ManifestV2Params): Record<string, unknown> {
  const { data, contentFiles, options, restoreHistoryCount, snapshotCount } = params;
  const encoder = new TextEncoder();

  // 文件清单（含路径、CRC32、字节数）
  const fileEntries = contentFiles.map(file => {
    const bytes = encoder.encode(file.content);
    return { path: file.path, crc32: crc32(bytes).toString(16).padStart(8, '0'), bytes: bytes.length };
  });

  // 隐私标记
  const hasSourceArchive =
    data.world.sourceMode === "source_archive" && Boolean(data.world.sourceArchive);
  const hasTelemetry = Boolean(data.telemetry?.aiCalls?.length);
  const hasMetaReality = hasMetaRealityRecords(data.world, options.restoreState);

  return {
    formatVersion: "eidos_export_package_v2",
    packageKind: "playthrough",
    generatedAt: data.meta.exportedAt,
    app: { name: "Eidos", version: "0.1.0" },
    world: {
      id: data.world.id,
      name: data.world.name,
      subtitle: data.world.subtitle,
    },
    player: data.player,
    counts: {
      actions: data.meta.actionCount,
      aiCalls: data.telemetry?.aiCalls.length ?? 0,
      causalLogEntries: data.telemetry?.causalLog.length ?? 0,
      restoreHistoryActions: restoreHistoryCount,
      restoreSnapshots: snapshotCount,
    },
    privacy: {
      apiKeysRedacted: true,
      includesPlayerText: true,
      includesSourceDocuments: hasSourceArchive,
      includesAiTelemetry: hasTelemetry,
      includesMetaReality: hasMetaReality,
    },
    restore: {
      stateFile: options.restoreState ? "restore/state.json" : null,
      historyIndexFile: restoreHistoryCount > 0 ? "restore/history/index.json" : null,
    },
    files: [
      {
        path: "manifest.json",
        crc32: "00000000",
        bytes: 0,
      },
      ...fileEntries,
    ],
  };
}

function addMetaRealityFiles(
  files: ExportPackageFile[],
  world: WorldDefinition,
  restoreState?: SerializedGameState,
) {
  const artifacts = restoreState?.realityArtifacts ?? [];
  const boundaryEvents = restoreState?.boundaryEvents ?? [];
  const manifest = restoreState?.metaChannelManifest ?? world.metaChannelManifest ?? null;

  if (artifacts.length > 0) {
    files.push({
      path: "meta-reality/artifacts.json",
      content: JSON.stringify(artifacts, null, 2),
      mimeType: "application/json;charset=utf-8",
    });
  }
  if (boundaryEvents.length > 0) {
    files.push({
      path: "meta-reality/boundary-events.json",
      content: JSON.stringify(boundaryEvents, null, 2),
      mimeType: "application/json;charset=utf-8",
    });
  }
  if (manifest) {
    files.push({
      path: "meta-reality/manifest.json",
      content: JSON.stringify(manifest, null, 2),
      mimeType: "application/json;charset=utf-8",
    });
  }
}

function hasMetaRealityRecords(
  world: WorldDefinition,
  restoreState?: SerializedGameState,
): boolean {
  return Boolean(
    world.metaChannelManifest ||
      restoreState?.metaChannelManifest ||
      restoreState?.realityArtifacts?.length ||
      restoreState?.boundaryEvents?.length,
  );
}

// ============================================================
// JSON 导出（兼容旧调试入口）
// ============================================================

export function toJson(data: ExportData): string {
  return JSON.stringify({ ...data, world: withoutLegacyProgress(data.world) }, null, 2);
}

// ============================================================
// Markdown 导出（兼容旧调试入口）
// ============================================================

export function toMarkdown(data: ExportData): string {
  const lines: string[] = [];

  lines.push(`# ${data.world.name} — Game records`);
  lines.push("");
  lines.push(
    `> Exported at ${data.meta.exportedAt} · Actions: ${data.meta.actionCount} · Day ${data.meta.totalGameDays}`,
  );
  lines.push("");

  lines.push("---");
  lines.push("");
  lines.push("## World setting");
  lines.push("");

  lines.push(`### ${data.world.name}`);
  if (data.world.subtitle) {
    lines.push(`*${data.world.subtitle}*`);
  }
  lines.push("");
  lines.push(data.world.overview);
  lines.push("");

  lines.push("### Player character");
  lines.push(`- **Name**: ${data.player.name}`);
  if (data.world.calendarEra) {
    lines.push(`- **Calendar era**: ${data.world.calendarEra}`);
  }
  lines.push("");

  lines.push("### Regions and scenes");
  for (const [regionId, region] of Object.entries(data.world.regions)) {
    const regionRecord = region as {
      description?: string;
      scenes?: Record<string, {
        name?: string;
        initialDescription?: string;
        connections?: string[];
      }>;
    };
    lines.push(
      `#### ${
        regionRecord.description
          ? regionRecord.description.slice(0, 50)
          : regionId
      }`,
    );
    if (regionRecord.scenes) {
      for (const [sceneId, scene] of Object.entries(regionRecord.scenes)) {
        lines.push(`- **${scene.name || sceneId}** (${regionId})`);
        if (scene.initialDescription) {
          lines.push(`  ${scene.initialDescription.slice(0, 200)}`);
        }
        if (scene.connections?.length) {
          lines.push(`  Connections: ${scene.connections.join(", ")}`);
        }
      }
    }
  }
  lines.push("");

  lines.push("### NPC roster");
  const npcEntries = Object.entries(data.world.npcs as Record<string, unknown>);
  if (npcEntries.length > 0) {
    for (const [name, desc] of npcEntries) {
      lines.push(`- **${name}**: ${normalizeNpcDescription(desc, name).slice(0, 200)}`);
    }
  } else {
    lines.push("No preset NPCs.");
  }
  lines.push("");

  lines.push("### Core conflicts");
  if (data.world.contradictions?.length) {
    for (const contradiction of data.world.contradictions) {
      lines.push(
        `- **${contradiction.name}**: ${contradiction.description.slice(0, 200)}`,
      );
    }
  } else {
    lines.push("None.");
  }
  lines.push("");

  lines.push("---");
  lines.push("");
  lines.push("## Interaction history");
  lines.push("");

  for (const record of data.history) {
    lines.push(actionToMarkdown(record));
    lines.push("---");
    lines.push("");
  }

  lines.push(`*Generated by Eidos on ${data.meta.exportedAt}*`);

  return lines.join("\n");
}

// ============================================================
// 写出 package
// ============================================================

export async function writeExportPackage(
  pkg: ExportPackage,
): Promise<ExportPackageResult> {
  const result = await downloadPackageAsSingleFile(pkg);
  return result === 'cancelled' ? 'cancelled' : 'downloads';
}

export async function writeExportPackageToDirectory(
  pkg: ExportPackage,
): Promise<"directory" | "cancelled" | "unavailable"> {
  if (typeof window === "undefined") return "unavailable";

  const picker = (window as DirectoryPickerWindow).showDirectoryPicker;
  if (!picker) return "unavailable";

  try {
    const root = await picker();
    const target = await root.getDirectoryHandle(pkg.rootName, { create: true });
    for (const file of pkg.files) {
      await writePackageFile(target, file);
    }
    return "directory";
  } catch (error) {
    if (isAbortError(error)) return "cancelled";
    throw error;
  }
}

export async function downloadExportPackageFiles(pkg: ExportPackage): Promise<SaveFileResult> {
  return downloadPackageAsSingleFile(pkg);
}

export function downloadFile(
  content: string,
  filename: string,
  mimeType: string,
): Promise<SaveFileResult> {
  const blob = new Blob([content], { type: mimeType });
  return saveFile(blob, filename);
}

/**
 * 导出当前游戏记录（目录式 package，含可恢复锚点）。
 * @param world 当前世界定义
 * @param playerName 玩家名称
 * @param history 行动历史
 * @param worldName 世界名称（用于根目录名）
 * @param input 遥测 / 审计 / 恢复状态
 */
export async function exportGameRecords(
  world: WorldDefinition,
  playerName: string,
  history: ActionRecord[],
  worldName?: string,
  input?: ExportGameRecordsInput,
): Promise<void> {
  const options = normalizeExportOptions(input);
  const data = collectExportData(
    world,
    playerName,
    history,
    options.telemetry,
  );
  const rootName = sanitizeExportName(
    `${worldName || world.name || "world"}_records_${timestampForName()}`,
  );
  await downloadPackageAsSingleFile(async () => {
    const documentBundle = options.documentScope ? await collectDocumentBundle({ scopes: [options.documentScope], nodes: { history, restoreState: options.restoreState } }) : undefined;
    const modResources: Record<string, ModResource> = {};
    for (const [id, ref] of resourceReferences({ state: options.restoreState, history })) { if (!documentBundle?.resources[id]) modResources[id] = await readModResource(ref); }
    return buildExportPackage(data, {
      documentBundle,
      modelDocuments: options.documentScope ? await loadModelDocuments(options.documentScope) : [],
      modResources,
      rootName,
      restoreState: options.restoreState,
      restoreHistory: history,
      personalityAuditJson: options.personalityAuditJson,
      uzqAuditJson: options.uzqAuditJson,
      keiReviewAuditJson: options.keiReviewAuditJson,
      sandboxSnapshotsJson: options.sandboxSnapshotsJson,
      sandboxToolExecutionsJson: options.sandboxToolExecutionsJson,
    });
  }, `${rootName}.eidos.zip`);
}

// ============================================================
// 辅助
// ============================================================

function toPackageSummaryMarkdown(
  data: ExportData,
  restore: {
    hasRestoreState: boolean;
    restoreHistoryCount: number;
    snapshotCount: number;
  },
): string {
  const lines = [
    `# ${data.world.name} — Export summary`,
    "",
    `- Exported at: ${data.meta.exportedAt}`,
    `- Player: ${data.player.name}`,
    `- Actions: ${data.meta.actionCount}`,
    `- Game day: ${data.meta.totalGameDays}`,
    `- AI calls: ${data.telemetry?.aiCalls.length ?? 0}`,
    `- Causal log entries: ${data.telemetry?.causalLog.length ?? 0}`,
    `- World source: ${data.world.sourceMode === "source_archive" && data.world.sourceArchive ? `Source archive (evidence entries: ${data.world.sourceArchive.evidence.length}, entities: ${data.world.sourceArchive.ledger.entities.length})` : "Concept"}`,
    `- Restore state: ${restore.hasRestoreState ? "Included in `restore/state.json`" : "Full state unavailable"}`,
    `- Restore history (actions / pre-action snapshots): ${restore.restoreHistoryCount} / ${restore.snapshotCount}`,
    "",
    "## Package contents",
    "",
    "- `manifest.json` lists files and format versions.",
    "- `world/` contains the world definition.",
    "- `history/` contains readable action records.",
    "- `restore/` contains data for resuming play, when included.",
    "- `telemetry/` contains AI call and causal logs.",
    "- `audits/` contains audit records, when included.",
    "- `source-archive/` contains the original archive for worlds built from source material.",
  ];

  return lines.join("\n");
}

function actionToMarkdown(record: ExportActionRecord): string {
  const gameTime = record.gameTime;
  const lines = [
    `### Action ${record.index} — Day ${gameTime.day}, ${String(gameTime.hour).padStart(2, "0")}:${String(gameTime.minute).padStart(2, "0")} · ${record.sceneName}`,
    "",
    "**Player action**",
    "",
    `> ${record.playerInput}`,
    "",
    "**AI narration**",
    "",
    record.aiResponse,
    "",
  ];

  const changes: string[] = [];
  if (
    record.timeSpent.day > 0 ||
    record.timeSpent.hour > 0 ||
    record.timeSpent.minute > 0
  ) {
    const parts: string[] = [];
    if (record.timeSpent.day > 0) parts.push(`${record.timeSpent.day} d`);
    if (record.timeSpent.hour > 0) parts.push(`${record.timeSpent.hour} h`);
    if (record.timeSpent.minute > 0) parts.push(`${record.timeSpent.minute} min`);
    changes.push(`Elapsed time: ${parts.join(" ")}`);
  }
  if (record.worldImpacts?.length) {
    changes.push(`World effects: ${record.worldImpacts.join(" / ")}`);
  }
  if (changes.length > 0) {
    lines.push("**State changes**", "");
    for (const change of changes) {
      lines.push(`- ${change}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

function buildTelemetrySummary(telemetry: ExportData["telemetry"] | undefined) {
  return {
    aiCallCount: telemetry?.aiCalls.length ?? 0,
    causalLogCount: telemetry?.causalLog.length ?? 0,
    speculationHits: telemetry?.speculationHits ?? 0,
    speculationMisses: telemetry?.speculationMisses ?? 0,
    segmentSkips: telemetry?.segmentSkips ?? 0,
    segmentSent: telemetry?.segmentSent ?? 0,
  };
}

async function writePackageFile(
  root: FileSystemDirectoryHandleLike,
  file: ExportPackageFile,
): Promise<void> {
  const parts = file.path.split("/").filter(Boolean);
  const filename = parts.pop();
  if (!filename) return;

  let directory = root;
  for (const part of parts) {
    directory = await directory.getDirectoryHandle(part, { create: true });
  }

  const handle = await directory.getFileHandle(filename, { create: true });
  const writable = await handle.createWritable();
  await writable.write(new Blob([file.content], { type: file.mimeType }));
  await writable.close();
}

function normalizeExportOptions(
  input: ExportGameRecordsInput,
): ExportGameRecordsOptions {
  if (!input) return {};
  if ("aiCalls" in input || "causalLog" in input) {
    return { telemetry: input as ExportData["telemetry"] };
  }
  return input;
}

export function sanitizeExportName(name: string): string {
  const sanitized = name
    .trim()
    .replace(/[^\p{L}\p{M}\p{N}_-]/gu, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");

  return Array.from(sanitized).slice(0, 96).join("") || "eidos_export";
}

function actionFileStem(index: number): string {
  return `action-${String(index).padStart(4, "0")}`;
}

function timestampForName(): string {
  return new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
}

function ensureTrailingNewline(content: string): string {
  return content.endsWith("\n") ? content : `${content}\n`;
}

function isAbortError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    error.name === "AbortError"
  );
}
