// @vitest-environment jsdom

import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SettingsScreen } from "@/components/game/SettingsScreen";
import { EidosShell } from "@/components/shell/EidosShell";
import { DEFAULT_SETTINGS } from "@/lib/game/types";
import { enMessages } from "@/lib/ui/messages/en";
import { zhCNMessages } from "@/lib/ui/messages/zh-CN";
import { useGameStore } from "@/store/game-store";
import { savePluginLibrary } from '@/lib/game/plugins/library';
import { parseGameplayPlugins } from '@/lib/game/plugins/manifest';

/** Helper: click the "高级接入设置" checkbox to reveal per-role controls */
function openPage(name: string) {
  const menu = screen.queryByRole('button', { name: /^(设置分类|Settings sections)$/ });
  if (menu?.getAttribute('aria-expanded') === 'false') fireEvent.click(menu);
  fireEvent.click(screen.getByRole('button', { name }));
}
function enableAdvancedMode() {
  openPage('AI 接入');
  fireEvent.click(screen.getByText(/高级接入设置/).closest("label")!);
}

it('keeps unsaved settings when using the phone drawer, including loaded mod pages', () => {
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  useGameStore.setState({ currentWorld: { id: 'phone-world', gameplayPlugins: [{ format: 'eidos-gameplay-plugin', version: 1, id: 'phone-mod', name: '手机阅读模组', description: '用于手机的阅读偏好', tags: [], prompts: { creation: '', action: '', review: '' }, rules: [], settings: [] }] } as never });
  render(React.createElement(EidosShell, null, React.createElement(SettingsScreen)));
  fireEvent.click(screen.getByRole('button', { name: '阅读与自动操作' }));
  const picker = screen.getByRole('button', { name: '返回' });
  expect(picker.closest('section')?.getAttribute('data-mobile-directory')).toBe('detail');
  fireEvent.change(screen.getByLabelText('自定义提示词（ALICE）'), { target: { value: '用简洁的文字叙事' } });
  fireEvent.click(picker);
  fireEvent.click(screen.getByRole('button', { name: '手机阅读模组' }));
  expect(screen.getByRole('main').getAttribute('aria-label')).toBe('手机阅读模组 设置页');
  fireEvent.click(picker);
  fireEvent.click(screen.getByRole('button', { name: '阅读与自动操作' }));
  expect((screen.getByLabelText('自定义提示词（ALICE）') as HTMLTextAreaElement).value).toBe('用简洁的文字叙事');
  expect(JSON.parse(localStorage.getItem('eidos_settings')!).aliceUserPrompt).not.toBe('用简洁的文字叙事');
});

it('saves pregeneration and content review preferences through the existing draft workflow', () => {
  render(React.createElement(EidosShell, null, React.createElement(SettingsScreen)));
  openPage('阅读与自动操作');
  const prediction = screen.getByRole('checkbox', { name: '开启预生成' }) as HTMLInputElement;
  const review = screen.getByRole('checkbox', { name: '开启内容审核' }) as HTMLInputElement;
  expect(prediction.checked).toBe(true); expect(review.checked).toBe(true);
  fireEvent.click(prediction); fireEvent.click(review);
  expect(JSON.parse(localStorage.getItem('eidos_settings')!)).toMatchObject({ enableSpeculation: true, enableContentReview: true });
  fireEvent.click(screen.getByRole('button', { name: '保存设置' }));
  expect(JSON.parse(localStorage.getItem('eidos_settings')!)).toMatchObject({ enableSpeculation: false, enableContentReview: false });
  cleanup();
  render(React.createElement(EidosShell, null, React.createElement(SettingsScreen)));
  openPage('阅读与自动操作');
  expect((screen.getByRole('checkbox', { name: '开启预生成' }) as HTMLInputElement).checked).toBe(false);
  expect((screen.getByRole('checkbox', { name: '开启内容审核' }) as HTMLInputElement).checked).toBe(false);
});

beforeEach(() => {
  Object.defineProperties(HTMLDialogElement.prototype, {
    showModal: { configurable: true, value: function () { this.setAttribute('open', ''); } },
    close: { configurable: true, value: function () { this.removeAttribute('open'); } },
  });
  localStorage.clear();
  localStorage.setItem("eidos_settings", JSON.stringify(DEFAULT_SETTINGS));
  vi.stubGlobal("matchMedia", vi.fn(() => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })));
  useGameStore.setState({ history: [], currentWorld: null, phase: "settings", previousPhase: "playing", navigationStack: ["playing"] });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('edits shortcuts as a settings draft and prevents duplicate keys', () => {
  render(React.createElement(EidosShell, null, React.createElement(SettingsScreen)));
  openPage('快捷键');
  const advance = screen.getByLabelText('下一段 / 确认') as HTMLInputElement;
  expect(advance.value).toBe('z');
  fireEvent.change(advance, { target: { value: 'q' } });
  expect(JSON.parse(localStorage.getItem('eidos_settings')!).keyboardShortcuts?.advance ?? 'z').toBe('z');
  fireEvent.change(screen.getByLabelText('上一段'), { target: { value: 'q' } });
  expect(screen.getByRole('alert').textContent).toContain('已用于');
  expect((screen.getByLabelText('上一段') as HTMLInputElement).value).toBe('x');
  fireEvent.click(screen.getByRole('button', { name: '保存设置' }));
  expect(JSON.parse(localStorage.getItem('eidos_settings')!).keyboardShortcuts.advance).toBe('q');
});

it('lists only packages loaded in the current archive, retaining its version over the local library', () => {
  const [loaded] = parseGameplayPlugins([{ format: 'eidos-gameplay-plugin', version: 1, id: 'loaded', name: '本局模组', description: '本局版本的简介', tags: ['阅读'], prompts: { creation: '', action: '', review: '' }, rules: [] }]);
  savePluginLibrary([{ ...loaded, description: '库中的另一版本' }, { ...loaded, id: 'library-only', name: '未加载模组', description: '仅在本机库', settings: [{ id: 'hint', label: '未加载的开关', type: 'boolean', default: true }] }]);
  const world = { id: 'loaded-world', gameplayPlugins: [loaded] } as never;
  useGameStore.setState({ currentWorld: world });
  render(React.createElement(EidosShell, null, React.createElement(SettingsScreen)));
  openPage('模组');
  expect(screen.getByText('本局版本的简介')).toBeTruthy();
  expect(screen.queryByText('库中的另一版本')).toBeNull();
  expect(screen.queryAllByText('未加载模组')).toHaveLength(0);
  expect(screen.queryByRole('button', { name: '未加载模组' })).toBeNull();
  openPage('本局模组');
  expect(screen.getByRole('heading', { name: '本局模组' })).toBeTruthy();
  expect(screen.getByText('本局版本的简介')).toBeTruthy();
  expect(screen.getByRole('button', { name: '导出本局模组 JSON' })).toBeTruthy();
  // Switching archives while a mod page is open cannot retain an old package's controls.
  act(() => useGameStore.setState({ currentWorld: { id: 'empty-world', gameplayPlugins: [] } as never }));
  expect(screen.queryByText('本局版本的简介')).toBeNull();
  expect(screen.queryByRole('button', { name: '本局模组' })).toBeNull();
  expect(screen.queryByRole('button', { name: '导出本局模组 JSON' })).toBeNull();
  expect(screen.getByText('当前档案没有加载模组。')).toBeTruthy();
  expect(useGameStore.getState().currentWorld?.id).toBe('empty-world');
});

it('does not present the local authoring library as loaded mods without an open archive', () => {
  savePluginLibrary(parseGameplayPlugins([{ format: 'eidos-gameplay-plugin', version: 1, id: 'library-only', name: '库中模组', description: '尚未装入档案', tags: [], prompts: { creation: '', action: '', review: '' }, rules: [] }]));
  render(React.createElement(EidosShell, null, React.createElement(SettingsScreen)));
  openPage('全局插件');
  expect(screen.queryByText('库中模组')).toBeNull();
  expect(screen.getByText('还没有全局插件')).toBeTruthy();
});

describe("SettingsScreen", () => {
  it('lets the player enable DeepSeek thinking and choose its effort without forcing thinking through the reserve switch', () => {
    render(React.createElement(EidosShell, null, React.createElement(SettingsScreen)));
    enableAdvancedMode();
    const thinking = screen.getByRole('checkbox', { name: 'ALICE 思考模式' }) as HTMLInputElement;
    expect(thinking.checked).toBe(false);
    fireEvent.click(thinking);
    fireEvent.change(screen.getByLabelText('ALICE 思考强度'), { target: { value: 'max' } });
    fireEvent.click(screen.getByRole('button', { name: '保存设置' }));
    expect(JSON.parse(localStorage.getItem('eidos_settings')!)).toMatchObject({ aliceEnableReasoning: true,
      aliceReasoningEffort: 'max', reserveReasoningBudget: true });
  });
  it('saves the thinking reserve switch only after saving and restores it on reopening', () => {
    render(React.createElement(EidosShell, null, React.createElement(SettingsScreen)));
    openPage('AI 接入');
    const reserve = screen.getByRole('checkbox', { name: '生成限额预留思考额度' }) as HTMLInputElement;
    expect(reserve.checked).toBe(true);
    fireEvent.click(reserve);
    expect(JSON.parse(localStorage.getItem('eidos_settings')!).reserveReasoningBudget).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '保存设置' }));
    expect(JSON.parse(localStorage.getItem('eidos_settings')!).reserveReasoningBudget).toBe(false);
    cleanup(); render(React.createElement(EidosShell, null, React.createElement(SettingsScreen)));
    openPage('AI 接入');
    const restored = screen.getByRole('checkbox', { name: '生成限额预留思考额度' }) as HTMLInputElement;
    expect(restored.checked).toBe(false);
    fireEvent.click(restored); fireEvent.click(screen.getByRole('button', { name: '保存设置' }));
    expect(JSON.parse(localStorage.getItem('eidos_settings')!).reserveReasoningBudget).toBe(true);
  });
  it("keeps presentation and connection changes in a draft until saved", async () => {
    render(React.createElement(EidosShell, null, React.createElement(SettingsScreen)));
    enableAdvancedMode();
    fireEvent.change(screen.getByLabelText("KEI API 端点"), { target: { value: "https://draft.invalid" } });
    openPage('显示');
    fireEvent.change(screen.getByLabelText(/界面语言/), { target: { value: "en" } });
    expect(JSON.parse(localStorage.getItem("eidos_settings")!).interfaceLanguage).toBe("zh-CN");
    fireEvent.click(screen.getByRole("button", { name: "保存设置" }));
    await waitFor(() => expect(screen.getByText("Manage model connections and gameplay preferences")).not.toBeNull());
    const saved = JSON.parse(localStorage.getItem("eidos_settings")!);
    expect(saved.interfaceLanguage).toBe("en");
    expect(saved.keiEndpoint).toBe("https://draft.invalid");
    expect(saved.narrativeLanguage).toBe("zh-CN");
  });

  it("guards a dirty draft when returning to the source screen", () => {
    useGameStore.setState({ phase: "settings", previousPhase: "world_select", navigationStack: ["world_select"] });
    render(React.createElement(EidosShell, null, React.createElement(SettingsScreen)));
    openPage('AI 接入');
    fireEvent.change(screen.getByLabelText("API 密钥"), { target: { value: "draft" } });
    fireEvent.click(screen.getByRole("button", { name: "返回" }));
    expect(screen.getByRole("dialog")).not.toBeNull();
    expect(useGameStore.getState().phase).toBe("settings");
    fireEvent.click(screen.getByRole("button", { name: "放弃并离开" }));
    expect(useGameStore.getState().phase).toBe("world_select");
    expect(JSON.parse(localStorage.getItem("eidos_settings")!).aliceApiKey).toBe("");
  });
  it('opens the directory on a phone swipe and preserves the unsaved-change guard on return', () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
    useGameStore.setState({ phase: 'settings', navigationStack: ['playing'] });
    const view = render(React.createElement(EidosShell, null, React.createElement(SettingsScreen)));
    openPage('阅读与自动操作');
    fireEvent.change(screen.getByLabelText('自定义提示词（ALICE）'), { target: { value: '保留我的修改' } });
    const page = view.container.querySelector('.eidos-settings-screen')!;
    const finger = (x: number) => ({ identifier: 1, clientX: x, clientY: 200 });
    fireEvent.touchStart(page, { touches: [finger(35)] }); fireEvent.touchMove(page, { touches: [finger(160)] });
    fireEvent.touchEnd(page, { touches: [], changedTouches: [finger(160)] });
    expect(page.getAttribute('data-mobile-directory')).toBe('index');
    expect(useGameStore.getState().phase).toBe('settings');
    fireEvent.click(screen.getByRole('button', { name: '返回' }));
    expect(screen.getByRole('dialog', { name: '保存更改后再离开？' })).toBeTruthy();
    expect(useGameStore.getState().phase).toBe('settings');
    fireEvent.click(screen.getByRole('button', { name: '继续编辑' }));
    expect((screen.getByLabelText('自定义提示词（ALICE）') as HTMLTextAreaElement).value).toBe('保留我的修改');
  });

  it("confirms before changing the language of future output in a continuity with narrative", () => {
    useGameStore.setState({ history: [{ summary: "已有叙事" }] as never });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(React.createElement(EidosShell, null, React.createElement(SettingsScreen)));

    fireEvent.change(screen.getByLabelText(/叙事生成语言/), { target: { value: "en" } });

    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("只影响之后生成的内容"));
    expect((screen.getByLabelText(/叙事生成语言/) as HTMLSelectElement).value).toBe("zh-CN");
    expect(JSON.parse(localStorage.getItem("eidos_settings") ?? "{}").narrativeLanguage).toBe("zh-CN");
  });

  it("keeps exact message-key parity between locales", () => {
    expect(Object.keys(enMessages).sort()).toEqual(Object.keys(zhCNMessages).sort());
  });

  it("localizes every model configuration label in both interface languages", async () => {
    render(React.createElement(EidosShell, null, React.createElement(SettingsScreen)));
    enableAdvancedMode();

    // Advanced mode has only the three role editors.
    expect(screen.getAllByText(/^(ALICE|KEI|UZQ) API 密钥$/)).toHaveLength(3);
    expect(screen.getByText("温度")).not.toBeNull();
    expect(screen.getByText("最大 Token 数")).not.toBeNull();

    openPage('显示');
    fireEvent.change(screen.getByLabelText(/界面语言/), { target: { value: "en" } });
    fireEvent.click(screen.getByRole("button", { name: "保存设置" }));

    openPage('AI Access');
    await waitFor(() => expect(screen.getAllByText(/^(ALICE|KEI|UZQ) API Key$/)).toHaveLength(3));
    expect(screen.getByText("Temperature")).not.toBeNull();
    expect(screen.getByText("Max Tokens")).not.toBeNull();
  });

  it("persists the UZQ-to-ALICE brief toggle", () => {
    render(React.createElement(EidosShell, null, React.createElement(SettingsScreen)));
    enableAdvancedMode();

    fireEvent.click(screen.getByLabelText(/向 ALICE 注入 UZQ 人格简报/));
    fireEvent.click(screen.getByRole("button", { name: "保存设置" }));

    expect(JSON.parse(localStorage.getItem("eidos_settings") ?? "{}").enableUzqAliceBrief).toBe(true);
  });

  it("tests the current AI connection from the simple setup panel", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true }),
    });
    vi.stubGlobal("fetch", fetchMock);
    render(React.createElement(EidosShell, null, React.createElement(SettingsScreen)));

    openPage('AI 接入');
    fireEvent.change(screen.getByLabelText("API 密钥"), { target: { value: "player-key" } });
    openPage('AI 接入');
    fireEvent.click(screen.getByRole("button", { name: "测试连接" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "/api/ai/test-connection",
      "/api/ai/test-connection",
      "/api/ai/test-connection",
    ]);
    const bodies = fetchMock.mock.calls.map(([, init]) => JSON.parse((init as RequestInit).body as string));
    expect(bodies.map((body) => body.role)).toEqual(["alice", "kei", "uzq"]);
    expect(bodies[0].settings.aliceApiKey).toBe("player-key");
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("连接正常"));
  });

  it("shows provider test failures without saving settings", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ error: "未填写 API Key。" }),
    }));
    render(React.createElement(EidosShell, null, React.createElement(SettingsScreen)));

    openPage('AI 接入');
    fireEvent.click(screen.getByRole("button", { name: "测试连接" }));

    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("未填写 API Key"));
    expect(JSON.parse(localStorage.getItem("eidos_settings") ?? "{}").aliceApiKey).toBe("");
  });

  it("reconciles clean remote fields while preserving and saving dirty local fields", async () => {
    render(React.createElement(EidosShell, null, React.createElement(SettingsScreen)));
    enableAdvancedMode();
    const localEndpoint = "https://local-draft.invalid";
    fireEvent.change(screen.getAllByDisplayValue(DEFAULT_SETTINGS.keiEndpoint)[0], {
      target: { value: localEndpoint },
    });

    const remote = {
      ...DEFAULT_SETTINGS,
      interfaceLanguage: "en" as const,
      aliceModel: "remote-alice-model",
      maxTokens: 9000,
    };
    localStorage.setItem("eidos_settings", JSON.stringify(remote));
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: "eidos_settings" }));
    });

    await waitFor(() => expect(screen.getByText("Settings")).not.toBeNull());
    expect(screen.getByDisplayValue("remote-alice-model")).not.toBeNull();
    expect(screen.getByDisplayValue(localEndpoint)).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));
    const persisted = JSON.parse(localStorage.getItem("eidos_settings") ?? "{}");
    expect(persisted.keiEndpoint).toBe(localEndpoint);
    expect(persisted.aliceModel).toBe("remote-alice-model");
    expect(persisted.maxTokens).toBe(9000);
  });

  it("keeps a failed presentation draft editable and reports the error", () => {
    render(React.createElement(EidosShell, null, React.createElement(SettingsScreen)));
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("denied");
    });
    vi.spyOn(console, "warn").mockImplementation(() => {});

    openPage('显示');
    fireEvent.change(screen.getByLabelText(/界面语言/), { target: { value: "en" } });

    fireEvent.click(screen.getByRole("button", { name: "保存设置" }));
    expect((screen.getByLabelText(/界面语言/) as HTMLSelectElement).value).toBe("en");
    expect(screen.getByRole("alert").textContent).toContain("保存设置失败");
  });

  it("does not report success when saving a dirty draft fails", () => {
    render(React.createElement(EidosShell, null, React.createElement(SettingsScreen)));
    enableAdvancedMode();
    fireEvent.change(screen.getAllByDisplayValue(DEFAULT_SETTINGS.keiEndpoint)[0], {
      target: { value: "https://local-draft.invalid" },
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("denied");
    });
    vi.spyOn(console, "warn").mockImplementation(() => {});

    fireEvent.click(screen.getByRole("button", { name: "保存设置" }));

    expect(screen.queryByText("已保存")).toBeNull();
    expect(screen.getByRole("alert").textContent).toContain("保存设置失败");
  });

  it("associates localized labels with model and numeric controls", async () => {
    render(React.createElement(EidosShell, null, React.createElement(SettingsScreen)));
    enableAdvancedMode();

    expect(screen.getAllByLabelText(/API 端点/).map((control) => control.id)).toEqual([
      "settings-kei-endpoint",
      "settings-uzq-endpoint",
      "settings-alice-endpoint",
    ]);
    expect(screen.getAllByLabelText(/API 密钥/).map((control) => control.id)).toEqual([
      "settings-kei-api-key",
      "settings-uzq-api-key",
      "settings-alice-api-key",
    ]);
    expect(screen.getByLabelText("温度")).not.toBeNull();
    expect(screen.getByLabelText("最大 Token 数")).not.toBeNull();
    openPage('显示');
    expect(screen.getByLabelText(/界面语言/)).not.toBeNull();
    expect(screen.getByLabelText(/界面主题/)).not.toBeNull();
    openPage('阅读与自动操作');
    expect(screen.getByLabelText("阅读与自动操作")).not.toBeNull();
    expect(screen.getByLabelText("自动存档间隔")).not.toBeNull();

    openPage('显示');
    fireEvent.change(screen.getByLabelText(/界面语言/), { target: { value: "en" } });
    fireEvent.click(screen.getByRole("button", { name: "保存设置" }));

    openPage('AI Access');
    await waitFor(() => expect(screen.getAllByLabelText(/API endpoint/)).toHaveLength(3));
    expect(screen.getAllByLabelText(/API Key/)).toHaveLength(3);
    expect(screen.getByLabelText("Temperature")).not.toBeNull();
    expect(screen.getByLabelText("Max Tokens")).not.toBeNull();
    openPage('Display');
    expect(screen.getByLabelText(/Narrative language/)).not.toBeNull();
    expect(screen.getByLabelText(/Interface theme/)).not.toBeNull();
    openPage('Reading and automation');
    expect(screen.getByLabelText("Reading and automation")).not.toBeNull();
    expect(screen.getByLabelText("Autosave interval")).not.toBeNull();
  });
});

it('provides real category pages and saves author preferences without altering the story state', () => {
  useGameStore.setState({ currentWorld: { id: 'settings-world', gameplayPlugins: [{ format: 'eidos-gameplay-plugin', version: 1, id: 'novel-settings', name: '连续小说', description: '作者偏好', tags: [], prompts: { creation: '', action: '', review: '' }, rules: [], settings: [
    { id: 'hints', label: '显示提示', type: 'boolean', default: true },
    { id: 'speed', label: '阅读速度', type: 'number', default: 2, min: 1, max: 4 },
    { id: 'layout', label: '排版', type: 'select', default: '宽松', options: ['宽松', '紧凑'] },
    { id: 'title', label: '自定标题', type: 'string', default: '旅程' },
  ] }] } as never, gameplayModState: {} });
  render(React.createElement(EidosShell, null, React.createElement(SettingsScreen)));
  expect(screen.getByLabelText(/界面语言/)).toBeTruthy(); expect(screen.queryByLabelText('API 密钥')).toBeNull();
  expect(within(screen.getByRole('navigation', { name: '设置分类' })).getByRole('button', { name: '作者工具' })).toBeTruthy();
  const modNavigation = within(screen.getByRole('navigation', { name: '设置分类' })).getByRole('group', { name: '模组设置' });
  expect(within(modNavigation).queryByRole('button', { name: '作者工具' })).toBeNull();
  expect(within(modNavigation).getByRole('button', { name: '连续小说' })).toBeTruthy();
  openPage('连续小说');
  expect(screen.queryByLabelText(/界面语言/)).toBeNull();
  fireEvent.click(screen.getByRole('checkbox', { name: '显示提示' }));
  fireEvent.change(screen.getByLabelText('阅读速度'), { target: { value: '3' } });
  fireEvent.change(screen.getByLabelText('排版'), { target: { value: '紧凑' } });
  fireEvent.change(screen.getByLabelText('自定标题'), { target: { value: '河岸' } });
  expect(JSON.parse(localStorage.getItem('eidos_settings')!).modPreferences).toEqual({});
  // A second window saves a preference belonging to another mod without a storage event.
  localStorage.setItem('eidos_settings', JSON.stringify({ ...DEFAULT_SETTINGS, modPreferences: { other: { sound: false } } }));
  fireEvent.click(screen.getByRole('button', { name: '保存设置' }));
  expect(JSON.parse(localStorage.getItem('eidos_settings')!).modPreferences).toEqual({ other: { sound: false }, 'novel-settings': { hints: false, speed: 3, layout: '紧凑', title: '河岸' } });
  expect(useGameStore.getState().gameplayModState).toEqual({});
  openPage('显示'); openPage('连续小说');
  expect((screen.getByLabelText('阅读速度') as HTMLInputElement).value).toBe('3');
  fireEvent.click(screen.getByRole('button', { name: '恢复此模组默认设置' }));
  expect((screen.getByLabelText('阅读速度') as HTMLInputElement).value).toBe('2');
});

it('previews palette drafts locally, applies only on save, and supports discarding', async () => {
  render(React.createElement(EidosShell, null, React.createElement(SettingsScreen)));
  await waitFor(() => expect(document.documentElement.dataset.palette).toBe('classic'));
  fireEvent.click(screen.getByRole('button', { name: '暖灰书页' }));
  expect(document.documentElement.dataset.palette).toBe('classic');
  expect(JSON.parse(localStorage.getItem('eidos_settings')!).interfacePalette).toBe('classic');
  fireEvent.click(screen.getByRole('button', { name: '阅读与自动操作' }));
  fireEvent.click(screen.getByRole('button', { name: '显示' }));
  expect(screen.getByRole('button', { name: '暖灰书页' }).getAttribute('aria-pressed')).toBe('true');
  fireEvent.click(screen.getByRole('button', { name: '保存设置' }));
  await waitFor(() => expect(document.documentElement.dataset.palette).toBe('warm'));
  expect(JSON.parse(localStorage.getItem('eidos_settings')!)).toMatchObject({ interfacePalette: 'warm', interfaceTheme: 'light' });
  fireEvent.click(screen.getByRole('button', { name: '经典红黑白' }));
  fireEvent.click(screen.getByRole('button', { name: '放弃更改' }));
  expect(screen.getByRole('button', { name: '暖灰书页' }).getAttribute('aria-pressed')).toBe('true');
  expect(document.documentElement.dataset.palette).toBe('warm');
});

it('saves custom theme colors separately for light and dark modes and applies the saved colors', async () => {
  render(React.createElement(EidosShell, null, React.createElement(SettingsScreen)));
  fireEvent.click(screen.getByRole('button', { name: '自定义' }));
  fireEvent.change(screen.getByLabelText('自定义背景'), { target: { value: '#f1ecdf' } });
  fireEvent.change(screen.getByLabelText('自定义强调色'), { target: { value: '#215f88' } });
  expect(document.documentElement.style.getPropertyValue('--eidos-palette-background')).not.toBe('#f1ecdf');
  fireEvent.click(screen.getByRole('button', { name: '保存设置' }));
  await waitFor(() => expect(document.documentElement.style.getPropertyValue('--eidos-palette-background')).toBe('#f1ecdf'));
  fireEvent.change(screen.getByLabelText('界面主题'), { target: { value: 'dark' } });
  expect((screen.getByLabelText('自定义背景') as HTMLInputElement).value).toBe('#151515');
  fireEvent.change(screen.getByLabelText('自定义背景'), { target: { value: '#112233' } });
  fireEvent.click(screen.getByRole('button', { name: '保存设置' }));
  await waitFor(() => expect(document.documentElement.style.getPropertyValue('--eidos-palette-background')).toBe('#112233'));
  const colors = JSON.parse(localStorage.getItem('eidos_settings')!).interfaceCustomColors;
  expect(colors.light.background).toBe('#f1ecdf'); expect(colors.dark.background).toBe('#112233');
});

it('keeps ALICE instructions and compression thresholds in one draft and saves or discards them together', () => {
  render(React.createElement(EidosShell, null, React.createElement(SettingsScreen)));
  openPage('阅读与自动操作');
  expect((screen.getByLabelText('自定义提示词（ALICE）') as HTMLTextAreaElement).value).toBe('');
  expect((screen.getByRole('slider', { name: '压缩目标下限' }) as HTMLInputElement).value).toBe('15');
  expect((screen.getByRole('slider', { name: '压缩触发上限' }) as HTMLInputElement).value).toBe('35');
  fireEvent.change(screen.getByLabelText('自定义提示词（ALICE）'), { target: { value: '保留人物动作与声音。' } });
  fireEvent.change(screen.getByRole('slider', { name: '压缩触发上限' }), { target: { value: '80' } });
  fireEvent.change(screen.getByRole('slider', { name: '压缩目标下限' }), { target: { value: '50' } });
  expect(JSON.parse(localStorage.getItem('eidos_settings')!).aliceUserPrompt).toBe('');
  openPage('显示'); openPage('阅读与自动操作');
  expect((screen.getByLabelText('自定义提示词（ALICE）') as HTMLTextAreaElement).value).toBe('保留人物动作与声音。');
  expect(screen.getByText(/已压缩节点.*完整节点/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '保存设置' }));
  expect(JSON.parse(localStorage.getItem('eidos_settings')!)).toMatchObject({ aliceUserPrompt: '保留人物动作与声音。', contextCompressionLowerPercent: 50, contextCompressionUpperPercent: 80 });
  fireEvent.change(screen.getByRole('slider', { name: '压缩触发上限' }), { target: { value: '30' } });
  expect((screen.getByRole('slider', { name: '压缩目标下限' }) as HTMLInputElement).value).toBe('30');
  fireEvent.click(screen.getByRole('button', { name: '放弃更改' }));
  expect((screen.getByRole('slider', { name: '压缩目标下限' }) as HTMLInputElement).value).toBe('50');
});

it('saves narration and background overlay preferences through the settings draft', () => {
  render(React.createElement(EidosShell, null, React.createElement(SettingsScreen)));
  const narration = screen.getByRole('checkbox', { name: '旁白不通过对话框展示' }) as HTMLInputElement;
  expect(narration.checked).toBe(true);
  fireEvent.click(narration);
  fireEvent.change(screen.getByRole('slider', { name: '场景遮罩不透明度' }), { target: { value: '25' } });
  expect(JSON.parse(localStorage.getItem('eidos_settings')!)).toMatchObject({ hideNarrationInDialogue: true, sceneOverlayOpacity: 100 });
  fireEvent.click(screen.getByRole('button', { name: '保存设置' }));
  expect(JSON.parse(localStorage.getItem('eidos_settings')!)).toMatchObject({ hideNarrationInDialogue: false, sceneOverlayOpacity: 25 });
});
