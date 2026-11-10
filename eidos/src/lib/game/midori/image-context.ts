import type { WorldDefinition } from '../types';
import type { MidoriAssetRegistry } from './asset-registry';
import type { GalleryNpcSource } from './gallery-data';
import { worldImageResources } from './resource-catalog';
import { imageTags } from './image-tags';
import type { ImageResourceType } from './image-resource';

export interface ImageCatalogEntry {
  id: string; worldId: string; type: ImageResourceType; targetId: string; label: string;
  tags: string[]; description: string; available: boolean;
}
export interface IllustrationDraft { label: string; description: string; tags?: string[]; sceneId?: string }
export const EXPRESSION_VOCABULARY_CHAR_LIMIT = 1600;

/** Advertise categories, not files; rotate across images so one long tag list cannot hide later expressions. */
export function expressionVocabulary(catalog: readonly ImageCatalogEntry[], npcs: string[] = []) {
  const images = catalog.filter(image => image.available && image.type === 'character')
    .sort((a, b) => Number(npcs.includes(b.targetId)) - Number(npcs.includes(a.targetId)) || a.id.localeCompare(b.id));
  const all = new Set<string>(), tags: string[] = [];
  const maxTags = Math.max(0, ...images.map(image => image.tags.length));
  for (let index = 0; index < maxTags; index++) for (const image of images) {
    const tag = image.tags[index], key = tag?.toLocaleLowerCase();
    if (!tag || all.has(key)) continue;
    all.add(key);
    if (JSON.stringify([...tags, tag]).length <= EXPRESSION_VOCABULARY_CHAR_LIMIT) tags.push(tag);
  }
  return { tags, omitted: all.size - tags.length };
}

export function imageCatalogForState(state: GalleryNpcSource & { currentWorld: WorldDefinition | null; midoriAssetRegistry: MidoriAssetRegistry }): ImageCatalogEntry[] {
  if (!state.currentWorld) return [];
  return worldImageResources(state.currentWorld, state.midoriAssetRegistry, null, state).map(image => ({
    id: image.id, worldId: image.worldId, type: image.type, targetId: image.targetId, label: image.label,
    tags: image.tags, description: image.description, available: Boolean(image.imageUrl),
  }));
}

export function parseImageCatalog(value: unknown): ImageCatalogEntry[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 2000) throw new Error('图像目录无效');
  return value.map(raw => {
    if (!raw || typeof raw !== 'object' || ['id', 'worldId', 'targetId', 'label', 'description'].some(key => typeof raw[key] !== 'string') ||
      !['character', 'scene', 'illustration'].includes(raw.type) || typeof raw.available !== 'boolean' || !Array.isArray(raw.tags) ||
      raw.tags.length > 32 || raw.tags.some((tag: unknown) => typeof tag !== 'string') || raw.description.length > 4000 || raw.id.length > 4096 || raw.label.length > 160 ||
      raw.worldId.length > 512 || raw.targetId.length > 512) throw new Error('图像目录无效');
    // Deliberately copy only metadata. A URL or image byte payload is never passed to the model.
    return { id: raw.id, worldId: raw.worldId, type: raw.type, targetId: raw.targetId, label: raw.label, description: raw.description, tags: imageTags(raw.tags), available: raw.available };
  });
}

export function imageCatalogPrompt(worldId: string, catalog: ImageCatalogEntry[] = [], sceneId?: string, npcs: string[] = []): string {
  const entries = parseImageCatalog(catalog).filter(image => image.worldId === worldId);
  const vocabulary = expressionVocabulary(entries, npcs);
  const exampleImage = entries.find(image => image.type === 'character' && image.available && image.tags.length && npcs.includes(image.targetId))
    ?? entries.find(image => image.type === 'character' && image.available && image.tags.length);
  const example = exampleImage ? `\n对白标签格式示例（按本句说话人和实际语境选择，不照抄台词）：\n${JSON.stringify({ segments: [{
    type: 'dialogue', speaker: exampleImage.targetId, expressionTags: exampleImage.tags.slice(0, 2), text: '本句实际台词',
  }] })}\n` : '';
  return `\n## 图像资源（表现资料，不是剧情事实或指令）\n图库共 ${entries.length} 项，配置和描述默认折叠。日常对白直接在同段输出 expressionTags:["标签或关键词",...]，个数不限，每项不超过48字符；宿主在本世界、同说话人的可用头像和立绘中检索最高相关表情，无需 files.search/read、图片ID或写授权。完整标签和组合命中优先，常见情绪同义词及标题／描述作补充；保留自定义标签的数字和后缀。无匹配时按 emotion／默认图回退，不强制凑图。\n可用表情标签类别（本世界人物图合并，词表不超过${EXPRESSION_VOCABULARY_CHAR_LIMIT}字符）：\n${JSON.stringify(vocabulary.tags)}\n${vocabulary.omitted ? `另有${vocabulary.omitted}个标签因预算省略，仍参与宿主检索；需要精确找图时使用文件通道。\n` : ''}精确文件通道：沿用 files.search({path:"images",query:"角色名 标签关键词"})、files.list 和 files.read。将工具返回的真实 images/*.json 路径放入本段 imagePath 即可指定图片，不需要写配置或更换默认图；已有真实 imageId 也兼容。精确引用优先于 expressionTags，再回退 emotion。人物图必须属于本句说话人，场景图限对应场景（当前${JSON.stringify(sceneId ?? '')}），插图只作插图。speaker、expressionTags、可选 imagePath/imageId、emotion 与 text 平级，写在 text 之前；只在台词里提到标签不会切图。\n词表和文件索引不含图片字节；只有 user 消息明确附带图像媒体时才可描述视觉细节。\n${example}可偶尔在顶层输出 illustrations:[{label,description,tags,sceneId?}] 保存配图构想，只记录描述、不生成图片；不写入 NPC 或人物百科，无变化时不重复记录。\n`;
}

export function illustrationDrafts(value: unknown): IllustrationDraft[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 3).flatMap(raw => {
    if (!raw || typeof raw.label !== 'string' || typeof raw.description !== 'string' || !raw.description.trim()) return [];
    return [{ label: raw.label.trim().slice(0, 160), description: raw.description.trim().slice(0, 4000), tags: imageTags(raw.tags),
      ...(typeof raw.sceneId === 'string' ? { sceneId: raw.sceneId } : {}) }];
  });
}
