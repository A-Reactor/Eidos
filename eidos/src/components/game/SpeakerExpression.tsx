import type { StorySegment } from '@/lib/ai/types';
import { segmentKaomoji } from '@/lib/game/kaomoji';

export function SpeakerExpression({ segment }: { segment: StorySegment | null }) {
  const expression = segmentKaomoji(segment);
  return expression ? <span className="eidos-speaker-expression" aria-hidden="true">{expression}</span> : null;
}
