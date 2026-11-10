import { useId } from 'react';

export function FieldPin({ label, pinned, disabled, onChange }: {
  label: string; pinned: boolean; disabled: boolean; onChange: (pinned: boolean) => void;
}) {
  const tooltipId = useId();
  const state = pinned ? '保留填写内容' : 'AI 重新整理';
  return <span className="group relative inline-flex shrink-0 align-middle">
    <button type="button" aria-label={`${label}：${state}`} aria-pressed={pinned} aria-describedby={tooltipId} disabled={disabled}
      className={`eidos-focus grid size-8 place-items-center rounded-md cursor-pointer hover:bg-[color:var(--eidos-quiet-hover)] disabled:cursor-default disabled:opacity-40 ${pinned ? 'text-[color:var(--eidos-accent)]' : 'text-[color:var(--eidos-archive-muted)]'}`}
      onClick={() => onChange(!pinned)}>
      <svg aria-hidden="true" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="m16 3 5 5-4 1-3 4v4l-3-3-6 6m1-10h4l4-3 1-4M6 10l8 8" />
        {!pinned && <path d="m3 3 18 18" />}
      </svg>
    </button>
    <span id={tooltipId} role="tooltip" className="pointer-events-none invisible absolute left-0 top-full z-20 mt-1 w-56 rounded-md border border-[color:var(--eidos-archive-line)] bg-[color:var(--eidos-archive-bg)] px-3 py-2 text-xs leading-6 text-[color:var(--eidos-archive-ink)] shadow-lg opacity-0 transition-opacity group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100">
      <strong className="block font-medium">{state}</strong>
      {pinned ? 'AI 将保留此项设定。点击取消固定。' : '允许 AI 调整、补全此项内容。点击固定设定。'}
    </span>
  </span>;
}
