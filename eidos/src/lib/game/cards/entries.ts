import { cardText, isRecord, type ParsedCard } from './types';
import { validateCardTemplate } from './template';
import { cardInitialization, isCardInitializer } from './initialization';
import { keywordUnsupported } from './keyword-matching';

export function cardEntries(card: ParsedCard) {
  const book = card.kind === 'worldbook' ? card.data : card.data.character_book;
  if (!isRecord(book)) return [];
  const entries = book.entries;
  if (!isRecord(entries) && !Array.isArray(entries)) return [];
  const prefix = `${card.dataPointer}${card.kind === 'worldbook' ? '' : '/character_book'}/entries`;
  return Object.entries(entries).filter((pair): pair is [string, Record<string, unknown>] => isRecord(pair[1])).map(([key, value]) => ({
    value, pointer: `${prefix}/${key.replace(/~/g, '~0').replace(/\//g, '~1')}/content`,
    text: cardText(value.content),
    keys: (value.keys ?? value.key ?? []) as string[],
    enabled: value.enabled !== false && value.disable !== true,
    constant: value.constant === true,
    order: typeof (value.insertion_order ?? value.order) === 'number' ? Number(value.insertion_order ?? value.order) : 0,
  }));
}
export function entryUnsupported(entry: Record<string, unknown>): string[] {
  const ext = isRecord(entry.extensions) ? entry.extensions : {};
  const reasons: string[] = [];
  try { validateCardTemplate(cardText(entry.content)); } catch (error) { reasons.push(error instanceof Error ? error.message : '未支持的模板'); }
  reasons.push(...keywordUnsupported(entry));
  if ((ext.useProbability === true || entry.useProbability === true) && Number(ext.probability ?? entry.probability ?? 100) < 100) reasons.push('概率');
  for (const key of ['sticky', 'cooldown', 'delay']) if (Number(ext[key] ?? entry[key] ?? 0) > 0) reasons.push(key);
  if (cardText(ext.group ?? entry.group)) reasons.push('互斥组');
  if (ext.excludeRecursion === true || ext.delayUntilRecursion === true || entry.delayUntilRecursion === true) reasons.push('递归条件');
  return reasons;
}
export function cardCompatibility(card: ParsedCard): { blocked: string[]; warnings: string[] } {
  const blocked: string[] = []; const warnings = new Set<string>();
  const entries = cardEntries(card).filter(e => e.enabled && !isCardInitializer(e.value));
  const core = ['description', 'personality', 'scenario', 'system_prompt', 'post_history_instructions', 'first_mes', 'mes_example'].map(key => cardText(card.data[key]));
  for (const text of core) try { validateCardTemplate(text); } catch (error) { blocked.push(error instanceof Error ? error.message : '核心模板无法运行'); }
  try { cardInitialization(card); } catch (error) { blocked.push(error instanceof Error ? error.message : '变量初始化无效'); }
  const extensions = isRecord(card.data.extensions) ? card.data.extensions : {};
  if (Array.isArray(extensions.regex_scripts) && extensions.regex_scripts.length) blocked.push('依赖正则处理流水线');
  if (isRecord(extensions.tavern_helper)) blocked.push('依赖酒馆助手脚本／变量运行时');
  for (const entry of entries) {
    const unsupported = entryUnsupported(entry.value);
    if (unsupported.length && entry.constant) blocked.push(`常驻条目需要 ${unsupported.join('、')}`);
    else unsupported.forEach(reason => warnings.add(`含 ${reason} 的条目不会激活`));
  }
  warnings.add('支持只读条件模板与 JSON InitVar；不执行任意 JavaScript、MVU 脚本或原卡 HTML；开场作为原文参考');
  return { blocked: [...new Set(blocked)], warnings: [...warnings] };
}
