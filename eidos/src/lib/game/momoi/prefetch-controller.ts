import type { StorySegment } from '@/lib/ai/types';
import type { VoiceLibrary } from './library';
import type { VoiceRequest } from './model';
import type { VoicePriority } from './generation-queue';
import { translationTarget } from './languages';

export interface VoicePrefetchView {
  segments: StorySegment[];
  index: number;
  streaming: boolean;
  lastIsDraft?: boolean;
  active: boolean;
}
interface Pending { cancel: AbortController; priority: VoicePriority; done: boolean }
function requestsForView(view: VoicePrefetchView, requestForSegment: (segment: StorySegment) => VoiceRequest | null, pending: Map<string, Pending>) {
  const desired = new Map<string, { request: VoiceRequest; priority: VoicePriority }>();
  const end = view.segments.length - (view.lastIsDraft ? 1 : 0);
  let upcoming = 0, earlyWork = 0;
  for (let index = Math.max(0, view.index); view.active && index < end; index++) {
    const request = requestForSegment(view.segments[index]);
    if (!request) continue;
    const key = JSON.stringify([request.text, request.speaker, request.emotion]);
    if (desired.has(key)) continue;
    desired.set(key, { request, priority: index === view.index ? 'current' : upcoming++ < 2 ? 'next' : 'prefetch' });
    // Refill local original dialogue while the stream continues; paid/unconfirmed material stays bounded in total.
    const refill = request.config.provider === 'legacy' && !translationTarget(request.config);
    if (!refill || !pending.get(key)?.done) earlyWork++;
    if (view.streaming && earlyWork >= 2) break;
  }
  return desired;
}

/** One configuration/session owns these waiters; overlapping SSE updates reuse them. */
export class VoicePrefetchController {
  private pending = new Map<string, Pending>();
  private disposed = false;
  private failed = false;
  private cancelled = false;
  private view?: VoicePrefetchView;
  private unsubscribe: () => void;
  constructor(private options: {
    library: VoiceLibrary;
    requestForSegment: (segment: StorySegment) => VoiceRequest | null;
    onError: (error: unknown) => void;
  }) {
    this.unsubscribe = options.library.subscribeForegroundSuccess(() => {
      if (!this.failed || this.cancelled || this.disposed || !this.view) return;
      this.failed = false;
      this.update(this.view);
    });
  }

  update(view: VoicePrefetchView) {
    this.view = view;
    if (this.disposed || this.failed) return;
    const desired = requestsForView(view, this.options.requestForSegment, this.pending);
    for (const [key, pending] of this.pending) if (!desired.has(key)) {
      pending.cancel.abort(); this.pending.delete(key);
    }
    for (const [key, { request, priority }] of desired) {
      const previous = this.pending.get(key);
      if (previous?.done || previous?.priority === priority) continue;
      const pending = { cancel: new AbortController(), priority, done: false };
      this.pending.set(key, pending);
      // Attach the promoted consumer before removing its old priority; synthesis stays shared.
      void this.options.library.ensure(request, false, { priority, signal: pending.cancel.signal }).then(() => {
        if (pending.cancel.signal.aborted || this.disposed) return;
        pending.done = true;
        if (this.view?.streaming) this.update(this.view);
      }).catch(error => {
        if (pending.cancel.signal.aborted || this.disposed) return;
        this.failed = true;
        this.cancelled = error instanceof Error && error.name === 'AbortError';
        this.cancelPending();
        if (!(error instanceof Error && error.name === 'AbortError')) this.options.onError(error);
      });
      previous?.cancel.abort();
    }
  }

  dispose() {
    this.disposed = true;
    this.unsubscribe();
    this.cancelPending();
  }
  private cancelPending() {
    for (const pending of this.pending.values()) pending.cancel.abort();
    this.pending.clear();
  }
}
