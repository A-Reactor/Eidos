import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/momoi/speak/route";
import { buildVoiceRequest, DEFAULT_VOICE_CONFIG } from "@/lib/game/momoi/model";
const body = () => buildVoiceRequest({ type: "dialogue", text: "甲".repeat(520), speaker: "Alice" }, { ...DEFAULT_VOICE_CONFIG, provider: "compatible", endpoint: "http://localhost:8880/v1", model: "kokoro", voice: "zf_xiaobei" })!;
const post = (data: unknown, origin?: string) => POST(new NextRequest("http://localhost:3000/api/momoi/speak", { method: "POST", headers: { "Content-Type": "application/json", ...(origin ? { origin } : {}) }, body: JSON.stringify(data) }));
afterEach(() => vi.unstubAllGlobals());
describe("MOMOI providers", () => {
  it('does not treat a trained voice display name as a disk filename when explicit reference audio is supplied', async () => {
    vi.stubGlobal('fetch', async () => Response.json({ audio: 'UklGRg==' }));
    const r = buildVoiceRequest({ type: 'dialogue', text: '你好', speaker: '试听' }, { ...DEFAULT_VOICE_CONFIG, voice: 'Alice / v2+', referenceAudio: 'UklGRg==' })!;
    r.worldId = 'preview';
    expect((await post(r)).status).toBe(200);
  });
  it('passes explicit local reference paths and preserves the actionable model error', async () => {
    let sent: Record<string, unknown> = {};
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      sent = JSON.parse(String(init.body));
      return Response.json({ error: '模型加载失败：缺少 speaker embedding 模型' }, { status: 400 });
    });
    const r = buildVoiceRequest({ type: 'dialogue', text: '你好', speaker: '爱丽丝' }, {
      ...DEFAULT_VOICE_CONFIG, referencePath: '/local/ref.wav', referenceText: 'こんにちは', referenceLanguage: 'ja',
    })!;
    r.worldId = 'world';
    const response = await post(r);
    expect(sent).toMatchObject({ referencePath: '/local/ref.wav', referenceLanguage: 'ja', useDefaultVoice: false });
    expect((await response.json()).error).toContain('缺少 speaker embedding 模型');
  });
  it('rejects oversized and cross-site bodies before calling a voice provider', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    const request = (headers: Record<string, string>) => new NextRequest('http://localhost:3000/api/momoi/speak', { method: 'POST', headers, body: JSON.stringify(body()) });
    expect((await POST(request({ 'content-length': '100000000' }))).status).toBe(413);
    expect((await POST(request({ 'sec-fetch-site': 'cross-site' }))).status).toBe(403);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('filters narration even when a direct client bypasses the voice request builder', async () => {
    let input = '';
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      input = JSON.parse(String(init.body)).input;
      return new Response('RIFF', { headers: { 'Content-Type': 'audio/wav' } });
    });
    const r = body(); r.text = '（她低声说）别回头。*她握紧你的手*';
    expect((await post(r)).status).toBe(200);
    expect(input).toBe('别回头。');
    r.text = '（她沉默了）';
    expect((await post(r)).status).toBe(400);
    r.text = '（她把信放进抽屉。）';
    expect((await post(r)).status).toBe(400);
    r.text = '我刚读完（笑傲江湖）。';
    expect((await post(r)).status).toBe(200);
    expect(input).toBe('我刚读完（笑傲江湖）。');
  });
  it("preserves full dialogue and maps compatible model/voice into an audio request", async () => {
    let sent: Record<string, unknown> = {};
    vi.stubGlobal("fetch", vi.fn(async (_url, init) => { sent = JSON.parse(init.body); return new Response(new Uint8Array([82,73,70,70]), { headers: { "Content-Type": "audio/wav" } }); }));
    const response = await post(body());
    expect(response.status).toBe(200);
    expect(sent).toMatchObject({ input: "甲".repeat(520), model: "kokoro", voice: "zf_xiaobei", response_format: "wav" });
    expect(await response.json()).toMatchObject({ audioBase64: "UklGRg==", mimeType: "audio/wav" });
  });
  it("maps GPT-SoVITS reference transcript and path", async () => {
    let sent: Record<string, unknown> = {};
    vi.stubGlobal("fetch", vi.fn(async (_url, init) => { sent = JSON.parse(init.body); return new Response("RIFF", { headers: { "Content-Type": "audio/wav" } }); }));
    const r = body(); r.config.provider = "gpt-sovits"; r.config.endpoint = "http://localhost:9880";
    r.voice = { voice: "", referencePath: "/voices/a.wav", referenceText: "你好" };
    expect((await post(r)).status).toBe(200);
    expect(sent).toMatchObject({ ref_audio_path: "/voices/a.wav", prompt_text: "你好", text_lang: "zh", streaming_mode: false });
    r.text = 'こんにちは。'; r.config.language = 'ja'; r.referenceLanguage = 'zh';
    expect((await post(r)).status).toBe(200);
    expect(sent).toMatchObject({ text: 'こんにちは。', text_lang: 'ja', prompt_lang: 'zh' });
  });
  it("rejects invalid input, foreign origins, URL credentials and upstream JSON", async () => {
    expect((await post({ text: 123 })).status).toBe(400);
    expect((await post(body(), "https://foreign.example")).status).toBe(403);
    const invalid = body(); invalid.config.endpoint = "http://user:password@localhost:8880";
    expect((await post(invalid)).status).toBe(400);
    vi.stubGlobal("fetch", vi.fn(async () => new Response('{}', { headers: { "Content-Type": "application/json" } })));
    expect((await post(body())).status).toBe(502);
  });
});
