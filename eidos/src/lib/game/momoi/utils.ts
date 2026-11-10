// ============================================================
// Eidos · MOMOI 工具函数（浏览器 + 服务端通用）
// ============================================================
// 不依赖 Node.js API，可在客户端和服务端同时使用。

/**
 * 对文本前 80 字符做简单的数字 hash。
 * 不需要 crypto 级别的 hash——只是缓存去重。
 */
export function hashText(text: string): string {
  let hash = 0;
  const str = text.slice(0, 80);
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

// ============================================================
// TTS 文本预处理 — 专有名词标注
// ============================================================
// GPT-SoVITS 等中文 TTS 模型对「」包裹的文本会特别处理，
// 提高人名、地名等专有名词的发音准确度。

/**
 * 用「」包裹文本中的已知专有名词，提升 TTS 发音准确度。
 *
 * @param text — 原始对话文本
 * @param knownNames — 已知的专有名词列表（如 NPC 名、地名）
 * @returns 标注后的文本
 *
 * @example
 *   wrapProperNouns("Smith John，我们去找东海帝王吧", ["Smith John", "东海帝王"])
 *   // → "「Smith John」，我们去找「东海帝王」吧"
 */
export function wrapProperNouns(text: string, knownNames: string[]): string {
  if (!knownNames.length) return text;

  let result = text;

  // 按长度降序排列，优先匹配长名（避免 "东海" 先于 "东海帝王" 匹配）
  const sorted = [...knownNames].sort((a, b) => b.length - a.length);

  for (const name of sorted) {
    if (!name || name.length < 2) continue;

    // 转义正则特殊字符
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    // 用否定环视避免匹配已包裹在「」中的子串
    // (?<!「) 前面不是「, (?!」) 后面不是」
    const regex = new RegExp(`(?<!「)${escaped}(?!」)`, "g");
    result = result.replace(regex, `「${name}」`);
  }

  return result;
}

/**
 * 检测文本中未被「」包裹的连续拉丁字符单词，自动包裹。
 * 解决中英混排时英文名被 TTS 拆成字母读的问题。
 *
 * @example
 *   wrapLatinWords("你好Smith，今天John来了")
 *   // → "你好「Smith」，今天「John」来了"
 */
export function wrapLatinWords(text: string): string {
  // 匹配 2-30 个拉丁字母/数字的连续串，且未被「」包裹
  return text.replace(
    /(?<!「)\b([A-Za-z][A-Za-z0-9]{1,29})\b(?!」)/g,
    "「$1」",
  );
}

/**
 * 完整的 TTS 文本预处理管线。
 *
 * @param text — 原始对话文本
 * @param knownNames — 已知专有名词（NPC 名、地名等）
 */
export function preprocessTtsText(text: string, knownNames: string[] = []): string {
  let result = text;
  // 中文破折号 → 逗号（TTS 模型对 —— 处理不佳）
  result = result.replace(/——/g, "，");
  result = wrapProperNouns(result, knownNames);
  result = wrapLatinWords(result);
  return result;
}

// ============================================================
// 音色解析（prefetch + useMomoiPlayback 共享——保证缓存 key 一致）
// ============================================================

export interface ResolvedSpeaker {
  speaker: string;
  referenceAudio?: string;
}

/** 解析 NPC speaker 为实际 TTS 请求用的 speaker 名 + 参考音频 */
export function resolveSpeaker(
  rawSpeaker: string,
  worldId: string,
): ResolvedSpeaker {
  if (!rawSpeaker) return { speaker: rawSpeaker };
  try {
    const raw = localStorage.getItem("eidos_momoi_voice_profiles");
    const profiles: Array<{ id: string; name: string; referenceAudio?: string | null }> =
      raw ? JSON.parse(raw) : [];

    // 1. NPC → 音色映射
    let speaker = rawSpeaker;
    const mapRaw = localStorage.getItem("eidos_momoi_npc_map_" + worldId);
    if (mapRaw) {
      const map: Record<string, string> = JSON.parse(mapRaw);
      const id = map[rawSpeaker];
      if (id) {
        const p = profiles.find((x) => x.id === id);
        if (p?.name) speaker = p.name;
      }
    }

    // 2. 按 name 查找音色档案
    let match = profiles.find((p) => p.name === speaker);
    if (!match) match = profiles.find((p) => p.name === rawSpeaker);
    if (match) return { speaker: match.name, referenceAudio: match.referenceAudio ?? undefined };

    // 3. 默认音色
    const dvRaw = localStorage.getItem("eidos_momoi_default_voice");
    if (dvRaw) {
      const dv = JSON.parse(dvRaw);
      if (dv.enabled && dv.profileId) {
        const df = profiles.find((p) => p.id === dv.profileId);
        if (df?.name) return { speaker: df.name, referenceAudio: df.referenceAudio ?? undefined };
      }
    }

    return { speaker: rawSpeaker };
  } catch {
    return { speaker: rawSpeaker };
  }
}
