import { isRecord } from './types';

const forbidden = new Set(['__proto__', 'prototype', 'constructor']);
export function variablePath(path: string): string[] {
  if (!path || path.length > 500) throw new Error('卡片变量路径无效');
  const parts: string[] = [];
  const pattern = /(?:^|\.)([^.\[\]]+)|\[(\d+|"[^"\\]*"|'[^'\\]*')\]/gy;
  let offset = 0;
  while (offset < path.length) {
    pattern.lastIndex = offset;
    const match = pattern.exec(path);
    if (!match) throw new Error('卡片变量路径无效');
    const part = match[1] ?? match[2].replace(/^['"]|['"]$/g, '');
    if (forbidden.has(part) || !part) throw new Error('卡片变量路径禁止访问原型');
    parts.push(part); offset = pattern.lastIndex;
  }
  if (parts.length > 32) throw new Error('卡片变量路径深度超限');
  return parts;
}
export function readVariable(root: unknown, path: string): unknown {
  return readVariableParts(root, variablePath(path));
}
export function readVariableParts(root: unknown, parts: string[]): unknown {
  let value = root;
  for (const key of parts) {
    if ((!isRecord(value) && !Array.isArray(value)) || !Object.hasOwn(value, key)) return undefined;
    value = (value as Record<string, unknown>)[key];
  }
  return value;
}
export function variableRootPath(path: string) {
  const parts = variablePath(path);
  return parts[0] === 'stat_data' ? parts.slice(1) : parts;
}
