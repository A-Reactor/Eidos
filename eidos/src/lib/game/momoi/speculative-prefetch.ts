import type { StorySegment } from '@/lib/ai/types';
import type { SpeculativeEngine } from '@/lib/ai/speculation';
import type { VoiceLibrary } from './library';
import type { VoiceRequest } from './model';
import { translationTarget } from './languages';

/** Keep speculative GPU work small; unselected branches must not start paid translations. */
export function watchSpeculativeVoice(options: {
  engine: SpeculativeEngine;
  library: VoiceLibrary;
  scope: () => string;
  ready: () => boolean;
  requestForSegment: (segment: StorySegment) => VoiceRequest | null;
}) {
  let key = '', cancel: AbortController | undefined, disposed = false;
  function sync() {
    if (disposed) return;
    const scope = options.scope();
    const candidate = options.ready() ? options.engine.peekPrimary(scope) : null;
    const request = candidate?.response.segments.map(options.requestForSegment).find(Boolean);
    const eligible = request && request.config.provider === 'legacy' && !translationTarget(request.config) && request.text.length <= 160;
    const next = eligible ? JSON.stringify([scope, candidate!.action, request.text, request.speaker, request.emotion]) : '';
    if (next === key) return;
    cancel?.abort(); key = next;
    if (!eligible) return;
    const controller = new AbortController(); cancel = controller;
    void options.library.ensure(request, false, { priority: 'speculative', signal: controller.signal }).catch(error => {
      if (!controller.signal.aborted) console.warn('[MOMOI] 候选语音预热失败', error);
    });
  }
  const unsubscribe = options.engine.subscribe(sync);
  sync();
  return { sync, dispose: () => { disposed = true; unsubscribe(); cancel?.abort(); } };
}
