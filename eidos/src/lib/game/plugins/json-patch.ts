import type { GameplayPatch } from './types';
import { validateGameModeConfig } from './manifest';
import { allowedFields, PluginInputError, record, text } from './validation';
import { stableRecordJSON } from '@/lib/ai/prompt-layout';

function pathParts(path: string): string[] {
  if (!path.startsWith('/') || /~(?![01])/u.test(path)) throw new PluginInputError('玩法更新路径无效');
  const parts = path.slice(1).split('/').map(p => p.replaceAll('~1', '/').replaceAll('~0', '~'));
  if (parts.length > 32 || parts.some(p => ['__proto__', 'constructor', 'prototype'].includes(p)) || parts[0].startsWith('_eidos')) throw new PluginInputError('玩法更新不能写入宿主保留状态');
  return parts;
}
export function parseGameplayPatches(value: unknown): GameplayPatch[] {
  if (!Array.isArray(value) || value.length > 128) throw new PluginInputError('玩法更新须为最多 128 项的列表');
  return value.map(raw => {
    const p = record(raw); allowedFields(p, ['op', 'path', 'value', 'from']);
    if (typeof p.op !== 'string' || !['add', 'replace', 'remove', 'test', 'copy', 'move'].includes(p.op)) throw new PluginInputError('玩法更新操作无效');
    text(p.path, 2000); const path = p.path as string; pathParts(path);
    if (p.op === 'copy' || p.op === 'move') { text(p.from, 2000); pathParts(p.from as string); return { op: p.op, from: p.from as string, path }; }
    if (p.op === 'remove') return { op: 'remove', path };
    if (!Object.hasOwn(p, 'value')) throw new PluginInputError('玩法更新缺少值');
    validateGameModeConfig({ value: p.value });
    return { op: p.op as 'add' | 'replace' | 'test', path, value: structuredClone(p.value) };
  });
}
export function applyGameplayPatches(target: Record<string, unknown>, changes: GameplayPatch[] = [], maxChars = Infinity): Record<string, unknown> {
  let next = structuredClone(target);
  for (const change of changes) {
    if (change.op === 'copy' || change.op === 'move') {
      const from = pathParts(change.from), to = pathParts(change.path);
      let value: unknown = next;
      for (const part of from) {
        if (!value || typeof value !== 'object' || Array.isArray(value) && !/^(0|[1-9]\d*)$/.test(part) || !Object.hasOwn(value, part)) throw new PluginInputError('玩法更新来源不存在');
        value = (value as Record<string, unknown>)[part];
      }
      if (change.op === 'move' && from.every((p, i) => p === to[i])) {
        if (from.length === to.length) continue;
        if (to.length > from.length) throw new PluginInputError('不能把对象移动到其内部');
      }
      const copied = structuredClone(value);
      if (change.op === 'move') next = applyGameplayPatches(next, [{ op: 'remove', path: change.from }], maxChars);
      next = applyGameplayPatches(next, [{ op: 'add', path: change.path, value: copied }], maxChars);
      continue;
    }
    const parts = pathParts(change.path), key = parts.pop()!;
    let parent: Record<string, unknown> | unknown[] = next;
    for (const part of parts) {
      if (Array.isArray(parent) && !/^(0|[1-9]\d*)$/.test(part)) throw new PluginInputError('玩法更新数组位置无效');
      const child: unknown = Array.isArray(parent) ? parent[Number(part)] : parent[part];
      if (!child || typeof child !== 'object') throw new PluginInputError('玩法更新路径不存在');
      parent = child as typeof parent;
    }
    const index = Array.isArray(parent) ? key === '-' && change.op === 'add' ? parent.length : /^(0|[1-9]\d*)$/.test(key) ? Number(key) : NaN : key;
    const exists = Array.isArray(parent) ? Number.isSafeInteger(index) && Number(index) < parent.length : Object.hasOwn(parent, key);
    if (Array.isArray(parent) && (!Number.isSafeInteger(index) || Number(index) < 0 || Number(index) > parent.length)) throw new PluginInputError('玩法更新数组位置无效');
    if (change.op !== 'add' && !exists) throw new PluginInputError('玩法更新路径不存在');
    const current = Array.isArray(parent) ? parent[Number(index)] : parent[key];
    if (change.op === 'test') {
      if (stableRecordJSON({ value: current }) !== stableRecordJSON({ value: change.value })) throw new PluginInputError('玩法更新条件不成立');
    } else if (Array.isArray(parent)) {
      if (change.op === 'add') parent.splice(Number(index), 0, structuredClone(change.value));
      else if (change.op === 'remove') parent.splice(Number(index), 1);
      else parent[Number(index)] = structuredClone(change.value);
    } else if (change.op === 'remove') delete parent[key];
    else parent[key] = structuredClone(change.value);
  }
  validateGameModeConfig(next, maxChars);
  return next;
}
