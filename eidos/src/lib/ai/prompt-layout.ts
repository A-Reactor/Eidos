export interface AiPromptSections { stablePrefix: string; dynamicSuffix: string; components?: Array<{ id: string; label: string; text: string }>; blocks?: import('./prompt-blocks').PromptBlock[] }
export const PROMPT_SECTION_SEPARATOR = '\n\n---\n\n';
export function composeSystemPrompt(sections: AiPromptSections): string {
  return sections.stablePrefix + PROMPT_SECTION_SEPARATOR + sections.dynamicSuffix;
}
export function assertPromptSections(systemPrompt: string, sections?: AiPromptSections): void {
  if (sections && composeSystemPrompt(sections) !== systemPrompt) throw new Error('promptSections 与实际 systemPrompt 不一致');
}
/** Only plain record keys lack semantic order; arrays and text retain their order. */
export function stableRecordJSON(value: unknown): string {
  return JSON.stringify(value, (_key, item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return item;
    const prototype = Object.getPrototypeOf(item);
    if (prototype !== Object.prototype && prototype !== null) return item;
    return Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]]));
  });
}
