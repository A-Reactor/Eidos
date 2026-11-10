// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useMomoiPlayback } from "@/lib/game/momoi/use-momoi-playback";
import { useGameStore } from "@/store/game-store";
import type { StorySegment } from "@/lib/ai/types";
const { ensure, library } = vi.hoisted(() => {
  const ensure = vi.fn();
  return { ensure, library: { ensure } };
});
vi.mock("@/lib/game/momoi/runtime", () => ({ getVoiceLibrary: async () => library, requestForSegment: (segment: StorySegment | null) => segment?.type === "dialogue" ? { text: segment.text, speaker: segment.speaker } : null }));
const audios: FakeAudio[] = [];
class FakeAudio {
  src = ""; volume = 1; playbackRate = 1;
  onended: (() => void) | null = null; onerror: (() => void) | null = null;
  pause = vi.fn(); play = vi.fn().mockResolvedValue(undefined);
  constructor(src: string) { this.src = src; audios.push(this); }
}
const a: StorySegment = { type: "dialogue", text: "你好", speaker: "甲" };
const asset = { audioBase64: "UklGRg==", mimeType: "audio/wav" };
beforeEach(() => {
  audios.length = 0; ensure.mockReset().mockResolvedValue(asset);
  vi.stubGlobal("Audio", FakeAudio);
  useGameStore.setState({ momoiSettings: { enabled: true, autoPlay: true, volume: .8, speed: 1 }, momoiStatus: "offline" });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
describe("dialogue playback lifecycle", () => {
  it("waits from initial lookup to audio ended, including cached audio while engine is offline", async () => {
    const { result } = renderHook(() => useMomoiPlayback(a, { occurrence: "1", streaming: false }));
    expect(result.current.isGenerating).toBe(true);
    await waitFor(() => expect(result.current.isPlaying).toBe(true));
    act(() => audios[0].onended?.());
    expect(result.current.isPlaying).toBe(false);
    expect(result.current.isGenerating).toBe(false);
  });
  it("never plays the previous segment when a late generation finishes", async () => {
    let finish!: (value: typeof asset) => void;
    ensure.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const { rerender } = renderHook(({ segment, occurrence }) => useMomoiPlayback(segment, { occurrence, streaming: false }), { initialProps: { segment: a, occurrence: "1" } });
    await waitFor(() => expect(finish).toBeTypeOf("function"));
    rerender({ segment: { type: "narration", text: "风吹过" }, occurrence: "2" });
    await act(async () => finish(asset));
    expect(audios).toHaveLength(0);
  });
  it("does not synthesize partial streaming text; returning to a visited occurrence needs replay", async () => {
    const { result, rerender } = renderHook(({ occurrence, streaming }) => useMomoiPlayback(a, { occurrence, streaming }), { initialProps: { occurrence: "1", streaming: true } });
    expect(ensure).not.toHaveBeenCalled();
    expect(result.current.isGenerating).toBe(true);
    rerender({ occurrence: "1", streaming: false });
    await waitFor(() => expect(audios).toHaveLength(1));
    rerender({ occurrence: "2", streaming: false });
    await waitFor(() => expect(audios).toHaveLength(2));
    rerender({ occurrence: "1", streaming: false });
    await act(async () => {});
    expect(audios).toHaveLength(2);
    act(() => result.current.replay());
    await waitFor(() => expect(audios).toHaveLength(3));
  });
  it("manual mode works without autoplay and disabling cancels playback", async () => {
    useGameStore.setState({ momoiSettings: { enabled: true, autoPlay: false, volume: .8, speed: 1 } });
    const { result } = renderHook(() => useMomoiPlayback(a, { occurrence: "1", streaming: false }));
    expect(ensure).not.toHaveBeenCalled();
    act(() => result.current.replay());
    await waitFor(() => expect(audios).toHaveLength(1));
    act(() => useGameStore.getState().setMomoiSettings({ enabled: false }));
    expect(audios[0].pause).toHaveBeenCalled();
    expect(result.current.isPlaying).toBe(false);
  });
});

it('replays the clicked historical dialogue after the current segments have ended', async () => {
  useGameStore.setState({ momoiSettings: { enabled: true, autoPlay: false, volume: .8, speed: 1 } });
  const { result } = renderHook(() => useMomoiPlayback(null, { occurrence: 'completed', streaming: false }));
  act(() => result.current.replay(a));
  await waitFor(() => expect(audios).toHaveLength(1));
  expect(ensure.mock.calls[0][0]).toEqual({ text: '你好', speaker: '甲' });
});
