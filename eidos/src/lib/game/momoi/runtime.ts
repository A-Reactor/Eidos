import { useGameStore } from "@/store/game-store";
import { scopeStorageKey } from "@/lib/game/archive-scope";
import { VoiceLibrary } from "./library";
import { buildVoiceRequest, type VoiceRequest } from "./model";
import { readVoiceResources, writeVoiceResources } from "./resource-storage";
import { resolveSpeaker } from "./utils";
import type { StorySegment } from "@/lib/ai/types";
import { generateVoiceAudio } from './client-generation';
import { enforceAudioStorageLimit, VOICE_CACHE_CHANGED, type AudioCacheStats } from './storage-quota';

type State = ReturnType<typeof useGameStore.getState>;
export function voiceScope(state: State = useGameStore.getState()) {
  return scopeStorageKey(state, JSON.stringify([state.currentWorld?.id ?? "", state.currentPlaythroughId ?? ""]));
}
function sessionKey(state: State) { return `${voiceScope(state)}:${state.voiceSession}`; }
let current: { key: string; ready: Promise<VoiceLibrary>; library?: VoiceLibrary } | null = null;
if (typeof window !== 'undefined') window.addEventListener(VOICE_CACHE_CHANGED, event => {
  const state = useGameStore.getState(), scope = voiceScope(state), prefix = `momoi_v2_${scope}:`;
  const ids = ((event as CustomEvent<AudioCacheStats>).detail?.deletedKeys ?? []).filter(key => key.startsWith(prefix)).map(key => key.slice(prefix.length));
  if (!ids.length) return;
  current?.library?.evict(ids);
  useGameStore.setState({ voiceAssets: Object.fromEntries(Object.entries(state.voiceAssets).filter(([id]) => !ids.includes(id))) });
});
useGameStore.subscribe(state => {
  if (current && current.key !== sessionKey(state)) {
    current.library?.dispose();
    current = null;
    useGameStore.setState({ voiceQueue: [] });
  }
});
export async function getVoiceLibrary(): Promise<VoiceLibrary> {
  const state = useGameStore.getState();
  const scope = voiceScope(state), key = sessionKey(state);
  if (current?.key === key) return current.ready;
  current?.library?.dispose();
  const entry: NonNullable<typeof current> = { key, ready: Promise.resolve(null as unknown as VoiceLibrary) };
  current = entry;
  entry.ready = (async () => {
    await enforceAudioStorageLimit();
    const disk = await readVoiceResources(scope);
    const assets = await writeVoiceResources(scope, { ...(!state.voiceAssetScope || state.voiceAssetScope === scope ? state.voiceAssets : {}), ...disk }, disk);
    let persisted = assets;
    const library = new VoiceLibrary(assets, async next => {
      const retained = await writeVoiceResources(scope, next, persisted);
      persisted = retained;
      if (sessionKey(useGameStore.getState()) === key) useGameStore.setState({ voiceAssets: retained, voiceAssetScope: scope });
      return retained;
    }, (request, signal) => generateVoiceAudio(request, signal, usage => useGameStore.getState().addTokenUsage(usage, state.currentWorld?.id)), items => {
      if (current === entry && sessionKey(useGameStore.getState()) === key) useGameStore.setState({ voiceQueue: items });
    });
    entry.library = library;
    if (current !== entry || sessionKey(useGameStore.getState()) !== key) {
      library.dispose(); throw new Error("存档已切换");
    }
    useGameStore.setState({ voiceAssets: assets, voiceAssetScope: scope });
    return library;
  })();
  try { return await entry.ready; }
  catch (error) { if (current === entry) current = null; throw error; }
}
export function voiceCredentialKey(endpoint: string) { return `eidos_momoi_key_${endpoint}`; }
export function requestForSegment(segment: StorySegment | null): VoiceRequest | null {
  const state = useGameStore.getState();
  const request = buildVoiceRequest(segment, state.voiceConfig);
  if (!request) return null;
  request.worldId = state.currentWorld?.id ?? "";
  if (request.config.provider === "legacy" && !request.voice.voice && !request.voice.referenceAudio && !request.voice.referencePath) {
    const old = resolveSpeaker(request.speaker, request.worldId);
    request.voice = { ...request.voice, voice: old.speaker || "对话", referenceAudio: old.referenceAudio };
  }
  try { request.apiKey = sessionStorage.getItem(voiceCredentialKey(request.config.endpoint)) ?? undefined; }
  catch { /* Cached audio remains playable if session storage is unavailable. */ }
  return request;
}
