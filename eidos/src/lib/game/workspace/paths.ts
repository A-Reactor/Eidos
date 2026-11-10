import { text, PluginInputError } from '../plugins/validation';
import type { ResourceRef } from './types';

export function filePath(value: unknown): string {
  const path = text(value, 240);
  if (path.startsWith('/') || path.includes('\\') || path.includes(':') || path.includes('\0')
    || path.split('/').some(p => !p || p === '.' || p === '..' || ['__proto__', 'constructor', 'prototype'].includes(p))) {
    throw new PluginInputError('文件名须为工作区内的相对路径');
  }
  return path;
}
export function checkVersion(current: ResourceRef | undefined, expected: unknown, required = false): void {
  if (required && expected === undefined) throw new Error('写入必须指定 expectedVersion；新建使用 null');
  if (expected !== undefined && expected !== (current?.id ?? null)) throw new Error('文件版本已变化，请重新读取后再保存');
}
export function withinPath(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}/`);
}
