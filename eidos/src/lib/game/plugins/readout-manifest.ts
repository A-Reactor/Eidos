import type { GameplayReadout, GameplayResource } from './types';
import { allowedFields, parsePluginFlags, pluginIdentifier, PluginInputError, record, text } from './validation';
import { parseResourceRequires } from './resource-manifest';
import { parseDisplayLocation } from './display-location';

export function parseReadouts(value: unknown, resources: Record<string, GameplayResource> = {}): GameplayReadout[] {
  if (!Array.isArray(value) || value.length > 32) throw new PluginInputError('插件提示须为最多 32 项的列表');
  const ids = new Set<string>();
  return value.map(raw => {
    const r = record(raw);
    allowedFields(r, ['id', 'text', 'requires', 'resourceRequires', 'placement', 'tone']);
    if (!pluginIdentifier(r.id) || ids.has(r.id)) throw new PluginInputError('插件提示 ID 无效或重复');
    ids.add(r.id);
    return { id: r.id, text: text(r.text, Infinity), requires: parsePluginFlags(r.requires),
      resourceRequires: parseResourceRequires(r.resourceRequires, resources), ...parseDisplayLocation(r) };
  });
}
