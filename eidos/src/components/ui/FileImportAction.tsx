'use client';
import { ActionIcon } from './ActionIcon';
import { FileImportZone } from './FileImportZone';

export function FileImportAction({ onFiles, disabled, accept, label, inputLabel, multiple = true }: {
  onFiles(files: File[]): Promise<void>; disabled?: boolean; accept: string; label: string; inputLabel: string; multiple?: boolean;
}) {
  return <FileImportZone label={label} inputLabel={inputLabel} accept={accept} multiple={multiple} disabled={disabled} onFiles={onFiles}
    className="eidos-action-button is-icon-only eidos-file-import-action"><ActionIcon name="import" /><span className="sr-only">{label}</span></FileImportZone>;
}
