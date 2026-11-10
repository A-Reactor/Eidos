import { loadMeta, saveMeta } from '../storage';
import { computeContentHash } from '../cas-storage';
import { record, text, PluginInputError } from '../plugins/validation';
import { MAX_RESOURCE_BYTES, type ModResource, type ResourceRef } from './types';
import { isImageMimeType } from '../midori/image-format';
import { MAX_IMAGE_UPLOAD_BYTES } from '../midori/image-tags';

export function parseResource(value: unknown): ModResource {
  const r = record(value);
  const name = text(r.name, 240), mimeType = text(r.mimeType, 120).toLowerCase();
  const content = typeof r.text === 'string' ? { text: r.text } : typeof r.base64 === 'string' ? { base64: r.base64 } : null;
  if (!content || r.text !== undefined && r.base64 !== undefined) throw new PluginInputError('资源须包含原文或 base64 原件');
  if (content.base64 !== undefined && (content.base64.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(content.base64))) throw new PluginInputError('资源编码无效');
  const size = content.text !== undefined ? new TextEncoder().encode(content.text).length
    : content.base64!.length * 3 / 4 - (content.base64!.match(/=*$/)?.[0].length ?? 0);
  const image = content.base64 !== undefined && isImageMimeType(mimeType);
  if (size > (image ? MAX_IMAGE_UPLOAD_BYTES : MAX_RESOURCE_BYTES)) throw new PluginInputError(image ? '图片不能超过 32 MB' : '单份材料超过 4 MB，请拆分后递交');
  return { ...(r.revisionToken !== undefined ? { revisionToken: text(r.revisionToken, 160) } : {}), ...(r.revisionName !== undefined ? { revisionName: text(r.revisionName, 240) } : {}), id: typeof r.id === 'string' ? r.id : '', name, mimeType, size, ...content };
}
export async function storeResource(value: unknown): Promise<ResourceRef> {
  const resource = parseResource(value);
  const id = `material_${await computeContentHash({ mimeType: resource.mimeType, text: resource.text, base64: resource.base64, ...(resource.revisionToken !== undefined ? { revisionToken: resource.revisionToken } : {}), ...(resource.revisionName !== undefined ? { revisionName: resource.revisionName } : {}) })}`;
  await saveMeta(id, { ...resource, id, lastStoredAt: Date.now() });
  const { text: _text, base64: _base64, ...ref } = { ...resource, id };
  return ref;
}
export async function readResource(ref: ResourceRef): Promise<ModResource> {
  const resource = await loadMeta<ModResource>(ref.id);
  if (!resource) throw new Error('材料原件缺失，请重新导入或恢复完整备份');
  // Refresh an old lease before publishing a reference; a concurrent sweep may otherwise race indexing.
  const stored = resource as ModResource & { lastStoredAt?: number };
  if (Number.isFinite(stored.lastStoredAt) && Date.now() - stored.lastStoredAt! > 24 * 60 * 60 * 1000) await saveMeta(ref.id, { ...resource, lastStoredAt: Date.now() });
  return { ...parseResource(resource), ...ref };
}
