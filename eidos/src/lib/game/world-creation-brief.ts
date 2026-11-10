import { isRecord, strings } from './source-reconstruction/validation';
import type { SourceIssue, SourceStyleReference, StartAnchor } from './source-reconstruction/types';
import type { WorldForm } from './creation-materials';
import { stableHash } from './source-reconstruction/source-index';

export const WORLD_BRIEF_FIELDS = ['name', 'overview', 'culture', 'regions', 'npcs', 'contradictions', 'history', 'clues', 'opening'] as const;
export type WorldBriefField = typeof WORLD_BRIEF_FIELDS[number];
export type FieldPolicy = 'source' | 'custom' | 'generate';
export interface BriefField { text: string; policy: FieldPolicy; factRefs: string[]; required: boolean; sourceText: string; customText: string }
export interface AdaptationOverride { field: WorldBriefField; factIds: string[]; instruction: string; status: 'requested' | 'resolved'; affectedFields: WorldBriefField[] }
export interface WorldCreationBrief {
  version: 2; origin: 'concept' | 'source'; fields: Record<WorldBriefField, BriefField>;
  styleChoice: 'preset' | 'source'; sourceStyle?: SourceStyleReference;
  sourceStyleAnchorId?: string;
  startAnchor?: StartAnchor; sourceDossierRef?: string;
  sourceStartAnchor?: StartAnchor;
  overrides: AdaptationOverride[]; issues: SourceIssue[]; revision: string;
}

export const WORLD_BRIEF_LABELS: Record<WorldBriefField, string> = { name: '世界名称', overview: '世界概述', culture: '文化与基调', regions: '区域与场景', npcs: '重要人物', contradictions: '核心矛盾', history: '世界历史', clues: '可发现的线索', opening: '开场背景' };
export function briefFromConcept(input: { form: WorldForm }): WorldCreationBrief {
  const fields = {} as WorldCreationBrief['fields'];
  for (const key of WORLD_BRIEF_FIELDS) fields[key] = { text: input.form[key], customText: input.form[key], sourceText: '', policy: input.form[key].trim() ? 'custom' : 'generate', factRefs: [], required: false };
  return { version: 2, origin: 'concept', fields, styleChoice: 'preset', overrides: [], issues: [], revision: stableHash(fields) };
}
export type BriefEdit = { field: WorldBriefField; text?: string; policy?: FieldPolicy; required?: boolean } | { styleChoice: 'preset' | 'source'; sourceStyle?: SourceStyleReference } | { startAnchor: StartAnchor } | { resolveIssue: number };
export interface BriefEditResult { brief: WorldCreationBrief; invalidated: Array<'world' | 'timeline' | 'seeds' | 'style'> }
export function applyBriefEdit(input: WorldCreationBrief, edit: BriefEdit): BriefEditResult {
  const brief = structuredClone(input);
  let invalidated: BriefEditResult['invalidated'] = ['world', 'timeline', 'seeds'];
  if ('field' in edit) {
    const field = brief.fields[edit.field];
    if (edit.policy === 'source' && brief.origin !== 'source') throw new Error('概念创建没有原文选项');
    if (edit.policy) { field.policy = edit.policy; field.text = edit.policy === 'source' ? field.sourceText : edit.policy === 'custom' ? field.customText : ''; }
    if (edit.text !== undefined) { field.text = edit.text; field.customText = edit.text; field.policy = 'custom'; }
    if (edit.required !== undefined) field.required = edit.required;
    if (edit.field === 'opening' && (edit.text !== undefined || edit.policy !== undefined)) {
      brief.sourceStartAnchor ??= brief.startAnchor;
      brief.startAnchor = field.policy === 'source' ? brief.sourceStartAnchor : { id: `custom_${stableHash(field.text)}`, label: field.text || '自由生成开场', sourceRefs: [], knownFactIds: {} };
      if (brief.sourceStyle) brief.sourceStyle.samples = [];
    }
    brief.overrides = brief.overrides.filter(o => o.field !== edit.field);
    if (brief.origin === 'source' && field.policy !== 'source') brief.overrides.push({ field: edit.field, factIds: [...field.factRefs], instruction: field.text || '允许补全此项', status: 'requested', affectedFields: [edit.field] });
  } else if ('styleChoice' in edit) {
    brief.styleChoice = edit.styleChoice;
    if (edit.sourceStyle) brief.sourceStyle = edit.sourceStyle;
    invalidated = ['style'];
  } else if ('resolveIssue' in edit) {
    const issue = brief.issues[edit.resolveIssue];
    if (issue) { issue.blocking = false; issue.message += '（玩家确认按当前生成稿处理）'; }
  } else {
    brief.startAnchor = edit.startAnchor;
    brief.sourceStartAnchor = edit.startAnchor;
    const field = brief.fields.opening;
    field.sourceText = edit.startAnchor.label;
    if (field.policy === 'source') field.text = edit.startAnchor.label;
    // Samples were evaluated at the previous entry point; keep traits until the player selects safe new examples.
    if (brief.sourceStyle) brief.sourceStyle.samples = [];
  }
  brief.revision = stableHash({ ...brief, revision: '' });
  return { brief, invalidated };
}
export function serializeWorldBrief(brief: WorldCreationBrief): string {
  const fields = WORLD_BRIEF_FIELDS.map(key => {
    const f = brief.fields[key];
    return `## ${WORLD_BRIEF_LABELS[key]}${f.required ? '（必须保留）' : ''}\n${f.policy === 'source' ? '遵照原文；原文缺失则保持未知。' : f.policy === 'generate' ? '允许为本次世界补全；不得冒充原文。' : '玩家指定内容。'}\n${f.text}`;
  });
  return fields.join('\n\n') + '\n\n保留玩家明确条件。若必须保留项互相冲突，指出具体冲突，不擅自选择更戏剧性的解释。玩家可通过行动改变未来；原文后续和结局不是必然事件。';
}

export function assertWorldBrief(value: unknown): asserts value is WorldCreationBrief {
  if (!isRecord(value) || value.version !== 2 || !['concept', 'source'].includes(String(value.origin)) || !isRecord(value.fields) || !Array.isArray(value.overrides) || !Array.isArray(value.issues) || !['source', 'preset'].includes(String(value.styleChoice)) || typeof value.revision !== 'string') throw new Error('世界生成稿无效');
  for (const key of WORLD_BRIEF_FIELDS) {
    const f = value.fields[key];
    if (!isRecord(f) || ['text', 'sourceText', 'customText'].some(k => typeof f[k] !== 'string') || !strings(f.factRefs) || typeof f.required !== 'boolean' || !['source', 'custom', 'generate'].includes(String(f.policy)) || value.origin === 'concept' && f.policy === 'source') throw new Error(`生成稿 ${key} 无效`);
  }
  if (value.issues.some(i => !isRecord(i) || typeof i.message !== 'string' || typeof i.blocking !== 'boolean')) throw new Error('生成稿冲突信息无效');
  if (value.overrides.some(o => !isRecord(o) || !WORLD_BRIEF_FIELDS.includes(o.field as typeof WORLD_BRIEF_FIELDS[number]) || !strings(o.factIds) || typeof o.instruction !== 'string')) throw new Error('改编条件无效');
}
