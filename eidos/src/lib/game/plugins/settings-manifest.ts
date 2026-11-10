import type { GameplaySetting } from './types';
import { allowedFields, pluginIdentifier, PluginInputError, record, text } from './validation';

export function parsePluginSettings(value: unknown): GameplaySetting[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > 32) throw new PluginInputError('模组设置须为最多 32 项的列表');
  const ids = new Set<string>();
  return value.map(raw => {
    const s = record(raw);
    allowedFields(s, ['id', 'label', 'description', 'type', 'default', 'min', 'max', 'options']);
    if (!pluginIdentifier(s.id) || ids.has(s.id)) throw new PluginInputError('模组设置 ID 无效或重复');
    ids.add(s.id);
    const base = { id: s.id, label: text(s.label, Infinity), ...(s.description === undefined ? {} : { description: text(s.description, Infinity) }) };
    if (s.type === 'boolean' && typeof s.default === 'boolean') return { ...base, type: s.type, default: s.default };
    if (s.type === 'number' && typeof s.default === 'number' && Number.isFinite(s.default)) {
      for (const bound of [s.min, s.max]) if (bound !== undefined && (typeof bound !== 'number' || !Number.isFinite(bound))) throw new PluginInputError('模组设置数值范围无效');
      const min = s.min as number | undefined, max = s.max as number | undefined;
      if ((min ?? -Infinity) > s.default || (max ?? Infinity) < s.default) throw new PluginInputError('模组设置默认值超出范围');
      return { ...base, type: s.type, default: s.default, ...(min === undefined ? {} : { min }), ...(max === undefined ? {} : { max }) };
    }
    if (s.type === 'string' && typeof s.default === 'string') return { ...base, type: s.type, default: text(s.default, Infinity, false) };
    if (s.type === 'select' && typeof s.default === 'string' && Array.isArray(s.options) && s.options.length > 0 && s.options.length <= 64) {
      const options = s.options.map(option => text(option, Infinity));
      if (options.includes(s.default)) return { ...base, type: s.type, default: s.default, options };
    }
    throw new PluginInputError('模组设置类型或默认值无效');
  });
}
