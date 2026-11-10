import type { StorySegment } from '@/lib/ai/types';

export const BASIC_KAOMOJI = {
  neutral: '(・_・)', happy: '(＾▽＾)', sad: '(；_；)', angry: '(＃｀д´)',
  surprised: '(°ロ°)', thinking: '(￢_￢)', worried: '(・・;)', smiling: '(˶ᵔ ᵕ ᵔ˶)',
} as const;

/** Model lettering stays a short expression; it must not become another narrative line. */
export function normalizeKaomoji(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = value.trim();
  return text && [...text].length <= 32 && !/[\r\n\x00-\x1f\x7f\u202a-\u202e\u2066-\u2069]/.test(text) ? text : undefined;
}
export function segmentKaomoji(segment: StorySegment | null): string {
  if (segment?.type !== 'dialogue') return '';
  return normalizeKaomoji(segment.kaomoji) ?? BASIC_KAOMOJI[(segment.emotion ?? 'neutral') as keyof typeof BASIC_KAOMOJI] ?? BASIC_KAOMOJI.neutral;
}
