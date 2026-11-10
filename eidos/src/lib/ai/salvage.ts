// ============================================================
// JSON 截断修复（用户中止或 max_tokens 耗尽后恢复部分世界数据）
// ============================================================
// 策略：找到 JSON 中最后一个完整闭合的顶层字段，在它之后截断并加 `}`
// 这样至少能保留 name/subtitle/overview 等已完成字段

import { documentResponse, readModelDocument, recoveredDocument } from './document-response';
import type { AIGameResponse, StorySegment } from "./types";
import type { GameTime, ValidityCheck } from "@/lib/game/types";
import { salvageTruncatedJSON } from "./client";
import { extractPartialSegments } from "./stream-parser";
import { topLevelJsonContainer, topLevelJsonValueStart } from './json-fields';
import { parseNpcSpeechProfiles } from '@/lib/game/npc-speech';
import { parseWorkspaceToolReply } from './workspace-tools';

// ============================================================
// AIGameResponse 截断修复
// ============================================================
// 当 AI 响应因 max_tokens 耗尽或流中断而截断时，
// 从部分 JSON 中尽可能恢复完整的 AIGameResponse 字段。
// 在 action-handler 和 action-stream 的 parseJSON 失败后使用。

/** 从截断的 JSON 中提取字符串字段值 */
function extractStr(json: string, key: string): string {
  const m = json.match(new RegExp(`"${key}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`));
  return m ? m[1].replace(/\\"/g, '"').replace(/\\\\/g, "\\") : "";
}

/** 从截断的 JSON 中提取字符串数组（已完成元素） */
function extractStringArray(json: string, key: string): string[] {
  const match = json.match(new RegExp(`"${key}"\\s*:\\s*\\[([\\s\\S]*?)(?:\\]|$)`));
  if (!match) return [];
  const elements: string[] = [];
  const re = /"((?:[^"\\]|\\.)*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(match[1])) !== null) {
    elements.push(m[1].replace(/\\"/g, '"').replace(/\\\\/g, "\\"));
  }
  return elements;
}

/** 从截断的 JSON 中提取整数 */
function extractInt(json: string, key: string): number {
  const m = json.match(new RegExp(`"${key}"\\s*:\\s*(\\d+)`));
  return m ? parseInt(m[1], 10) : 0;
}

/** 从截断的 JSON 中提取 validity 嵌套对象 */
function extractValidity(json: string): ValidityCheck | null {
  const match = json.match(/"validity"\s*:\s*\{([\s\S]*?)\}/);
  if (!match) return null;
  try {
    return JSON.parse(`{${match[1]}}`) as ValidityCheck;
  } catch {
    // 提取子字段
    const isPossibleMatch = json.match(/"isPossible"\s*:\s*(true|false)/);
    const isPossible = isPossibleMatch ? isPossibleMatch[1] === "true" : true;
    const fantasy = extractStr(json, "fantasyResponse");
    const reason = extractStr(json, "reason");
    return {
      isPossible,
      fantasyResponse: fantasy || null,
      reason: reason || null,
    };
  }
}

/** 从截断的 JSON 中提取 timeSpent 嵌套对象 */
function extractTimeSpent(json: string): GameTime {
  const match = json.match(/"timeSpent"\s*:\s*\{([\s\S]*?)\}/);
  if (!match) return { day: 0, hour: 0, minute: 5 };
  try {
    return JSON.parse(`{${match[1]}}`) as GameTime;
  } catch {
    return {
      day: extractInt("day", match[1]),
      hour: extractInt("hour", match[1]),
      minute: extractInt("minute", match[1]) || 5,
    };
  }
}

/** 将 narrative 文本按段落拆分为 segments（内联版，避免循环 import） */
function narrativeToSegments(narrative: string, dialogue?: string): StorySegment[] {
  const segments: StorySegment[] = [];
  const paragraphs = narrative.split(/\n\n+/).filter((p) => p.trim());
  for (const para of paragraphs) {
    const trimmed = para.trim();
    if (trimmed.length === 0) continue;
    if (trimmed.length > 200) {
      const sentences = trimmed.split(/(?<=[。！？])/);
      let buf = "";
      for (const s of sentences) {
        if ((buf + s).length > 150 && buf.length > 0) {
          segments.push({ type: "narration", text: buf.trim() });
          buf = s;
        } else {
          buf += s;
        }
      }
      if (buf.trim()) segments.push({ type: "narration", text: buf.trim() });
    } else {
      segments.push({ type: "narration", text: trimmed });
    }
  }
  if (dialogue && dialogue.trim()) {
    segments.push({ type: "dialogue", text: dialogue.trim() });
  }
  return segments;
}

/**
 * 从截断的 AI 响应 JSON 中尽力恢复 AIGameResponse。
 *
 * 恢复策略（按优先级）：
 * 1. 先用通用 JSON 截断修复（salvageTruncatedJSON）尝试闭合，然后 JSON.parse
 * 2. 如果失败，用正则逐字段提取并组装
 * 3. 如果截断发生在 segments 内部，复用 extractPartialSegments 提取已完成段落
 *
 * 调用时机：parseJSON<AIGameResponse> 抛出异常时。
 */
export function salvagePartialGameResponse(fullText: string): AIGameResponse {
  const tool = parseWorkspaceToolReply(fullText);
  if (tool) return tool;
  // Prose can contain JSON examples. Keep the whole document rather than
  // mistaking a quoted field or example for a game-state proposal.
  if (fullText.trim() && !/^(?:```(?:json)?\s*)?\{/.test(fullText.trimStart())) return documentResponse(recoveredDocument(fullText));
  const json = fullText.replace(/^```json\s*/i, "").replace(/```\s*$/i, "");

  if (topLevelJsonValueStart(json, 'documents') >= 0) return documentResponse({ ...recoveredDocument(fullText), incomplete: true });

  // Stage 1：通用 JSON 截断修复
  const repaired = salvageTruncatedJSON(fullText);
  if (repaired) {
    try {
      const result = JSON.parse(repaired) as AIGameResponse;
      const document = readModelDocument(result, fullText);
      if (document) return documentResponse(document);
      // 确保关键字段存在
      if (!result.validity) result.validity = { isPossible: true, fantasyResponse: null, reason: null };
      if (!result.segments) result.segments = [];
      if (!result.availableActions?.length) result.availableActions = ["观察周围环境", "与附近的人交谈", "继续探索"];
      if (!result.timeSpent) result.timeSpent = { day: 0, hour: 0, minute: 5 };
      if (!result.summary) result.summary = "世界回应了";
      if (!result.itemsGained) result.itemsGained = [];
      if (!result.itemsUsed) result.itemsUsed = [];
      if (!result.cluesDiscovered) result.cluesDiscovered = [];
      if (!result.worldImpacts) result.worldImpacts = [];
      if (!result.sceneChanges) result.sceneChanges = [];
      if (!result.discoveredSecrets) result.discoveredSecrets = [];
      if (!result.npcsReacted) result.npcsReacted = [];
      // 通用闭合可能只保留前面的完整档案，不能因此丢掉后面已有的实际对白。
      const prose = topLevelJsonContainer(json, 'segments');
      if (result.segments.length || !prose || !/"text"\s*:/.test(prose.text)) {
        console.log(`[Salvage] 通用修复成功: ${result.segments.length} segs, ${result.availableActions.length} actions`);
        return result;
      }
    } catch {
      // 继续 Stage 2
    }
  }

  // Stage 2：逐字段正则提取
  console.warn("[Salvage] 通用修复失败，使用正则逐字段提取...");

  // 提取 segments——优先用括号匹配提取已完成的对象
  let segments = extractPartialSegments(json);
  const narrative = extractStr(json, "narrative");
  const dialogue = extractStr(json, "dialogue");
  if (segments.length === 0 && (narrative || dialogue)) {
    segments = narrativeToSegments(narrative, dialogue);
  }
  // 尝试提取嵌入在 segments 里的 text 内容（当 segment 对象不完整时）
  if (segments.length === 0) {
    // 档案范例、物品说明等字段也可能叫 text，只有真正的正文数组可以恢复为叙事。
    const segmentContainer = topLevelJsonContainer(json, 'segments');
    const textMatch: string[] = segmentContainer?.text.match(/"text"\s*:\s*"((?:[^"\\]|\\.)*)"/g) ?? [];
    // 兼容旧模型直接返回残缺的单个 text 对象，但不从嵌套元数据中搜寻正文。
    if (!segmentContainer && topLevelJsonValueStart(json, 'npcSpeechProfiles') < 0) {
      const start = topLevelJsonValueStart(json, 'text');
      const standalone = start >= 0 ? json.slice(start).match(/^"((?:[^"\\]|\\.)*)"/) : null;
      if (standalone) textMatch.push(`"text":${standalone[0]}`);
    }
    if (textMatch) {
      for (const m of textMatch) {
        const t = m.replace(/"text"\s*:\s*"/, "").replace(/"$/, "");
        const text = t.replace(/\\"/g, '"').replace(/\\n/g, '\n').replace(/\\\\/g, '\\');
        if (text.length > 5) {
          segments.push({ type: "narration", text });
        }
      }
    }
  }
  // 最终 fallback：用清理后的文本
  if (segments.length === 0 && topLevelJsonValueStart(json, 'npcSpeechProfiles') < 0) {
    if (fullText.trim()) return documentResponse(recoveredDocument(fullText));
    throw new Error('模型没有返回可恢复的正文');
  }

  const validity = extractValidity(json) ?? { isPossible: true, fantasyResponse: null, reason: null };
  const availableActions = extractStringArray(json, "availableActions");
  if (availableActions.length === 0) {
    availableActions.push("观察周围环境", "与附近的人交谈", "继续探索");
  }
  const timeSpent = extractTimeSpent(json);
  let timeAfter: GameTime | undefined;
  const endTime = json.match(/"timeAfter"\s*:\s*(\{[^}]*\})/);
  if (endTime) {
    try { timeAfter = JSON.parse(endTime[1]) as GameTime; }
    catch { /* Incomplete clock objects fall back to duration validation. */ }
  }
  const summary = extractStr(json, "summary") || "世界回应了";

  // 状态变更数组
  const itemsGained = extractStringArray(json, "itemsGained");
  const itemsUsed = extractStringArray(json, "itemsUsed");
  const cluesDiscovered = extractStringArray(json, "cluesDiscovered");
  const worldImpacts = extractStringArray(json, "worldImpacts");
  const sceneChanges = extractStringArray(json, "sceneChanges");
  const discoveredSecrets = extractStringArray(json, "discoveredSecrets");
  const npcsReacted = extractStringArray(json, "npcsReacted");
  const criticalFactsDiscovered = extractStringArray(json, "criticalFactsDiscovered");
  const profileContainer = topLevelJsonContainer(json, 'npcSpeechProfiles');
  let npcSpeechProfiles: AIGameResponse['npcSpeechProfiles'];
  if (profileContainer?.complete) {
    try { npcSpeechProfiles = parseNpcSpeechProfiles(JSON.parse(profileContainer.text)); }
    catch { /* 不完整或非法的写法资料不能补造成事实。 */ }
  }

  console.log(`[Salvage] 正则提取完成: ${segments.length} segs, ${availableActions.length} actions`);

  return {
    ...(npcSpeechProfiles ? { npcSpeechProfiles } : {}),
    validity,
    segments,
    narrative: narrative || undefined,
    dialogue: dialogue || undefined,
    sceneChanges: sceneChanges.length > 0 ? sceneChanges : [],
    discoveredSecrets: discoveredSecrets.length > 0 ? discoveredSecrets : [],
    npcsReacted: npcsReacted.length > 0 ? npcsReacted : [],
    availableActions,
    summary,
    timeSpent,
    timeAfter,
    itemsGained: itemsGained.length > 0 ? (itemsGained as unknown as AIGameResponse["itemsGained"]) : [],
    itemsUsed,
    cluesDiscovered,
    worldImpacts: worldImpacts.length > 0 ? worldImpacts : [],
    criticalFactsDiscovered: criticalFactsDiscovered.length > 0 ? criticalFactsDiscovered : undefined,
  };
}

export function salvagePartialWorldJSON(fullText: string): {
  name: string;
  subtitle: string;
  overview: string;
  regions: any;
  npcs: any;
  contradictions: any;
  history: any;
  clues: any;
} {
  // 去掉可能的 markdown fence 前缀
  const json = fullText.replace(/^```json\s*/i, "").replace(/```\s*$/i, "");

  // 找到最后一个在 depth=1 处的逗号或第一个未闭合的嵌套结构
  // 策略：扫描整个文本标记每个 depth=1 的逗号位置，取最后一个
  let depth = 0;
  let inString = false;
  let escaped = false;
  let lastGoodComma = -1;
  let lastGoodBrace = -1; // 记录 depth 降回 1 的位置

  for (let i = 0; i < json.length; i++) {
    const ch = json[i];
    if (escaped) { escaped = false; continue; }
    if (ch === "\\") { escaped = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === "{" || ch === "[") { depth++; continue; }
    if (ch === "}" || ch === "]") {
      depth--;
      if (depth === 1) lastGoodBrace = i + 1; // 嵌套结构闭合完成
      continue;
    }
    if (ch === "," && depth === 1) {
      lastGoodComma = i;
    }
  }

  // 选择截断点：优先用最后一个 depth=1 的逗号
  const cutPos = lastGoodComma > 0 ? lastGoodComma : lastGoodBrace;
  if (cutPos <= 0) {
    // 连一个完整字段都没有 → 尝试只提取 name
    const nameMatch = json.match(/"name"\s*:\s*"((?:[^"\\]|\\.)*)"/);
    if (nameMatch) {
      const name = nameMatch[1].replace(/\\"/g, '"');
      return { name, subtitle: "", overview: "", regions: {}, npcs: {}, contradictions: [], history: [], clues: [] };
    }
    throw new Error("无法从截断的 JSON 中恢复任何数据");
  }

  const trimmed = json.slice(0, cutPos) + "}";
  console.log(`[WorldStream] 截断修复：从位置 ${cutPos} 截断（原 ${json.length} 字符）→ ${trimmed.length} 字符`);

  try {
    return JSON.parse(trimmed);
  } catch {
    // 仍然失败 → 最后手段：正则提取已知字段
    console.warn("[WorldStream] 截断修复 JSON 解析失败，使用正则提取...");
    const extract = (key: string) => {
      const m = json.match(new RegExp(`"${key}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`));
      return m ? m[1].replace(/\\"/g, '"').replace(/\\\\/g, "\\") : "";
    };
    return {
      name: extract("name") || "未命名世界",
      subtitle: extract("subtitle"),
      overview: extract("overview"),
      regions: {},
      npcs: {},
      contradictions: [],
      history: [],
      clues: [],
    };
  }
}
