import { exportValues } from '../export-values';
import { record, text, PluginInputError } from './validation';
import { preserveGameplayLedger } from './gameplay-state';

export const WORKSPACE_KEY = '_eidosWorkspace';
export { MAX_RESOURCE_BYTES } from '../workspace/types';
export type { ModResource, ResourceRef } from '../workspace/types';
import { MAX_RESOURCE_BYTES, type ResourceRef } from '../workspace/types';
export { filePath, checkVersion } from '../workspace/paths';
export { parseResource as parseModResource, storeResource as storeModResource, readResource as readModResource } from '../workspace/resources';
export interface ModStage { id: string; title: string; html: string; x: number; y: number; width: number; height: number; mode?: 'native' | 'embedded' }
export interface WorkspaceEvent { id: string; type: string; path?: string; stageId?: string; version?: string; createdAt: number }
export interface ModWorkspace {
  files: Record<string, ResourceRef>; stages: ModStage[]; events: WorkspaceEvent[];
  interpretations: Record<string, { content: string; resourceId: string; task: string }>;
  nativeFiles?: Record<string, ResourceRef>;
}
export function workspaceOf(state: Record<string, unknown>): ModWorkspace {
  const w = state[WORKSPACE_KEY] as ModWorkspace | undefined;
  return w ?? { files: {}, stages: [], events: [], interpretations: {} };
}
/** Author state updates cannot erase host-owned files while a task is in flight. */
export function authorState(previous: Record<string, unknown>, next: Record<string, unknown>): Record<string, unknown> {
  const { [WORKSPACE_KEY]: _ignored, _eidosCard: _ignoredCard, ...author } = next;
  return { ...preserveGameplayLedger(previous, author), ...(previous[WORKSPACE_KEY] ? { [WORKSPACE_KEY]: previous[WORKSPACE_KEY] } : {}),
    ...(previous._eidosCard ? { _eidosCard: previous._eidosCard } : {}) };
}
export function workspaceEvent(w: ModWorkspace, event: Omit<WorkspaceEvent, 'id' | 'createdAt'>): ModWorkspace {
  return { ...w, events: [...w.events.slice(-31), { ...event, id: crypto.randomUUID(), createdAt: Date.now() }] };
}
export function validateWorkspace(state: Record<string, unknown>): void {
  if (state[WORKSPACE_KEY] === undefined) return;
  const w = record(state[WORKSPACE_KEY]);
  const refs = Object.values(record(w.files)).concat(Object.values(record(w.nativeFiles ?? {})));
  for (const raw of refs) {
    const ref = record(raw);
    if (typeof ref.id !== 'string' || !/^material_[a-f0-9]{16}$/.test(ref.id) || typeof ref.name !== 'string' || typeof ref.mimeType !== 'string' || typeof ref.size !== 'number' || ref.size < 0 || ref.size > MAX_RESOURCE_BYTES) throw new PluginInputError('存档材料引用无效');
  }
  if (!Array.isArray(w.stages) || !Array.isArray(w.events)) throw new PluginInputError('存档工作区舞台或事件无效');
  w.stages.forEach(stage => parseStage(stage));
  for (const raw of w.events) { const event = record(raw); if (typeof event.id !== 'string' || typeof event.type !== 'string' || typeof event.createdAt !== 'number') throw new PluginInputError('存档工作区事件无效'); }
  record(w.interpretations);
}
export function parseStage(value: unknown, previous?: ModStage): ModStage {
  const s = record(value), id = text(s.id, 80);
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new PluginInputError('舞台 ID 无效');
  const number = (key: 'x' | 'y' | 'width' | 'height', fallback: number) => typeof s[key] === 'number' && Number.isFinite(s[key]) ? Math.max(key === 'width' || key === 'height' ? 180 : 0, Math.min(1600, s[key])) : previous?.[key] ?? fallback;
  return { id, title: s.title === undefined ? previous?.title ?? id : text(s.title, 120), html: s.html === undefined ? previous?.html ?? '' : text(s.html, 20_000),
    mode: s.mode === 'native' ? 'native' : s.mode === 'embedded' ? 'embedded' : previous?.mode ?? 'embedded',
    x: number('x', 24), y: number('y', 24), width: number('width', 360), height: number('height', 320) };
}
/** Walk snapshots as well as manual saves, including resources on abandoned branches. */
export function resourceReferences(value: unknown, result = new Map<string, ResourceRef>()): Map<string, ResourceRef> {
  for (const item of exportValues(value)) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const w = (item as Record<string, unknown>)[WORKSPACE_KEY] as ModWorkspace | undefined;
    const outputs = (item as Record<string, unknown>).workspaceState as Record<string, ResourceRef> | undefined;
    for (const ref of Object.values(outputs ?? {})) result.set(ref.id, ref);
    const registry = (item as Record<string, unknown>).midoriAssetRegistry as import('../midori/asset-registry').MidoriAssetRegistry | undefined;
    for (const image of Object.values(registry?.images ?? {})) if (image.originalResource) result.set(image.originalResource.id, image.originalResource);
    const branch = (item as Record<string, unknown>).workspaceBranch as import('../workspace/branch').WorkspaceBranch | undefined;
    for (const change of branch?.images ?? []) {
      result.set(change.resource.id, change.resource);
      for (const original of [change.before?.originalResource, change.image.originalResource]) if (original) result.set(original.id, original);
    }
    for (const ref of Object.values(w?.files ?? {})) result.set(ref.id, ref);
    for (const ref of Object.values(w?.nativeFiles ?? {})) result.set(ref.id, ref);
  }
  return result;
}
