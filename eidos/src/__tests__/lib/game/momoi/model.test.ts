import { describe, expect, it } from "vitest";
import { buildVoiceRequest, voiceIdentity, normalizeVoiceConfig, validateVoiceConfiguration, DEFAULT_VOICE_CONFIG } from "@/lib/game/momoi/model";
import { extractSpokenDialogue } from '@/lib/game/momoi/spoken-text';

describe("dialogue voice identity", () => {
  const dialogue = { type: "dialogue" as const, text: "你好", speaker: "爱丽丝", emotion: "happy" as const };
  it("never generates narration or empty dialogue", () => {
    expect(buildVoiceRequest({ type: "narration", text: "有人走进来" }, DEFAULT_VOICE_CONFIG)).toBeNull();
    expect(buildVoiceRequest({ ...dialogue, text: " " }, DEFAULT_VOICE_CONFIG)).toBeNull();
  });
  it("separates long texts, emotions, models and voice assignments", async () => {
    const request = buildVoiceRequest(dialogue, DEFAULT_VOICE_CONFIG)!;
    const a = await voiceIdentity({ ...request, text: "甲".repeat(80) + "乙" });
    expect(await voiceIdentity({ ...request, text: "甲".repeat(80) + "丙" })).not.toBe(a);
    const original = await voiceIdentity(request);
    expect(await voiceIdentity({ ...request, emotion: "sad" })).not.toBe(original);
    expect(await voiceIdentity({ ...request, config: { ...request.config, model: "different" } })).not.toBe(original);
    expect(await voiceIdentity({ ...request, voice: { ...request.voice, voice: "another" } })).not.toBe(original);
    expect(await voiceIdentity({ ...request, apiKey: "rotated" })).toBe(original);
  });
  it("resolves character overrides with a default for unknown speakers", () => {
    const config = { ...DEFAULT_VOICE_CONFIG, voice: "default", speakers: { 爱丽丝: { voice: "alice" } } };
    expect(buildVoiceRequest(dialogue, config)?.voice.voice).toBe("alice");
    expect(buildVoiceRequest({ ...dialogue, speaker: "新角色" }, config)?.voice.voice).toBe("default");
  });
  it('keeps a character reference recording separate from the default transcript and language', () => {
    const config = { ...DEFAULT_VOICE_CONFIG, referenceAudio: 'default', referencePath: '/default.wav', referenceText: '默认录音', referenceLanguage: 'zh',
      speakers: { 爱丽丝: { referenceAudio: 'alice', referenceLanguage: 'ja' } } };
    const request = buildVoiceRequest(dialogue, config)!;
    expect(request.voice.referenceAudio).toBe('alice');
    expect(request.voice.referenceText).toBe('');
    expect(request.voice.referencePath).toBe('');
    expect(request.referenceLanguage).toBe('ja');
  });
  it('inherits the complete default reference when only character weights are changed', () => {
    const config = { ...DEFAULT_VOICE_CONFIG, referenceAudio: 'default', referenceText: 'こんにちは', referenceLanguage: 'ja',
      speakers: { 爱丽丝: { gptWeights: '/a.ckpt', sovitsWeights: '/a.pth' } } };
    expect(buildVoiceRequest(dialogue, config)).toMatchObject({ referenceLanguage: 'ja', voice: { referenceAudio: 'default', referenceText: 'こんにちは' } });
    expect(validateVoiceConfiguration({ ...DEFAULT_VOICE_CONFIG, gptWeights: '/only.ckpt' })).toMatch(/成对/);
  });
  it("normalizes malformed imported config without carrying credentials", () => {
    const config = normalizeVoiceConfig({ provider: "unknown", apiKey: "secret", speakers: null });
    expect(config.provider).toBe("legacy");
    expect(config).not.toHaveProperty("apiKey");
    expect(config.speakers).toEqual({});
  });
  it('preserves community weights and resolves paired character overrides', async () => {
    const config = normalizeVoiceConfig({ ...DEFAULT_VOICE_CONFIG, provider: 'gpt-sovits', endpoint: 'http://localhost:9880',
      referencePath: '/ref.wav', gptWeights: '/default.ckpt', sovitsWeights: '/default.pth',
      speakers: { 爱丽丝: { gptWeights: '/alice.ckpt', sovitsWeights: '/alice_lora.pth' } } });
    const request = buildVoiceRequest(dialogue, config)!;
    expect(request.voice).toMatchObject({ referencePath: '/ref.wav', gptWeights: '/alice.ckpt', sovitsWeights: '/alice_lora.pth' });
    expect(buildVoiceRequest({ ...dialogue, speaker: '其他角色' }, config)?.voice).toMatchObject({ gptWeights: '/default.ckpt', sovitsWeights: '/default.pth' });
    expect(normalizeVoiceConfig(JSON.parse(JSON.stringify(config)))).toEqual(config);
    const id = await voiceIdentity(request);
    expect(await voiceIdentity({ ...request, voice: { ...request.voice, sovitsWeights: '/other_lora.pth' } })).not.toBe(id);
    expect(await voiceIdentity({ ...request, voice: { ...request.voice, gptWeights: '/other.ckpt' } })).not.toBe(id);
  });
  it('keeps old cache identities unchanged when no weights are selected', async () => {
    const request = buildVoiceRequest(dialogue, DEFAULT_VOICE_CONFIG)!;
    const legacyIdentity = [request.text, request.speaker, request.emotion, 'legacy', '', '', 'zh', '', '', '', ''];
    const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(legacyIdentity)));
    const expected = Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('');
    expect(await voiceIdentity(request)).toBe(expected);
  });
  it('keeps an independent character cache when the default model name changes', async () => {
    const config = { ...DEFAULT_VOICE_CONFIG, model: '默认模型甲', gptWeights: '/default.ckpt', sovitsWeights: '/default.pth',
      speakers: { 爱丽丝: { gptWeights: '/alice.ckpt', sovitsWeights: '/alice.pth', referenceAudio: 'alice' } } };
    const before = await voiceIdentity(buildVoiceRequest(dialogue, config)!);
    expect(await voiceIdentity(buildVoiceRequest(dialogue, { ...config, model: '初始模型', gptWeights: '', sovitsWeights: '' })!)).toBe(before);
  });
  it('rejects incomplete weight pairs and character models without a restorable default', () => {
    const config = { ...DEFAULT_VOICE_CONFIG, provider: 'gpt-sovits' as const, endpoint: 'http://localhost:9880', referencePath: '/ref.wav' };
    expect(validateVoiceConfiguration(config, { ...config, gptWeights: '/a.ckpt' })).toMatch(/成对/);
    expect(validateVoiceConfiguration(config, { ...config, gptWeights: '/a.ckpt', sovitsWeights: '/a.pth' })).toMatch(/默认/);
    expect(validateVoiceConfiguration({ ...config, gptWeights: '/default.ckpt', sovitsWeights: '/default.pth' }, { ...config, gptWeights: '/a.ckpt', sovitsWeights: '/a.pth' })).toBeNull();
  });
  it('preserves spaces while editing paths and does not complete a partial character pair from defaults', () => {
    expect(normalizeVoiceConfig({ gptWeights: '/models/my ' }).gptWeights).toBe('/models/my ');
    const config = normalizeVoiceConfig({ ...DEFAULT_VOICE_CONFIG, provider: 'gpt-sovits', endpoint: 'http://localhost:9880', referencePath: '/ref.wav',
      gptWeights: '/default.ckpt', sovitsWeights: '/default.pth', speakers: { 爱丽丝: { sovitsWeights: '/alice_lora.pth' } } });
    const request = buildVoiceRequest(dialogue, config)!;
    expect(validateVoiceConfiguration(request.config, request.voice)).toMatch(/成对/);
  });
  it.each([
    ['（压低声音）你终于来了。', '你终于来了。'],
    ['*她移开视线* 我不知道。 _她摇头_', '我不知道。'],
    ['[sighs] Come in. (She steps aside.)', 'Come in.'],
    ['【旁白：她走近窗户】我会等你。', '我会等你。'],
    ['爱丽丝：\n「今晚别出门。」\n旁白：她关上了门。', '今晚别出门。'],
    ['她低声说：“你回来了。”', '你回来了。'],
    ['“你回来了。”她低声说。', '你回来了。'],
    ['你**一定**要回来。', '你一定要回来。'],
    ['他说的是“明天”，不是“今晚”。', '他说的是“明天”，不是“今晚”。'],
    ['「输入（1+2），再按“确定”。」', '输入（1+2），再按“确定”。'],
    ['<narration>她叹了口气。</narration>好吧。', '好吧。'],
    ['“明天”或“今晚”', '“明天”或“今晚”'],
    ['把《计划（第二版）》带来。', '把《计划（第二版）》带来。'],
    ['输入 foo_bar，再检查 baz_qux。', '输入 foo_bar，再检查 baz_qux。'],
    ['我刚读完（笑傲江湖）。', '我刚读完（笑傲江湖）。'],
    ['（她把信放进抽屉。）我知道了。', '我知道了。'],
    ['（爱丽丝坐在窗边。）明天见。', '明天见。'],
  ])('speaks only dialogue from %s', (text, expected) => {
    expect(buildVoiceRequest({ ...dialogue, text }, DEFAULT_VOICE_CONFIG)?.text).toBe(expected);
    expect(extractSpokenDialogue(expected, dialogue.speaker)).toBe(expected);
  });
  it.each(['（她沉默了。）', '*她看向窗外*', '旁白：房间静了下来。', '（她把信放进抽屉。）'])('skips a dialogue containing only stage directions: %s', text => {
    expect(buildVoiceRequest({ ...dialogue, text }, DEFAULT_VOICE_CONFIG)).toBeNull();
  });
});
