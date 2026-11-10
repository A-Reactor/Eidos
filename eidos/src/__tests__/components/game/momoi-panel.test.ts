// @vitest-environment jsdom
import "fake-indexeddb/auto";
import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MomoiPanel } from "@/components/game/MomoiPanel";
import { LocaleProvider } from '@/components/shell/LocaleProvider';
import { useGameStore } from "@/store/game-store";
import { checkVoiceService } from "@/lib/game/momoi/service-status";
import { DEFAULT_VOICE_CONFIG, buildVoiceRequest, voiceIdentity } from '@/lib/game/momoi/model';
vi.mock("@/lib/game/momoi/runtime", () => ({ getVoiceLibrary: async () => ({ assets: {} }), voiceScope: () => "test", voiceCredentialKey: (endpoint: string) => endpoint, requestForSegment: () => null }));
const installation = { checks: [{ label: 'Python', ready: true, detail: '/python' }], languageResources: ['zh', 'ja', 'en'].map(id => ({ id, ready: true, detail: '已安装' })), models: [{ version: 'v1', languages: ['zh', 'ja', 'en'], ready: true }] };
beforeEach(() => {
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  useGameStore.getState().setVoiceConfig(DEFAULT_VOICE_CONFIG);
  useGameStore.getState().setMomoiSettings({ enabled: false });
  vi.stubGlobal("fetch", vi.fn(async (url: string) => Response.json(url.includes('installation') ? installation : { status: 'offline' })));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
describe("MOMOI player controls", () => {
  it('localizes audio navigation, controls and language names while keeping language codes stable', async () => {
    const view = render(React.createElement(LocaleProvider, { locale: 'en' }, React.createElement(MomoiPanel, { open: true, onClose: vi.fn() })));
    expect(screen.getByRole('region', { name: 'Audio management' })).toBeTruthy();
    expect(screen.getByRole('checkbox', { name: 'Enable dialogue speech' })).toBeTruthy();
    await waitFor(() => expect(screen.getByLabelText('Original text language').querySelector('option[value="ja"]')?.textContent).toBe('Japanese'));
    fireEvent.click(screen.getByRole('button', { name: 'Models and voices' }));
    expect(screen.getByRole('main', { name: 'Models and voices' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Generate preview' })).toBeTruthy();
    view.rerender(React.createElement(LocaleProvider, { locale: 'zh-CN' }, React.createElement(MomoiPanel, { open: true, onClose: vi.fn() })));
    expect(screen.getByRole('main', { name: '模型与音色' })).toBeTruthy();
    await act(async () => {});
  });
  it('restores initial local weights from the model loading controls while keeping reference audio and character overrides', async () => {
    act(() => useGameStore.getState().setVoiceConfig({ ...DEFAULT_VOICE_CONFIG, model: 'v2ProPlus · 训练音色', voice: '训练音色',
      referenceAudio: 'UklGRg==', referenceText: '参考台词', referenceLanguage: 'ja', gptWeights: '/trained.ckpt', sovitsWeights: '/trained.pth',
      speakers: { 爱丽丝: { voice: '角色音色', gptWeights: '/alice.ckpt', sovitsWeights: '/alice.pth' } } }));
    const segment = { type: 'dialogue' as const, speaker: '未指定角色', text: '你好' };
    const previous = buildVoiceRequest(segment, useGameStore.getState().voiceConfig)!;
    render(React.createElement(MomoiPanel, { open: true, onClose: vi.fn() }));
    fireEvent.click(screen.getByRole('button', { name: '模型与音色' }));
    await act(async () => {});
    const reset = screen.getByRole('button', { name: '恢复初始权重' });
    expect(reset.closest('details')).toBeNull();
    fireEvent.click(reset);
    const config = useGameStore.getState().voiceConfig;
    expect(config.gptWeights).toBeUndefined();
    expect(config.sovitsWeights).toBeUndefined();
    expect(config.model).toBe('');
    expect(config).toMatchObject({ provider: 'legacy', voice: '训练音色', referenceAudio: 'UklGRg==', referenceText: '参考台词', referenceLanguage: 'ja',
      speakers: { 爱丽丝: { gptWeights: '/alice.ckpt', sovitsWeights: '/alice.pth' } } });
    const next = buildVoiceRequest(segment, config)!;
    expect(next.voice.gptWeights).toBeUndefined();
    expect(next.voice.sovitsWeights).toBeUndefined();
    expect(await voiceIdentity(next)).not.toBe(await voiceIdentity(previous));
    expect(screen.getByText('当前配置：初始权重')).toBeTruthy();
    await act(async () => {});
  });
  it('lets a trained local character inherit the default model without removing its reference', async () => {
    act(() => useGameStore.getState().setVoiceConfig({ ...DEFAULT_VOICE_CONFIG,
      speakers: { 爱丽丝: { voice: '角色音色', referenceAudio: 'UklGRg==', referenceText: '你好', gptWeights: '/alice.ckpt', sovitsWeights: '/alice.pth' } } }));
    render(React.createElement(MomoiPanel, { open: true, onClose: vi.fn() }));
    fireEvent.click(screen.getByRole('button', { name: '模型与音色' }));
    fireEvent.change(screen.getByLabelText('为谁设置音色'), { target: { value: '爱丽丝' } });
    fireEvent.click(screen.getByRole('button', { name: '使用默认模型' }));
    const config = useGameStore.getState().voiceConfig;
    expect(config.speakers.爱丽丝.gptWeights).toBeUndefined();
    expect(config.speakers.爱丽丝.sovitsWeights).toBeUndefined();
    expect(config.speakers.爱丽丝).toMatchObject({ voice: '角色音色', referenceAudio: 'UklGRg==', referenceText: '你好' });
    const next = buildVoiceRequest({ type: 'dialogue', speaker: '爱丽丝', text: '你好' }, config)!;
    expect(next.voice.gptWeights).toBeUndefined();
    expect(next.voice.referenceAudio).toBe('UklGRg==');
    expect(screen.getByText('当前配置：沿用默认模型 · 初始权重')).toBeTruthy();
    await act(async () => {});
  });
  it('previews the selected character with its community model and keeps advanced weights collapsible', async () => {
    act(() => useGameStore.getState().setVoiceConfig({ ...DEFAULT_VOICE_CONFIG, provider: 'gpt-sovits', endpoint: 'http://localhost:9880', referencePath: '/default.wav',
      gptWeights: '/default.ckpt', sovitsWeights: '/default.pth', speakers: { 爱丽丝: { referencePath: '/alice.wav', gptWeights: '/alice.ckpt', sovitsWeights: '/alice_lora.pth' } } }));
    const play = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('Audio', class { volume = 1; play = play; pause() {} });
    let sent: Record<string, unknown> = {};
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => { if (_url.includes('installation')) return Response.json(installation); sent = JSON.parse(String(init.body)); return { ok: true, json: async () => ({ audioBase64: 'UklGRg==', mimeType: 'audio/wav' }) }; });
    render(React.createElement(MomoiPanel, { open: true, onClose: vi.fn() }));
    fireEvent.click(screen.getByRole('button', { name: '模型与音色' }));
    fireEvent.change(screen.getByLabelText('为谁设置音色'), { target: { value: '爱丽丝' } });
    fireEvent.click(screen.getByText('社区模型与 LoRA（可选）'));
    expect((screen.getByLabelText('GPT 权重路径') as HTMLInputElement).value).toBe('/alice.ckpt');
    expect((screen.getByLabelText('SoVITS / LoRA 权重路径') as HTMLInputElement).value).toBe('/alice_lora.pth');
    fireEvent.click(screen.getByRole('button', { name: '生成并试听' }));
    await waitFor(() => expect(sent).toMatchObject({ speaker: '爱丽丝', voice: { referencePath: '/alice.wav', gptWeights: '/alice.ckpt', sovitsWeights: '/alice_lora.pth' } }));
    await screen.findByText('连接成功，正在播放试听。');
    act(() => useGameStore.getState().setVoiceConfig({ speakers: { 试听: { referencePath: '/wrong.wav', gptWeights: '/wrong.ckpt', sovitsWeights: '/wrong.pth' } } }));
    fireEvent.change(screen.getByLabelText('为谁设置音色'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: '生成并试听' }));
    await waitFor(() => expect(sent).toMatchObject({ voice: { referencePath: '/default.wav', gptWeights: '/default.ckpt', sovitsWeights: '/default.pth' } }));
  });
  it('offers built-in Japanese dubbing only after checking weights, without a plugin', async () => {
    act(() => useGameStore.getState().setVoiceConfig({ material: 'original' }));
    render(React.createElement(MomoiPanel, { open: true, onClose: vi.fn() }));
    const select = screen.getByLabelText('语音生成材料') as HTMLSelectElement;
    expect(select.value).toBe('original');
    await waitFor(() => expect(select.querySelector('option[value="ja"]')).toBeTruthy());
    expect(select.querySelector('option[value="ko"]')).toBeNull();
    expect(screen.queryByText('启用日语语音材料插件')).toBeNull();
    fireEvent.change(select, { target: { value: 'ja' } });
    expect(useGameStore.getState().voiceConfig.material).toBe('japanese');
    expect(useGameStore.getState().serializeState().momoiVoiceSettings?.config?.material).toBe('japanese');
    fireEvent.change(screen.getByLabelText('语音生成材料'), { target: { value: 'original' } });
    expect(useGameStore.getState().voiceConfig.material).toBeUndefined();
    await act(async () => {});
  });
  it('provides an in-game installation checker that players can rerun', async () => {
    render(React.createElement(MomoiPanel, { open: true, onClose: vi.fn() }));
    fireEvent.click(screen.getByRole('button', { name: '安装检查' }));
    const button = await screen.findByRole('button', { name: '检查安装情况' });
    expect(screen.getByRole('region', { name: '语音环境检查' })).toBeTruthy();
    expect(screen.getByText(/当前权重可用的译文语言：中文、日语、英语/)).toBeTruthy();
    const before = vi.mocked(fetch).mock.calls.filter(call => String(call[0]).includes('installation')).length;
    fireEvent.click(button);
    await waitFor(() => expect(vi.mocked(fetch).mock.calls.filter(call => String(call[0]).includes('installation')).length).toBe(before + 1));
    await act(async () => {});
  });
  it("keeps the enable button truthful as service and playback states change", async () => {
    render(React.createElement(MomoiPanel, { open: true, onClose: vi.fn() }));
    await act(async () => {});
    const toggle = screen.getByRole("checkbox", { name: "启用对话语音" }) as HTMLInputElement;
    expect(toggle.checked).toBe(false);
    fireEvent.click(toggle);
    expect(toggle.checked).toBe(true);
    expect(screen.getByText('服务未启动')).toBeTruthy();
    act(() => useGameStore.setState({ momoiStatus: "ready", voiceError: null }));
    expect(screen.getByText('服务就绪')).toBeTruthy();
    act(() => useGameStore.setState({ isVoicePlaying: true }));
    expect(screen.getByText('播放中')).toBeTruthy();
    fireEvent.click(toggle);
    expect(screen.getByText('已关闭')).toBeTruthy();
    expect(screen.queryByText('播放中')).toBeNull();
    act(() => useGameStore.setState({ isVoicePlaying: false }));
  });
  it("identifies the current page after both tab and in-page navigation", async () => {
    render(React.createElement(MomoiPanel, { open: true, onClose: vi.fn() }));
    expect(screen.getByRole("button", { name: "播放与语言" }).getAttribute("aria-current")).toBe("page");
    fireEvent.click(screen.getByRole("button", { name: "选择模型与音色" }));
    expect(screen.getByRole("button", { name: "模型与音色" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("button", { name: "播放与语言" }).getAttribute("aria-current")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "音频资源" }));
    expect(screen.getByRole("button", { name: "音频资源" }).getAttribute("aria-current")).toBe("page");
    await act(async () => {});
  });
  it("offers playback, connection and resources on a standalone page", async () => {
    const close = vi.fn();
    render(React.createElement(MomoiPanel, { open: true, onClose: close }));
    expect(screen.getByRole("region", { name: "音频管理" })).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByLabelText("启用对话语音"));
    expect(useGameStore.getState().momoiSettings.enabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "模型与音色" }));
    fireEvent.change(screen.getByLabelText("生成服务"), { target: { value: "compatible" } });
    expect(await screen.findByLabelText("模型 ID")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("音色 ID"), { target: { value: "alice" } });
    expect(useGameStore.getState().voiceConfig.voice).toBe("alice");
    fireEvent.click(screen.getByRole("button", { name: "音频资源" }));
    await act(async () => {});
    expect(screen.getByRole("button", { name: "补齐本组对话" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "返回上一级" }));
    expect(close).toHaveBeenCalledOnce();
  });
  it('keeps the current category and expanded form when changing the dubbing language', async () => {
    render(React.createElement(MomoiPanel, { open: true, onClose: vi.fn() }));
    await waitFor(() => expect(screen.getByLabelText('语音生成材料').querySelector('option[value="ja"]')).toBeTruthy());
    fireEvent.change(screen.getByLabelText('语音生成材料'), { target: { value: 'ja' } });
    expect(screen.getByRole('main', { name: '播放与语言' })).toBeTruthy();
    expect((screen.getByLabelText('语音生成材料') as HTMLSelectElement).value).toBe('ja');
    expect(screen.getByRole('button', { name: '播放与语言' }).getAttribute('aria-current')).toBe('page');
  });
  it('provides direct training and inspection pages and retains training drafts between categories', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => Response.json(url.includes('installation') ? installation : url.includes('view=environment') ? {
      versions: [], asr: {}, ffmpeg: true, configuredModel: 'v2ProPlus', missingModules: []
    } : url.includes('/training') ? { jobs: [] } : { status: 'offline' })));
    render(React.createElement(MomoiPanel, { open: true, onClose: vi.fn() }));
    fireEvent.click(screen.getByRole('button', { name: '训练音色' }));
    fireEvent.change(screen.getByLabelText('新音色名称'), { target: { value: '尚未导入的音色' } });
    fireEvent.click(screen.getByRole('button', { name: '安装检查' }));
    await screen.findByRole('button', { name: '检查安装情况' });
    expect(screen.queryByRole('textbox', { name: '新音色名称' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '训练音色' }));
    expect((screen.getByLabelText('新音色名称') as HTMLInputElement).value).toBe('尚未导入的音色');
    await act(async () => {});
  });
  it('retains transcript corrections and shares the selected character with the training page', async () => {
    act(() => useGameStore.getState().setVoiceConfig({ speakers: { 爱丽丝: {} } }));
    vi.stubGlobal('fetch', vi.fn(async (url: string) => Response.json(url.includes('installation') ? installation : url.includes('view=environment') ? {
      versions: [], asr: {}, ffmpeg: true, configuredModel: 'v2ProPlus', missingModules: []
    } : url.includes('/training') ? { jobs: [{ id: 'review', name: '待校对', version: 'v2ProPlus', language: 'zh', status: 'review', stage: '校对台词',
      clips: [{ id: 'clip', duration: 5, text: '原台词', included: true }] }] } : { status: 'offline' })));
    render(React.createElement(MomoiPanel, { open: true, onClose: vi.fn() }));
    fireEvent.click(screen.getByRole('button', { name: '模型与音色' }));
    fireEvent.change(screen.getByLabelText('为谁设置音色'), { target: { value: '爱丽丝' } });
    fireEvent.click(screen.getByRole('button', { name: '训练音色' }));
    expect((screen.getByLabelText('训练完成后应用到') as HTMLSelectElement).value).toBe('爱丽丝');
    fireEvent.change(await screen.findByLabelText('片段 1 台词'), { target: { value: '我校对后的台词' } });
    fireEvent.click(screen.getByRole('button', { name: '安装检查' }));
    fireEvent.click(screen.getByRole('button', { name: '训练音色' }));
    expect((screen.getByLabelText('片段 1 台词') as HTMLTextAreaElement).value).toBe('我校对后的台词');
    await act(async () => {});
  });
  it("shows startup, model loading and readiness directly on the start button", async () => {
    render(React.createElement(MomoiPanel, { open: true, onClose: vi.fn() }));
    fireEvent.click(screen.getByRole("button", { name: "模型与音色" }));
    await act(async () => {});
    const start = screen.getByRole("button", { name: "启动本地模型" });
    vi.mocked(fetch).mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true, status: "loading_model" }) } as Response);
    await act(async () => { fireEvent.click(start); });
    expect((screen.getByRole("button", { name: "模型加载中…" }) as HTMLButtonElement).disabled).toBe(true);
    vi.mocked(fetch).mockResolvedValueOnce({ ok: true, json: async () => ({ status: "ready" }) } as Response);
    await act(async () => { await checkVoiceService(); });
    expect((screen.getByRole("button", { name: "模型已就绪" }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByText("本地语音服务已就绪")).toBeTruthy();
  });
  it("saves and reapplies a named model with NPC overrides, preserving provider drafts", async () => {
    render(React.createElement(MomoiPanel, { open: true, onClose: vi.fn() }));
    fireEvent.click(screen.getByRole("button", { name: "模型与音色" }));
    fireEvent.change(screen.getByLabelText("生成服务"), { target: { value: "compatible" } });
    await screen.findByLabelText("模型 ID");
    fireEvent.change(screen.getByLabelText("模型 ID"), { target: { value: "kokoro" } });
    fireEvent.change(screen.getByLabelText("音色 ID"), { target: { value: "alice" } });
    act(() => useGameStore.getState().setVoiceConfig({ speakers: { 甲: { voice: "bob" } } }));
    fireEvent.click(screen.getByText("保存与管理方案"));
    fireEvent.change(screen.getByLabelText("方案名称"), { target: { value: "中文角色" } });
    fireEvent.click(screen.getByRole("button", { name: "另存为新方案" }));
    await screen.findByText("已保存为新方案");
    const id = (screen.getByLabelText("已保存方案") as HTMLSelectElement).value;
    fireEvent.change(screen.getByLabelText("生成服务"), { target: { value: "gpt-sovits" } });
    await screen.findByLabelText("参考音频路径");
    fireEvent.change(screen.getByLabelText("参考音频路径"), { target: { value: "/voice/test.wav" } });
    fireEvent.change(screen.getByLabelText("生成服务"), { target: { value: "compatible" } });
    await screen.findByLabelText("模型 ID");
    expect(useGameStore.getState().voiceConfig.model).toBe("kokoro");
    expect(useGameStore.getState().voiceConfig.speakers.甲.voice).toBe("bob");
    fireEvent.change(screen.getByLabelText("音色 ID"), { target: { value: "changed" } });
    fireEvent.change(screen.getByLabelText("已保存方案"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("已保存方案"), { target: { value: id } });
    await waitFor(() => expect(useGameStore.getState().voiceConfig.voice).toBe("alice"));
  });
});
