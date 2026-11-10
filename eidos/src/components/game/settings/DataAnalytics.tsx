'use client';

import { useEffect, useMemo, type ReactNode } from 'react';
import { useI18n } from '@/components/shell/LocaleProvider';
import { useGameStore } from '@/store/game-store';
import { buildCallTimeline, createModelAnalytics, summarizeModelAnalytics } from '@/lib/game/model-analytics';
import { CallActivityChart } from './CallActivityChart';
import styles from './DataAnalytics.module.css';

const percent = (value: number | undefined) => value === undefined ? '—' : `${Number((value * 100).toFixed(1))}%`;
const EMPTY_ANALYTICS = createModelAnalytics();

function Metric({ label, value, children }: { label: string; value: string; children?: ReactNode }) {
  return <div className={styles.metric} aria-label={label}><dt>{label}</dt><dd>{value}{children && <small>{children}</small>}</dd></div>;
}

function Rate({ label, rate, children }: { label: string; rate: number | undefined; children: ReactNode }) {
  return <div className={styles.rate}>
    <div className={styles.rowHeading}><span>{label}</span><strong>{percent(rate)}</strong></div>
    <div className={styles.track} role={rate === undefined ? undefined : 'meter'} aria-label={label}
      aria-valuemin={rate === undefined ? undefined : 0} aria-valuemax={rate === undefined ? undefined : 100}
      aria-valuenow={rate === undefined ? undefined : Number((rate * 100).toFixed(1))}>
      <span style={{ width: `${(rate ?? 0) * 100}%` }} />
    </div>
    <p>{children}</p>
  </div>;
}

export function DataAnalytics() {
  const english = useI18n().locale === 'en';
  const text = (zh: string, en: string) => english ? en : zh;
  const stored = useGameStore(state => state.modelAnalytics);
  const hydrate = useGameStore(state => state.hydrateModelAnalytics);
  const world = useGameStore(state => state.currentWorld && (state.phase === 'playing' || state.navigationStack.includes('playing')) ? state.currentWorld : null);
  useEffect(() => { hydrate(); }, [hydrate]);
  const analytics = world ? (stored && Object.hasOwn(stored.worlds, world.id) ? stored.worlds[world.id] : EMPTY_ANALYTICS) : stored?.total ?? EMPTY_ANALYTICS;
  const stats = useMemo(() => summarizeModelAnalytics(analytics), [analytics]);
  const timeline = useMemo(() => buildCallTimeline(analytics), [analytics]);
  const hits = analytics.speculationHits, misses = analytics.speculationMisses;
  const number = (value: number) => value.toLocaleString(english ? 'en-US' : 'zh-CN');
  const { cache } = stats;
  return <section className={styles.analytics} aria-label={text('运行统计', 'Runtime analytics')}>
    <header className={styles.heading}>
      <h3>{text('运行统计', 'Runtime analytics')}</h3>
      <span className={styles.scope} title={world?.name}>{world ? text('当前世界', 'This world') : text('总计', 'All worlds')}</span>
    </header>
    <dl className={styles.metrics}>
      <Metric label={text('模型调用', 'Model calls')} value={number(stats.totalCalls)}>{number(stats.successfulCalls)} {text('次成功', 'successful')} · {number(stats.totalCalls - stats.successfulCalls)} {text('次失败', 'failed')}</Metric>
      <Metric label={text('Token 用量', 'Token usage')} value={number(stats.totalTokens)}>{text('输入', 'In')} {number(stats.promptTokens)} · {text('输出', 'Out')} {number(stats.completionTokens)}</Metric>
      <Metric label={text('调用成功率', 'Success rate')} value={percent(stats.successRate)} />
      <Metric label={text('平均耗时', 'Average latency')} value={stats.averageElapsedMs === undefined ? '—' : `${(stats.averageElapsedMs / 1000).toFixed(1)} s`} />
    </dl>
    <CallActivityChart timeline={timeline} english={english} />
    <div className={styles.breakdown}>
      <section className={styles.models} aria-label={text('模型调用分布', 'Calls by model')}>
        <header className={styles.chartHeading}><h4>{text('模型调用分布', 'Calls by model')}</h4><span>{text('次数 / Token', 'Calls / tokens')}</span></header>
        {stats.models.map(row => <div className={styles.model} key={row.model}>
          <div className={styles.rowHeading}><span>{row.model.toUpperCase()}</span><span>{number(row.calls)} {text('次', 'calls')}<small> / {number(row.tokens)}</small></span></div>
          <div className={styles.track} data-model={row.model} role="meter" aria-label={`${row.model.toUpperCase()} ${text('调用占比', 'call share')}`}
            aria-valuemin={0} aria-valuemax={100} aria-valuenow={stats.totalCalls ? Number((row.calls / stats.totalCalls * 100).toFixed(1)) : 0}>
            <span style={{ width: `${stats.totalCalls ? row.calls / stats.totalCalls * 100 : 0}%` }} />
          </div>
        </div>)}
      </section>
      <section className={styles.rates} aria-label={text('命中表现', 'Hit rates')}>
        <header className={styles.chartHeading}><h4>{text('命中表现', 'Hit rates')}</h4></header>
        <Rate label={text('缓存命中率', 'Cache hit rate')} rate={cache.hitRate}>
          {cache.hitRate === undefined ? text('暂无缓存数据', 'No cache data') : `${number(cache.cachedTokens)} / ${number(cache.promptTokens)} ${text('输入 Token', 'input tokens')}`}
        </Rate>
        <Rate label={text('预生成命中率', 'Pregeneration hit rate')} rate={hits + misses ? hits / (hits + misses) : undefined}>
          {hits + misses ? `${number(hits)} ${text('次命中', 'hits')} · ${number(misses)} ${text('次未命中', 'misses')}` : text('暂无预生成记录', 'No pregeneration data')}
        </Rate>
      </section>
    </div>
    <details className={styles.note}><summary>{text('统计说明', 'About these metrics')}</summary><p>{text('缓存命中率按接口上报的输入 Token 计算，未上报及估算用量不计入。', 'Cache hit rate uses reported input tokens; unknown and estimated usage is excluded.')} {cache.reportedCalls}/{stats.totalCalls} {text('次调用已上报缓存数据。', 'calls reported cache data.')}{cache.estimatedCalls > 0 && ` ${cache.estimatedCalls} ${text('次用量为估算。', 'usages estimated.')}`}</p></details>
  </section>;
}
