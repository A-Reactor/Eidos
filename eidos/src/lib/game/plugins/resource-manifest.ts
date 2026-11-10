import type { GameplayResource, GameplayResourceHud, ResourceBounds } from './types';
import { allowedFields, pluginIdentifier, PluginInputError, record, text } from './validation';
import { parseDisplayLocation } from './display-location';

export function resourceInteger(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || Math.abs(value) > 1_000_000) throw new PluginInputError('玩法资源须为 ±1000000 以内的整数');
  return value;
}
function parseHud(value: unknown, min: number, max: number): GameplayResourceHud {
  const hud = record(value);
  allowedFields(hud, ['style', 'placement', 'tone', 'warningBelow', 'warningAbove']);
  if (typeof hud.style !== 'string' || !['gauge', 'bar', 'counter'].includes(hud.style)) throw new PluginInputError('HUD 样式无效');
  const result: GameplayResourceHud = { style: hud.style as GameplayResourceHud['style'], ...parseDisplayLocation(hud) };
  for (const key of ['warningBelow', 'warningAbove'] as const) {
    if (hud[key] === undefined) continue;
    const threshold = resourceInteger(hud[key]);
    if (threshold < min || threshold > max) throw new PluginInputError('HUD 警戒值须在资源上下限内');
    result[key] = threshold;
  }
  if (result.warningBelow !== undefined && result.warningAbove !== undefined && result.warningBelow >= result.warningAbove) throw new PluginInputError('HUD 低值警戒须小于高值警戒');
  return result;
}
export function parseResources(value: unknown): Record<string, GameplayResource> {
  const entries = Object.entries(record(value));
  if (entries.length > 32) throw new PluginInputError('每个插件最多声明 32 个资源');
  return Object.fromEntries(entries.map(([id, raw]) => {
    if (!pluginIdentifier(id)) throw new PluginInputError('资源 ID 无效');
    const r = record(raw);
    allowedFields(r, ['name', 'initial', 'min', 'max', 'unit', 'visible', 'hud']);
    const initial = resourceInteger(r.initial), min = resourceInteger(r.min), max = resourceInteger(r.max);
    if (min > initial || initial > max) throw new PluginInputError('资源初值须在上下限之间');
    if (r.visible !== undefined && typeof r.visible !== 'boolean') throw new PluginInputError('visible 须为布尔值');
    return [id, { name: text(r.name, Infinity), initial, min, max, unit: r.unit === undefined ? '' : text(r.unit, Infinity, false), visible: r.visible !== false,
      ...(r.hud !== undefined ? { hud: parseHud(r.hud, min, max) } : {}) }];
  }));
}
function resourceEntries(value: unknown, resources: Record<string, GameplayResource>) {
  const entries = Object.entries(record(value ?? {}));
  if (entries.length > 32 || entries.some(([id]) => !Object.hasOwn(resources, id))) throw new PluginInputError('规则引用未声明的资源');
  return entries;
}
export function parseResourceChanges(value: unknown, resources: Record<string, GameplayResource>): Record<string, number> {
  return Object.fromEntries(resourceEntries(value, resources).map(([id, raw]) => {
    const delta = resourceInteger(raw);
    if (delta === 0) throw new PluginInputError('资源变化不能为 0');
    return [id, delta];
  }));
}
export function parseResourceRequires(value: unknown, resources: Record<string, GameplayResource>): Record<string, ResourceBounds> {
  return Object.fromEntries(resourceEntries(value, resources).map(([id, raw]) => {
    const r = record(raw);
    allowedFields(r, ['min', 'max']);
    const bounds: ResourceBounds = {};
    if (r.min !== undefined) bounds.min = resourceInteger(r.min);
    if (r.max !== undefined) bounds.max = resourceInteger(r.max);
    if (!Object.keys(bounds).length || (bounds.min ?? resources[id].min) > (bounds.max ?? resources[id].max)
      || (bounds.min ?? resources[id].min) > resources[id].max || (bounds.max ?? resources[id].max) < resources[id].min) throw new PluginInputError('资源前提区间无效或不可满足');
    return [id, bounds];
  }));
}
