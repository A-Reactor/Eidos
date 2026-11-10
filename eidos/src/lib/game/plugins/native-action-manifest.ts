import type { GameplayPlugin, NativeGameplayAction } from './types';
import { allowedFields, PluginInputError, record, text } from './validation';
import { authoredSegments } from './gameplay-state';

export function parseNativeActions(value: unknown, rules: GameplayPlugin['rules']): NativeGameplayAction[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new PluginInputError('原生行动须为列表');
  const labels = new Set<string>(), ids = new Set<string>();
  return value.map(raw => {
    const action = record(raw); allowedFields(action, ['ruleId', 'label', 'segments']);
    const ruleId = text(action.ruleId, 64), label = text(action.label, Infinity);
    if (!rules.some(rule => rule.id === ruleId) || ids.has(ruleId) || labels.has(label)) throw new PluginInputError('原生行动引用未知规则或重复标签');
    ids.add(ruleId); labels.add(label);
    return { ruleId, label, ...(action.segments === undefined ? {} : { segments: authoredSegments(action.segments) }) };
  });
}
