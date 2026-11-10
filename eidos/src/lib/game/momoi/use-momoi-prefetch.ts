import { useEffect, useRef } from 'react';
import { useGameStore } from '@/store/game-store';
import { speculativeEngine, speculationScope } from '@/lib/ai/speculation';
import { getVoiceLibrary, requestForSegment, voiceScope } from './runtime';
import { VoicePrefetchController, type VoicePrefetchView } from './prefetch-controller';
import { watchSpeculativeVoice } from './speculative-prefetch';
const sessionKey = (state: ReturnType<typeof useGameStore.getState>) => `${voiceScope(state)}:${state.voiceSession}:${state.currentNode?.id ?? ''}`;

export function useMomoiPrefetch(view: VoicePrefetchView) {
  const enabled = useGameStore(state => state.momoiSettings.enabled);
  const config = useGameStore(state => state.voiceConfig);
  const session = useGameStore(sessionKey);
  const { segments, index, streaming, lastIsDraft, active } = view;
  const latest = useRef(view);
  const update = useRef<(() => void) | null>(null);
  useEffect(() => {
    latest.current = { segments, index, streaming, lastIsDraft, active };
    update.current?.();
  }, [segments, index, streaming, lastIsDraft, active]);
  useEffect(() => {
    if (!enabled) return;
    let disposed = false, controller: VoicePrefetchController | undefined;
    let predictions: ReturnType<typeof watchSpeculativeVoice> | undefined;
    const ownsSession = () => { const state = useGameStore.getState(); return state.momoiSettings.enabled && state.voiceConfig === config && sessionKey(state) === session; };
    const failed = (error: unknown) => {
      if (disposed || !ownsSession()) return;
      predictions?.dispose();
      useGameStore.setState({ voiceError: error instanceof Error ? error.message : '语音预生成失败' });
    };
    void getVoiceLibrary().then(library => {
      if (disposed || !ownsSession()) return;
      controller = new VoicePrefetchController({ library, requestForSegment, onError: failed });
      controller.update(latest.current);
      predictions = watchSpeculativeVoice({ library, engine: speculativeEngine, requestForSegment,
        ready: () => ownsSession() && latest.current.active && !latest.current.streaming,
        scope: () => { const state = useGameStore.getState(); return speculationScope(state.currentWorld?.id, state.currentPlaythroughId, state.currentNode?.id, state); } });
      update.current = () => { controller?.update(latest.current); predictions?.sync(); };
    }).catch(failed);
    return () => { disposed = true; update.current = null; controller?.dispose(); predictions?.dispose(); };
  }, [enabled, config, session]);
}
