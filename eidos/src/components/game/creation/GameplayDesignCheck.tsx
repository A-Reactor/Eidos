"use client";
import { useInterfaceText } from "@/components/shell/useInterfaceText";


import { useEffect, useRef, useState } from 'react';
import type { GameplayPlugin } from '@/lib/game/plugins/types';
import { parseUzqGameplayReview, type GameplayDesignReview } from '@/lib/ai/uzq-gameplay';
import { loadSettings } from '@/lib/game/settings';
import { useGameStore } from '@/store/game-store';

export function GameplayDesignCheck({ plugins, disabled }: { plugins: GameplayPlugin[]; disabled: boolean }) {
  const ui = useInterfaceText();
  const [review, setReview] = useState<GameplayDesignReview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const active = useRef<AbortController | null>(null);
  useEffect(() => () => { active.current?.abort(); active.current = null; }, []);

  const stop = () => { active.current?.abort(); active.current = null; setChecking(false); };
  const check = async () => {
    if (disabled || active.current) return;
    const controller = new AbortController(); active.current = controller;
    setChecking(true); setReview(null); setError(null);
    try {
      const response = await fetch('/api/world/plugins/review', { method: 'POST', signal: controller.signal,
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ gameplayPlugins: plugins, _settings: loadSettings() }) });
      const data = await response.json();
      // A stale result may still have incurred a real charge; account before discarding its advice.
      if (data.usage) useGameStore.getState().addTokenUsage(data.usage, null);
      if (active.current !== controller || controller.signal.aborted) return;
      if (!response.ok || data.error) throw new Error(data.error || '玩法检查失败');
      setReview(parseUzqGameplayReview(data.review, plugins));
    } catch (err) {
      if (active.current === controller && !controller.signal.aborted) setError(err instanceof Error ? err.message : '玩法检查失败');
    } finally {
      if (active.current === controller) { active.current = null; setChecking(false); }
    }
  };
  return <section aria-label={ui("玩法设计检查")} className="space-y-2 border border-[color:var(--eidos-archive-line)] p-3 text-xs text-[color:var(--eidos-archive-muted)]">
    <div className="flex items-center gap-3">
      <button type="button" disabled={disabled || checking} onClick={() => void check()} className="cursor-pointer border border-[color:var(--eidos-archive-line)] px-3 py-1.5 disabled:opacity-50">{ui("检查玩法设计")}</button>
      {checking && <button type="button" onClick={stop} className="cursor-pointer text-[color:var(--eidos-archive-ink)]">{ui("停止检查")}</button>}
      {checking && <span role="status">{ui("UZQ 正在分析…")}</span>}
    </div>
    <p>{ui("由 UZQ 检查所选自定义玩法，提供设计建议。按需调用模型并记录用量；不影响继续创建。")}</p>
    {error && <p role="alert" className="text-[color:var(--eidos-accent)]">{error}</p>}
    {review && <div className="space-y-2">
      <p className="text-[color:var(--eidos-archive-ink)]">{review.summary}</p>
      {review.findings.map((finding, index) => <div key={index} className="border-l-2 border-violet-500/40 pl-3">
        <p className="text-[color:var(--eidos-archive-muted)]">{plugins.find(p => p.id === finding.pluginId)?.name}{finding.ruleId ? ` · ${plugins.find(p => p.id === finding.pluginId)?.rules.find(r => r.id === finding.ruleId)?.description}` : ''}</p>
        <p className={finding.severity === 'warning' ? 'text-amber-300' : 'text-[color:var(--eidos-archive-ink)]'}>{finding.message}</p>
        <p>{finding.suggestion}</p>
      </div>)}
    </div>}
  </section>;
}
