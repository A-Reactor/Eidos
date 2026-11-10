import { afterEach, describe, expect, it, vi } from "vitest";
import { readCreationEvents, streamCreationJSON, parseCreationJSON } from "@/lib/ai/creation-stream";
import { creationResponse } from "@/lib/ai/creation-response";

const cfg = { baseUrl: "https://test.invalid", apiKey: "test", model: "test" };
const body = { messages: [{ role: "user", content: "create world" }], stream: true };
function response(parts: string[]) {
  return new Response(new ReadableStream({ start(controller) {
    for (const part of parts) controller.enqueue(new TextEncoder().encode(part));
    controller.close();
  } }));
}
const event = (delta: string, finish_reason?: string) => `data: ${JSON.stringify({ choices: [{ delta: { content: delta }, finish_reason }] })}\n`;
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
describe("durable creation streams", () => {
  it("records one usage per actual length continuation and none for completed resume", async () => {
    const raw = { prompt_tokens: 1000, completion_tokens: 10, prompt_cache_hit_tokens: 800 };
    const tail = `data: ${JSON.stringify({ choices: [], usage: raw })}`;
    const fetchMock = vi.fn().mockResolvedValueOnce(response([event('{"name":', 'length'), tail])).mockResolvedValueOnce(response([event('"世界"}', 'stop'), tail]));
    vi.stubGlobal('fetch', fetchMock);
    const onUsage = vi.fn();
    await streamCreationJSON(cfg, body, () => {}, { onUsage });
    expect(onUsage).toHaveBeenCalledTimes(2);
    expect(onUsage.mock.calls[0][0]).toEqual(raw);
    expect(onUsage.mock.calls[0][1]).toMatchObject({ elapsedMs: expect.any(Number), firstTokenMs: expect.any(Number) });
    await streamCreationJSON(cfg, body, () => {}, { resumeText: '{"name":"世界"}', onUsage });
    expect(onUsage).toHaveBeenCalledTimes(2);
  });
  it("rejects partial JSON rather than salvaging it as a complete world", () => {
    expect(() => parseCreationJSON('{"name":"test","regions":{"a":{}')).toThrow();
    expect(parseCreationJSON('```json\n{"name":"test"}\n```')).toEqual({ name: "test" });
  });
  it("reuses complete output when only the final response was lost", async () => {
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    expect(await streamCreationJSON(cfg, body, () => {}, { resumeText: '{"name":"world"}' })).toBe('{"name":"world"}');
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("preserves split network lines and a final line without newline", async () => {
    const data = event('{"name":"世') + event('界"}', "stop").trimEnd();
    const fetchMock = vi.fn().mockResolvedValue(response([...data]));
    vi.stubGlobal("fetch", fetchMock);
    expect(await streamCreationJSON(cfg, body, () => {})).toBe('{"name":"世界"}');
  });
  it("continues on a provider length limit without discarding the prefix", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(response([event('{"name":', "length")])).mockResolvedValueOnce(response([event('"世界"}', "stop")]));
    vi.stubGlobal("fetch", fetchMock);
    const onText = vi.fn();
    expect(await streamCreationJSON(cfg, body, () => {}, { onText })).toBe('{"name":"世界"}');
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).messages).toContainEqual({ role: "assistant", content: '{"name":' });
    expect(onText).toHaveBeenLastCalledWith('{"name":"世界"}', '"世界"}');
  });
  it("keeps received material available when the stream disconnects", async () => {
    let reads = 0;
    const broken = new Response(new ReadableStream({ pull(controller) {
      if (reads++ === 0) controller.enqueue(new TextEncoder().encode(event('{"name":')));
      else controller.error(new Error("disconnected"));
    } }));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(broken));
    let saved = "";
    await expect(streamCreationJSON(cfg, body, () => {}, { onText: (text) => { saved = text; } })).rejects.toThrow("disconnected");
    expect(saved).toBe('{"name":');
  });
  it("allows more than twenty minutes of reasoning and still supports explicit cancellation", async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    vi.stubGlobal("fetch", vi.fn((_url, init) => { signal = init.signal; return new Promise((_resolve, reject) => signal?.addEventListener("abort", () => reject(new DOMException("stopped", "AbortError")))); }));
    const abort = new AbortController();
    const task = streamCreationJSON(cfg, body, () => {}, { signal: abort.signal });
    const result = expect(task).rejects.toThrow("stopped");
    await vi.advanceTimersByTimeAsync(21 * 60 * 1000);
    expect(signal?.aborted).toBe(false);
    abort.abort(); await result;
  });
  it("does not swallow server errors or turn EOF into a done event", async () => {
    await expect(readCreationEvents(response(['data: {"type":"error","message":"failed"}\n']), (event) => { if (event.type === "error") throw new Error(event.message); })).rejects.toThrow("failed");
  });
  it("cancels upstream work when the response reader is cancelled", async () => {
    let upstream: AbortSignal | undefined;
    const res = creationResponse(new Request("http://localhost/test"), async (_send, signal) => {
      upstream = signal;
      await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve()));
    });
    await res.body!.cancel();
    expect(upstream?.aborted).toBe(true);
  });
});

it('retains received usage once when a creation reader fails after reporting it', async () => {
  const raw = { prompt_tokens: 1000, completion_tokens: 10, total_tokens: 1010, prompt_cache_hit_tokens: 800, prompt_cache_miss_tokens: 200 };
  let reads = 0;
  const broken = new Response(new ReadableStream({ pull(c) {
    if (reads++ === 0) c.enqueue(new TextEncoder().encode(event('{"name":') + `data: ${JSON.stringify({ choices: [], usage: raw })}\n`));
    else c.error(new Error('disconnected after usage'));
  } }));
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(broken));
  const onUsage = vi.fn(); let saved = '';
  await expect(streamCreationJSON(cfg, body, () => {}, { onUsage, onText: text => { saved = text; } })).rejects.toThrow('disconnected after usage');
  expect(saved).toBe('{"name":');
  expect(onUsage).toHaveBeenCalledTimes(1);
  expect(onUsage.mock.calls[0][0]).toEqual(raw);
});
