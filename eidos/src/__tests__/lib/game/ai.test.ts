// ============================================================
// Eidos · AI 工具函数测试
// ============================================================
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock sessionStorage 和 localStorage（模块加载时需要）
vi.stubGlobal("sessionStorage", {
  getItem: vi.fn(() => null),
  setItem: vi.fn(),
  removeItem: vi.fn(),
});
vi.stubGlobal("localStorage", {
  getItem: vi.fn(() => null),
  setItem: vi.fn(),
});

// 动态导入以正确触发 mock
// parseJSON 和 legacyNarrativeToSegments 是纯函数，可以直接测试

// 我们需要在不加载完整模块的情况下测试 parseJSON，
// 因为 ai.ts 模块顶级会调用 loadSettings() 等初始化逻辑
// 所以我们在这里复制 parseJSON 逻辑进行测试

// ============================================================
// parseJSON 逻辑测试（从 ai.ts 复制的逻辑）
// ============================================================

function parseJSON<T>(raw: string, fallback?: T): T {
  // 先尝试提取 ```json 代码块
  const fenceMatch = raw.match(/```json\s*([\s\S]*?)```/);
  if (fenceMatch) {
    try { return JSON.parse(fenceMatch[1].trim()); } catch { /* fall through */ }
  }
  try {
    return JSON.parse(raw);
  } catch {
    const match = raw.match(/\{[\s\S]*\}/);
    if (match) {
      try { return JSON.parse(match[0]); } catch { /* fall through */ }
    }
    if (fallback !== undefined) return fallback;
    throw new Error(`Failed to parse AI response: ${raw.slice(0, 200)}`);
  }
}

describe("parseJSON", () => {
  it("parses bare JSON", () => {
    const result = parseJSON<{ a: number }>('{"a": 42}');
    expect(result).toEqual({ a: 42 });
  });

  it("extracts JSON from ```json fence", () => {
    const result = parseJSON<{ b: string }>('```json\n{"b": "hello"}\n```');
    expect(result).toEqual({ b: "hello" });
  });

  it("extracts JSON from fence with surrounding text", () => {
    const result = parseJSON<{ c: boolean }>(
      'Some text before\n```json\n{"c": true}\n```\nSome text after'
    );
    expect(result).toEqual({ c: true });
  });

  it("falls back to {} extraction when fence fails", () => {
    const result = parseJSON<{ d: number }>(
      'not json at all but there is a { "d": 99 } inside'
    );
    expect(result).toEqual({ d: 99 });
  });

  it("returns fallback for completely invalid input", () => {
    const result = parseJSON<{ e: number }>("this is not json at all", { e: 0 });
    expect(result).toEqual({ e: 0 });
  });

  it("throws without fallback for invalid input", () => {
    expect(() => parseJSON<{ f: number }>("totally invalid text with no braces")).toThrow(
      "Failed to parse AI response"
    );
  });
});

// ============================================================
// legacyNarrativeToSegments 测试（从 ai.ts 复制的逻辑）
// ============================================================

interface StorySegment {
  type: "narration" | "dialogue";
  text: string;
  speaker?: string;
}

function legacyNarrativeToSegments(
  narrative: string,
  dialogue?: string
): StorySegment[] {
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

describe("legacyNarrativeToSegments", () => {
  it("splits paragraphs into narration segments", () => {
    const result = legacyNarrativeToSegments("第一段内容。\n\n第二段内容。");
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ type: "narration", text: "第一段内容。" });
    expect(result[1]).toEqual({ type: "narration", text: "第二段内容。" });
  });

  it("appends dialogue segment when provided", () => {
    const result = legacyNarrativeToSegments("一段叙事。", "NPC说的话");
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ type: "narration", text: "一段叙事。" });
    expect(result[1]).toEqual({ type: "dialogue", text: "NPC说的话" });
  });

  it("returns empty array for empty narrative", () => {
    expect(legacyNarrativeToSegments("")).toEqual([]);
  });

  it("splits long paragraphs at sentence boundaries", () => {
    // 创建超过 200 字的段落
    let longText = "";
    for (let i = 0; i < 30; i++) {
      longText += `这是第${i + 1}句话。`;
    }
    expect(longText.length).toBeGreaterThan(200);
    const result = legacyNarrativeToSegments(longText);
    expect(result.length).toBeGreaterThan(1);
    // All segments should be narration
    expect(result.every((s) => s.type === "narration")).toBe(true);
  });

  it("handles dialogue only (no narrative)", () => {
    const result = legacyNarrativeToSegments("", "你好");
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ type: "dialogue", text: "你好" });
  });
});

// ============================================================
// extractPartialSegments 测试（渐进式 JSON 提取——流式核心）
// ============================================================

interface StorySegment {
  type: "narration" | "dialogue";
  text: string;
  speaker?: string;
}

function extractPartialSegments(jsonText: string): StorySegment[] {
  const segments: StorySegment[] = [];

  const segKey = '"segments"';
  const segIdx = jsonText.indexOf(segKey);
  if (segIdx === -1) return segments;

  const bracketIdx = jsonText.indexOf('[', segIdx);
  if (bracketIdx === -1) return segments;

  let pos = bracketIdx + 1;

  while (pos < jsonText.length) {
    while (pos < jsonText.length && ' \t\n\r,'.includes(jsonText[pos])) pos++;
    if (pos >= jsonText.length) break;

    if (jsonText[pos] === ']') break;
    if (jsonText[pos] !== '{') break;

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

    if (objEnd === -1) break;

    const objStr = jsonText.slice(objStart, objEnd + 1);

    let type: string = 'narration';
    let text = '';
    let speaker: string | undefined;

    const typeMatch = objStr.match(/"type"\s*:\s*"([^"]*)"/);
    if (typeMatch) type = typeMatch[1];

    const speakerMatch = objStr.match(/"speaker"\s*:\s*"((?:[^"\\]|\\.)*)"/);
    if (speakerMatch) speaker = speakerMatch[1].replace(/\\"/g, '"');

    const textMatch = objStr.match(/"text"\s*:\s*"((?:[^"\\]|\\.)*)"/);
    if (textMatch) {
      text = textMatch[1]
        .replace(/\\"/g, '"')
        .replace(/\\n/g, '\n')
        .replace(/\\\\/g, '\\');
    }

    if (text.length > 0) {
      segments.push({ type: type as 'narration' | 'dialogue', text, speaker });
    }

    pos = objEnd + 1;
  }

  return segments;
}

describe("extractPartialSegments", () => {
  it("returns empty when segments key not yet in text", () => {
    const partial = '```json\n{"validity":{"isPossible":true';
    expect(extractPartialSegments(partial)).toEqual([]);
  });

  it("returns empty when segment object is incomplete", () => {
    // segments 数组已开始但第一个对象还没闭合
    const partial = '```json\n{"validity":{},"segments":[{"type":"narration","text":"你蹲在井底';
    expect(extractPartialSegments(partial)).toEqual([]);
  });

  it("extracts one complete narration segment from partial JSON", () => {
    const partial = '{"validity":{"isPossible":true},"segments":[{"type":"narration","text":"你蹲在井底边缘。潮湿的石壁上爬满了发光的苔藓。"}]';
    const result = extractPartialSegments(partial);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      type: "narration",
      text: "你蹲在井底边缘。潮湿的石壁上爬满了发光的苔藓。",
    });
  });

  it("extracts multiple complete segments", () => {
    const partial = '{"validity":{},"segments":[{"type":"narration","text":"第一段。"},{"type":"dialogue","speaker":"老王","text":"你好！"}]';
    const result = extractPartialSegments(partial);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ type: "narration", text: "第一段。" });
    expect(result[1]).toEqual({ type: "dialogue", speaker: "老王", text: "你好！" });
  });

  it("extracts only complete segments, ignores incomplete ones at end", () => {
    // 第一个 segment 完整，第二个 text 还没闭合引号
    const partial = '{"segments":[{"type":"narration","text":"第一段完整。"},{"type":"dialogue","speaker":"老王","text":"还没说';
    const result = extractPartialSegments(partial);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ type: "narration", text: "第一段完整。" });
  });

  it("handles text with escaped quotes", () => {
    const partial = '{"segments":[{"type":"narration","text":"他说：\\"你好\\"，然后走了。"}]}';
    const result = extractPartialSegments(partial);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      type: "narration",
      text: '他说："你好"，然后走了。',
    });
  });

  it("handles text with escaped backslashes", () => {
    const partial = '{"segments":[{"type":"narration","text":"路径是 C:\\\\Users\\\\player"}]}';
    const result = extractPartialSegments(partial);
    expect(result).toHaveLength(1);
    expect(result[0].text).toContain("C:\\Users\\player");
  });

  it("handles code fence prefix (from AI output format)", () => {
    const partial = '```json\n{"segments":[{"type":"narration","text":"有代码块的文本。"}]}';
    const result = extractPartialSegments(partial);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ type: "narration", text: "有代码块的文本。" });
  });

  it("handles pretty-printed JSON with whitespace", () => {
    const partial = `{
      "validity": {},
      "segments": [
        {
          "type": "narration",
          "text": "格式化 JSON。"
        },
        {
          "type": "dialogue",
          "speaker": "NPC",
          "text": "对话内容。"
        }
      ],
      "timeSpent": {}
    }`;
    const result = extractPartialSegments(partial);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ type: "narration", text: "格式化 JSON。" });
    expect(result[1]).toEqual({ type: "dialogue", speaker: "NPC", text: "对话内容。" });
  });

  it("stops at unclosed array bracket (streaming in progress)", () => {
    // segments 数组还没闭合，但所有对象都是完整的
    const partial = '{"segments":[{"type":"narration","text":"完成。"},{"type":"narration","text":"也完成。"}';
    const result = extractPartialSegments(partial);
    expect(result).toHaveLength(2);
  });

  it("handles empty segments gracefully", () => {
    // segments 数组为空
    const partial = '{"segments":[]';
    const result = extractPartialSegments(partial);
    expect(result).toEqual([]);
  });

  it("handles segment with only speaker (text still generating)", () => {
    // speaker 字段已完成但 text 还是空的
    const partial = '{"segments":[{"type":"dialogue","speaker":"老王","text":""}]}';
    const result = extractPartialSegments(partial);
    // text 为空，不应包含在结果中
    expect(result).toHaveLength(0);
  });

  it("works with real-world JSON (compressed format from AI)", () => {
    const partial =
      '```json\n{"validity":{"isPossible":true,"fantasyResponse":null,"reason":null},"segments":[{"type":"narration","text":"你蹲在井底边缘，潮湿的石壁上爬满了发光的苔藓。头顶的井口像一枚遥远的硬币，隐约传来地面的喧嚣声。"},{"type":"dialogue","speaker":"井底商人","text":"嘿，新来的？别看了，井口离这里三十米，你爬不上去的。不如看看我的货？"}]';
    const result = extractPartialSegments(partial);
    expect(result).toHaveLength(2);
    expect(result[0].type).toBe("narration");
    expect(result[0].text).toContain("你蹲在井底");
    expect(result[1].type).toBe("dialogue");
    expect(result[1].speaker).toBe("井底商人");
  });
});

// ============================================================
// detectCompletedFields 测试（流式 JSON 字段检测器）
// ============================================================

function detectCompletedFields(
  jsonText: string,
  alreadySeen: Set<string>,
  resumePos: number,
  depth: number
): { fields: string[]; resumePos: number; depth: number } {
  const found: string[] = [];
  let i = resumePos;

  if (resumePos === 0) {
    while (i < jsonText.length && jsonText[i] !== "{") i++;
    if (i >= jsonText.length) return { fields: found, resumePos, depth: 0 };
    i++;
    depth = 1;
  }

  let inString = false;
  let escapeNext = false;
  let currentKey = "";
  let keyBuf = "";
  let expectValue = false;
  let lastComplete = resumePos;

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
      // 标量值直接跟 }
      if (depth === 1 && expectValue && currentKey && !alreadySeen.has(currentKey)) {
        found.push(currentKey);
        lastComplete = i + 1;
      }
      depth--;
      // 嵌套对象/数组闭合后 depth 从 2→1，该顶层字段完成
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

  return { fields: found, resumePos: lastComplete, depth: lastComplete > 0 ? 1 : 0 };
}

describe("detectCompletedFields", () => {
  // ============ 标量字段 ============

  it("detects a completed scalar field (comma-terminated)", () => {
    const alreadySeen = new Set<string>();
    const json = '{"name": "裂隙之城",';
    const result = detectCompletedFields(json, alreadySeen, 0, 0);
    expect(result.fields).toContain("name");
    expect(result.resumePos).toBeGreaterThan(0);
    // 返回的 depth 必须是 1（resumePos 在顶层）
    expect(result.depth).toBe(1);
  });

  it("detects multiple scalar fields in sequence", () => {
    const alreadySeen = new Set<string>();
    const json = '{"name": "裂隙之城",\n"subtitle": "知道未来的人",\n"overview": "在这座城市...",';
    const result = detectCompletedFields(json, alreadySeen, 0, 0);
    expect(result.fields).toEqual(["name", "subtitle", "overview"]);
  });

  it("does not re-report already-seen fields", () => {
    const alreadySeen = new Set(["name"]);
    const json = '{"name": "裂隙之城",\n"subtitle": "知道未来的人",';
    const result = detectCompletedFields(json, alreadySeen, 0, 0);
    expect(result.fields).not.toContain("name");
    expect(result.fields).toContain("subtitle");
  });

  it("detects last scalar field before JSON closing brace", () => {
    const alreadySeen = new Set<string>();
    const json = '{"calendarEra": "裂隙历"}';
    const result = detectCompletedFields(json, alreadySeen, 0, 0);
    expect(result.fields).toContain("calendarEra");
  });

  // ============ 嵌套字段（对象/数组） — 修复核心 ============

  it("detects nested object field when its closing brace arrives", () => {
    const alreadySeen = new Set<string>();
    // regions 是一个对象，其值被完全包含
    const json = '{"name": "裂隙之城",\n"regions": {"r1": {"id": "r1", "name": "中央广场", "description": "..."}},\n"npcs": {';
    const result = detectCompletedFields(json, alreadySeen, 0, 0);
    // name 通过逗号检测，regions 通过闭合 } 检测
    expect(result.fields).toContain("name");
    expect(result.fields).toContain("regions");
    // npcs 还没闭合
    expect(result.fields).not.toContain("npcs");
  });

  it("detects array field when closing bracket arrives", () => {
    const alreadySeen = new Set<string>();
    const json = '{"clues": [{"id": "clue_001", "name": "线索1"}, {"id": "clue_002", "name": "线索2"}],';
    const result = detectCompletedFields(json, alreadySeen, 0, 0);
    expect(result.fields).toContain("clues");
  });

  it("detects last nested field before final closing brace", () => {
    const alreadySeen = new Set<string>();
    // npcs 是最后一个字段，没有尾随逗号
    const json = '{"regions": {"r1": {"id": "r1"}}, "npcs": {"老王": "一个NPC"}}';
    const result = detectCompletedFields(json, alreadySeen, 0, 0);
    expect(result.fields).toContain("regions");
    expect(result.fields).toContain("npcs");
  });

  it("detects all types of fields in a realistic world JSON", () => {
    const alreadySeen = new Set<string>();
    const json = `{
      "name": "测试世界",
      "overview": "这是一个测试世界",
      "regions": {"central": {"id": "central", "scenes": {"plaza": {"id": "plaza"}}}},
      "npcs": {"老王": "一个NPC", "小李": "另一个NPC"},
      "contradictions": [{"name": "矛盾1", "description": "描述1"}],
      "clues": [{"id": "c1", "name": "线索1"}],
      "identityOptions": [{"id": "i1", "name": "玩家身份"}]
    }`;
    const result = detectCompletedFields(json, alreadySeen, 0, 0);
    // 所有顶层字段都应该被检测到
    expect(result.fields).toContain("name");
    expect(result.fields).toContain("overview");
    expect(result.fields).toContain("regions");
    expect(result.fields).toContain("npcs");
    expect(result.fields).toContain("contradictions");
    expect(result.fields).toContain("clues");
    expect(result.fields).toContain("identityOptions");
  });

  // ============ 增量扫描（resumePos / depth） ============

  it("resumes from resumePos correctly, not re-scanning old fields", () => {
    const alreadySeen = new Set(["name", "subtitle"]);
    const fullJson = '{"name": "裂隙之城", "subtitle": "副标题", "overview": "描述..."}';
    // 模拟：前一次调用已扫描到 subtitle 逗号之后
    // "subtitle": "副标题", — 逗号在索引 34，"副标题" 值闭合在索引 33
    const commaAfterSubtitle = fullJson.indexOf('"副标题"') + 6; // 位置 35，即 ", 之后
    const firstSlice = fullJson.slice(0, commaAfterSubtitle);
    const firstResult = detectCompletedFields(firstSlice, new Set(), 0, 0);
    expect(firstResult.fields).toEqual(["name", "subtitle"]);
    expect(firstResult.depth).toBe(1);

    // 第二次调用：从 resumePos 继续，alreadySeen 含 name 和 subtitle
    const secondResult = detectCompletedFields(
      fullJson,
      new Set(["name", "subtitle"]),
      firstResult.resumePos,
      firstResult.depth
    );
    // 只应检测到 overview（新的），不应重复 name/subtitle
    expect(secondResult.fields).toEqual(["overview"]);
    expect(secondResult.depth).toBe(1);
  });

  it("returns depth=1 at resumePos even when scan ended inside nested object", () => {
    const alreadySeen = new Set<string>();
    // 这个 JSON 在 regions 内部截断——扫描结束时 depth 是 2
    const truncatedJson = '{"name": "裂隙之城", "regions": {"central": {"id": "central"';
    const result = detectCompletedFields(truncatedJson, alreadySeen, 0, 0);
    // name 被检测到，regions 尚未闭合
    expect(result.fields).toEqual(["name"]);
    // 关键断言：返回的 depth 必须是 1（resumePos 在顶层逗号后），不是 2（扫描结束在嵌套内部）
    expect(result.depth).toBe(1);
    // resumePos 应该在 name 逗号之后
    expect(result.resumePos).toBeGreaterThan(0);
  });

  it("handles partial JSON with no complete fields gracefully", () => {
    const alreadySeen = new Set<string>();
    const json = '{"name": "裂隙';
    const result = detectCompletedFields(json, alreadySeen, 0, 0);
    expect(result.fields).toEqual([]);
    expect(result.depth).toBe(0);
  });
});
