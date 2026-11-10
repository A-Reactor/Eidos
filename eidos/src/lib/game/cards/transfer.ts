import type { ExportPackageFile } from '../export-records';
import type { ImportSourceFile } from '../import-records';
import type { WorldDefinition } from '../types';
import { importCardAsset, loadCardAsset } from './storage';
import { MAX_CARD_FILE_BYTES, isRecord } from './types';
import { validateCardBindings } from './validation';

function encodeBytes(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(binary);
}
export async function exportWorldCardFiles(world: Pick<WorldDefinition, 'cardBindings'>): Promise<ExportPackageFile[]> {
  const ids = [...new Set((world.cardBindings ?? []).map(b => b.assetId))];
  return Promise.all(ids.map(async id => {
    const asset = await loadCardAsset(id);
    if (!asset) throw new Error('世界引用的原卡资源缺失，无法导出');
    return { path: `cards/${id}.json`, content: JSON.stringify({ id, filename: asset.filename, bytes: encodeBytes(asset.originalBytes) }), mimeType: 'application/json;charset=utf-8' };
  }));
}
export async function restoreWorldCardFiles(files: ImportSourceFile[], world: Pick<WorldDefinition, 'cardBindings'>): Promise<void> {
  validateCardBindings(world.cardBindings);
  for (const id of new Set((world.cardBindings ?? []).map(b => b.assetId))) {
    const file = files.find(f => f.path === `cards/${id}.json` || f.path.endsWith(`/cards/${id}.json`));
    if (!file) {
      if (!await loadCardAsset(id)) throw new Error('导入包缺少原卡资源，请导入包含原卡的世界包');
      continue;
    }
    const envelope: unknown = JSON.parse(file.content);
    if (!isRecord(envelope) || envelope.id !== id || typeof envelope.filename !== 'string' || typeof envelope.bytes !== 'string'
      || envelope.bytes.length > Math.ceil(MAX_CARD_FILE_BYTES / 3) * 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(envelope.bytes)) throw new Error('原卡资源包无效');
    const decoded = atob(envelope.bytes);
    const bytes = Uint8Array.from(decoded, c => c.charCodeAt(0));
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    const hash = Array.from(new Uint8Array(digest), n => n.toString(16).padStart(2, '0')).join('');
    if (hash !== id) throw new Error('原卡资源哈希校验失败');
    await importCardAsset(bytes, envelope.filename);
  }
}
