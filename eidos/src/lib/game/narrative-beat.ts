import type { StorySegment } from '@/lib/ai/types';

/** Reader continuity is separate from the protagonist's knowledge and world clock. */
export interface NarrativeBeat {
  chapter?: { id: string; title: string };
  recap?: string;
  threads?: string[];
  boundary?: 'chapter' | 'ending';
}
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const short = (v: unknown, max: number): v is string => typeof v === 'string' && v.length <= max;
/** Optional model metadata must never make otherwise readable prose unusable. */
export function parseNarrativeBeat(value: unknown): NarrativeBeat | undefined {
  if (!object(value)) return undefined;
  const { chapter, recap, threads, boundary } = value;
  if (chapter !== undefined && (!object(chapter) || !short(chapter.id, 160) || !chapter.id.trim() || !short(chapter.title, 160) || !chapter.title.trim())) return undefined;
  if (recap !== undefined && !short(recap, 2000)) return undefined;
  if (threads !== undefined && (!Array.isArray(threads) || threads.length > 16 || threads.some(v => !short(v, 240)))) return undefined;
  if (boundary !== undefined && boundary !== 'chapter' && boundary !== 'ending') return undefined;
  if (chapter === undefined && recap === undefined && threads === undefined && boundary === undefined) return undefined;
  return { ...(chapter ? { chapter: { id: String(chapter.id).trim(), title: String(chapter.title).trim() } } : {}),
    ...(recap === undefined ? {} : { recap: recap as string }), ...(threads === undefined ? {} : { threads: [...threads as string[]] }),
    ...(boundary ? { boundary } : {}) };
}
export function nextNarrativeProgress(previous: NarrativeBeat | null | undefined, beat?: NarrativeBeat): NarrativeBeat | null {
  if (!beat) return previous ?? null;
  const { boundary: _oldBoundary, ...continuity } = previous ?? {};
  return { ...continuity, ...structuredClone(beat) };
}
export function beatSegments(segments: StorySegment[], beat?: NarrativeBeat): StorySegment[] {
  return segments.map((segment, index) => {
    const { beat: _untrusted, ...text } = segment;
    return { ...text, ...(beat && index === segments.length - 1 ? { beat } : {}) };
  });
}
export function narrativeContinuityPrompt(value: unknown): string {
  const progress = parseNarrativeBeat(value);
  return progress ? `\n## 已接受的篇章衔接\n${JSON.stringify(progress)}\n这是读者看到的叙事记忆，不是主角的亲历或已知信息。承接已发生的情绪、承诺与未解线索，不能把摘要中的幕间信息直接交给主角。章节末的明确继续进入下一章；结尾后的明确继续可写尾声，普通自由行动仍按玩家意图推进。` : '';
}
