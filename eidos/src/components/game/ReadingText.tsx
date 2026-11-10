import { InlineDocumentText } from './InlineDocumentText';
import { inlineTextTokens } from '@/lib/game/web-citations';
import { Fragment } from 'react';
import { getTextMatches } from '@/lib/game/player-reading';
import { EffectText } from './NarrativeText';
import type { ProjectedRun } from '@/lib/game/presentation';

export function ReadingText({ text, query, runs }: { text: string; query: string; runs?: ProjectedRun[] }) {
  if (runs) return <EffectText runs={runs} renderText={chunk => <ReadingText text={chunk} query={query} />} />;
  if (inlineTextTokens(text).length) return <InlineDocumentText text={text} renderText={chunk => <ReadingText text={chunk} query={query} />} />;
  const matches = getTextMatches(text, query);
  return <>{matches.map(({ start, end }, index) => {
    const before = text.slice(index ? matches[index - 1].end : 0, start);
    return <Fragment key={start}>{before}<mark className="bg-amber-200/70 text-inherit">{text.slice(start, end)}</mark></Fragment>;
  })}{text.slice(matches.at(-1)?.end ?? 0)}</>;
}
