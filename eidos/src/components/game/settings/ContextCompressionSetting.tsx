'use client';
import { useSyncExternalStore } from 'react';
import { useGameStore } from '@/store/game-store';
import type { GameSettings } from '@/lib/game/types';
import { getActionDiagnostics, subscribeActionDiagnostics, selectActionDiagnostics, type ActionDiagnostic } from '@/lib/game/action-diagnostics';
import { contextCompressionPolicy } from '@/lib/ai/action-context-diagnostics';
import { selectContextHistory, historySummary } from '@/lib/ai/history-context';
import { estimateTextTokens } from '@/lib/ai/prompt-budget';
import { aliceUserInstructions } from '@/lib/ai/user-instructions';
import { useI18n } from '@/components/shell/LocaleProvider';
const empty: ActionDiagnostic[] = [];

export function ContextCompressionSetting({ settings, onChange }: { settings: GameSettings; onChange: (patch: Partial<GameSettings>) => void }) {
  const state = useGameStore(), { locale } = useI18n();
  const text = (zh: string, en: string) => locale === 'en' ? en : zh;
  const all = useSyncExternalStore(subscribeActionDiagnostics, getActionDiagnostics, () => empty);
  const latest = selectActionDiagnostics(all, state).find(record => record.status === 'accepted' && record.context?.budget)?.context?.budget;
  const oldHistory = latest?.sections.filter(s => s.id === 'history').reduce((n, s) => n + s.estimatedTokens, 0) ?? 0;
  const oldPreferences = latest?.sections.find(s => s.id === 'preferences')?.estimatedTokens ?? 0;
  const baseTokens = Math.max(0, (latest?.inputTokensEstimated ?? 0) - oldHistory - oldPreferences) + estimateTextTokens(aliceUserInstructions({ ...settings }));
  const policy = contextCompressionPolicy({ ...settings }, baseTokens, latest?.minimumOutputTokens ?? 8000);
  const preview = selectContextHistory(state.history, policy);
  const total = baseTokens + estimateTextTokens(historySummary(preview.history)) + policy.outputTokens;
  const capacity = policy.windowTokens;
  const lower = settings.contextCompressionLowerPercent, upper = settings.contextCompressionUpperPercent;
  const format = (n: number) => n.toLocaleString(locale);
  return <section className="eidos-context-setting" aria-label={text('上下文压缩', 'Context compression')}>
    <div className="eidos-context-heading"><h3>{text('上下文压缩', 'Context compression')}</h3><span>{capacity ? `${format(capacity)} token` : text('模型容量未识别', 'Unknown model capacity')}</span></div>
    <p>{text('达到上限时，用摘要替换较早正文，尽量降至下限。原文可回看。', 'At the upper limit, summarize older text toward the lower target. Originals remain readable.')}</p>
    <div className="eidos-context-scale">
      <div className="eidos-context-capacity" role="progressbar" aria-label={text('模型总容量', 'Model context capacity')} aria-valuemin={0} aria-valuemax={capacity ?? 100} aria-valuenow={capacity ? Math.min(total, capacity) : undefined} aria-valuetext={capacity ? text(`预计 ${format(total)} / ${format(capacity)} token，含正文生成预留`, `Estimated ${format(total)} / ${format(capacity)} tokens, including output reserve`) : text('容量未知', 'Unknown capacity')}><span style={{ width: capacity ? `${Math.min(100, total / capacity * 100)}%` : '0%' }} /></div>
      {([{ id: 'lower', value: lower }, { id: 'upper', value: upper }] as const).map(marker => <div className={`eidos-context-marker eidos-context-marker--${marker.id}`} key={marker.id}>
        <input id={`settings-compression-${marker.id}`} aria-label={marker.id === 'lower' ? text('压缩目标下限', 'Compression target lower limit') : text('压缩触发上限', 'Compression trigger upper limit')} type="range" min={marker.id === 'lower' ? 0 : 1} max={100} step={1} value={marker.value} onChange={event => {
          const value = Number(event.target.value);
          onChange(marker.id === 'lower' ? { contextCompressionLowerPercent: Math.min(value, upper) } : { contextCompressionUpperPercent: value, contextCompressionLowerPercent: Math.min(lower, value) });
        }} />
      </div>)}
    </div>
    <p className="eidos-context-limits">{capacity ? text(`下限 ${format(Math.floor(capacity * lower / 100))} token（${lower}%） / 上限 ${format(Math.floor(capacity * upper / 100))} token（${upper}%） · 正文预留 ${format(policy.outputTokens)}`, `Lower ${format(Math.floor(capacity * lower / 100))} tokens (${lower}%) / upper ${format(Math.floor(capacity * upper / 100))} tokens (${upper}%) · output reserve ${format(policy.outputTokens)}`) : text('请在「AI 接入 → 上下文窗口覆盖」填写模型容量。', 'Set model capacity under AI Access → Context window override.')}</p>
    <p className="eidos-context-counts" aria-live="polite">{text(`已压缩节点 ${preview.compressed} / 完整节点 ${preview.full}`, `Compressed nodes ${preview.compressed} / complete nodes ${preview.full}`)}{preview.omitted > 0 && text(` · 略过 ${preview.omitted} 个旧节点`, ` · ${preview.omitted} older nodes omitted`)}</p>
    <p className="eidos-context-hint">{text('Token 用量为估算值。', 'Token counts are estimates.')}</p>
  </section>;
}
