'use client';
import { useEffect } from 'react';
import { globalPluginRuntime } from '@/lib/game/global-plugins/runtime';

/** One host for the entire application, including pages without an active world. */
export function GlobalPluginsHost() {
  useEffect(() => globalPluginRuntime.start(), []);
  return null;
}
