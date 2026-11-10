// ============================================================
// Eidos · 导出包下载（单文件 + 目录双路径）
// ============================================================
// 默认路径：将 ExportPackage 打包为 .eidos.zip，并让玩家选择保存位置。
// 高级路径（仅 File System Access API 可用时）：写入用户选择的目录。
// ============================================================

import type { ExportPackage, ExportPackageFile } from "./export-records";
import { createZipBlobAsync, type ZipFileEntry } from "./zip-writer";
import { saveFile, type SaveFileResult } from './save-file';

// ============================================================
// 单文件下载（默认路径）
// ============================================================

/**
 * 先打开保存选择器，再读取材料并打包，保留浏览器所需的用户激活。
 * 所有包内文件以 store method 存入 ZIP，文件名使用 UTF-8 编码。
 */
export async function downloadPackageAsSingleFile(input: ExportPackage | (() => Promise<ExportPackage>), filename?: string): Promise<SaveFileResult> {
  return saveFile(async () => {
    const pkg = typeof input === 'function' ? await input() : input;
    const textEncoder = new TextEncoder();
    function* entries(): Generator<ZipFileEntry> {
      for (const file of pkg.files) yield { path: file.path, content: textEncoder.encode(file.content) };
    }
    return createZipBlobAsync(entries());
  }, filename ?? (typeof input === 'function' ? 'eidos-export.eidos.zip' : `${input.rootName}.eidos.zip`));
}

// ============================================================
// 目录写入（高级路径，仅 File System Access API 可用时）
// ============================================================

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

/**
 * 尝试将导出包写入用户选择的目录。
 * 返回 "directory" 表示成功写入目录，"unavailable" 表示 API 不可用，
 * "cancelled" 表示用户取消选择。
 */
export async function writePackageToDirectory(
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

// ============================================================
// 通用入口：单文件保存，保留原有结果类型以兼容调用方
// ============================================================

export type ExportResult = "directory" | "single_file" | "cancelled";

/**
 * 桌面原生保存对话框 / 浏览器文件选择器，不支持时明确提示兼容下载。
 */
export async function exportPackage(pkg: ExportPackage | (() => Promise<ExportPackage>), filename?: string): Promise<ExportResult> {
  const result = await downloadPackageAsSingleFile(pkg, filename);
  return result === 'cancelled' ? 'cancelled' : 'single_file';
}

// ============================================================
// 辅助
// ============================================================

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

function isAbortError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    error.name === "AbortError"
  );
}
