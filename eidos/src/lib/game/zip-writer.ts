// ============================================================
// Eidos · ZIP Store Writer
// ============================================================
// 零依赖 ZIP 生成器（store method，不压缩）。
// 用于 .eidos.zip 导出包，避免下载文件夹被散文件污染。
//
// ZIP 格式参考：APPNOTE.TXT 6.3.3
// ============================================================

// ============================================================
// CRC32（IEEE 802.3，与 ZIP/PKZIP 一致）
// ============================================================

const CRC32_TABLE = new Int32Array(256);

function buildCrc32Table(): void {
  for (let i = 0; i < 256; i++) {
    let crc = i;
    for (let j = 0; j < 8; j++) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
    CRC32_TABLE[i] = crc;
  }
}
// 惰性初始化——首次调用 crc32 时生成
let tableBuilt = false;

/**
 * 计算 CRC32 校验值（IEEE 802.3 多项式，与 ZIP 兼容）。
 * 输入为原始字节数组，返回无符号 32-bit 整数。
 */
export function crc32(data: Uint8Array): number {
  if (!tableBuilt) {
    buildCrc32Table();
    tableBuilt = true;
  }
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc = (crc >>> 8) ^ CRC32_TABLE[(crc ^ data[i]) & 0xff];
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// ============================================================
// 类型
// ============================================================

export interface ZipFileEntry {
  /** 包内路径（使用正斜杠，如 "world/world.json"） */
  path: string;
  /** 文件内容（UTF-8 编码为字节后传入） */
  content: Uint8Array;
  /** 可选：自定义修改时间（毫秒时间戳），默认当前时间 */
  modifiedAt?: number;
}

// ============================================================
// 常量
// ============================================================

/** ZIP store method（不压缩） */
const STORE_METHOD = 0;
/** 版本标记：2.0（支持目录和文件） */
const VERSION = 20;
/** 通用位标记 bit 11：文件名使用 UTF-8 编码 */
const UTF8_FLAG = 0x0800;

// ============================================================
// 构建 ZIP Blob
// ============================================================

/**
 * 将所有文件打包为 ZIP Blob（store method，不压缩）。
 * 包内路径支持目录结构（正斜杠分隔）。
 * 文件名统一标记为 UTF-8 编码。
 */
export function createZipBlob(files: ZipFileEntry[], options?: { comment?: string }): Blob {
  return new Blob([...zipParts(files, options)] as BlobPart[], { type: 'application/zip' });
}

/** Consume lazy entries one at a time and let input/painting run between chunks. */
export async function createZipBlobAsync(files: Iterable<ZipFileEntry>, options?: { comment?: string }): Promise<Blob> {
  const parts: Blob[] = [];
  let pendingBytes = 0, pendingParts = 0;
  await new Promise<void>(resolve => setTimeout(resolve, 0));
  for (const part of zipParts(files, options)) {
    parts.push(new Blob([part as BlobPart]));
    pendingBytes += part.length; pendingParts++;
    if (pendingBytes >= 1024 * 1024 || pendingParts >= 64) {
      await new Promise<void>(resolve => setTimeout(resolve, 0));
      pendingBytes = 0; pendingParts = 0;
    }
  }
  return new Blob(parts, { type: 'application/zip' });
}

function* zipParts(files: Iterable<ZipFileEntry>, options?: { comment?: string }): Generator<Uint8Array> {
  const now = Date.now(), directory: Uint8Array[] = [];
  let offset = 0;
  for (const file of files) {
    const name = encodeUtf8(file.path), checksum = crc32(file.content), size = file.content.length;
    const params = { dosTime: toDosDateTime(file.modifiedAt ?? now), crc32: checksum, compressedSize: size, uncompressedSize: size, fileName: name };
    const header = buildLocalFileHeader(params);
    directory.push(buildCentralDirHeader({ ...params, localHeaderOffset: offset }));
    yield header; yield file.content;
    offset += header.length + size;
  }
  const directoryOffset = offset;
  for (const header of directory) { yield header; offset += header.length; }
  yield buildEocd({ entryCount: directory.length, centralDirSize: offset - directoryOffset, centralDirOffset: directoryOffset,
    comment: options?.comment ? encodeUtf8(options.comment) : new Uint8Array(0) });
}

// ============================================================
// ZIP 结构构建
// ============================================================

interface FileHeaderParams {
  dosTime: number;
  crc32: number;
  compressedSize: number;
  uncompressedSize: number;
  fileName: Uint8Array;
}

function buildLocalFileHeader(params: FileHeaderParams): Uint8Array {
  const nameLen = params.fileName.length;
  const header = new Uint8Array(30 + nameLen);
  const view = new DataView(header.buffer);
  let off = 0;

  // signature 0x04034b50
  view.setUint32(off, 0x04034b50, true); off += 4;
  // version needed
  view.setUint16(off, VERSION, true); off += 2;
  // general purpose bit flag (UTF-8)
  view.setUint16(off, UTF8_FLAG, true); off += 2;
  // compression method (store)
  view.setUint16(off, STORE_METHOD, true); off += 2;
  // last mod time
  view.setUint16(off, params.dosTime & 0xffff, true); off += 2;
  // last mod date
  view.setUint16(off, (params.dosTime >> 16) & 0xffff, true); off += 2;
  // crc32
  view.setUint32(off, params.crc32, true); off += 4;
  // compressed size
  view.setUint32(off, params.compressedSize, true); off += 4;
  // uncompressed size
  view.setUint32(off, params.uncompressedSize, true); off += 4;
  // file name length
  view.setUint16(off, nameLen, true); off += 2;
  // extra field length
  view.setUint16(off, 0, true); off += 2;

  // file name
  header.set(params.fileName, off);
  return header;
}

function buildCentralDirHeader(
  params: FileHeaderParams & { localHeaderOffset: number },
): Uint8Array {
  const nameLen = params.fileName.length;
  const header = new Uint8Array(46 + nameLen);
  const view = new DataView(header.buffer);
  let off = 0;

  // signature 0x02014b50
  view.setUint32(off, 0x02014b50, true); off += 4;
  // version made by (host = 3 = Unix, version = 20)
  view.setUint16(off, (3 << 8) | VERSION, true); off += 2;
  // version needed
  view.setUint16(off, VERSION, true); off += 2;
  // general purpose bit flag (UTF-8)
  view.setUint16(off, UTF8_FLAG, true); off += 2;
  // compression method
  view.setUint16(off, STORE_METHOD, true); off += 2;
  // last mod time
  view.setUint16(off, params.dosTime & 0xffff, true); off += 2;
  // last mod date
  view.setUint16(off, (params.dosTime >> 16) & 0xffff, true); off += 2;
  // crc32
  view.setUint32(off, params.crc32, true); off += 4;
  // compressed size
  view.setUint32(off, params.compressedSize, true); off += 4;
  // uncompressed size
  view.setUint32(off, params.uncompressedSize, true); off += 4;
  // file name length
  view.setUint16(off, nameLen, true); off += 2;
  // extra field length
  view.setUint16(off, 0, true); off += 2;
  // file comment length
  view.setUint16(off, 0, true); off += 2;
  // disk number start
  view.setUint16(off, 0, true); off += 2;
  // internal file attributes
  view.setUint16(off, 0, true); off += 2;
  // external file attributes
  view.setUint32(off, 0, true); off += 4;
  // relative offset of local header
  view.setUint32(off, params.localHeaderOffset, true); off += 4;

  // file name
  header.set(params.fileName, off);
  return header;
}

interface EocdParams {
  entryCount: number;
  centralDirSize: number;
  centralDirOffset: number;
  comment: Uint8Array;
}

function buildEocd(params: EocdParams): Uint8Array {
  const commentLen = params.comment.length;
  const record = new Uint8Array(22 + commentLen);
  const view = new DataView(record.buffer);
  let off = 0;

  // signature 0x06054b50
  view.setUint32(off, 0x06054b50, true); off += 4;
  // disk number
  view.setUint16(off, 0, true); off += 2;
  // disk where central directory starts
  view.setUint16(off, 0, true); off += 2;
  // number of central directory records on this disk
  view.setUint16(off, params.entryCount, true); off += 2;
  // total number of central directory records
  view.setUint16(off, params.entryCount, true); off += 2;
  // size of central directory
  view.setUint32(off, params.centralDirSize, true); off += 4;
  // offset of central directory
  view.setUint32(off, params.centralDirOffset, true); off += 4;
  // comment length
  view.setUint16(off, commentLen, true); off += 2;

  if (commentLen > 0) {
    record.set(params.comment, off);
  }
  return record;
}

// ============================================================
// 辅助
// ============================================================

/** 将毫秒时间戳转换为 MS-DOS 日期时间格式 */
function toDosDateTime(ms: number): number {
  const d = new Date(ms);
  const time =
    ((d.getSeconds() >> 1) << 0) |
    (d.getMinutes() << 5) |
    (d.getHours() << 11);
  const date =
    d.getDate() |
    ((d.getMonth() + 1) << 5) |
    ((d.getFullYear() - 1980) << 9);
  return (date << 16) | time;
}

function encodeUtf8(str: string): Uint8Array {
  return new TextEncoder().encode(str);
}
