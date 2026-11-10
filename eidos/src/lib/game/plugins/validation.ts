export class PluginInputError extends Error {}
const forbidden = new Set(['__proto__', 'constructor', 'prototype']);
export function pluginIdentifier(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z][a-z0-9_-]{0,63}$/.test(value) && !forbidden.has(value);
}
export function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new PluginInputError('插件字段须为对象');
  const result = value as Record<string, unknown>;
  if (Object.keys(result).some(key => forbidden.has(key))) throw new PluginInputError('插件包含不安全的字段');
  return result;
}
export function allowedFields(value: Record<string, unknown>, keys: string[]): void {
  if (Object.keys(value).some(key => !keys.includes(key))) throw new PluginInputError('插件包含未支持的字段');
}
export function text(value: unknown, limit: number, required = true): string {
  if (typeof value !== 'string' || value.length > limit || required && !value.trim()) throw new PluginInputError('插件文本缺失或超出长度限制');
  return value.trim();
}
export function parsePluginFlags(value: unknown): Record<string, boolean> {
  const entries = Object.entries(record(value ?? {}));
  if (entries.length > 32 || entries.some(([key, flag]) => !pluginIdentifier(key) || typeof flag !== 'boolean')) throw new PluginInputError('插件状态须为最多 32 个布尔标记');
  return Object.fromEntries(entries) as Record<string, boolean>;
}
