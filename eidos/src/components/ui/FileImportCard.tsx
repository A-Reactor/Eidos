'use client';

import type { ComponentProps } from 'react';
import { FileImportZone } from './FileImportZone';

type Props = Omit<ComponentProps<typeof FileImportZone>, 'children'> & {
  heading: string;
  description?: string;
  hint?: string;
  compact?: boolean;
};

/** Keep the creation flow's import surface while sharing the same picker, drop and busy handling. */
export function FileImportCard({ heading, description, hint, compact = false, className = '', ...props }: Props) {
  return <FileImportZone {...props} className={`eidos-import-card${compact ? ' is-compact' : ''} ${className}`}>
    <span className="eidos-import-card-heading">{heading}</span>
    {description && <span className="eidos-import-card-description">{description}</span>}
    {hint && <span className="eidos-import-card-hint">{hint}</span>}
  </FileImportZone>;
}
