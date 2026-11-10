import { extractSpokenDialogue } from './spoken-text';
import { isGameplayPluginActive } from '../plugins/activation';
import { presentedSpeech, getPresentationDraft, subscribePresentationDrafts } from '../presentation';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useGameStore } from "@/store/game-store";
import type { StorySegment } from "@/lib/ai/types";
import { getVoiceLibrary, requestForSegment } from "./runtime";
import type { VoicePriority } from "./generation-queue";

export function useMomoiPlayback(segment: StorySegment | null, options: { occurrence: string; streaming: boolean; paused?: boolean; nodeId?:string; segmentIndex?:number; playbackKey?:string;autoPlay?:boolean;originId?:string } = { occurrence: "current", streaming: false }) {
  const settings = useGameStore(s => s.momoiSettings);
  const session = useGameStore(s => s.voiceSession);
  const config = useGameStore(s => s.voiceConfig);
  const world = useGameStore(s => s.currentWorld?.id);
  const archiveScope = useGameStore(s => `${s.sandboxMode}:${s.sandboxDossierId}`);
  const playthrough = useGameStore(s => s.currentPlaythroughId);
  const [status, setStatus] = useState<"idle" | "generating" | "playing">("idle");
  const audio = useRef<HTMLAudioElement | null>(null);
  const sequence = useRef(0);
  const pending = useRef<AbortController | null>(null);
  const visited = useRef(new Set<string>());
  const occurrence = `${archiveScope}:${world}:${playthrough}:${session}:${options.occurrence}`;
  const stop = useCallback(() => {
    sequence.current++;
    pending.current?.abort(); pending.current = null;
    if (audio.current) {
      audio.current.onended = null; audio.current.onerror = null;
      audio.current.pause(); audio.current.src = ""; audio.current = null;
    }
    setStatus("idle");
    useGameStore.setState({ isVoicePlaying: false, voiceProgress: "idle" });
  }, []);
  const native=useGameStore(s=>s.currentWorld?.gameplayPlugins?.some(p=>p.ui?.presentation==='native-text' && isGameplayPluginActive(p,s.worldFlags,s.currentSceneId)));
  const nodes=useGameStore(s=>s.allNodes),origin=useGameStore(s=>s.currentNode?.id);
  useSyncExternalStore(subscribePresentationDrafts,()=>getPresentationDraft(options.playbackKey),()=>undefined);
  const presented=segment && native ? presentedSpeech(segment,nodes,options.originId ?? origin,options.nodeId,options.segmentIndex,options.playbackKey) : segment;
  const text = presented?.text === undefined ? undefined : extractSpokenDialogue(presented.text, presented.speaker), speaker = segment?.speaker, emotion = segment?.emotion, type = segment?.type;
  const play = useCallback(async (priority: VoicePriority = "manual", selected?: StorySegment) => {
    const state=useGameStore.getState();
    const projected=selected && native ? presentedSpeech(selected,state.allNodes,options.originId ?? state.currentNode?.id,options.nodeId,undefined,options.playbackKey) : selected;
    const spoken = projected ? { ...projected, text: projected.text } : { type, text, speaker, emotion };
    if (!settings.enabled || options.paused || options.streaming || spoken.type !== "dialogue" || !spoken.text?.trim()) return;
    stop();
    const ticket = sequence.current;
    const controller = new AbortController(); pending.current = controller;
    const request = requestForSegment(spoken as StorySegment);
    if (!request) return;
    setStatus("generating");
    useGameStore.setState({ voiceProgress: "generating", voiceError: null });
    try {
      const library = await getVoiceLibrary();
      if (ticket !== sequence.current) return;
      const asset = await library.ensure(request, false, { priority, signal: controller.signal });
      if (ticket !== sequence.current) return;
      const element = new Audio(`data:${asset.mimeType};base64,${asset.audioBase64}`);
      audio.current = element;
      const latest = useGameStore.getState().momoiSettings;
      element.volume = latest.volume; element.playbackRate = latest.speed;
      element.onended = () => { if (ticket === sequence.current) stop(); };
      element.onerror = () => {
        if (ticket !== sequence.current) return;
        stop(); useGameStore.setState({ voiceError: "音频无法播放，请重新生成或上传替换", voiceProgress: "failed" });
      };
      await element.play();
      if (ticket !== sequence.current) { element.pause(); return; }
      visited.current.add(occurrence);
      setStatus("playing");
      useGameStore.setState({ isVoicePlaying: true, voiceProgress: "done" });
    } catch (error) {
      if (ticket !== sequence.current) return;
      stop();
      const message = error instanceof Error && error.name === "NotAllowedError" ? "浏览器暂停了自动播放，请点击播放对话" : error instanceof Error ? error.message : "语音播放失败";
      useGameStore.setState({ voiceError: message, voiceProgress: "failed" });
    }
  }, [settings.enabled, options.paused, options.streaming, type, text, speaker, emotion, occurrence, stop, options.nodeId,options.playbackKey,options.originId,native]);
  useEffect(() => {
    if (settings.enabled && settings.autoPlay && options.autoPlay!==false && !options.paused && !options.streaming && !visited.current.has(occurrence)) void play("current");
    return stop;
  }, [play, stop, occurrence, settings.enabled, settings.autoPlay, options.autoPlay, options.paused, options.streaming, config]);
  useEffect(() => {
    if (audio.current) { audio.current.volume = settings.volume; audio.current.playbackRate = settings.speed; }
  }, [settings.volume, settings.speed]);
  return { isPlaying: status === "playing", isGenerating: status === "generating" || Boolean(settings.enabled && settings.autoPlay && options.autoPlay!==false && !options.paused && options.streaming && type === "dialogue" && text?.trim()), replay: (selected?: StorySegment) => { void play("manual", selected); }, stop };
}
