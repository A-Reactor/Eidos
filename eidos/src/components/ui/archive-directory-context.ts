'use client';
import { createContext } from 'react';

export const ArchiveDirectoryContext = createContext<{
  open: boolean; showIndex: () => void; showDetail: () => void; back: () => void; backLabel: string;
} | null>(null);
