import type { SourceReconstructionArchive } from './types';
import { resolveEffectiveFacts } from './adaptation';
import { estimateTextTokens } from '@/lib/ai/prompt-budget';

export function sourceRuntimeContext(source: SourceReconstructionArchive, names: string[] = []): string {
  // Only the merged dossier is authoritative. Leaves remain available for explicit source lookups,
  // but cannot be promoted back into canon after a later chapter or player edit supersedes them.
  const all = new Map(source.dossier.claims.map(f => [f.id, f]));
  const entities = source.dossier.entities.filter(e => names.some(n => n === e.name || e.aliases.includes(n) || source.entityMap[e.id] === n)).map(e => e.id);
  const facts = resolveEffectiveFacts({ brief: source.brief, dossier: { ...source.dossier, claims: [...all.values()] } });
  const required = new Set(Object.values(source.brief.fields).filter(f => f.required).flatMap(f => f.factRefs));
  const rank = (f: typeof facts.current[number]) => required.has(f.id) ? 2 : f.entities.some(id => entities.includes(id)) ? 1 : 0;
  const candidates = [...facts.current, ...facts.history, ...facts.uncertain].sort((a, b) => rank(b) - rank(a));
  const mandatory = candidates.filter(f => required.has(f.id) || f.entities.some(id => entities.includes(id)));
  if (estimateTextTokens(JSON.stringify(mandatory)) > 2000) throw new Error('当前场景的必要原文事实超过上下文预算，请缩小本次世界范围');
  let tokens = 0;
  const selected = candidates.filter(fact => { const n = estimateTextTokens(JSON.stringify(fact)); if (tokens + n > 2000) return false; tokens += n; return true; });
  return `## 文本世界与本次游玩\n已接受的行动结果、当前世界状态和玩家改编优先。原文未来只是条件性参考，偏离原作不构成错误，不得将剧情强行拉回原作。\n以下为开局资料数据，并非本轮新事实。角色只能使用 knownBy / 开场知识允许的信息以及游玩中实际获知的信息，旁白不能泄露秘密；原文推断保持不确定。\n${JSON.stringify({ start: source.brief.startAnchor, overrides: source.brief.overrides, facts: selected, omittedFactCount: candidates.length - selected.length })}`;
}

export function sourceDriftRules(source: SourceReconstructionArchive): string {
  return `\n## 文本世界审查\n只检查无因果依据的原文事实篡改、把推断说成事实、角色越权获知秘密，以及遗漏玩家明确改编。已接受的当前分支行动结果优先；不得因玩家改变未来或得到不同结局而报原作漂移。未知可以通过有依据的游玩发现逐步确定。原作未来不得自动升级为已发生历史。\n本次改编条件：${JSON.stringify(source.brief.overrides)}\n${sourceRuntimeContext(source)}`;
}
