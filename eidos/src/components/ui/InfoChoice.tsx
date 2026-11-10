import type { ReactNode } from 'react';

/** Selection and explanation have separate targets, matching the plugin picker. */
export function InfoChoice({ label, accessibleLabel = label, active, disabled, infoDisabled = disabled, infoLabel, onInfo, onSelect, children, trailing, showIndicator = true }: {
  label: string; accessibleLabel?: string; active: boolean; disabled?: boolean; infoLabel: string;
  infoDisabled?: boolean; onInfo: () => void; onSelect: () => void; children?: ReactNode; trailing?: ReactNode; showIndicator?: boolean;
}) {
  return <div className="eidos-plugin-choice-group relative min-w-0">
    <button type="button" disabled={infoDisabled} aria-label={infoLabel} aria-haspopup="dialog" title={infoLabel}
      className="eidos-focus absolute left-1 top-1/2 z-10 grid size-8 -translate-y-1/2 place-items-center cursor-pointer opacity-65 hover:opacity-100 disabled:cursor-default disabled:opacity-40"
      onClick={onInfo}>
      <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
        <circle cx="12" cy="12" r="9" /><path d="M12 11v6M12 7h.01" />
      </svg>
    </button>
    <button type="button" aria-label={accessibleLabel} aria-pressed={active} disabled={disabled} onClick={onSelect}
      className="eidos-focus eidos-world-create__choice eidos-plugin-choice w-full min-w-0 text-left pl-11 pr-3 py-3 border text-xs transition-colors disabled:cursor-default disabled:opacity-40">
      <span className="flex justify-between gap-2"><span className="font-medium">{label}</span>{showIndicator && <span aria-hidden="true">{active ? '✓' : '+'}</span>}</span>
      {children && <span className="mt-1 block text-xs leading-relaxed text-[color:var(--eidos-archive-muted)]">{children}</span>}
    </button>
    {trailing}
  </div>;
}
