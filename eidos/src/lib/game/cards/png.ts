import { crc32 } from '../zip-writer';
import { MAX_CARD_JSON_BYTES } from './types';

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
export function isCardPng(bytes: Uint8Array): boolean {
  return SIGNATURE.every((value, index) => bytes[index] === value);
}
export function readCardPng(bytes: Uint8Array): string {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const metadata: Record<string, string> = {};
  let offset = 8;
  let ended = false;
  while (offset + 12 <= bytes.length) {
    const size = view.getUint32(offset);
    const end = offset + size + 12;
    if (end > bytes.length) throw new Error('PNG 数据块越界');
    const kind = new TextDecoder().decode(bytes.subarray(offset + 4, offset + 8));
    if (crc32(bytes.subarray(offset + 4, end - 4)) !== view.getUint32(end - 4)) throw new Error('PNG CRC 校验失败');
    if (kind === 'tEXt') readMetadata(bytes.subarray(offset + 8, end - 4), metadata);
    offset = end;
    if (kind === 'IEND') { ended = true; break; }
  }
  if (!ended || offset !== bytes.length) throw new Error('PNG 文件不完整');
  // Invalid V3 must be reported, rather than silently running an older V2 copy.
  const encoded = metadata.ccv3 ?? metadata.chara;
  if (!encoded) throw new Error('PNG 未包含人物卡元数据');
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) throw new Error('PNG 卡片 Base64 无效');
  let decoded: string;
  try { decoded = atob(encoded); } catch { throw new Error('PNG 卡片 Base64 无效'); }
  if (decoded.length > MAX_CARD_JSON_BYTES) throw new Error('卡片元数据超过大小限制');
  return new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(decoded, c => c.charCodeAt(0)));
}
function readMetadata(payload: Uint8Array, metadata: Record<string, string>): void {
  const zero = payload.indexOf(0);
  if (zero < 0) return;
  const key = new TextDecoder().decode(payload.subarray(0, zero));
  if (key !== 'chara' && key !== 'ccv3') return;
  if (metadata[key] !== undefined) throw new Error(`PNG 含重复 ${key} 元数据`);
  if (payload.length > MAX_CARD_JSON_BYTES * 1.4) throw new Error('卡片元数据超过大小限制');
  metadata[key] = new TextDecoder().decode(payload.subarray(zero + 1));
}
