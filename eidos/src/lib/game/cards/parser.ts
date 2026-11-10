import { isCardPng, readCardPng } from './png';
import { cardText, isRecord, MAX_CARD_FILE_BYTES, MAX_CARD_JSON_BYTES, type ParsedCard } from './types';

export function parseCardBytes(bytes: Uint8Array, filename: string): ParsedCard {
  if (!bytes.length || bytes.length > MAX_CARD_FILE_BYTES) throw new Error('卡片文件为空或超过 20 MiB');
  let text: string;
  if (isCardPng(bytes)) text = readCardPng(bytes);
  else {
    if (bytes.length > MAX_CARD_JSON_BYTES) throw new Error('JSON 卡片超过 4 MiB');
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  }
  let document: unknown;
  try { document = JSON.parse(text); } catch { throw new Error('卡片不是有效 JSON'); }
  return readCardDocument(document, filename);
}
export function readCardDocument(document: unknown, filename = '世界书'): ParsedCard {
  if (!isRecord(document)) throw new Error('无效卡片对象');
  let data = document;
  let dataPointer = '';
  if (document.spec !== undefined) {
    if (!['chara_card_v2', 'chara_card_v3'].includes(String(document.spec)) || !isRecord(document.data)) throw new Error('不支持的卡片格式版本');
    data = document.data; dataPointer = '/data';
  }
  if (isRecord(data.entries) || Array.isArray(data.entries)) {
    validateEntries(data.entries);
    return { kind: 'worldbook', name: cardText(data.name) || filename.replace(/\.[^.]+$/, ''), document, data, dataPointer };
  }
  if (!cardText(data.name).trim() || !['description', 'personality', 'scenario', 'first_mes', 'character_book'].some(key => key in data)) throw new Error('文件不是人物卡或世界书');
  for (const key of ['description', 'personality', 'scenario', 'first_mes', 'mes_example', 'system_prompt', 'post_history_instructions']) {
    if (data[key] !== undefined && typeof data[key] !== 'string') throw new Error(`卡片 ${key} 须为字符串`);
  }
  if (data.character_book !== undefined) {
    if (!isRecord(data.character_book)) throw new Error('卡片世界书无效');
    validateEntries(data.character_book.entries);
  }
  return { kind: 'character', name: String(data.name), document, data, dataPointer };
}
function validateEntries(entries: unknown): void {
  if (!Array.isArray(entries) && !isRecord(entries)) throw new Error('世界书条目无效');
  const values = Object.values(entries);
  if (values.length > 2000) throw new Error('世界书超过 2000 条');
  for (const entry of values) {
    if (!isRecord(entry) || typeof entry.content !== 'string') throw new Error('世界书条目正文无效');
    for (const field of ['keys', 'key', 'secondary_keys', 'keysecondary']) {
      if (entry[field] !== undefined && (!Array.isArray(entry[field]) || (entry[field] as unknown[]).some(key => typeof key !== 'string'))) throw new Error(`世界书 ${field} 须为字符串列表`);
    }
  }
}
