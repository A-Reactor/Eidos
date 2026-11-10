export const CHARACTER_IMAGE_TAGS = ['平静', '开心', '悲伤', '生气', '惊讶', '思考', '担忧', '微笑'] as const;
export const SCENE_IMAGE_TAGS = ['晴', '多云', '阴', '雨', '雾', '风', '雪'] as const;
export const MAX_IMAGE_UPLOAD_BYTES = 32 * 1024 * 1024;
export const IMAGE_ACCEPT = 'image/png,image/jpeg,image/webp,image/gif';

const aliases: Record<string, string> = {
  neutral: '平静', happy: '开心', sad: '悲伤', angry: '生气', surprised: '惊讶', thinking: '思考', worried: '担忧', smiling: '微笑',
  sunny: '晴', cloudy: '多云', overcast: '阴', rain: '雨', fog: '雾', wind: '风', snow: '雪',
};

export function imageTag(value: string): string {
  const tag = value.normalize('NFKC').replace(/[\u0000-\u001f\u007f]/gu, '').trim().slice(0, 48);
  return Object.hasOwn(aliases, tag.toLowerCase()) ? aliases[tag.toLowerCase()] : tag;
}

function normalizedTags(value: unknown, limit: number): string[] {
  if (!Array.isArray(value)) return [];
  const tags = new Map<string, string>();
  for (const raw of value) {
    if (typeof raw !== 'string') continue;
    const tag = imageTag(raw);
    if (tag && !tags.has(tag.toLocaleLowerCase())) tags.set(tag.toLocaleLowerCase(), tag);
    if (tags.size >= limit) break;
  }
  return [...tags.values()];
}

export const imageTags = (value: unknown): string[] => normalizedTags(value, 32);
/** Query tags are not stored image metadata, so the album's 32-tag limit must not truncate them. */
export const expressionTags = (value: unknown): string[] => normalizedTags(value, Infinity);

export function imageTimeTag(time: string | number): string {
  const hour = typeof time === 'number' ? time : parseInt(time.match(/\d{1,2}/u)?.[0] ?? '', 10);
  if (!Number.isFinite(hour)) return String(time);
  if (hour < 6) return '深夜';
  if (hour < 9) return '清晨';
  if (hour < 12) return '上午';
  if (hour < 14) return '正午';
  if (hour < 18) return '下午';
  if (hour < 21) return '黄昏';
  return '夜晚';
}
