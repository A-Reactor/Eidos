'use client';
import { useInterfaceText } from "@/components/shell/useInterfaceText";


import type { buildCallTimeline } from '@/lib/game/model-analytics';
import styles from './DataAnalytics.module.css';

type Timeline = ReturnType<typeof buildCallTimeline>;

export function CallActivityChart({ timeline, english }: { timeline: Timeline; english: boolean }) {
  const ui = useInterfaceText();
  const { buckets } = timeline;
  const max = Math.max(2, Math.ceil(Math.max(...buckets.map(bucket => bucket.calls)) / 2) * 2);
  const hasCalls = buckets.some(bucket => bucket.calls > 0);
  const formatDay = (timestamp: number) => new Intl.DateTimeFormat(english ? 'en-GB' : 'zh-CN', {
    month: '2-digit', day: '2-digit',
  }).format(timestamp);
  const count = (value: number) => english ? `${value} calls` : ui("{0} 次调用", {"0": value});
  return <section className={styles.activity} aria-label={english ? 'Call activity' : ui("调用趋势")}>
    <header className={styles.chartHeading}>
      <h4>{english ? 'Call activity' : ui("调用趋势")}</h4>
      <span>{english ? 'Last 7 days' : ui("近 7 天")}</span>
    </header>
    {!hasCalls ? <div className={styles.empty}>
      <svg viewBox="0 0 40 32" fill="none" stroke="currentColor" aria-hidden="true"><path d="M4 27h32M10 22v-7m10 7V5m10 17V11" strokeWidth="2" /></svg>
      <p>{english ? 'No calls recorded yet' : ui("暂无调用记录")}</p>
    </div> : <>
      <div className={styles.plot}>
        <div className={styles.axis} aria-hidden="true"><span>{max}</span><span>{max / 2}</span><span>0</span></div>
        <ol className={styles.columns} aria-label={english ? 'Daily calls' : ui("每日调用")}>
          {buckets.map(bucket => <li key={bucket.timestamp} className={styles.column}
            aria-label={`${formatDay(bucket.timestamp)} · ${count(bucket.calls)} · ${bucket.failures} ${english ? 'failed' : ui("次失败")}`}
            title={`${formatDay(bucket.timestamp)} · ${count(bucket.calls)} · ${bucket.failures} ${english ? 'failed' : ui("次失败")}`}>
            <span className={styles.columnFill} style={{ height: `${bucket.calls / max * 100}%` }}>
              <span className={styles.columnValue}>{bucket.calls}</span>
              {bucket.failures > 0 && <i style={{ height: `${bucket.failures / bucket.calls * 100}%` }} />}
            </span>
          </li>)}
        </ol>
      </div>
      <div className={styles.timeLabels} aria-hidden="true">{buckets.map(bucket => <span key={bucket.timestamp}>{formatDay(bucket.timestamp)}</span>)}</div>
    </>}
  </section>;
}
