import type { ButtonHTMLAttributes } from 'react';
import { ActionIcon, type ActionIconName } from './ActionIcon';

export function ActionButton({ icon, label, text = label, iconOnly = true, variant = 'quiet', className = '', type = 'button', ...props }: Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
  icon: ActionIconName; label: string; text?: string; iconOnly?: boolean; variant?: 'quiet' | 'primary';
}) {
  return <button {...props} type={type} aria-label={label} title={props.title ?? label} data-variant={variant}
    className={`eidos-focus eidos-archive-button eidos-action-button${iconOnly ? ' is-icon-only' : ''} ${className}`}>
    <ActionIcon name={icon} /><span className={iconOnly ? 'sr-only' : undefined}>{text}</span>
  </button>;
}
