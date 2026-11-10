import { PROMPT_SECTION_SEPARATOR, type AiPromptSections } from './prompt-layout';

export interface PromptBlock {
  id: string;
  kind: 'rules' | 'edition' | 'memory' | 'record' | 'current' | 'evidence' | 'execution';
  stability: 'edition' | 'record' | 'request' | 'step';
  text: string;
  sourceVersion?: string;
}
export type PromptBlockSpan = Omit<PromptBlock, 'text'> & { start: number; end: number; hash: string };
export function promptTextHash(text: string): string {
  let value = 2166136261;
  for (let i = 0; i < text.length; i++) value = Math.imul(value ^ text.charCodeAt(i), 16777619);
  return (value >>> 0).toString(16);
}
/** Blocks carry their own whitespace. Diagnostics never insert labels into the model input. */
export function assemblePromptBlocks(blocks: readonly PromptBlock[]) {
  const split = blocks.findIndex(b => b.stability !== 'edition');
  const boundary = split < 0 ? blocks.length : split;
  const stablePrefix = blocks.slice(0, boundary).map(b => b.text).join('');
  const dynamicSuffix = blocks.slice(boundary).map(b => b.text).join('');
  let cursor = 0;
  const spans = blocks.map(({ text, ...block }, i) => {
    if (i === boundary) cursor += PROMPT_SECTION_SEPARATOR.length;
    const start = cursor; cursor += text.length;
    return { ...block, start, end: cursor, hash: promptTextHash(text) };
  });
  const sections: AiPromptSections = { stablePrefix, dynamicSuffix, blocks: [...blocks] };
  return { systemPrompt: stablePrefix + PROMPT_SECTION_SEPARATOR + dynamicSuffix, sections, spans };
}
export function describePromptDifference(previous: string, current: string, spans: readonly PromptBlockSpan[]) {
  let offset = 0;
  while (offset < Math.min(previous.length, current.length) && previous[offset] === current[offset]) offset++;
  return { commonPrefixChars: offset, changed: previous !== current,
    blockId: spans.find(s => s.start <= offset && offset < s.end)?.id };
}
/** A provider breakpoint may include immutable records without calling them fixed world settings. */
export function reusablePromptBoundary(sections: AiPromptSections): number {
  if (!sections.blocks) return sections.stablePrefix.length;
  const physical = assemblePromptBlocks(sections.blocks);
  let boundary = sections.stablePrefix.length;
  for (const span of physical.spans) {
    if (span.start === span.end || span.stability === 'edition') continue;
    if (span.stability !== 'record') break;
    boundary = span.end;
  }
  return boundary;
}
