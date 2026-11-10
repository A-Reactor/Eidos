'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useGameStore } from '@/store/game-store';
import type { StorySegment } from '@/lib/ai/types';
import type { NarrativeRequest } from '@/lib/game/narrative';
import { parseGameplayPlugins } from '@/lib/game/plugins/manifest';
import { nativeReadingActions, nativeReadingPlugin } from '@/lib/game/plugins/native-reading';
import { pluginPreferences } from '@/lib/game/plugins/preferences';
import { EIDOS_SETTINGS_CHANGE_EVENT, loadSettings } from '@/lib/game/settings';
import { isPipelineBusy } from '@/lib/game/stream-lifecycle';
import { getPendingActionNodeSave } from '@/lib/game/action-node-commit';
import { archiveScopeSessionValue } from '@/lib/game/archive-scope';

/** Continue only opted-in ordinary prose; native pause and chapter/choice boundaries remain authoritative. */
export function useNativeReadingContinuation({ segments, ready, onContinue }: {
  segments: StorySegment[]; ready: boolean; onContinue: (request: NarrativeRequest) => void;
}) {
  const world = useGameStore(s => s.currentWorld), flags = useGameStore(s => s.worldFlags);
  const sceneId = useGameStore(s => s.currentSceneId);
  const scope = useGameStore(s => `${s.currentWorld?.id}:${s.currentPlaythroughId}:${s.worldLine?.id}:${s.currentNode?.id}:${archiveScopeSessionValue(s)}`);
  const [preferences, setPreferences] = useState(() => loadSettings().modPreferences);
  const attempted = useRef(''), callback = useRef(onContinue);
  useEffect(() => { callback.current = onContinue; }, [onContinue]);
  useEffect(() => {
    const sync = () => setPreferences(loadSettings().modPreferences);
    window.addEventListener(EIDOS_SETTINGS_CHANGE_EVENT, sync); window.addEventListener('storage', sync);
    return () => { window.removeEventListener(EIDOS_SETTINGS_CHANGE_EVENT, sync); window.removeEventListener('storage', sync); };
  }, []);
  const plugin = useMemo(() => nativeReadingPlugin(parseGameplayPlugins(world?.gameplayPlugins), flags, sceneId), [world, flags, sceneId]);
  const enabled = plugin && pluginPreferences(plugin, preferences).auto_continue === true;
  useEffect(() => {
    const last = segments.at(-1), action = nativeReadingActions(segments).find(a => a.request.kind === 'continue');
    if (!ready || !enabled || !last || last.beat?.boundary || !action || attempted.current === scope) return;
    const timer = setTimeout(() => {
      if (!loadSettings().autoAdvance || isPipelineBusy() || getPendingActionNodeSave(useGameStore)) return;
      attempted.current = scope; callback.current(action.request);
    }, 5000);
    return () => clearTimeout(timer);
  }, [segments, ready, enabled, scope]);
}
