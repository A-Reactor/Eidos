import { describe, expect, it, vi } from "vitest";
import { VoiceLibrary } from "@/lib/game/momoi/library";
import { buildVoiceRequest, DEFAULT_VOICE_CONFIG, voiceIdentity } from "@/lib/game/momoi/model";
import { generateVoiceBatch } from "@/lib/game/momoi/generate-batch";
const request = (text: string) => buildVoiceRequest({ type: "dialogue", text, speaker: "甲" }, DEFAULT_VOICE_CONFIG)!;
const audio = { audioBase64: "UklGRg==", mimeType: "audio/wav" };
function blockedLibrary() {
  let finish!: (value: typeof audio) => void;
  const calls: string[] = [];
  const library = new VoiceLibrary({}, async () => {}, async r => {
    calls.push(r.text);
    if (calls.length === 1) return new Promise(resolve => { finish = resolve; });
    return audio;
  });
  return { library, calls, release: () => finish(audio) };
}
describe("voice priority queue", () => {
  it("finishes the active request then runs manual, current, prefetch and batch in priority order", async () => {
    const { library, calls, release } = blockedLibrary();
    const running = library.ensure(request("running"));
    await vi.waitFor(() => expect(calls).toEqual(["running"]));
    const batch = library.ensure(request("batch"), false, { priority: "batch" });
    const prefetch = library.ensure(request("prefetch"), false, { priority: "prefetch" });
    const current = library.ensure(request("current"), false, { priority: "current" });
    const manual = library.ensure(request("manual"), false, { priority: "manual" });
    await vi.waitFor(() => expect(library.queueItems).toHaveLength(5));
    expect(calls).toEqual(["running"]);
    release(); await Promise.all([running, batch, prefetch, current, manual]);
    expect(calls).toEqual(["running", "manual", "current", "prefetch", "batch"]);
  });
  it("promotes a shared waiting clip without making another synthesis request", async () => {
    const { library, calls, release } = blockedLibrary();
    const running = library.ensure(request("running"));
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    const first = library.ensure(request("other"), false, { priority: "prefetch" });
    const low = library.ensure(request("promoted"), false, { priority: "batch" });
    await vi.waitFor(() => expect(library.queueItems).toHaveLength(3));
    const high = library.ensure(request("promoted"), false, { priority: "manual" });
    await vi.waitFor(() => expect(library.queueItems[1].priority).toBe("manual"));
    release();
    const [, , a, b] = await Promise.all([running, first, low, high]);
    expect(a).toEqual(b);
    expect(calls).toEqual(["running", "promoted", "other"]);
  });
  it("cancelling a playback waiter preserves another consumer's shared task", async () => {
    const { library, calls, release } = blockedLibrary();
    const running = library.ensure(request("running"));
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    const background = library.ensure(request("shared"), false, { priority: "prefetch" });
    const cancel = new AbortController();
    const foreground = library.ensure(request("shared"), false, { priority: "manual", signal: cancel.signal }).catch(error => error);
    await vi.waitFor(() => expect(library.queueItems[1].priority).toBe("manual"));
    cancel.abort();
    expect((await foreground).name).toBe("AbortError");
    expect(library.queueItems[1].priority).toBe("prefetch");
    release(); await Promise.all([running, background]);
    expect(calls).toEqual(["running", "shared"]);
  });
  it("cancels waiting work without deleting existing audio or interrupting the active job", async () => {
    const { library, calls, release } = blockedLibrary();
    const running = library.ensure(request("running"));
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    await library.replace(request("saved"), audio);
    const cancelled = library.ensure(request("waiting")).catch(error => error);
    await vi.waitFor(() => expect(library.queueItems).toHaveLength(2));
    library.cancelWaiting();
    expect((await cancelled).name).toBe("AbortError");
    release(); await running;
    expect(calls).toEqual(["running"]);
    expect(library.assets[await voiceIdentity(request("saved"))]).toBeDefined();
    expect(Object.keys(library.assets)).toHaveLength(2);
  });
  it("stops the rest of a batch on the first failure without sending more requests", async () => {
    const synthesize = vi.fn().mockRejectedValue(new Error("offline"));
    const library = new VoiceLibrary({}, async () => {}, synthesize);
    await expect(generateVoiceBatch(library, [request("one"), request("two"), request("three")], { priority: "batch" })).rejects.toThrow("offline");
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(synthesize).toHaveBeenCalledOnce();
    expect(library.queueItems).toHaveLength(0);
  });
  it("cancels a batch's waiting tasks but still persists its active generation", async () => {
    const { library, calls, release } = blockedLibrary();
    const cancel = new AbortController();
    const batch = generateVoiceBatch(library, [request("one"), request("two"), request("three")], { priority: "batch", signal: cancel.signal }).catch(error => error);
    await vi.waitFor(() => expect(library.queueItems).toHaveLength(3));
    cancel.abort();
    expect((await batch).name).toBe("AbortError");
    release();
    await vi.waitFor(() => expect(Object.keys(library.assets)).toHaveLength(1));
    expect(calls).toEqual(["one"]);
  });
  it("disposes waiting and running tasks on archive changes without publishing old audio", async () => {
    const { library, calls, release } = blockedLibrary();
    const running = library.ensure(request("running")).catch(error => error);
    const waiting = library.ensure(request("waiting")).catch(error => error);
    await vi.waitFor(() => expect(library.queueItems).toHaveLength(2));
    library.dispose(); release();
    expect((await running).name).toBe("AbortError");
    expect((await waiting).name).toBe("AbortError");
    expect(calls).toEqual(["running"]);
    expect(library.assets).toEqual({});
  });
});
