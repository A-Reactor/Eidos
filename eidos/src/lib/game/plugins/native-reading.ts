import type { StorySegment } from '@/lib/ai/types';
import type { GameplayPlugin } from './types';
import type { NarrativeRequest } from '../narrative';
import { parseNarrativeFrame } from '../narrative';
import { isGameplayPluginActive } from './activation';

export function nativeReadingPlugin(plugins: GameplayPlugin[], flags: Record<string, boolean>, sceneId?: string) {
  return plugins.find(p => p.ui?.presentation === 'native' && p.ui.nativeReading && isGameplayPluginActive(p, flags, sceneId));
}
/** Keep reader choices tied to the actual camera, instead of turning them into protagonist actions. */
export function nativeReadingActions(segments: StorySegment[]): Array<{ label: string; request: NarrativeRequest }> {
  const last = segments.at(-1);
  if (!last) return [];
  let frame;
  try { frame = parseNarrativeFrame(last.view); } catch { return []; }
  const choices = (last.choices ?? []).filter(choice => choice.id && choice.label && (frame?.kind !== 'cutaway' || frame.actor));
  const actions: Array<{ label: string; request: NarrativeRequest }> = choices.length
    ? choices.map(choice => ({ label: choice.label, request: { kind: 'choice', choice: choice.label, choiceId: choice.id, ...(frame ? { frame } : {}) } }))
    : [{ label: last.beat?.boundary === 'chapter' ? '继续下一章' : '继续故事', request: { kind: 'continue', ...(frame ? { frame } : {}) } }];
  if (frame?.kind === 'cutaway') actions.push({ label: '回到主角', request: { kind: 'return' } });
  return actions;
}
