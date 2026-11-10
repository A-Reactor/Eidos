import type { GameplayPlugin } from './types';
import type { GlobalPlugin } from '../global-plugins/types';
import { allowedFields, PluginInputError, record, text } from './validation';

export const PLUGIN_IMPACTS = { layout: '界面布局', gameplay: '玩法与规则', narrative: '叙事与文字表现', appearance: '外观与样式', audio: '语音与音频', tools: '作者工具' } as const;
export type PluginImpact = keyof typeof PLUGIN_IMPACTS;
export interface PluginImage { src: string; alt: string }
export interface PluginIntroduction { impacts: PluginImpact[]; images: PluginImage[] }
export const MAX_INTRO_IMAGES = 4;
export const MAX_INTRO_IMAGE_BYTES = 2 * 1024 * 1024;
export function parsePluginIntroduction(value: unknown): PluginIntroduction | undefined {
  if (value === undefined) return undefined;
  const info = record(value); allowedFields(info, ['impacts', 'images']);
  if (!Array.isArray(info.impacts) || info.impacts.length > 6 || info.impacts.some(key => typeof key !== 'string' || !Object.hasOwn(PLUGIN_IMPACTS, key)) || new Set(info.impacts).size !== info.impacts.length) throw new PluginInputError('插件影响类型无效');
  if (!Array.isArray(info.images) || info.images.length > MAX_INTRO_IMAGES) throw new PluginInputError('介绍图片最多 4 张');
  const images = info.images.map(value => {
    const image = record(value); allowedFields(image, ['src', 'alt']);
    const match = typeof image.src === 'string' ? image.src.match(/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/) : null;
    const encoded = match?.[2] ?? '';
    const bytes = Math.floor(encoded.length * 3 / 4) - (encoded.endsWith('==') ? 2 : encoded.endsWith('=') ? 1 : 0);
    if (!match || encoded.length % 4 !== 0 || bytes > MAX_INTRO_IMAGE_BYTES) throw new PluginInputError('介绍图片须为不超过 2 MB 的 PNG、JPEG 或 WebP');
    return { src: match[0], alt: text(image.alt, 160) };
  });
  return { impacts: info.impacts as PluginImpact[], images };
}
export function pluginImpactSummary(plugin: GameplayPlugin | GlobalPlugin): { detected: PluginImpact[]; declared: PluginImpact[]; script: boolean } {
  const detected = new Set<PluginImpact>();
  if (plugin.format === 'eidos-gameplay-plugin') {
    if (plugin.ui?.presentation === 'scene-map' || plugin.ui?.reading === 'replace' && !['native', 'native-text', 'tool'].includes(plugin.ui.presentation ?? '')) detected.add('layout');
    if (plugin.rules.length || Object.keys(plugin.resources ?? {}).length) detected.add('gameplay');
    if (Object.values(plugin.prompts).some(value => value.trim()) || plugin.ui?.presentation === 'native-text') detected.add('narrative');
    if (plugin.ui?.html && plugin.ui.presentation !== 'scene-map') detected.add('tools');
  } else if (plugin.css) detected.add('appearance');
  return { detected: [...detected], declared: plugin.introduction?.impacts ?? [], script: plugin.format === 'eidos-global-plugin' && Boolean(plugin.script) };
}
export function readIntroductionImage(file: File): Promise<PluginImage> {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > MAX_INTRO_IMAGE_BYTES || !file.size) return Promise.reject(new Error('请选择不超过 2 MB 的 PNG、JPEG 或 WebP 图片'));
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('图片读取失败'));
    reader.onload = () => {
      try { const image = { src: String(reader.result), alt: file.name.replace(/\.[^.]+$/, '').slice(0, 160) || '插件介绍图' }; parsePluginIntroduction({ impacts: [], images: [image] }); resolve(image); }
      catch (error) { reject(error); }
    };
    reader.readAsDataURL(file);
  });
}
