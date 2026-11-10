import type { DirectorFrame, KeiReviewOrigin } from '@/lib/ai/types';
import { stableRecordJSON } from '@/lib/ai/prompt-layout';
import { promptTextHash } from '@/lib/ai/prompt-blocks';

export interface DirectorCue {
  id: string; origin: KeiReviewOrigin; afterNodeId: string | null; revision: number;
  kind: 'set' | 'withdraw'; frame: DirectorFrame | null; replaces?: string;
}
export function captureDirectorCue(input: {
  origin: KeiReviewOrigin; afterNodeId: string | null; frame: DirectorFrame | null | undefined; previous?: DirectorCue;
}): DirectorCue | null {
  if (input.frame === undefined || stableRecordJSON(input.frame) === stableRecordJSON(input.previous?.frame ?? null)) return null;
  const revision = (input.previous?.revision ?? 0) + 1;
  const value = { origin: input.origin, afterNodeId: input.afterNodeId, revision,
    kind: input.frame === null ? 'withdraw' as const : 'set' as const, frame: input.frame, ...(input.previous ? { replaces: input.previous.id } : {}) };
  // Capture is idempotent across a failed request/local-save retry, without rendering fresh timestamps.
  return structuredClone({ id: `director_${promptTextHash(stableRecordJSON(value))}`, ...value });
}
export function renderDirectorCue(cue: DirectorCue): string {
  return cue.kind === 'withdraw'
    ? '\n【幕后导演撤回】撤回此前的导演安排；保持当前事实与知识边界。\n'
    : `\n【幕后导演备注（${cue.replaces ? '完整替换此前导演安排' : '从这里开始适用'}，仅供叙述者，不是人物经历）】\n${stableRecordJSON(cue.frame)}\n`;
}
export function directorFrameRecorded(frame: DirectorFrame | null | undefined, cues: readonly DirectorCue[]): boolean {
  const latest = cues.at(-1);
  return Boolean(latest && stableRecordJSON(latest.frame) === stableRecordJSON(frame ?? null));
}
