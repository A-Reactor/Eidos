import { normalizeKaomoji } from '@/lib/game/kaomoji';
import { expressionTags } from '@/lib/game/midori/image-tags';
import { isImageWorkspacePath } from '@/lib/game/midori/image-resource';
import { topLevelJsonContainer } from './json-fields';
// ============================================================
// 流式 JSON 解析工具
// ============================================================
// 从流式 AI 响应中提取已完成的结构化数据，
// 不等整个 JSON 完成就渐进式返回解析结果。

import type { StorySegment } from "./types";
import { parseNarrativeFrame, type NarrativeFrame } from '@/lib/game/narrative';
import { parseTextEffects } from '@/lib/game/text-effects';

/** Camera metadata is emitted before prose; unfinished objects never reveal labels. */
export function extractNarrativeFrame(jsonText: string): NarrativeFrame | undefined {
  const start = jsonText.match(/"narrativeFrame"\s*:\s*\{/);
  if (!start || start.index === undefined) return undefined;
  const offset = start.index + start[0].length - 1;
  let inString = false, escaped = false, depth = 0;
  for (let index = offset; index < jsonText.length; index++) {
    const char = jsonText[index];
    if (escaped) { escaped = false; continue; }
    if (char === '\\' && inString) { escaped = true; continue; }
    if (char === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (char === '{') depth++;
    if (char === '}' && --depth === 0) {
      try { return parseNarrativeFrame(JSON.parse(jsonText.slice(offset, index + 1))); }
      catch { return undefined; }
    }
  }
  return undefined;
}

/** Custom expressions must survive parsing so uploaded image tags can match them. */
function asEmotion(v: string): StorySegment["emotion"] {
  return v.normalize('NFKC').replace(/[\u0000-\u001f\u007f]/gu, '').trim().slice(0, 48) || undefined;
}

/** 渐进提取结果：完整 segments + 可能存在的未完成草稿段 */
export interface ProgressiveSegmentsResult {
  /** 已完成解析的 segments（含草稿段，如果存在） */
  segments: StorySegment[];
  /** 最后一个 segment 是否仍在生成中（草稿） */
  lastIsDraft: boolean;
}

/**
 * 从部分 JSON 中提取 segments——含已完成的 + 正在生成的草稿段。
 *
 * 完整 segment：大括号匹配，text 字段完整解析。
 * 草稿 segment：大括号未闭合，但可从文本字段提取已 stream 的部分内容。
 *
 * 这让所有 segment 都能渐进式显示——第一个 segment 首 2-3 秒可见，
 * 后续 segment 即使 AI 还在写也能被客户端感知并逐字渲染。
 */
export function extractSegmentsProgressive(jsonText: string): ProgressiveSegmentsResult {
  const segments: StorySegment[] = [];
  let lastIsDraft = false;

  const container = topLevelJsonContainer(jsonText, 'segments');
  if (!container || !container.text.startsWith('[')) return { segments, lastIsDraft };
  jsonText = container.text;

  // 遍历数组元素（每个是一个 {type, text, speaker?, emotion?} 对象）
  let pos = 1;

  while (pos < jsonText.length) {
    // 跳过空白和逗号
    while (pos < jsonText.length && ' \t\n\r,'.includes(jsonText[pos])) pos++;
    if (pos >= jsonText.length) break;

    // 数组结束
    if (jsonText[pos] === ']') break;

    // 必须是对象开始
    if (jsonText[pos] !== '{') break;

    // 括号匹配找对象结束位置（处理字符串内的大括号）
    const objStart = pos;
    let depth = 0;
    let inString = false;
    let escaped = false;
    let objEnd = -1;

    for (let i = objStart; i < jsonText.length; i++) {
      const ch = jsonText[i];
      if (escaped) { escaped = false; continue; }
      if (ch === '\\') { escaped = true; continue; }
      if (ch === '"') { inString = !inString; continue; }
      if (!inString) {
        if (ch === '{') depth++;
        if (ch === '}') { depth--; if (depth === 0) { objEnd = i; break; } }
      }
    }

    if (objEnd === -1) {
      // ============================================================
      // 对象不完整 → 尝试提取草稿段（partial text）
      // ============================================================
      const draft = extractDraftSegment(jsonText.slice(objStart));
      if (draft) {
        segments.push(draft);
        lastIsDraft = true;
      }
      break; // 等更多 token
    }

    // 完整对象 → 正常提取
    const objStr = jsonText.slice(objStart, objEnd + 1);
    const seg = parseCompleteSegment(objStr);
    if (seg) segments.push(seg);

    pos = objEnd + 1;
  }

  return { segments, lastIsDraft };
}

/**
 * 从部分 JSON 中提取已完成的 segment 对象（向后兼容导出）。
 * 内部调用 extractSegmentsProgressive。
 */
export function extractPartialSegments(jsonText: string): StorySegment[] {
  const { segments, lastIsDraft } = extractSegmentsProgressive(jsonText);
  // 向后兼容：草稿段不返回（旧版调用者只处理完整段）
  if (lastIsDraft && segments.length > 0) {
    return segments.slice(0, -1);
  }
  return segments;
}

// ============================================================
// 内部工具
// ============================================================

/** 解析一个完整的 segment JSON 对象字符串 */
function parseCompleteSegment(objStr: string): StorySegment | null {
  try {
    const raw = JSON.parse(objStr);
    if (typeof raw.text !== 'string' || !raw.text) return null;
    const textEffects = parseTextEffects(raw.textEffects);
    const tags = expressionTags(raw.expressionTags);
    return { type: raw.type === 'dialogue' ? 'dialogue' : 'narration', text: raw.text,
      ...(typeof raw.imageId === 'string' && raw.imageId.length <= 4096 ? { imageId: raw.imageId } : {}),
      ...(isImageWorkspacePath(raw.imagePath) ? { imagePath: raw.imagePath } : {}),
      ...(tags.length ? { expressionTags: tags } : {}),
      ...(typeof raw.speaker === 'string' ? { speaker: raw.speaker } : {}),
      ...(typeof raw.emotion === 'string' ? { emotion: asEmotion(raw.emotion) } : {}),
      ...(normalizeKaomoji(raw.kaomoji) ? { kaomoji: normalizeKaomoji(raw.kaomoji) } : {}),
      ...(Array.isArray(raw.workspaceEffects) && raw.workspaceEffects.every((id: unknown) => typeof id === 'string') ? { workspaceEffects: raw.workspaceEffects } : {}),
      ...(textEffects ? { textEffects } : {}) };
  } catch { /* Retain the existing recovery path for malformed streamed objects. */ }
  let type: string = 'narration';
  let text = '';
  let speaker: string | undefined;
  let emotion: string | undefined;

  const typeMatch = objStr.match(/"type"\s*:\s*"([^"]*)"/);
  if (typeMatch) type = typeMatch[1];

  const speakerMatch = objStr.match(/"speaker"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  if (speakerMatch) speaker = speakerMatch[1].replace(/\\"/g, '"');

  const emotionMatch = objStr.match(/"emotion"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  if (emotionMatch) emotion = emotionMatch[1];

  const textMatch = objStr.match(/"text"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  if (textMatch) {
    text = textMatch[1]
      .replace(/\\"/g, '"')
      .replace(/\\n/g, '\n')
      .replace(/\\\\/g, '\\');
  }

  if (text.length === 0) return null;

  const seg: StorySegment = { type: type as 'narration' | 'dialogue', text };
  if (speaker) seg.speaker = speaker;
  if (emotion) seg.emotion = asEmotion(emotion);
  const expression = objStr.match(/"kaomoji"\s*:\s*("(?:[^"\\]|\\.)*")/);
  if (expression) { try { seg.kaomoji = normalizeKaomoji(JSON.parse(expression[1])); } catch {} }
  return seg;
}

/**
 * 从部分 JSON 片段中提取草稿段——segment 对象大括号未闭合，
 * 但已有部分 text 字段内容可供渐进显示。
 */
function topLevelTextKey(input: string): number {
  let depth = 0, start = -1, escaped = false;
  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (start >= 0) {
      if (escaped) { escaped = false; continue; }
      if (char === '\\') { escaped = true; continue; }
      if (char === '"') {
        if (depth === 1 && input.slice(start, i + 1) === '"text"' && /^\s*:/.test(input.slice(i + 1))) return start;
        start = -1;
      }
    } else if (char === '"') start = i;
    else if (char === '{' || char === '[') depth++;
    else if (char === '}' || char === ']') depth--;
  }
  return -1;
}

function extractDraftSegment(partialObj: string): StorySegment | null {
  // 1. 提取 type
  let type: string = 'narration';
  const typeMatch = partialObj.match(/"type"\s*:\s*"([^"]*)"/);
  if (typeMatch) type = typeMatch[1];

  // 2. 提取 speaker（可选）
  let speaker: string | undefined;
  const speakerMatch = partialObj.match(/"speaker"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  if (speakerMatch) speaker = speakerMatch[1].replace(/\\"/g, '"');

  // 3. 提取 emotion（可选）
  let emotion: string | undefined;
  const emotionMatch = partialObj.match(/"emotion"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  if (emotionMatch) emotion = emotionMatch[1];

  // 4. 提取部分 text —— 不要求闭合引号（text 可能还在生成中）
  // An effect's target/value may itself be "text"; only the paragraph's own key is prose.
  const textKeyIdx = topLevelTextKey(partialObj);
  if (textKeyIdx === -1) return null;

  // 找到 "text": 后面的第一个引号
  const colonIdx = partialObj.indexOf(':', textKeyIdx);
  if (colonIdx === -1) return null;

  let startQuote = -1;
  for (let i = colonIdx + 1; i < partialObj.length; i++) {
    if (/\s/.test(partialObj[i])) continue; // 跳过空白
    if (partialObj[i] === '"') { startQuote = i; break; }
    break; // 非引号的非空白字符 → text 还没开始写
  }
  if (startQuote === -1) return null;

  // 逐字符扫描：从开始引号后读取到闭合引号或缓冲区末尾
  let partialText = '';
  let escaped = false;
  for (let i = startQuote + 1; i < partialObj.length; i++) {
    const ch = partialObj[i];
    if (escaped) { partialText += ch; escaped = false; continue; }
    if (ch === '\\') { escaped = true; continue; }
    if (ch === '"') break; // 闭合引号 → text 字段在这段缓冲中已完整
    partialText += ch;
  }

  // 还原 JSON 转义
  partialText = partialText
    .replace(/\\n/g, '\n')
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\');

  if (partialText.length === 0) return null;

  const seg: StorySegment = { type: type as 'narration' | 'dialogue', text: partialText };
  // Effects precede text in the contract. Only complete metadata is used while the prose streams.
  try {
    const prefix = partialObj.slice(0, textKeyIdx).trimEnd().replace(/,$/, '') + '}';
    const metadata = JSON.parse(prefix);
    // Decode JSON escapes exactly as the completed segment does, so custom tags
    // and character names select the same image before and after streaming ends.
    if (typeof metadata.speaker === 'string') speaker = metadata.speaker;
    if (typeof metadata.emotion === 'string') emotion = metadata.emotion;
    const textEffects = parseTextEffects(metadata.textEffects);
    if (textEffects) seg.textEffects = textEffects;
    seg.kaomoji = normalizeKaomoji(metadata.kaomoji);
    const imageId = metadata.imageId;
    if (typeof imageId === 'string' && imageId.length <= 4096) seg.imageId = imageId;
    if (isImageWorkspacePath(metadata.imagePath)) seg.imagePath = metadata.imagePath;
    const tags = expressionTags(metadata.expressionTags);
    if (tags.length) seg.expressionTags = tags;
  } catch { /* An unfinished declaration is ignored until its segment is complete. */ }
  if (speaker) seg.speaker = speaker;
  if (emotion) seg.emotion = asEmotion(emotion);
  return seg;
}

// ============================================================
// 流式 JSON 字段检测（带恢复位置，避免重复扫描）
// ============================================================
// 每次只扫描新增部分——上次结束位置到当前末尾
// 无法从中间恢复时退化到全量扫描（仅首次或 JSON 格式异常时）

export function detectCompletedFields(
  jsonText: string,
  alreadySeen: Set<string>,
  resumePos: number,
  depth: number
): { fields: string[]; resumePos: number; depth: number } {
  const found: string[] = [];
  let i = resumePos;

  // 首次调用：跳过 markdown 代码块，找到第一个 {
  if (resumePos === 0) {
    while (i < jsonText.length && jsonText[i] !== "{") i++;
    if (i >= jsonText.length) return { fields: found, resumePos, depth: 0 };
    i++; // 跳过 {
    depth = 1;
  }

  let inString = false;
  let escapeNext = false;
  let currentKey = "";
  let keyBuf = "";
  let expectValue = false;
  let lastComplete = resumePos; // 最后一个完整解析的位置

  for (; i < jsonText.length; i++) {
    const ch = jsonText[i];

    if (escapeNext) { escapeNext = false; continue; }
    if (ch === "\\") { escapeNext = true; continue; }

    if (ch === '"') {
      inString = !inString;
      if (!inString && depth === 1 && !expectValue) {
        currentKey = keyBuf;
        keyBuf = "";
      }
      continue;
    }

    if (inString) {
      if (depth === 1 && !expectValue) keyBuf += ch;
      continue;
    }

    if (ch === "{" || ch === "[") { depth++; continue; }
    if (ch === "]" || ch === "}") {
      // 在 depth 递减前检查：标量值直接跟 }（JSON 末尾最后一个字段）
      if (depth === 1 && expectValue && currentKey && !alreadySeen.has(currentKey)) {
        found.push(currentKey);
        lastComplete = i + 1;
      }
      depth--;
      // 在 depth 递减后检查：嵌套对象/数组闭合后 depth 从 2→1，
      // 表示该顶层字段值（对象/数组）刚刚完成解析
      if (depth === 1 && expectValue && currentKey && !alreadySeen.has(currentKey)) {
        found.push(currentKey);
        lastComplete = i + 1;
      }
      if (depth === 1) { expectValue = false; currentKey = ""; }
      continue;
    }

    if (ch === ":" && depth === 1 && currentKey) {
      expectValue = true;
      continue;
    }

    if (ch === "," && depth === 1) {
      if (expectValue && currentKey && !alreadySeen.has(currentKey)) {
        found.push(currentKey);
        lastComplete = i + 1;
      }
      expectValue = false;
      currentKey = "";
      keyBuf = "";
      continue;
    }
  }

  // 返回 resumePos 处的深度（而非扫描结束处的深度）
  // resumePos 始终指向顶层逗号/闭合括号之后，深度恒为 1（初始 0 除外）
  // 如果返回扫描结束处的 depth（可能在嵌套内部 >1），下一次调用会因 depth 错位
  // 而使所有 depth===1 检查失败，导致字段检测完全失效
  return { fields: found, resumePos: lastComplete, depth: lastComplete > 0 ? 1 : 0 };
}
