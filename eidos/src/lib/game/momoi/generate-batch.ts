import type { VoiceLibrary } from "./library";
import type { VoiceRequest } from "./model";
import type { VoicePriority } from "./generation-queue";

export async function generateVoiceBatch(library: VoiceLibrary, requests: VoiceRequest[], options: {
  priority: VoicePriority; signal?: AbortSignal; onProgress?: (done: number, total: number) => void;
}) {
  const cancel = new AbortController();
  const signal = options.signal ? AbortSignal.any([cancel.signal, options.signal]) : cancel.signal;
  let done = 0;
  await Promise.all(requests.map(async request => {
    try {
      await library.ensure(request, false, { priority: options.priority, signal });
      options.onProgress?.(++done, requests.length);
    } catch (error) { cancel.abort(); throw error; }
  }));
}
