import type { StorySegment } from "@/lib/ai/types";
import { useGameStore } from "@/store/game-store";
import { getVoiceLibrary, requestForSegment, voiceScope } from "./runtime";
import { generateVoiceBatch } from "./generate-batch";

/** Serial generation saves every completed dialogue, including newly introduced speakers. */
export async function prefetchVoices(segments: StorySegment[], _worldId?: string, _knownNames?: string[], signal?: AbortSignal): Promise<void> {
  const scope = voiceScope(), session = useGameStore.getState().voiceSession;
  const requests = segments.map(requestForSegment).filter(r => r !== null);
  if (!requests.length) return;
  const library = await getVoiceLibrary();
  const cancel = new AbortController();
  const check = () => {
    const state = useGameStore.getState();
    if (!state.momoiSettings.enabled || scope !== voiceScope() || session !== state.voiceSession) cancel.abort();
  };
  const unsubscribe = useGameStore.subscribe(check);
  check();
  try { await generateVoiceBatch(library, requests, { priority: "prefetch", signal: signal ? AbortSignal.any([signal, cancel.signal]) : cancel.signal }); }
  finally { unsubscribe(); }
}
