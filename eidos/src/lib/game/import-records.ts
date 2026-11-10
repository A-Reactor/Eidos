import { withoutLegacyProgress } from './legacy-progress';
import { validatePortableSourceArchive } from './source-reconstruction/compatibility';
// ============================================================
// Eidos · 世界导入
// ============================================================
// 轻量导入层：支持 .eidos.zip（ZIP store）、旧 records package、
// 单 world.json 三种格式。
// 现有存档系统继续负责严肃恢复，restore/* 这里只做存在性标记。

import type { WorldDefinition } from "@/lib/game/types";
import { validateCardBindings } from './cards/validation';
import { parseGameplayPlugins, validateGameModeConfig } from "./plugins/manifest";

// ============================================================
// 类型
// ============================================================

export interface ImportSourceFile {
  path: string;
  content: string;
}

export type WorldImportSourceKind = "eidos_zip" | "records_package" | "world_json";

/** 导入前预览 —— 由 UI 决定导入世界、恢复周目还是作为备份恢复 */
export interface ImportPreview {
  sourceKind: WorldImportSourceKind;
  formatVersion: string;
  packageKind?: string;
  worldId: string;
  worldName: string;
  worldSubtitle: string;
  /** 周目数（从 manifest v2 读取，旧包可能为 0） */
  playthroughCount: number;
  /** 行动数 */
  actionCount: number;
  /** 是否包含恢复状态（restore/state.json） */
  hasRestoreState: boolean;
  /** 是否包含 AI 调用日志 */
  hasAiTelemetry: boolean;
  /** 是否包含资料建档原文 */
  hasSourceDocuments: boolean;
  /** 是否包含现实/游戏边界通道或事件 */
  hasMetaReality: boolean;
  /** 包内文件数 */
  fileCount: number;
  /** 原始文件列表（供内部使用） */
  files: ImportSourceFile[];
}

export interface ParsedWorldImport {
  sourceKind: WorldImportSourceKind;
  world: WorldDefinition;
  hasRestoreState: boolean;
}

export interface FinalizeImportedWorldOptions {
  existingWorldIds: ReadonlySet<string>;
  importedAt?: number;
}

// ============================================================
// ZIP 解析
// ============================================================

/**
 * 解析 .eidos.zip（ZIP store method）为文件列表。
 * 仅支持 store method（不压缩）；如果遇到压缩条目会报错。
 */
export async function parseZipImport(zipBlob: Blob): Promise<ImportSourceFile[]> {
  const buffer = await zipBlob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  // 1. 查找 EOCD 签名 0x06054b50（从末尾向前扫描，处理 comment 情况）
  const eocdOffset = findEocdOffset(view);
  if (eocdOffset < 0) {
    throw new Error("Import file is not a valid ZIP (EOCD not found).");
  }

  // 2. 读取 EOCD
  const entryCount = view.getUint16(eocdOffset + 10, true);
  const centralDirSize = view.getUint32(eocdOffset + 12, true);
  const centralDirOffset = view.getUint32(eocdOffset + 16, true);

  if (entryCount === 0 || centralDirSize === 0) {
    throw new Error("ZIP import file is empty (no entries).");
  }

  // 3. 遍历中央目录
  const files: ImportSourceFile[] = [];
  let cursor = centralDirOffset;
  for (let i = 0; i < entryCount; i++) {
    // 验证签名 0x02014b50
    const sig = view.getUint32(cursor, true);
    if (sig !== 0x02014b50) {
      throw new Error(`ZIP central directory entry ${i} has invalid signature.`);
    }

    const compressionMethod = view.getUint16(cursor + 10, true);
    if (compressionMethod !== 0) {
      throw new Error(`ZIP entry uses compression (method ${compressionMethod}), only store is supported.`);
    }

    const crc32 = view.getUint32(cursor + 16, true);
    const compressedSize = view.getUint32(cursor + 20, true);
    const uncompressedSize = view.getUint32(cursor + 24, true);
    const fileNameLength = view.getUint16(cursor + 28, true);
    const extraFieldLength = view.getUint16(cursor + 30, true);
    const fileCommentLength = view.getUint16(cursor + 32, true);
    const localHeaderOffset = view.getUint32(cursor + 42, true);

    // 读取文件名
    const fileNameStart = cursor + 46;
    const fileName = decodeUtf8(bytes.subarray(fileNameStart, fileNameStart + fileNameLength));

    // 跳过目录条目（以 / 结尾的文件名）
    if (!fileName.endsWith("/")) {
      // 4. 读取本地文件头获取数据
      const localSig = view.getUint32(localHeaderOffset, true);
      if (localSig !== 0x04034b50) {
        throw new Error(`ZIP local header for "${fileName}" has invalid signature.`);
      }

      const localFileNameLength = view.getUint16(localHeaderOffset + 26, true);
      const localExtraFieldLength = view.getUint16(localHeaderOffset + 28, true);
      const dataOffset = localHeaderOffset + 30 + localFileNameLength + localExtraFieldLength;

      const fileBytes = bytes.subarray(dataOffset, dataOffset + compressedSize);
      const content = decodeUtf8(fileBytes);

      // 校验 CRC32（如果非零且大小非零）
      if (crc32 !== 0 && compressedSize > 0) {
        const actualCrc = crc32FromBytes(fileBytes);
        if (actualCrc !== crc32) {
          console.warn(`[ImportRecords] CRC32 mismatch for "${fileName}" (expected ${crc32.toString(16)}, got ${actualCrc.toString(16)})`);
        }
      }

      files.push({ path: fileName, content });
    }

    cursor += 46 + fileNameLength + extraFieldLength + fileCommentLength;
  }

  return files;
}

// ============================================================
// 导入预览
// ============================================================

/**
 * 从原始文件列表构造导入预览，用于 UI 展示。
 * 支持 .eidos.zip 内容、旧 records package、单 world.json 三种来源。
 */
export function buildImportPreview(files: ImportSourceFile[]): ImportPreview {
  if (files.length === 0) {
    throw new Error("World import requires at least one JSON file.");
  }

  const entries = files.map((file) => ({
    ...file,
    normalizedPath: normalizeImportPath(file.path),
  }));

  // 判断格式
  const manifestFile = entries.find((f) => f.normalizedPath === "manifest.json");
  const manifestRaw = manifestFile ? tryParseJson(manifestFile.content) : null;

  let sourceKind: WorldImportSourceKind = "world_json";
  let formatVersion = "unknown";
  let packageKind: string | undefined;
  let manifestV2: ManifestV2 | null = null;
  let manifestV1: ManifestV1 | null = null;

  if (manifestRaw && isManifestV2(manifestRaw)) {
    manifestV2 = manifestRaw;
    sourceKind = "eidos_zip";
    formatVersion = manifestV2.formatVersion;
    packageKind = manifestV2.packageKind;
  } else if (manifestRaw && isRecordsManifestV1(manifestRaw)) {
    manifestV1 = manifestRaw;
    sourceKind = "records_package";
    formatVersion = manifestV1.formatVersion;
    packageKind = manifestV1.packageKind ?? "game_records";
  }

  // 提取世界名
  const worldFile =
    sourceKind !== "world_json"
      ? entries.find((f) => f.normalizedPath === "world/world.json")
      : entries.find((f) => f.normalizedPath === "world.json")
        ?? entries.find((f) => f.normalizedPath === "world/world.json");

  const world = worldFile ? tryParseJson(worldFile.content) : null;
  const worldId = (world && typeof world === "object" && "id" in world ? String(world.id) : "") || "unknown";
  const worldName = (world && typeof world === "object" && "name" in world ? String(world.name) : "") || "Unknown World";
  const worldSubtitle = (world && typeof world === "object" && "subtitle" in world ? String(world.subtitle) : "") || "";

  return {
    sourceKind,
    formatVersion,
    packageKind,
    worldId,
    worldName,
    worldSubtitle,
    playthroughCount: manifestV2?.counts?.playthroughs ?? manifestV1?.counts?.playthroughs ?? manifestV1?.counts?.worlds ?? 1,
    actionCount: manifestV2?.counts?.actions ?? manifestV1?.counts?.actions ?? 0,
    hasRestoreState: entries.some((f) => f.normalizedPath === "restore/state.json"),
    hasAiTelemetry: manifestV2?.privacy?.includesAiTelemetry ?? manifestV1?.privacy?.includesAiTelemetry ?? entries.some((f) =>
      f.normalizedPath.startsWith("telemetry/")),
    hasSourceDocuments: manifestV2?.privacy?.includesSourceDocuments ?? manifestV1?.privacy?.includesSourceDocuments ?? entries.some((f) =>
      f.normalizedPath.startsWith("source-archive/")),
    hasMetaReality: manifestV2?.privacy?.includesMetaReality ?? entries.some((f) =>
      f.normalizedPath.startsWith("meta-reality/")),
    fileCount: files.length,
    files,
  };
}

// ============================================================
// 世界导入解析（保留现有 API）
// ============================================================

export function parseWorldImportFiles(files: ImportSourceFile[]): ParsedWorldImport {
  if (files.length === 0) {
    throw new Error("World import requires at least one JSON file.");
  }

  const entries = files.map((file) => ({
    ...file,
    normalizedPath: normalizeImportPath(file.path),
  }));
  const manifest = entries.find((file) => file.normalizedPath === "manifest.json");
  const manifestParsed = manifest ? tryParseJson(manifest.content) : null;
  const sourceKind = manifestParsed && (
    isManifestV2(manifestParsed) ||
    isRecordsManifestV1(manifestParsed)
  )
    ? (isManifestV2(manifestParsed) ? "eidos_zip" : "records_package")
    : "world_json";
  const worldFile = sourceKind !== "world_json"
    ? entries.find((file) => file.normalizedPath === "world/world.json")
    : entries.find((file) => file.normalizedPath === "world.json")
      ?? entries.find((file) => file.normalizedPath === "world/world.json");

  if (!worldFile) {
    throw new Error("World import package is missing world/world.json or world.json.");
  }

  const world = parseJson(worldFile.content, worldFile.path);
  if (!isWorldDefinitionLike(world)) {
    throw new Error("World import file does not contain a valid Eidos world definition.");
  }
  validateWorldGameplay(world);

  return {
    sourceKind,
    world: withoutLegacyProgress(world),
    hasRestoreState: entries.some((file) => file.normalizedPath === "restore/state.json"),
  };
}

export function finalizeImportedWorld(
  world: WorldDefinition,
  options: FinalizeImportedWorldOptions,
): WorldDefinition {
  validateWorldGameplay(world);
  const importedAt = options.importedAt ?? Date.now();
  const id = options.existingWorldIds.has(world.id)
    ? nextImportedWorldId(world.id, importedAt, options.existingWorldIds)
    : world.id;

  return {
    ...withoutLegacyProgress(structuredCloneCompat(world)),
    id,
    isPlayerCreated: true,
    createdAt: importedAt,
  };
}

function validateWorldGameplay(world: WorldDefinition): void {
  validatePortableSourceArchive(world.sourceArchive);
  validateCardBindings(world.cardBindings);
  // Reject unsupported declarations before they can become a saved, unplayable world.
  parseGameplayPlugins(world.gameplayPlugins);
  validateGameModeConfig(world.gameModeConfig);
}

// ============================================================
// 内部辅助
// ============================================================

function normalizeImportPath(path: string): string {
  const normalized = path.replace(/\\/g, "/").split("/").filter(Boolean).join("/");

  // 旧扁平文件名映射
  if (normalized.endsWith("__manifest.json")) return "manifest.json";
  if (normalized.endsWith("__world__world.json")) return "world/world.json";
  if (normalized.endsWith("__restore__state.json")) return "restore/state.json";
  if (
    normalized === "meta-reality/manifest.json" ||
    normalized.endsWith("/meta-reality/manifest.json")
  ) return "meta-reality/manifest.json";
  if (normalized.endsWith("/manifest.json")) return "manifest.json";
  if (normalized.endsWith("/world/world.json")) return "world/world.json";
  if (normalized.endsWith("/restore/state.json")) return "restore/state.json";

  return normalized;
}

function parseJson(content: string, path: string): unknown {
  try {
    return JSON.parse(content);
  } catch {
    throw new Error(`World import file is not valid JSON: ${path}`);
  }
}

// ============================================================
// Manifest 类型
// ============================================================

interface ManifestV1 {
  formatVersion: "eidos_records_package_v1";
  packageKind?: string;
  files: string[];
  counts?: {
    actions?: number;
    worlds?: number;
    playthroughs?: number;
  };
  privacy?: {
    includesAiTelemetry?: boolean;
    includesSourceDocuments?: boolean;
    includesMetaReality?: boolean;
  };
}

interface ManifestV2 {
  formatVersion: "eidos_export_package_v2";
  packageKind: string;
  files: Array<{ path: string; crc32?: string; bytes?: number }>;
  counts?: {
    actions?: number;
    worlds?: number;
    playthroughs?: number;
  };
  privacy?: {
    includesAiTelemetry?: boolean;
    includesSourceDocuments?: boolean;
    includesMetaReality?: boolean;
  };
  [key: string]: unknown;
}

type Manifest = ManifestV1 | ManifestV2;

function tryParseJson(content: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(content);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isManifestV2(input: unknown): input is ManifestV2 {
  return (
    isRecord(input) &&
    input.formatVersion === "eidos_export_package_v2" &&
    typeof input.packageKind === "string" &&
    Array.isArray(input.files)
  );
}

function isRecordsManifestV1(input: unknown): input is ManifestV1 {
  return (
    isRecord(input) &&
    input.formatVersion === "eidos_records_package_v1" &&
    Array.isArray(input.files)
  );
}

function isWorldDefinitionLike(input: unknown): input is WorldDefinition {
  return (
    isRecord(input) &&
    typeof input.id === "string" &&
    input.id.trim().length > 0 &&
    typeof input.name === "string" &&
    input.name.trim().length > 0 &&
    typeof input.overview === "string" &&
    isRecord(input.regions) &&
    isRecord(input.npcs) &&
    Array.isArray(input.contradictions) &&
    Array.isArray(input.history) &&
    Array.isArray(input.timeline) &&
    Array.isArray(input.clues) &&
    typeof input.systemPromptBase === "string" &&
    typeof input.identityPrompt === "string"
  );
}

function nextImportedWorldId(
  originalId: string,
  importedAt: number,
  existingWorldIds: ReadonlySet<string>,
): string {
  const baseId = `${sanitizeWorldId(originalId)}_imported_${importedAt}`;
  if (!existingWorldIds.has(baseId)) return baseId;

  let suffix = 2;
  while (existingWorldIds.has(`${baseId}_${suffix}`)) {
    suffix += 1;
  }
  return `${baseId}_${suffix}`;
}

function sanitizeWorldId(id: string): string {
  return id
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    || "world";
}

function structuredCloneCompat<T>(value: T): T {
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value)) as T;
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null;
}

// ============================================================
// ZIP 解析辅助
// ============================================================

/** 从末尾向前扫描，查找 EOCD 签名 0x06054b50 */
function findEocdOffset(view: DataView): number {
  const maxCommentSize = 65535; // ZIP comment 最大长度
  const searchStart = Math.max(0, view.byteLength - maxCommentSize - 22);
  for (let offset = view.byteLength - 22; offset >= searchStart; offset--) {
    if (view.getUint32(offset, true) === 0x06054b50) {
      return offset;
    }
  }
  return -1;
}

function decodeUtf8(bytes: Uint8Array): string {
  return new TextDecoder("utf-8").decode(bytes);
}

/** 计算 CRC32（用于 ZIP 导入校验） */
function crc32FromBytes(data: Uint8Array): number {
  // 使用与 zip-writer.ts 相同的 CRC32 表
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc = (crc >>> 8) ^ CRC32_TABLE_IMPORT[(crc ^ data[i]) & 0xff];
  }
  return (crc ^ 0xffffffff) >>> 0;
}

const CRC32_TABLE_IMPORT = new Int32Array(256);
(function buildTable() {
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) {
      c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
    }
    CRC32_TABLE_IMPORT[i] = c;
  }
})();
