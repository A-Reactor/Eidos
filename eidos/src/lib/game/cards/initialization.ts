import { cardEntries } from './entries';
import { validateGameModeConfig } from '../plugins/manifest';
import { cardText, isRecord, type ParsedCard } from './types';
import { readVariableParts, variableRootPath } from './variable-path';

export const CARD_STATE_KEY = '_eidosCard';
export function isCardInitializer(entry: Record<string, unknown>) {
  return /\[InitVar\]/i.test(cardText(entry.comment ?? entry.name));
}
export function cardInitialization(card: ParsedCard) {
  const entries = cardEntries(card).filter(e => isCardInitializer(e.value));
  if (entries.length > 1) throw new Error('多份 InitVar 初始化需要明确合并规则');
  if (!entries.length) return undefined;
  let variables: unknown;
  try { variables = JSON.parse(entries[0].text); } catch { throw new Error('InitVar 当前须为 JSON 对象'); }
  if (!isRecord(variables)) throw new Error('InitVar 当前须为 JSON 对象');
  validateGameModeConfig(variables, 32_000);
  const extensions = isRecord(card.data.extensions) ? card.data.extensions : {};
  const options = isRecord(extensions.eidos) ? extensions.eidos : {};
  const publicVariables = options.publicVariables ?? [];
  if (!Array.isArray(publicVariables) || publicVariables.length > 32 || publicVariables.some(p => typeof p !== 'string')) throw new Error('公开变量须为最多 32 个路径');
  const bounds = options.variableBounds ?? {};
  if (!isRecord(bounds) || Object.keys(bounds).length > 64) throw new Error('变量界限声明无效');
  for (const path of [...publicVariables, ...Object.keys(bounds)]) {
    const value = readVariableParts(variables, variableRootPath(path));
    if (value === undefined || !scalar(value) || !mutableVariable(variables, path)) throw new Error(`变量声明不是已有标量：${path}`);
    if (bounds[path] !== undefined) validateBound(bounds[path], value);
  }
  return { variables: JSON.parse(JSON.stringify(variables)) as Record<string, unknown>, publicVariables: publicVariables as string[], bounds };
}
export function scalar(value: unknown) { return value === null || ['string', 'number', 'boolean'].includes(typeof value); }
export function mutableVariable(root: Record<string, unknown>, path: string) {
  const parts = variableRootPath(path); let current: unknown = root;
  for (const key of parts) {
    // MVU pairs keep the second item as the author's explanation, not a mutable value.
    if (Array.isArray(current) && current.length === 2 && typeof current[1] === 'string' && key !== '0') return false;
    if ((!isRecord(current) && !Array.isArray(current)) || !Object.hasOwn(current, key)) return false;
    current = (current as Record<string, unknown>)[key];
  }
  return scalar(current);
}
export function validateBound(bound: unknown, value: unknown) {
  if (!isRecord(bound) || Object.keys(bound).some(k => k !== 'min' && k !== 'max') || typeof value !== 'number'
    || (bound.min !== undefined && (typeof bound.min !== 'number' || !Number.isFinite(bound.min) || value < bound.min))
    || (bound.max !== undefined && (typeof bound.max !== 'number' || !Number.isFinite(bound.max) || value > bound.max))) throw new Error('卡片变量越过数值界限');
}
