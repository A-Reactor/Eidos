import { loadMeta, saveMeta } from '../storage';
import { record, text } from './validation';
import { WORKSPACE_KEY, checkVersion, filePath, parseStage, readModResource, storeModResource, workspaceEvent, workspaceOf, type ModWorkspace, type ResourceRef } from './workspace';
import { runFileOperation } from '../workspace/operations';

export interface WorkspaceAccess {
  scope: string; mailbox: string;
  storagePrefix?: (key: string) => string;
  current(): boolean;
  state(): Record<string, unknown>;
  commit(workspace: ModWorkspace): void;
}
export async function workspaceOperation(method: string, raw: unknown, access: WorkspaceAccess): Promise<unknown> {
  const p = record(raw ?? {}), w = workspaceOf(access.state());
  if (!access.current()) throw new Error('模组会话已切换');
  const commit = (next: ModWorkspace) => { if (!access.current()) throw new Error('模组会话已切换'); access.commit(next); };
  if (method === 'files.list') return Object.entries(w.files).map(([path, ref]) => ({ path, ...ref }));
  if (method === 'stages.list') return w.stages.map(({ html: _html, ...stage }) => stage);
  if (method === 'stages.open' || method === 'stages.update') {
    const stage = parseStage(p, w.stages.find(s => s.id === p.id));
    commit(workspaceEvent({ ...w, stages: [...w.stages.filter(s => s.id !== stage.id), stage] }, { type: method === 'stages.open' ? 'stage_opened' : 'stage_updated', stageId: stage.id }));
    return { id: stage.id, mode: stage.mode ?? 'embedded' };
  }
  if (method === 'stages.close') {
    const id = text(p.id, 80);
    commit(workspaceEvent({ ...w, stages: w.stages.filter(s => s.id !== id) }, { type: 'stage_closed', stageId: id }));
    return { id };
  }
  const path = filePath(p.path), ref = w.files[path];
  if (method === 'files.read') { if (!ref) throw new Error('文件不存在'); return readModResource(ref); }
  if (method === 'files.remove') {
    checkVersion(ref, p.expectedVersion);
    const files = { ...w.files }; delete files[path];
    commit(workspaceEvent({ ...w, files }, { type: 'file_removed', path })); return { path };
  }
  if (method === 'files.write' || method === 'files.patch') {
    const result = await runFileOperation({ method, params: { ...p, expectedVersion: p.expectedVersion === undefined ? ref?.id ?? null : p.expectedVersion } }, {
      current: access.current, files: () => workspaceOf(access.state()).files, canAccess: () => true, status: 'committed',
      replaceFiles: files => commit(workspaceEvent({ ...workspaceOf(access.state()), files }, { type: 'file_written', path, version: files[path].id })),
    });
    return result.resource;
  }
  if (method === 'resources.import') {
    checkVersion(ref, p.expectedVersion);
    const resource = await storeModResource({ ...record(p.resource), name: path });
    const current = workspaceOf(access.state());
    checkVersion(current.files[path], p.expectedVersion);
    commit(workspaceEvent({ ...current, files: { ...current.files, [path]: resource } }, { type: 'file_written', path, version: resource.id }));
    return resource;
  }
  // Mail is deliberately outside branch state: only the author's explicit publish carries it.
  const key = text(p.key, 120);
  const storageKey = access.storagePrefix?.(`mod_mail:${access.mailbox}:${key}`) ?? `mod_mail:${access.mailbox}:${key}`;
  if (method === 'files.publish') {
    if (!ref) throw new Error('文件不存在');
    if (!access.current()) throw new Error('模组会话已切换');
    await saveMeta(storageKey, { resource: ref, origin: access.scope });
    commit(workspaceEvent(workspaceOf(access.state()), { type: 'file_published', path, version: ref.id })); return { key, version: ref.id };
  }
  if (method === 'files.receive') {
    const mail = await loadMeta<{ resource: ResourceRef; origin: string }>(storageKey);
    if (!mail) throw new Error('没有这份已寄出的材料');
    checkVersion(ref, p.expectedVersion);
    await readModResource(mail.resource);
    const current = workspaceOf(access.state());
    checkVersion(current.files[path], p.expectedVersion);
    commit(workspaceEvent({ ...current, files: { ...current.files, [path]: { ...mail.resource, name: path } } }, { type: 'file_received', path, version: mail.resource.id }));
    return { ...mail.resource, origin: mail.origin };
  }
  throw new Error(`当前环境不支持操作：${method}`);
}
export function withWorkspace(state: Record<string, unknown>, workspace: ModWorkspace): Record<string, unknown> {
  return { ...state, [WORKSPACE_KEY]: workspace };
}
