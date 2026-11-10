import { isRecord } from './types';

const LOGIC_NAMES = ['AND ANY', 'NOT ALL', 'NOT ANY', 'AND ALL'];
function keywordOptions(entry: Record<string, unknown>) {
  const ext = isRecord(entry.extensions) ? entry.extensions : {};
  const keys = (entry.keys ?? entry.key ?? []) as string[];
  const secondary = (entry.secondary_keys ?? entry.keysecondary ?? []) as string[];
  const logic = ext.selectiveLogic ?? entry.selectiveLogic ?? 0;
  return { keys, secondary, selective: entry.selective === true && secondary.length > 0,
    // Unknown author JSON must never acquire a different rule through coercion.
    logic: typeof logic === 'number' ? logic : NaN,
    caseSensitive: (entry.case_sensitive ?? entry.caseSensitive ?? ext.caseSensitive ?? ext.case_sensitive) === true,
    wholeWords: (entry.matchWholeWords ?? entry.match_whole_words ?? ext.matchWholeWords ?? ext.match_whole_words) === true,
    regex: entry.use_regex === true || entry.useRegex === true || ext.useRegex === true || ext.use_regex === true };
}

export function keywordUnsupported(entry: Record<string, unknown>): string[] {
  // Constant entries never evaluate activation keys; unused filters cannot disable their rules.
  if (entry.constant === true) return [];
  const options = keywordOptions(entry), reasons: string[] = [];
  if (options.selective && (!Number.isInteger(options.logic) || options.logic < 0 || options.logic > 3)) reasons.push('未知组合关键词逻辑');
  const activeKeys = options.selective ? [...options.keys, ...options.secondary] : options.keys;
  // Tavern recognizes slash-delimited regex keys even without an explicit useRegex flag.
  if (options.regex || activeKeys.some(key => /^\/[\s\S]*\/[a-z]*$/i.test(key))) reasons.push('正则触发');
  return reasons;
}

export function matchCardEntry(entry: Record<string, unknown>, query: string): { matched: boolean; reason: string } {
  if (entry.constant === true) return { matched: true, reason: '源 constant' };
  const unsupported = keywordUnsupported(entry);
  if (unsupported.length) return { matched: false, reason: `未支持：${unsupported.join('、')}` };
  const options = keywordOptions(entry), haystack = options.caseSensitive ? query : query.toLowerCase();
  const matches = (key: string) => literalMatch(haystack, options.caseSensitive ? key : key.toLowerCase(), options.wholeWords);
  if (!options.keys.some(matches)) return { matched: false, reason: '未命中主关键词' };
  if (!options.selective) return { matched: true, reason: '关键词命中' };
  const any = options.secondary.some(matches), all = options.secondary.every(matches);
  const matched = [any, !all, !any, all][options.logic];
  return { matched, reason: matched ? `组合关键词命中（${LOGIC_NAMES[options.logic]}）` : `副关键词条件未满足（${LOGIC_NAMES[options.logic]}）` };
}

function literalMatch(haystack: string, key: string, wholeWords: boolean): boolean {
  if (!key) return false;
  if (!wholeWords || /\s/.test(key)) return haystack.includes(key);
  // Match Tavern's ASCII \W boundaries, without compiling author-provided text as a regex.
  const isWord = (char: string) => /[A-Za-z0-9_]/.test(char);
  let offset = haystack.indexOf(key);
  while (offset !== -1) {
    if (!isWord(haystack[offset - 1] ?? '') && !isWord(haystack[offset + key.length] ?? '')) return true;
    offset = haystack.indexOf(key, offset + 1);
  }
  return false;
}
