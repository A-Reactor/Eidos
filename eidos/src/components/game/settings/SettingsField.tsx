import type { ReactNode } from 'react';

export function SettingsField({ id, label, hint, children }: { id?: string; label: string; hint?: string; children: ReactNode }) {
  return <div className="eidos-settings-row">
    <div className="eidos-settings-label">{id ? <label htmlFor={id}>{label}</label> : <span>{label}</span>}{hint && <p>{hint}</p>}</div>
    <div className="eidos-settings-input">{children}</div>
  </div>;
}

export function SettingsToggle({ id, label, hint, checked, onChange }: { id: string; label: string; hint?: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return <div className="eidos-settings-row">
    <div className="eidos-settings-label"><label htmlFor={id}>{label}</label>{hint && <p id={`${id}-hint`}>{hint}</p>}</div>
    <input id={id} type="checkbox" checked={checked} aria-describedby={hint ? `${id}-hint` : undefined} onChange={event => onChange(event.target.checked)} />
  </div>;
}
