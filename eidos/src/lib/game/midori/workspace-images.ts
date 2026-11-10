import type { GameStore } from '@/store/game-store';
import type { WorkspaceSession } from '../workspace/session';
import type { ResourceRef, WorkspaceToolResult } from '../workspace/types';
import type { DocumentRef } from '../documents/types';
import { loadDocumentRecords } from '../documents/repository';
import { readResource, storeResource } from '../workspace/resources';
import { computeContentHash } from '../cas-storage';
import { getSandboxDossierId } from '../archive-scope';
import { currentDocumentScope } from '../model-documents';
import { loadWorldAssetRegistry, readWorldAssetRegistry, persistImageRegistry } from './asset-library';
import { worldImageResources } from './resource-catalog';
import { galleryCharacters, galleryScenes } from './gallery-data';
import { imageResourceId, imageWorkspacePath, type ImageResource } from './image-resource';
import type { MidoriAssetRegistry } from './asset-registry';
import { isImageMimeType, IMAGE_MIME_EXTENSIONS } from './image-format';
import { imageTags } from './image-tags';
import { editImageResource } from './resource-edits';
import { uploadImageResource } from './upload-image';
import { canAdaptImageOriginal, retainImageOriginal } from './image-original';

interface ImageFileSpec {
  imageId: string; type: ImageResource['type']; targetId: string; slot: NonNullable<ImageResource['slot']>;
  label: string; description: string; tags: string[]; makeDefault: boolean;
}
export interface WorkspaceImageEntry { image: ImageResource; writable: boolean; selected?: boolean; document?: DocumentRef }
export interface WorkspaceImageLibrary {
  entries: Record<string, WorkspaceImageEntry>; registry: MidoriAssetRegistry;
  characters: string[]; scenes: string[];
  pathsByDocument: Record<string, string>;
}
export interface WorkspaceImageChange {
  path: string; segmentIndex: number; before: ImageResource | null; image: ImageResource;
  bindingsHash: string; makeDefault: boolean; resource: ResourceRef;
  document?: DocumentRef;
}
const slotOf = (image: ImageResource) => image.slot ?? (image.type === 'character' ? 'portrait' : image.type === 'scene' ? 'background' : 'detail');
const imageSpec = (image: ImageResource, makeDefault = false): ImageFileSpec => ({ imageId: image.id, type: image.type,
  targetId: image.targetId, slot: slotOf(image), label: image.label, description: image.description, tags: image.tags, makeDefault });
const comparable = (image: ImageResource | null) => image && { ...imageSpec(image), original: image.originalResource?.id ?? null };
// A restored original may receive a new cache URL; compare its identity and original instead.
const bindingsHash = (registry: MidoriAssetRegistry) => computeContentHash(Object.fromEntries(Object.entries(registry.bindings).map(([key, { imageUrl, ...binding }]) => {
  const image = Object.values(registry.images ?? {}).find(image => image.imageUrl === imageUrl);
  return [key, { ...binding, imageSource: image ? `${image.id}:${image.originalResource?.id ?? ''}` : imageResourceId(imageUrl) }];
})));

/** Editable descriptors expose placement, never URLs, original bytes or arbitrary host paths. */
export async function mountImageWorkspace(session: WorkspaceSession, state: GameStore): Promise<void> {
  const world = state.currentWorld;
  if (!world) return;
  const registry = await readWorldAssetRegistry(world, state.midoriAssetRegistry, state);
  const images = new Map(worldImageResources(world, registry, null, state).map(image => [image.id, image]));
  const docs = (await loadDocumentRecords(session.scope)).filter(doc => !doc.staged && doc.trashedAt === undefined);
  const byOriginal = new Map([...images.values()].filter(i => i.originalResource).map(i => [i.originalResource!.id, i]));
  const docByImage = new Map<string, DocumentRef[]>();
  for (const doc of docs) {
    const link = session.actionInputs.find(ref => ref.documentId === doc.id)
      ?? Object.entries(session.documentByPath).find(([path, ref]) => path.startsWith('library/') && ref.documentId === doc.id)?.[1];
    const version = link && doc.versions[link.revision], original = version?.originalResource;
    if (!original || !isImageMimeType(original.mimeType)) continue;
    const knownId = doc.idempotencyKey?.startsWith('eidos-image:') ? doc.idempotencyKey.slice('eidos-image:'.length) : '';
    const existing = byOriginal.get(original.id) ?? images.get(knownId);
    const id = existing?.id ?? (knownId || imageResourceId(original.id));
    const image: ImageResource = existing ? { ...existing, originalResource: original,
      ...(existing.originalResource && existing.originalResource.id !== original.id ? { imageUrl: undefined, relativePath: undefined } : {}) } : { id, worldId: world.id, type: 'illustration', targetId: '',
      label: link!.title.slice(0, 160), description: '', tags: [], originalResource: original, source: 'uploaded', createdAt: doc.createdAt, updatedAt: doc.updatedAt };
    if (!registry.removedImageIds?.includes(id)) images.set(id, image);
    docByImage.set(id, [...docByImage.get(id) ?? [], { documentId: doc.id, revision: link!.revision }]);
  }
  if (!images.size) return;
  const characters = galleryCharacters(world, registry, [], state).map(npc => npc.name);
  const scenes = galleryScenes(world);
  const entries: WorkspaceImageLibrary['entries'] = {};
  const pathsByDocument: Record<string, string> = {};
  const sandbox = state.sandboxMode && getSandboxDossierId(state.sandboxDossierId) === '002';
  await Promise.all([...images.values()].map(async image => {
    const documents = docByImage.get(image.id) ?? [];
    const grants = session.actionInputs.filter(ref => documents.some(doc => ref.documentId === doc.documentId && ref.revision === doc.revision));
    const document = grants.find(ref => ref.allowWrite) ?? documents[0];
    const writable = grants.some(ref => ref.allowWrite === false) ? false : sandbox || documents.some(doc => session.writableDocuments.has(`${doc.documentId}:${doc.revision}`));
    const path = imageWorkspacePath(image.id);
    const name = `${image.label || image.id} · 图像配置`.slice(0, 240);
    const ref = await storeResource({ name, revisionName: name, mimeType: 'application/json', text: JSON.stringify(imageSpec(image), null, 2) });
    entries[path] = { image, writable, selected: grants.length > 0, document };
    for (const doc of documents) pathsByDocument[`${doc.documentId}:${doc.revision}`] = path;
    session.files[path] = ref; session.initialFiles[path] = ref;
  }));
  const targets = await storeResource({ name: '图像配置：可用角色和场景', mimeType: 'application/json',
    text: JSON.stringify({ characters, scenes, usage: '修改 images/ 中已有图像配置的 type、targetId、slot、tags、label、description、makeDefault；imageId 保持不变。角色表情通过 tags，例如 ["开心"]；不填写图片地址或原件内容。' }, null, 2) });
  if (session.closed || !session.isCurrent()) throw new DOMException('图像工作区归属已变化', 'AbortError');
  session.files['images/targets.json'] = targets; session.initialFiles['images/targets.json'] = targets;
  session.imageLibrary = { entries, registry, characters, scenes: scenes.map(scene => scene.sceneId), pathsByDocument };
}

export async function readWorkspaceImage(session: WorkspaceSession, path: string): Promise<void> {
  const entry = session.imageLibrary?.entries[path];
  if (!entry || entry.image.originalResource) return;
  // Explicit reads may retain a known local cache file; arbitrary remote/model URLs never enter this path.
  const local = { ...entry.image, source: 'uploaded' as const };
  if (!canAdaptImageOriginal(local)) return;
  const retained = await retainImageOriginal(local);
  if (session.closed || !session.isCurrent()) throw new DOMException('图片查阅已取消', 'AbortError');
  entry.image = { ...entry.image, originalResource: retained.originalResource };
}

export function parseImageFile(session: WorkspaceSession, path: string, text: string): ImageFileSpec {
  const library = session.imageLibrary, entry = library?.entries[path];
  if (!entry?.writable) throw new Error('图像配置未获修改授权');
  let raw: Record<string, unknown>;
  try { raw = JSON.parse(text); } catch { throw new Error('图像配置须为有效 JSON'); }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).some(key => !['imageId', 'type', 'targetId', 'slot', 'label', 'description', 'tags', 'makeDefault'].includes(key))) throw new Error('图像配置包含不支持的字段；不能修改图片地址或原件');
  if (raw.imageId !== entry.image.id || !['character', 'scene', 'illustration'].includes(String(raw.type))) throw new Error('图像 ID 或类型无效');
  if (raw.type !== 'illustration' && !entry.image.imageUrl && !entry.image.originalResource) throw new Error('配图构想没有图片原件，不能设置为立绘或背景，请先导入图像');
  if (typeof raw.targetId !== 'string' || typeof raw.label !== 'string' || raw.label.length > 160 || typeof raw.description !== 'string' || raw.description.length > 4000 || typeof raw.makeDefault !== 'boolean') throw new Error('图像归属、标题、描述或默认设置无效');
  if (!Array.isArray(raw.tags) || raw.tags.length > 32 || raw.tags.some(tag => typeof tag !== 'string' || !tag.trim() || tag.length > 48)) throw new Error('图像标签须为不超过32项的文本列表');
  if (raw.type === 'character' && (!library!.characters.includes(raw.targetId) || !['portrait', 'avatar'].includes(String(raw.slot)))) throw new Error('角色或立绘位置不存在，请读取 images/targets.json');
  if (raw.type === 'scene' && (!library!.scenes.includes(raw.targetId) || raw.slot !== 'background')) throw new Error('场景或背景位置不存在，请读取 images/targets.json');
  if (raw.type === 'illustration' && (raw.slot !== 'detail' || raw.targetId !== '' && !library!.scenes.includes(raw.targetId))) throw new Error('插图位置须为空或真实场景，slot 使用 detail');
  return { ...raw, tags: imageTags(raw.tags) } as unknown as ImageFileSpec;
}

/** Only selected real writes enter an accepted branch; failed JSON never changes its file version. */
export async function prepareImageChanges(session: WorkspaceSession, effects: Array<WorkspaceToolResult & { segmentIndex: number }>): Promise<WorkspaceImageChange[]> {
  let registry = session.imageLibrary?.registry;
  const changes: WorkspaceImageChange[] = [];
  for (const receipt of effects.filter(effect => effect.path?.startsWith('images/'))) {
    const path = receipt.path!, entry = session.imageLibrary?.entries[path];
    if (!registry || !entry || !receipt.resource) throw new Error('图像修改缺少真实配置回执');
    const spec = parseImageFile(session, path, (await readResource(receipt.resource)).text ?? '');
    const before = Object.values(registry.images ?? {}).find(image => image.id === entry.image.id)
      ?? worldImageResources({ id: entry.image.worldId, npcs: {}, regions: {} } as import('../types').WorldDefinition, registry).find(image => image.id === entry.image.id) ?? null;
    const image: ImageResource = { ...entry.image, type: spec.type, targetId: spec.targetId, slot: spec.slot,
      label: spec.label, description: spec.description, tags: spec.tags, updatedAt: Date.now() };
    const change = { path, segmentIndex: receipt.segmentIndex, before, image, bindingsHash: await bindingsHash(registry), makeDefault: spec.makeDefault, resource: receipt.resource, document: entry.document };
    changes.push(change);
    // A host-only projection validates later commands without writing the world library during prediction.
    registry = editImageResource({ world: image.worldId, registry, image: image.originalResource && !image.imageUrl ? { ...image, imageUrl: `pending:${image.id}` } : image, makeDefault: spec.makeDefault, scope: {}, persist: false });
  }
  return changes;
}

export async function projectImageChanges(state: GameStore, changes: WorkspaceImageChange[], current: () => boolean): Promise<MidoriAssetRegistry> {
  let registry = loadWorldAssetRegistry(state.currentWorld!, state.midoriAssetRegistry, state);
  for (const change of changes) {
    if (!current()) throw new DOMException('图像合并归属已变化', 'AbortError');
    if (change.document) {
      const doc = (await loadDocumentRecords(currentDocumentScope(state)!)).find(doc => doc.id === change.document!.documentId);
      if (!doc || doc.trashedAt !== undefined || !doc.versions[change.document.revision]) throw new Error('源图片文档已失效或移入回收站，请重新引用');
    }
    const targets = change.image.type === 'character' ? galleryCharacters(state.currentWorld!, registry, [], state).map(npc => npc.name) : galleryScenes(state.currentWorld!).map(scene => scene.sceneId);
    if (change.image.type !== 'illustration' && !targets.includes(change.image.targetId)) throw new Error('图像目标已不存在，请重新选择角色或场景');
    const actual = worldImageResources(state.currentWorld!, registry, null, state).find(image => image.id === change.image.id) ?? null;
    if (registry.removedImageIds?.includes(change.image.id) || JSON.stringify(comparable(actual)) !== JSON.stringify(comparable(change.before)) || await bindingsHash(registry) !== change.bindingsHash) throw new Error('图像资源或绑定已变化，未覆盖图库，请重新执行操作');
    let image = change.image;
    const moved = !change.before || change.before.type !== image.type || change.before.targetId !== image.targetId || slotOf(change.before) !== slotOf(image);
    // Materialize a placement from immutable bytes, rather than binding a potentially stale exported cache URL.
    if (image.originalResource && (!image.imageUrl || moved)) {
      const original = await readResource(image.originalResource);
      if (!original.base64 || !isImageMimeType(original.mimeType)) throw new Error('图像原件格式无效');
      const bytes = Uint8Array.from(atob(original.base64), char => char.charCodeAt(0));
      image = await uploadImageResource(image.worldId, new File([bytes], original.name || `image.${IMAGE_MIME_EXTENSIONS[original.mimeType]}`, { type: original.mimeType }),
        { type: image.type, targetId: image.targetId, label: image.label, tags: image.tags, resource: image });
      image = { ...image, updatedAt: change.image.updatedAt };
    }
    if (!current()) throw new DOMException('图像合并归属已变化', 'AbortError');
    registry = editImageResource({ world: state.currentWorld!, registry, image, makeDefault: change.makeDefault, scope: state, persist: false });
  }
  return registry;
}

export async function persistImageProjection(state: GameStore, next: MidoriAssetRegistry): Promise<void> {
  const previous = loadWorldAssetRegistry(state.currentWorld!, state.midoriAssetRegistry, state);
  await persistImageRegistry(state.currentWorld!.id, previous, next, state);
}
