import { filePath, checkVersion, withinPath } from './paths';
import { readResource, storeResource } from './resources';
import { lineChanges } from './line-changes';
import type { ResourceRef, WorkspaceCatalogEntry, WorkspaceFileAccess, WorkspaceMatch, WorkspaceToolRequest, WorkspaceToolResult } from './types';

function ensureCurrent(access: WorkspaceFileAccess) {
  if (!access.current()) throw new Error('请求已取消或世界/周目切换，工作区归属发生变化');
}
function checkAccess(access: WorkspaceFileAccess, path: string, operation: 'read' | 'write') {
  ensureCurrent(access);
  if (!access.canAccess(path, operation)) throw new Error('此文件不在本次允许访问的工作区内');
}
function offsetOf(value: unknown): number {
  if (value === undefined) return 0;
  if (!Number.isSafeInteger(value) || Number(value) < 0) throw new Error('文件偏移须为非负整数');
  return Number(value);
}
function entry(path: string, ref: ResourceRef): WorkspaceCatalogEntry {
  return { path, version: ref.id, name: ref.name, mimeType: ref.mimeType, size: ref.size };
}
function availablePaths(request: WorkspaceToolRequest, access: WorkspaceFileAccess, list = false) {
  const prefix = request.params.path === undefined ? '' : filePath(request.params.path);
  return Object.keys(access.files()).filter(path => (!prefix || withinPath(path, prefix)) && (list && access.canList ? access.canList(path) : access.canAccess(path, 'read'))).sort(access.comparePaths);
}
async function search(request: WorkspaceToolRequest, access: WorkspaceFileAccess): Promise<WorkspaceToolResult> {
  const query = request.params.query;
  if (typeof query !== 'string' || !query.trim() || query.length > 2000) throw new Error('检索词须为 1–2000 字符');
  const terms = query.toLocaleLowerCase().trim().split(/\s+/), matches: Array<WorkspaceMatch & { score: number }> = [];
  for (const path of availablePaths(request, access)) {
    const ref = access.files()[path], resource = await readResource(ref);
    ensureCurrent(access);
    if (resource.text === undefined) continue;
    const lower = resource.text.toLocaleLowerCase(), searchable = `${access.describe?.(path, ref).name ?? ref.name}\n${path}\n${lower}`.toLocaleLowerCase();
    const score = terms.reduce((n, term) => n + Number(searchable.includes(term)), 0);
    if (!score) continue;
    const hits = terms.map(term => lower.indexOf(term)).filter(i => i >= 0);
    const offset = hits.length ? Math.max(0, Math.min(...hits) - 160) : 0;
    const descriptor = access.describe?.(path, ref);
    matches.push({ ...(descriptor ? { name: descriptor.name, writable: descriptor.writable, ...(descriptor.imagePath ? { imagePath: descriptor.imagePath } : {}) } : {}), path, version: ref.id, offset, excerpt: resource.text.slice(offset, offset + 500), score });
  }
  matches.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
  const offset = offsetOf(request.params.offset), end = Math.min(matches.length, offset + 8);
  return { method: request.method, status: 'committed', matches: matches.slice(offset, end).map(({ score: _score, ...match }) => match),
    totalMatches: matches.length, offset, nextOffset: end < matches.length ? end : null };
}
async function read(request: WorkspaceToolRequest, access: WorkspaceFileAccess, path: string): Promise<WorkspaceToolResult> {
  const ref = access.files()[path];
  if (!ref) throw new Error('文件不存在');
  if (request.params.version !== undefined && request.params.version !== ref.id) throw new Error('文件版本已变化，请重新读取');
  const resource = await readResource(ref);
  checkAccess(access, path, 'read');
  if (resource.text === undefined) throw new Error('此文件尚无可读取的文本解析结果');
  const offset = offsetOf(request.params.offset);
  if (offset > resource.text.length) throw new Error(`偏移已超出原文长度：offset=${offset}，当前 totalChars=${resource.text.length}，version=${ref.id}。offset 是文本位置，不能使用文件字节大小；请按 nextOffset 读取，或用 offset:0 重新读取。`);
  const end = Math.min(resource.text.length, offset + 12000);
  return { method: request.method, status: 'committed', path, version: ref.id, text: resource.text.slice(offset, end),
    totalChars: resource.text.length, offset, nextOffset: end < resource.text.length ? end : null };
}
async function write(request: WorkspaceToolRequest, access: WorkspaceFileAccess, path: string): Promise<WorkspaceToolResult> {
  const previous = access.files()[path], expected = request.params.expectedVersion;
  checkVersion(previous, expected, true);
  let content = request.params.text;
  const original = previous ? await readResource(previous) : null;
  if (request.method === 'files.patch') {
    if (!previous) throw new Error('待修改文件不存在');
    const old = request.params.oldText, replacement = request.params.newText;
    if (original?.text === undefined) throw new Error('只能修改已解析的文本文件');
    if (typeof old !== 'string' || !old || typeof replacement !== 'string' || original.text.split(old).length !== 2) throw new Error('修改片段须在原文中唯一匹配');
    content = original.text.replace(old, () => replacement);
  }
  if (typeof content !== 'string') throw new Error('写入内容须为文本');
  access.validateWrite?.(path, content);
  const resource = await storeResource({ name: path, mimeType: previous?.mimeType ?? request.params.mimeType ?? 'text/plain', text: content, ...(previous?.revisionName ? { revisionName: previous.revisionName } : {}) });
  checkAccess(access, path, 'write');
  // Persistence can yield to another editor; compare again before replacing its mapping.
  checkVersion(access.files()[path], expected, true);
  access.replaceFiles({ ...access.files(), [path]: resource });
  return { method: request.method, status: access.status ?? 'staged', operationId: crypto.randomUUID(), actor: request.actor ?? { kind: 'assistant' },
    path, beforeVersion: previous?.id ?? null, afterVersion: resource.id, version: resource.id, resource, changes: lineChanges(original?.text ?? '', content), emptyText: !content.trim() };
}
async function rename(request: WorkspaceToolRequest, access: WorkspaceFileAccess, path: string): Promise<WorkspaceToolResult> {
  if (!access.canRename?.(path)) throw new Error('当前仅支持重命名已获写授权的文档库文件');
  const previous = access.files()[path], name = request.params.newName;
  if (!previous) throw new Error('待重命名文件不存在');
  if (typeof name !== 'string' || !name.trim() || name.length > 240 || /[/\\\x00-\x1f]/.test(name)) throw new Error('文件名须为 1–240 字符且不包含路径');
  checkVersion(previous, request.params.expectedVersion, true);
  const original = await readResource(previous);
  // Names are revisioned too: unchanged bytes must still produce a distinct merge target.
  const resource = await storeResource({ ...original, name: name.trim(), revisionName: name.trim() });
  checkAccess(access, path, 'write');
  checkVersion(access.files()[path], request.params.expectedVersion, true);
  access.replaceFiles({ ...access.files(), [path]: resource });
  return { method: request.method, status: access.status ?? 'staged', operationId: crypto.randomUUID(), actor: request.actor ?? { kind: 'assistant' },
    path, beforeVersion: previous.id, afterVersion: resource.id, version: resource.id, resource, changes: { added: 0, removed: 0 } };
}
export async function runFileOperation(request: WorkspaceToolRequest, access: WorkspaceFileAccess): Promise<WorkspaceToolResult> {
  ensureCurrent(access);
  if (request.method === 'files.list') {
    const paths = availablePaths(request, access, true), offset = offsetOf(request.params.offset), end = Math.min(paths.length, offset + 8);
    return { method: request.method, status: 'committed', entries: paths.slice(offset, end).map(path => access.describe?.(path, access.files()[path]) ?? entry(path, access.files()[path])),
      totalMatches: paths.length, offset, nextOffset: end < paths.length ? end : null };
  }
  if (request.method === 'files.search') return search(request, access);
  const path = filePath(request.params.path), writable = request.method === 'files.write' || request.method === 'files.patch' || request.method === 'files.rename';
  checkAccess(access, path, writable ? 'write' : 'read');
  if (request.method === 'files.read') return read(request, access, path);
  if (request.method === 'files.rename') return rename(request, access, path);
  if (writable) return write(request, access, path);
  throw new Error('未知工作区操作');
}
