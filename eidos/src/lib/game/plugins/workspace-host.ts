import { computeContentHash } from '../cas-storage';
import { loadSettings } from '../settings';
import { validateGameModeConfig } from './manifest';
import { filePath, readModResource, workspaceEvent, workspaceOf } from './workspace';
import { workspaceOperation, type WorkspaceAccess } from './workspace-operations';
import { text } from './validation';
import type { TokenUsage } from '@/lib/ai/types';
import { nativeWorkspaceAvailable, nativeWorkspaceFile } from './native-workspace';
import { storeModResource } from './workspace';
import { saveFile } from '../save-file';

export function modCapabilities() {
  const settings = loadSettings();
  return { files: true, resources: true, stages: 'embedded', nativeWindows: nativeWorkspaceAvailable(), nativeDirectory: nativeWorkspaceAvailable(),
    analysis: { role: 'uzq', providerId: settings.uzqProviderId, model: settings.uzqModel, imageTransport: settings.uzqProviderId !== 'deepseek', documentTransport: ['anthropic', 'custom-anthropic-compatible', 'gemini'].includes(settings.uzqProviderId), audio: false } };
}
export function commitWorkspace(access: WorkspaceAccess, next: Parameters<WorkspaceAccess['commit']>[0]) {
  validateGameModeConfig({ ...access.state(), _eidosWorkspace: next });
  access.commit(next);
}
/** Download only a resource already owned by this author's current workspace. */
async function exportResource(path: string, access: WorkspaceAccess) {
  const ref = workspaceOf(access.state()).files[path];
  if (!ref) throw new Error('文件不存在');
  const result = await saveFile(async () => {
    const resource = await readModResource(ref);
    if (!access.current()) throw new Error('模组会话已切换');
    const bytes = resource.text !== undefined ? resource.text : Uint8Array.from(atob(resource.base64!), char => char.charCodeAt(0));
    return new Blob([bytes], { type: resource.mimeType });
  }, path.split('/').at(-1)!);
  if (result === 'cancelled') return { path, version: ref.id, status: 'cancelled' };
  if (!access.current()) throw new Error('模组会话已切换，文件已导出但未写入旧会话事件');
  commitWorkspace(access, workspaceEvent(workspaceOf(access.state()), { type: 'file_export_requested', path, version: ref.id }));
  return { path, version: ref.id, status: 'download_requested' };
}
export async function inspectResource(params: Record<string, unknown>, access: WorkspaceAccess, signal: AbortSignal, account: (usage: TokenUsage) => void) {
  const path = filePath(params.path), task = text(params.task, 4000);
  const w = workspaceOf(access.state()), ref = w.files[path];
  if (!ref) throw new Error('文件不存在');
  const settings = loadSettings();
  const selected = Object.fromEntries(Object.entries(settings).filter(([key]) => key.startsWith('uzq') || key === 'reserveReasoningBudget'));
  const { uzqApiKey: _key, ...identity } = selected;
  const offset = typeof params.offset === 'number' && Number.isInteger(params.offset) && params.offset >= 0 ? params.offset : 0;
  const length = typeof params.length === 'number' && Number.isInteger(params.length) && params.length > 0 ? Math.min(params.length, 48_000) : 24_000;
  const cacheKey = await computeContentHash({ version: ref.id, name: path, task, identity, offset, length });
  if (!access.current()) throw new Error('模组会话已切换');
  const cached = w.interpretations[cacheKey];
  if (cached) return { ...cached, cached: true };
  const original = await readModResource(ref);
  // Loading local material can outlive ownership of the reading stage.
  if (!access.current()) throw new Error('模组会话已切换');
  const resource = original.text === undefined ? original : { ...original, text: original.text.slice(offset, offset + length) };
  const selectedTask = original.text !== undefined && resource.text!.length !== original.text.length ? `${task}\n本次只提供原文 ${offset}–${offset + resource.text!.length} 字符，总长 ${original.text.length}；不要声称已读全文。` : task;
  signal.throwIfAborted();
  const response = await fetch('/api/game/mod-resource', { method: 'POST', signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ resource, task: selectedTask, _settings: selected }) });
  const result = await response.json();
  if (result.usage) account(result.usage);
  if (!response.ok || result.error) throw new Error(result.error || '材料处理失败');
  if (!access.current()) throw new Error('模组会话已切换');
  signal.throwIfAborted();
  const current = workspaceOf(access.state());
  if (current.files[path]?.id !== ref.id) throw new Error('材料已更新，旧版本的分析结果未写入当前文件');
  const interpretation = { content: text(result.content, 16_000), resourceId: ref.id, task };
  // Keep recent independent tasks; old raw files are still addressable by snapshots.
  const interpretations = Object.fromEntries([...Object.entries(current.interpretations).slice(-3), [cacheKey, interpretation]]);
  commitWorkspace(access, workspaceEvent({ ...current, interpretations }, { type: 'resource_interpreted', path, version: ref.id }));
  return { ...interpretation, cached: false };
}
export async function runWorkspaceOperation(method: string, params: Record<string, unknown>, access: WorkspaceAccess) {
  if (method === 'files.checkout' || method === 'files.reload') {
    const path = filePath(params.path), w = workspaceOf(access.state());
    const workspace = await computeContentHash(access.mailbox);
    const ref = w.files[path], base = w.nativeFiles?.[path];
    const previous = base ? await readModResource(base) : undefined;
    const resource = ref ? await readModResource(ref) : undefined;
    if (!access.current()) throw new Error('模组会话已切换');
    if (method === 'files.checkout' && resource?.text === undefined) throw new Error('工作目录当前只支持文本文件');
    const result = await nativeWorkspaceFile(workspace, path, method === 'files.checkout' ? resource!.text : undefined, previous?.text ?? null);
    if (!access.current()) throw new Error('模组会话已切换');
    const saved = await storeModResource({ name: path, mimeType: ref?.mimeType ?? 'text/plain', text: result.content });
    if (!access.current()) throw new Error('模组会话已切换');
    const current = workspaceOf(access.state());
    commitWorkspace(access, workspaceEvent({ ...current, files: { ...current.files, [path]: saved }, nativeFiles: { ...current.nativeFiles, [path]: saved } }, { type: method === 'files.checkout' ? 'file_checked_out' : 'file_reloaded', path, version: saved.id }));
    return { ...saved, directory: result.directory };
  }
  if (method === 'files.export') return exportResource(filePath(params.path), access);
  return workspaceOperation(method, params, { ...access, commit: next => commitWorkspace(access, next) });
}
