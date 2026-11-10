// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { deleteVoicePreset, loadVoicePresets, normalizeVoicePresets, readVoicePresets, rememberVoiceDraft, saveVoicePreset, useVoicePresets, voiceProviderDraft, writeVoicePresets } from "@/lib/game/momoi/presets";
import { DEFAULT_VOICE_CONFIG, normalizeVoiceConfig, validateVoiceConfiguration } from "@/lib/game/momoi/model";
const config = normalizeVoiceConfig({ ...DEFAULT_VOICE_CONFIG, provider: "compatible", endpoint: "http://localhost:8880/v1", model: "kokoro", voice: "alice", speakers: { 甲: { voice: "bob" } } });
beforeEach(async () => {
  await writeVoicePresets({ presets: [], drafts: {} });
  useVoicePresets.setState({ data: { presets: [], drafts: {} }, ready: false, error: "" });
  await loadVoicePresets();
});
describe("voice connection and casting presets", () => {
  it('retains default and character LoRA paths in saved presets and service drafts', async () => {
    const voice = normalizeVoiceConfig({ ...config, provider: 'gpt-sovits', gptWeights: '/base.ckpt', sovitsWeights: '/base.pth',
      speakers: { 甲: { gptWeights: '/a.ckpt', sovitsWeights: '/a_lora.pth' } } });
    await saveVoicePreset('角色模型', voice);
    await rememberVoiceDraft('world-a', voice);
    const saved = await readVoicePresets();
    expect(saved.presets[0].config).toMatchObject({ gptWeights: '/base.ckpt', sovitsWeights: '/base.pth', speakers: { 甲: { gptWeights: '/a.ckpt', sovitsWeights: '/a_lora.pth' } } });
    expect(saved.drafts['world-a']['gpt-sovits']).toEqual(saved.presets[0].config);
  });
  it("persists named models and speaker overrides, updates and deletes without mutating current config", async () => {
    const id = await saveVoicePreset("角色配音", config);
    let saved = await readVoicePresets();
    expect(saved.presets[0]).toEqual({ id, name: "角色配音", config });
    await saveVoicePreset("改名", { ...config, voice: "carol" }, id);
    saved = await readVoicePresets();
    expect(saved.presets).toHaveLength(1);
    expect(saved.presets[0].config.speakers.甲.voice).toBe("bob");
    expect(saved.presets[0].name).toBe("改名");
    await deleteVoicePreset(id);
    expect((await readVoicePresets()).presets).toHaveLength(0);
    expect(config.voice).toBe("alice");
  });
  it("restores provider drafts across reloads and isolates them by world", async () => {
    const sovits = await voiceProviderDraft("world-a", config, "gpt-sovits");
    sovits.referencePath = "/voices/sample.wav";
    const compatible = await voiceProviderDraft("world-a", sovits, "compatible");
    expect(compatible).toEqual(config);
    useVoicePresets.setState({ ready: false });
    await loadVoicePresets();
    expect((await voiceProviderDraft("world-a", config, "gpt-sovits")).referencePath).toBe("/voices/sample.wav");
    expect((await voiceProviderDraft("world-b", config, "gpt-sovits")).referencePath).toBe("");
  });
  it("strips unknown fields and credentials before durable storage", async () => {
    const unsafe = { ...config, apiKey: "secret-token", speakers: { 甲: { voice: "bob", apiKey: "nested-secret" } } };
    await saveVoicePreset("安全方案", unsafe);
    await rememberVoiceDraft("world-a", unsafe);
    expect(JSON.stringify(await readVoicePresets())).not.toContain("secret");
    expect(normalizeVoicePresets({ presets: [null, { id: "broken" }] }).presets).toEqual([]);
  });
  it("validates relevant required fields before a service request", () => {
    expect(validateVoiceConfiguration(config)).toBeNull();
    expect(validateVoiceConfiguration({ ...config, model: "" })).toContain("模型 ID");
    expect(validateVoiceConfiguration({ ...config, voice: "" })).toContain("音色 ID");
    expect(validateVoiceConfiguration({ ...config, endpoint: "bad" })).toContain("服务地址");
    expect(validateVoiceConfiguration({ ...config, provider: "gpt-sovits" })).toContain("参考音频路径");
    expect(validateVoiceConfiguration({ ...config, voice: "" }, { voice: "npc" })).toBeNull();
  });
});
