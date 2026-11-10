// ============================================================
// Eidos ZIP Writer 测试
// ============================================================

import { describe, expect, it } from "vitest";
import { createZipBlob, crc32 } from "@/lib/game/zip-writer";

const encoder = new TextEncoder();

describe("crc32", () => {
  it("computes IEEE 802.3 CRC32 correctly", () => {
    const data = encoder.encode("hello world");
    expect(crc32(data)).toBe(0x0d4a1185);
  });

  it("returns 0 for empty data", () => {
    expect(crc32(new Uint8Array(0))).toBe(0);
  });

  it("produces a non-zero value for non-empty data", () => {
    const data = encoder.encode("test");
    expect(crc32(data)).not.toBe(0);
  });

  it("is deterministic", () => {
    const data = encoder.encode("deterministic test");
    expect(crc32(data)).toBe(crc32(data));
  });

  it("handles single-byte input", () => {
    const data = new Uint8Array([0x41]); // 'A'
    expect(crc32(data)).not.toBe(0);
  });
});

describe("createZipBlob", () => {
  it("creates a valid ZIP with correct mime type", () => {
    const blob = createZipBlob([]);
    expect(blob.type).toBe("application/zip");
  });

  it("creates an empty ZIP (only EOCD)", () => {
    const blob = createZipBlob([]);
    // EOCD is 22 bytes
    expect(blob.size).toBe(22);
  });

  it("creates a ZIP containing a single file", async () => {
    const content = encoder.encode("hello world");
    const blob = createZipBlob([
      { path: "test.txt", content },
    ]);

    // 应该大于原始内容（包含 local header + central dir + EOCD）
    expect(blob.size).toBeGreaterThan(content.length + 22);

    // 可以通过标准 ZIP 库解析验证
    const arrayBuffer = await blob.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);

    // 验证 EOCD 签名 (0x06054b50) 存在于末尾
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const eocdSig = view.getUint32(bytes.length - 22, true);
    expect(eocdSig).toBe(0x06054b50);
  });

  it("stores multiple files with correct entry count in central directory", async () => {
    const files = [
      { path: "world/world.json", content: encoder.encode(JSON.stringify({ id: "test" })) },
      { path: "manifest.json", content: encoder.encode(JSON.stringify({ version: "v2" })) },
      { path: "summary.md", content: encoder.encode("# Summary") },
    ];

    const blob = createZipBlob(files);
    const arrayBuffer = await blob.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

    // 从末尾 EOCD 读取条目数
    const eocdOffset = bytes.length - 22;
    const entryCount = view.getUint16(eocdOffset + 10, true);
    expect(entryCount).toBe(3);
  });

  it("handles UTF-8 file names with Chinese characters", async () => {
    const content = encoder.encode("test");
    const blob = createZipBlob([
      { path: "裂隙之城/世界.json", content },
    ]);

    const arrayBuffer = await blob.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);

    // 查找文件名 "裂隙之城/世界.json" 的 UTF-8 字节
    const fileNameBytes = encoder.encode("裂隙之城/世界.json");
    const found = indexOfSubarray(bytes, fileNameBytes);
    expect(found).toBeGreaterThan(-1);
  });

  it("handles empty file content correctly", async () => {
    const blob = createZipBlob([
      { path: "empty.json", content: new Uint8Array(0) },
    ]);

    expect(blob.size).toBeGreaterThan(0);

    const arrayBuffer = await blob.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

    // EOCD entry count 应该为 1
    const eocdOffset = bytes.length - 22;
    const entryCount = view.getUint16(eocdOffset + 10, true);
    expect(entryCount).toBe(1);
  });

  it("maintains central directory with valid signatures", async () => {
    const content = encoder.encode("central dir test");
    const blob = createZipBlob([
      { path: "dir/file.txt", content },
    ]);

    const arrayBuffer = await blob.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

    // 本地文件头签名 (0x04034b50) 在开头
    expect(view.getUint32(0, true)).toBe(0x04034b50);

    // 中央目录条目签名 (0x02014b50) 在文件数据后
    const localHeaderSize = 30 + encoder.encode("dir/file.txt").length;
    const fileStart = localHeaderSize;
    const fileEnd = fileStart + content.length;
    const centralDirSig = view.getUint32(fileEnd, true);
    expect(centralDirSig).toBe(0x02014b50);
  });

  it("sets UTF-8 flag (bit 11) in general purpose bit flag", async () => {
    const content = encoder.encode("utf8 test");
    const blob = createZipBlob([
      { path: "utf8-file.md", content },
    ]);

    const arrayBuffer = await blob.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

    // 本地文件头 general purpose bit flag 在偏移 6
    const gpFlag = view.getUint16(6, true);
    expect(gpFlag & 0x0800).toBe(0x0800);
  });

  it("sets compression method to store (0)", async () => {
    const content = encoder.encode("store test");
    const blob = createZipBlob([
      { path: "store.txt", content },
    ]);

    const arrayBuffer = await blob.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

    // 本地文件头 compression method 在偏移 8
    const method = view.getUint16(8, true);
    expect(method).toBe(0);
  });

  it("stores file content exactly without modification", async () => {
    const originalContent = encoder.encode("exact content preservation test\nwith newlines\n");
    const blob = createZipBlob([
      { path: "exact.txt", content: originalContent },
    ]);

    const arrayBuffer = await blob.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);

    // 文件内容应该原样出现在 ZIP 中
    const found = indexOfSubarray(bytes, originalContent);
    expect(found).toBeGreaterThan(-1);
  });

  it("sets correct CRC32 in local header matching the file content", async () => {
    const content = encoder.encode("crc32 test content");
    const expectedCrc = crc32(content);
    const blob = createZipBlob([
      { path: "crc.txt", content },
    ]);

    const arrayBuffer = await blob.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

    // 本地文件头 CRC32 在偏移 14
    const storedCrc = view.getUint32(14, true);
    expect(storedCrc).toBe(expectedCrc);
  });
});

/** 在 Uint8Array 中查找子数组的位置 */
function indexOfSubarray(haystack: Uint8Array, needle: Uint8Array): number {
  outer: for (let i = 0; i <= haystack.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    return i;
  }
  return -1;
}
