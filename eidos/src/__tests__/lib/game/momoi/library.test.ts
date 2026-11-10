import { describe, expect, it, vi } from "vitest";
import { VoiceLibrary } from "@/lib/game/momoi/library";
import { buildVoiceRequest, DEFAULT_VOICE_CONFIG, voiceIdentity } from "@/lib/game/momoi/model";
const request = buildVoiceRequest({ type: "dialogue", text: "你好", speaker: "甲" }, DEFAULT_VOICE_CONFIG)!;
const result = { audioBase64: "UklGRg==", mimeType: "audio/wav" };

describe("voice resources", () => {
  it('labels saved character audio with its own trained model rather than the default model', async () => {
    const selected = buildVoiceRequest({ type: 'dialogue', speaker: '甲', text: '你好' }, {
      ...DEFAULT_VOICE_CONFIG, model: '默认模型', speakers: { 甲: { gptWeights: '/a.ckpt', sovitsWeights: '/a.pth', modelName: 'v2ProPlus · 甲' } },
    })!;
    const library = new VoiceLibrary({}, async () => {}, async () => result);
    expect((await library.ensure(selected)).model).toBe('v2ProPlus · 甲');
  });
  it("shares prefetch/playback and can read persisted audio while offline", async () => {
    const synthesize = vi.fn().mockResolvedValue(result);
    let saved = {};
    const library = new VoiceLibrary({}, async assets => { saved = assets; }, synthesize);
    const [a, b] = await Promise.all([library.ensure(request), library.ensure(request)]);
    expect(a).toEqual(b);
    expect(synthesize).toHaveBeenCalledTimes(1);
    const offline = new VoiceLibrary(saved, async () => {}, async () => { throw new Error("offline"); });
    expect(await offline.ensure(request)).toEqual(a);
  });
  it("deleting during generation prevents resurrection", async () => {
    let finish!: (value: typeof result) => void;
    const library = new VoiceLibrary({}, async () => {}, () => new Promise(resolve => { finish = resolve; }));
    const pending = library.ensure(request);
    await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
    await library.remove(await voiceIdentity(request));
    finish(result);
    await expect(pending).rejects.toThrow();
    expect(library.assets).toEqual({});
  });
  it("failed regeneration preserves existing audio; replacement wins over old work", async () => {
    let fail = false;
    const library = new VoiceLibrary({}, async () => {}, async () => { if (fail) throw new Error("offline"); return result; });
    const original = await library.ensure(request);
    fail = true;
    await expect(library.ensure(request, true)).rejects.toThrow("offline");
    expect(library.assets[original.id]).toEqual(original);
    await library.replace(request, { audioBase64: "bmV3", mimeType: "audio/mpeg" });
    expect((await library.ensure(request)).provider).toBe("uploaded");
  });
  it("does not claim success when durable storage fails", async () => {
    const library = new VoiceLibrary({}, async () => { throw new Error("quota"); }, async () => result);
    await expect(library.ensure(request)).rejects.toThrow("quota");
    expect(library.assets).toEqual({});
  });
});

it("upload wins over an older generation and retrying a failed request is possible", async () => {
  let finish!: (value: typeof result) => void;
  const library = new VoiceLibrary({}, async () => {}, () => new Promise(resolve => { finish = resolve; }));
  const pending = library.ensure(request);
  await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
  await library.replace(request, { audioBase64: "bmV3", mimeType: "audio/mpeg" });
  finish(result);
  await expect(pending).rejects.toThrow("取消");
  expect((await library.ensure(request)).audioBase64).toBe("bmV3");
});
