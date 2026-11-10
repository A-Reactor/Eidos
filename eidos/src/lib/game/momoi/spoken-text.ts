import { inlineTextTokens } from '../web-citations';

const quotePairs: Record<string, string> = { '「': '」', '『': '』', '“': '”', '"': '"' };
const speechAttribution = /(?:低声说|轻声说|说道|问道|回答道|喃喃道|whispered|said|asked)/i;
const standaloneDirection = /^(?:旁白[:：]|动作[:：]|压低声音|低声|轻声|小声|沉默|叹息|叹气|摇头|点头|微笑|苦笑|大笑|哭泣|皱眉|转身|看向|走向|移开|握紧|笑[，。！…\s]*$|哭[，。！…\s]*$|(?:sighs?|whispering|laughs?|silence|narration)\b)/i;
const subjectAction = /^(?:她|他|它|他们|她们|你|我)(?:把|将|用|正|缓缓|轻轻|慢慢|突然|仍|已经|坐|站|走|转|看|望|伸|抬|低|拿|放|推|拉|握|笑|哭|摇|点|叹|沉默|说道|问道)|^(?:she|he|they)\s+(?:says?|said|steps?|looks?|turns?|nods?|shakes?|smiles?|whispers?|puts?|places?|sits?|stands?)\b/i;

function isStageDirection(content: string, speaker: string): boolean {
  const text = content.trim();
  if (standaloneDirection.test(text) || subjectAction.test(text)) return true;
  // Named-speaker annotations must begin with that exact speaker and an action.
  const tail = speaker.trim() && text.startsWith(speaker.trim()) ? text.slice(speaker.trim().length) : '';
  return !!tail && /^(?:把|将|用|正|缓缓|轻轻|慢慢|突然|坐|站|走|转|看|望|伸|抬|低|拿|放|推|拉|握|笑|哭|摇|点|叹|沉默|说道|问道)/.test(tail.trim());
}

function unquote(text: string): string {
  const close = quotePairs[text[0]];
  return close && text.indexOf(close, 1) === text.length - 1 ? text.slice(1, -1).trim() : text;
}

/** Only explicit dialogue formatting is removed; ordinary unmarked prose stays intact. */
export function extractSpokenDialogue(text: string, speaker = ''): string {
  let value = speechFormatting(text)
    .split('\n').filter(line => !/^\s*(?:旁白|动作|叙述|narration|narrator|stage direction)\s*[:：]/i.test(line)).join('\n');
  if (speaker.trim()) {
    const escaped = speaker.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    value = value.replace(new RegExp(`^\\s*${escaped}\\s*[:：]\\s*`), '');
  }
  // Bold is spoken emphasis. Single star/underscore spans are stage directions.
  value = value.replace(/\*\*([^*]+)\*\*|__([^_]+)__/g, '$1$2')
    .replace(/\*[^*\n]+\*|(?<![\p{L}\p{N}])_[^_\n]+_(?![\p{L}\p{N}])/gu, ' ')
    .replace(/【[^【】]*】|\[[^\[\]\n]*\]/g, ' ')
    .replace(/（[^（）]*）|\([^()]*\)/g, match => {
      // Parentheses also occur in spoken titles, explanations and mathematics.
      // Remove recognizable directions; repeated client/server passes stay safe.
      return isStageDirection(match.slice(1, -1), speaker) ? ' ' : match;
    }).trim();

  const quotes = [...value.matchAll(/「([^「」]*)」|『([^『』]*)』|“([^“”]*)”|"([^"\n]*)"/g)];
  if (quotes.length) {
    const first = quotes[0], last = quotes[quotes.length - 1];
    const before = value.slice(0, first.index).trim();
    const after = value.slice((last.index ?? 0) + last[0].length).trim();
    // Attribution is recognizable formatting, unlike ordinary quoted words.
    if ((before.endsWith('：') || before.endsWith(':')) && speechAttribution.test(before) ||
        !before && after && speechAttribution.test(after)) {
      value = quotes.map(match => match[1] ?? match[2] ?? match[3] ?? match[4]).join(' ');
    } else value = unquote(value);
  }
  return value.replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').trim();
}

// File titles are display labels. Paths, extensions and generated IDs add noise to speech.
const fileExtension = /\.(?:md|markdown|txt|json|jsonl|ya?ml|csv|tsv|xml|html?|pdf|docx?|xlsx?|pptx?|png|jpe?g|gif|webp|svg|mp3|wav|ogg|mp4|zip)$/i;
function spokenFileName(label: string): string {
  const name = label.replace(/\\/g, '/').split('/').at(-1) ?? '';
  return name.replace(fileExtension, '')
    .replace(/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/gi, ' ')
    .replace(/(?:^|[_ -])[a-f0-9]{16,}(?=$|[_ -])/gi, ' ')
    .replace(/[_#*~|/\\[\]{}<>]+/g, ' ')
    .replace(/[^\p{L}\p{N}\p{M}\s，。！？、：；,.!?()（）《》“”「」+&%–—-]/gu, ' ')
    .replace(/\s+/g, ' ').trim() || '文件';
}
function speechFormatting(text: string): string {
  let value = text.replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/g, '')
    .replace(/^[ \t]*(?:```|~~~)[^\n]*\n[\s\S]*?^[ \t]*(?:```|~~~)[ \t]*(?:\n|$)/gm, '\n')
    .replace(/^[ \t]*(?:```|~~~)[^\n]*(?:\n[\s\S]*)?$/gm, '\n')
    .replace(/<(narration|aside|stage-direction)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ');
  let rendered = '', end = 0;
  for (const token of inlineTextTokens(value)) {
    rendered += value.slice(end, token.start) + (token.kind === 'document' ? spokenFileName(token.label) : token.label);
    end = token.end;
  }
  value = rendered + value.slice(end);
  return value
    .replace(/!?\[([^\]\n]*)\]\([^\n)]*\)/g, (_match, label: string) => fileExtension.test(label) ? spokenFileName(label) : label)
    .replace(/(?:document|file):(?:\/\/)?[^\s<>，。！？；、）)]+/gi, ' ')
    .replace(/`([^`\n]+)`/g, (_match, content: string) => fileExtension.test(content) ? spokenFileName(content) : content)
    .replace(/[^\s`「」“”《》，。！？；：、()（）<>]+\.(?:md|markdown|txt|json|jsonl|ya?ml|csv|tsv|xml|pdf|docx?|xlsx?|pptx?|png|jpe?g|gif|webp|svg|mp3|wav|ogg|mp4|zip)(?=$|[\s，。！？；：、()（）「」“”《》])/gi, spokenFileName)
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<\/?[a-z][^>]*>/gi, '')
    .replace(/&(amp|lt|gt|quot|apos|nbsp);/gi, (_match, entity: string) => ({amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' '}[entity.toLowerCase()] ?? ' '))
    .replace(/^\s{0,3}(?:#{1,6}\s+|>\s*|[-*+]\s+)/gm, '')
    .replace(/^\s*\|?(?:\s*:?-{3,}:?\s*\|)+\s*$/gm, '')
    .replace(/\s*\|\s*/g, '，')
    .replace(/\n[ \t]*\n+/g, '\n');
}
