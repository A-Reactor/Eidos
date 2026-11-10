import type { AIGameResponse } from '@/lib/ai/types';

export interface NpcSpeechProfile {
  version: 1;
  baseline: string;
  wording: string[];
  rhythm: string;
  relationships: Array<{ audience: string; style: string }>;
  emotions: Array<{ state: string; style: string }>;
  examples: Array<{ situation: string; text: string }>;
}

const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === 'string' && Boolean(value.trim());
const nameAllowed = (name: string) => text(name) && !['__proto__', 'constructor', 'prototype'].includes(name);
function pairs(value: unknown, first: string, second: string, minimum = 1): value is Array<Record<string, string>> {
  return Array.isArray(value) && value.length >= minimum && value.every(item => record(item) && text(item[first]) && text(item[second]));
}

/** 不截断台词，也不允许其他模型字段混入持久档案。 */
export function parseNpcSpeechProfile(value: unknown): NpcSpeechProfile | undefined {
  if (!record(value) || value.version !== 1 || !text(value.baseline) || !text(value.rhythm)
    || !Array.isArray(value.wording) || !value.wording.length || !value.wording.every(text)
    || !pairs(value.relationships, 'audience', 'style') || !pairs(value.emotions, 'state', 'style')
    || !pairs(value.examples, 'situation', 'text', 2)) return undefined;
  return {
    version: 1, baseline: value.baseline, wording: [...value.wording], rhythm: value.rhythm,
    relationships: value.relationships.map(item => ({ audience: item.audience, style: item.style })),
    emotions: value.emotions.map(item => ({ state: item.state, style: item.style })),
    examples: value.examples.map(item => ({ situation: item.situation, text: item.text })),
  };
}

export function parseNpcSpeechProfiles(value: unknown, allowedNames?: readonly string[]): Record<string, NpcSpeechProfile> {
  if (!record(value)) return {};
  return Object.fromEntries(Object.entries(value).flatMap(([name, raw]) => {
    if (!nameAllowed(name) || allowedNames && !allowedNames.includes(name)) return [];
    const profile = parseNpcSpeechProfile(raw);
    return profile ? [[name, profile]] : [];
  }));
}

export function formatNpcSpeechProfiles(profiles: Record<string, NpcSpeechProfile>): string {
  const entries = Object.entries(parseNpcSpeechProfiles(profiles)).sort(([a], [b]) => a.localeCompare(b, 'zh-CN'));
  if (!entries.length) return '';
  return `\n## 逐角色言语档案（内隐写法资料）
对象键是档案所属人物的准确姓名，只用于该人物。档案不声明人物在场，也不改变其动机、知识或记忆。
baseline、wording、rhythm 是表达底色；relationships 与 emotions 按本轮真实关系和情绪选用，不强行制造条件。
examples 是不同情境的台词示范，不是已发生的历史、承诺或秘密，不照抄到正文。原文与原卡的明确表达习惯、玩家明确改编优先；不把某个人的句式套给其他人，不把其他档案借给未建档人物。
${JSON.stringify(Object.fromEntries(entries), null, 2)}`;
}

/** 只接纳实际行动中首次说话人物的新档案；候选生成本身不写入状态。 */
export function newNpcSpeechProfiles(response: Partial<AIGameResponse>, worldProfiles: Record<string, NpcSpeechProfile>, savedProfiles: Record<string, NpcSpeechProfile>): Record<string, NpcSpeechProfile> {
  if (response.document || response.historyRequest !== undefined || response.narrativeFrame?.kind === 'cutaway'
    || response._gameplayResult || response.validity?.isPossible === false) return {};
  const speakers = (response.segments ?? []).flatMap(segment => segment.type === 'dialogue' && text(segment.speaker) ? [segment.speaker] : []);
  const supplied = parseNpcSpeechProfiles(response.npcSpeechProfiles, speakers);
  return Object.fromEntries(Object.entries(supplied).filter(([name]) => !parseNpcSpeechProfile(worldProfiles[name]) && !parseNpcSpeechProfile(savedProfiles[name])));
}
