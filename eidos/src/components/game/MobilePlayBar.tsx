'use client';
import { useInterfaceText } from "@/components/shell/useInterfaceText";


/** The divider carries progress without adding another toolbar above the composer. */
export function MobilePlayBar({ index, count, showing, focused = true, busy = false, modActive, onSelect }: {
  index: number; count: number; showing: boolean; loading: boolean; busy?: boolean; modActive: boolean;
  focused?: boolean;
  onSelect: (index: number) => void;
}) {
  const ui = useInterfaceText();
  if (modActive || count < 1) return null;
  const current = showing ? Math.max(1, Math.min(index + 1, count)) : count;
  return <nav className="eidos-mobile-segment-divider" aria-label={ui("手机阅读操作")} title={ui("第 {0} 段，共 {1} 段", {"0": current, "1": count})}>
    <div className="eidos-mobile-segment-divider__track" aria-hidden="true" style={{ gridTemplateColumns: `repeat(${count}, minmax(0, 1fr))`, columnGap: count > 200 ? 0 : count > 48 ? 1 : 3 }}>
      {Array.from({ length: count }, (_, segment) => <span key={segment} data-read={segment < current} data-current={focused && showing && segment === current - 1} />)}
    </div>
    <input type="range" aria-label={ui("当前叙事段落")} aria-valuetext={ui("第 {0} 段，共 {1} 段", {"0": current, "1": count})} min={1} max={count} value={current} disabled={busy || count === 1}
      onChange={event => onSelect(Number(event.target.value) - 1)} />
  </nav>;
}
