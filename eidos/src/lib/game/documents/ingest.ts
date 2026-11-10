import { storeResource } from '../workspace/resources';
import { MAX_RESOURCE_BYTES } from '../workspace/types';
import { readDocument, saveDocument } from './repository';
import type { DocumentFormat, DocumentRef, DocumentScope } from './types';

const EXTENSIONS = /\.(txt|md|markdown|json|csv|log|yml|yaml)$/i;
import { fileBytes, bytesToBase64 } from './file-bytes';
export { fileBytes, bytesToBase64 } from './file-bytes';
import { isImageMimeType } from '../midori/image-format';
import { importImageDocument } from '../midori/image-documents';
export async function importDocument(scope: DocumentScope, file: File) {
  if (isImageMimeType(file.type)) return (await importImageDocument(scope, file)).link;
  if (!EXTENSIONS.test(file.name) && !file.type.startsWith('text/')) throw new Error('首期支持文本文件，PDF 和 Word 将后续接入');
  if (file.size > MAX_RESOURCE_BYTES) throw new Error('单份文件超过 4 MiB，请拆分后导入');
  const bytes = await fileBytes(file);
  if (bytes.length > MAX_RESOURCE_BYTES) throw new Error('单份文件超过 4 MiB，请拆分后导入');
  let content: string;
  try { content = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { throw new Error('文件不是有效 UTF-8 文本，请转换编码后导入'); }
  if (content.includes('\0')) throw new Error('文件包含二进制内容，请导入文本版本');
  const markdown = /\.(md|markdown)$/i.test(file.name), internalName = `${crypto.randomUUID()}${markdown ? '.md' : '.txt'}`;
  const originalResource = await storeResource({ name: internalName, mimeType: file.type || 'application/octet-stream', base64: bytesToBase64(bytes) });
  const resource = await storeResource({ name: internalName, mimeType: markdown ? 'text/markdown' : 'text/plain', text: content });
  return saveDocument(scope, { title: file.name, fileName: file.name, origin: 'imported', resource, originalResource, format: markdown ? 'markdown' : 'text' });
}
export async function saveLocalDocument(scope: DocumentScope, input: { title: string; content: string; format?: DocumentFormat; previous?: DocumentRef }) {
  const format = input.format ?? 'markdown';
  const previous = input.previous ? await readDocument(scope, input.previous) : undefined;
  const revisionName = previous && (previous.resource.revisionName || previous.record.title !== input.title && previous.resource.text === input.content) ? input.title : undefined;
  const resource = await storeResource({ ...(revisionName ? { revisionName } : {}), name: format === 'markdown' ? 'document.md' : 'document.txt', mimeType: format === 'markdown' ? 'text/markdown' : 'text/plain', text: input.content });
  return saveDocument(scope, { title: input.title, origin: 'authored', resource, format, previous: input.previous,
    originalResource: previous?.record.versions[input.previous!.revision]?.originalResource });
}
