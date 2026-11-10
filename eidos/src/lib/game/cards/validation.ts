import { isRecord, cardContextText, type CardActionContext, type CardBinding } from './types';

export function validateCardBindings(value: unknown): asserts value is CardBinding[] | undefined {
  if (value === undefined) return;
  if (!Array.isArray(value) || value.length > 16) throw new Error('卡片绑定须为最多 16 项的列表');
  for (const binding of value) {
    if (!isRecord(binding) || typeof binding.assetId !== 'string' || !/^[a-f0-9]{64}$/.test(binding.assetId)
      || !['world', 'character', 'persona'].includes(String(binding.role)) || typeof binding.enabled !== 'boolean'
      || typeof binding.name !== 'string' || !binding.name.trim() || binding.name.length > 200) throw new Error('卡片绑定无效');
    if (binding.aliases !== undefined && (!Array.isArray(binding.aliases) || binding.aliases.length > 30 || binding.aliases.some(a => typeof a !== 'string' || a.length > 200))) throw new Error('卡片别名无效');
  }
}
export function validateCardContext(value: unknown, bindings: unknown, maxChars = 24_000): void {
  validateCardBindings(bindings);
  if (value === undefined) return;
  if (!isRecord(value) || typeof value.stablePrefix !== 'string' || typeof value.dynamicSuffix !== 'string'
    || !Array.isArray(value.selected) || !Array.isArray(value.omitted)) throw new Error('卡片上下文无效');
  for (const field of ['behaviorPrefix', 'behaviorSuffix', 'examples']) if (value[field] !== undefined && typeof value[field] !== 'string') throw new Error('卡片行为上下文无效');
  const body = cardContextText(value as unknown as CardActionContext);
  if (!Number.isFinite(maxChars) || maxChars < 1 || maxChars > 100_000 || Array.from(body).length > maxChars) throw new Error('卡片上下文超过预算');
  const allowed = new Set((bindings ?? []).filter(b => b.enabled).map(b => b.assetId));
  for (const list of [value.selected, value.omitted]) {
    if (list.length > 32_000) throw new Error('卡片追踪信息过多');
    for (const item of list) {
      if (!isRecord(item) || !allowed.has(String(item.assetId))) throw new Error('卡片上下文引用未绑定资源');
      if (typeof item.pointer !== 'string' || item.pointer !== '' && !item.pointer.startsWith('/') || item.pointer.length > 1000
        || typeof item.reason !== 'string' || item.reason.length > 300 || typeof item.chars !== 'number' || !Number.isFinite(item.chars) || item.chars < 0) throw new Error('卡片追踪信息无效');
    }
  }
  if (body && !value.selected.length) throw new Error('卡片上下文缺少原文来源');
}
