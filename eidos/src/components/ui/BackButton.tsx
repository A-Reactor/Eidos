'use client';
import { ActionIcon } from './ActionIcon';
import { useContext } from 'react';
import { ArchiveBackContext } from './archive-back-context';
import { useI18n } from '@/components/shell/LocaleProvider';

export function BackButton({ onClick, label, className = '', header = false }: { onClick: () => void; label?: string; className?: string; header?: boolean }) {
  const { locale } = useI18n();
  const managed = useContext(ArchiveBackContext);
  if (managed && !header) return null;
  const name = label ?? (locale === 'en' ? 'Back' : '返回');
  return <button type="button" onClick={onClick} aria-label={name} title={name} className={`eidos-focus eidos-back-button ${className}`}>
    <ActionIcon name="back" />
  </button>;
}
