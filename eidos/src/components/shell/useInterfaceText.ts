"use client";

import { useCallback } from 'react';
import { useI18n } from './LocaleProvider';
import { translateInterface } from '@/lib/ui/i18n';

export function useInterfaceText() {
  const { locale } = useI18n();
  return useCallback((source: string | null | undefined, values?: Record<string, unknown>) => translateInterface(locale, source, values), [locale]);
}
