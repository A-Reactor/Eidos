// @vitest-environment jsdom

import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { IdentitySelect, getDefaultStartingScene } from "@/components/game/IdentitySelect";
import { loadIdentityOptions } from '@/store/game-store';

const identityOptions = [
  { id: 'asagiri', name: '朝雾', description: '档案管理员', startingScene: 'upper_district', openingNarrative: '朝雾整理着随身的笔记。' },
  {
    id: "observer",
    name: "上城贵族观测员",
    description: "出身上城区的裂隙观测局初级观测员。",
    startingScene: "upper_district",
    openingNarrative: "我站在观测台上，裂隙的幽蓝光芒映在我脸上。",
  },
];

const store = {
  phase: 'identity',
  currentWorld: {
    id: "rift-city",
    name: "裂隙之城",
    isPlayerCreated: false,
  },
  identityOptions,
  midoriSettings: { enabled: false },
  setIdentityOptions: vi.fn(),
  setPlayerName: vi.fn(),
  setEntryContext: vi.fn(),
  setSceneNarrative: vi.fn(),
  updatePlaythroughMeta: vi.fn().mockResolvedValue(undefined),
  navigateToScene: vi.fn(),
  setPhase: vi.fn(),
  addToHistory: vi.fn(),
};

vi.mock("@/store/game-store", () => ({
  loadIdentityOptions: vi.fn(() => identityOptions),
  saveIdentityOptions: vi.fn(),
  useGameStore: Object.assign(
    (selector?: (state: typeof store) => unknown) => (selector ? selector(store) : store),
    { getState: () => store, setState: vi.fn() }
  ),
}));

afterEach(cleanup);

it('uses a local visitor for a thin card world before fabricating identities from an empty host', async () => {
  const previousWorld = store.currentWorld;
  const previousOptions = store.identityOptions;
  const fetcher = vi.fn().mockRejectedValue(new Error('must not call identity generation'));
  vi.stubGlobal('fetch', fetcher);
  store.currentWorld = { id: 'raw-card', name: '原卡世界', isPlayerCreated: true, sourceMode: 'external_cards' } as typeof store.currentWorld;
  store.identityOptions = [];
  try {
    render(React.createElement(IdentitySelect));
    expect(await screen.findByRole('button', { name: '选择身份：访客' })).not.toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  } finally { store.currentWorld = previousWorld; store.identityOptions = previousOptions; vi.unstubAllGlobals(); }
});

describe("IdentitySelect", () => {
  it.each(['strict replay', 'world reference refresh'])('reads world identities immediately after %s without a paid request', async (scenario) => {
    const previousWorld = store.currentWorld, previousOptions = store.identityOptions;
    const fetcher = vi.fn().mockRejectedValue(new Error('must not generate identities'));
    vi.stubGlobal('fetch', fetcher);
    vi.mocked(loadIdentityOptions).mockReturnValue([{ ...identityOptions[0], name: '旧缓存身份' }]);
    store.currentWorld = { id: 'uncached-world', name: '新世界', isPlayerCreated: true, identityOptions } as typeof store.currentWorld;
    store.identityOptions = [{ ...identityOptions[0], name: '旧状态身份' }];
    try {
      const element = () => scenario === 'strict replay'
        ? React.createElement(React.StrictMode, null, React.createElement(IdentitySelect))
        : React.createElement(IdentitySelect);
      const view = render(element());
      if (scenario === 'world reference refresh') {
        store.currentWorld = { ...store.currentWorld };
        view.rerender(element());
      }
      expect(await screen.findByRole('button', { name: '选择身份：朝雾' })).toBeTruthy();
      expect(screen.queryByText('正在为这个世界生成身份...')).toBeNull();
      expect(screen.queryByRole('button', { name: '选择身份：旧缓存身份' })).toBeNull();
      expect(screen.queryByRole('button', { name: '选择身份：旧状态身份' })).toBeNull();
      expect(fetcher).not.toHaveBeenCalled();
    } finally { store.currentWorld = previousWorld; store.identityOptions = previousOptions; vi.mocked(loadIdentityOptions).mockReturnValue(identityOptions); vi.unstubAllGlobals(); }
  });

  it('preserves an explicitly empty preset list and offers custom identity without filling NPCs', async () => {
    const previousWorld = store.currentWorld, previousOptions = store.identityOptions;
    vi.mocked(loadIdentityOptions).mockReturnValue(null);
    store.currentWorld = { id: 'custom-only', name: '新世界', isPlayerCreated: true, identityOptions: [], npcs: { 朝雾: '档案员' } } as typeof store.currentWorld;
    store.identityOptions = [];
    const fetcher = vi.fn().mockRejectedValue(new Error('offline'));
    vi.stubGlobal('fetch', fetcher);
    try {
      render(React.createElement(React.StrictMode, null, React.createElement(IdentitySelect)));
      expect(await screen.findByRole('button', { name: '创建自定义身份' })).toBeTruthy();
      expect(screen.queryByText('裂隙正在凝视你...')).toBeNull();
      expect(screen.queryByRole('button', { name: '选择身份：朝雾' })).toBeNull();
      expect(fetcher).not.toHaveBeenCalled();
    } finally { store.currentWorld = previousWorld; store.identityOptions = previousOptions; vi.mocked(loadIdentityOptions).mockReturnValue(identityOptions); vi.unstubAllGlobals(); }
  });

  it('replaces world presets when switching to another world', async () => {
    const previousWorld = store.currentWorld, previousOptions = store.identityOptions;
    const fetcher = vi.fn().mockRejectedValue(new Error('must not call identity API'));
    vi.stubGlobal('fetch', fetcher);
    vi.mocked(loadIdentityOptions).mockReturnValue(null);
    store.currentWorld = { id: 'world-a', name: '甲世界', isPlayerCreated: true, identityOptions } as typeof store.currentWorld; store.identityOptions = [];
    try {
      const view = render(React.createElement(IdentitySelect));
      expect(await screen.findByRole('button', { name: '选择身份：朝雾' })).toBeTruthy();
      store.currentWorld = { id: 'world-b', name: '乙世界', isPlayerCreated: true, sourceMode: 'external_cards' } as typeof store.currentWorld;
      view.rerender(React.createElement(IdentitySelect));
      expect(await screen.findByRole('button', { name: '选择身份：访客' })).toBeTruthy();
      expect(screen.queryByRole('button', { name: '选择身份：朝雾' })).toBeNull();
      expect(fetcher).not.toHaveBeenCalled();
    } finally { store.currentWorld = previousWorld; store.identityOptions = previousOptions; vi.mocked(loadIdentityOptions).mockReturnValue(identityOptions); vi.unstubAllGlobals(); }
  });
  it('uses a legacy world character locally with no invented opening when no cache exists', async () => {
    const previousWorld = store.currentWorld, previousOptions = store.identityOptions;
    const fetcher = vi.fn().mockRejectedValue(new Error('offline'));
    vi.stubGlobal('fetch', fetcher); vi.mocked(loadIdentityOptions).mockReturnValue(null);
    store.currentWorld = { id: 'old-world', name: '旧世界', isPlayerCreated: true, npcs: { 老林: '门口的医师' }, regions: { port: { id: 'port', description: '港口', scenes: { gate: { id: 'gate', name: '城门', npcs: ['老林'], initialDescription: '清晨的城门' } } } } } as typeof store.currentWorld;
    store.identityOptions = [];
    try {
      render(React.createElement(IdentitySelect));
      fireEvent.click(await screen.findByRole('button', { name: '选择身份：老林' }));
      fireEvent.click(screen.getByRole('button', { name: '进入旧世界' }));
      await waitFor(() => expect(store.setEntryContext).toHaveBeenLastCalledWith(expect.objectContaining({ canonicalName: '老林', startingSceneId: 'gate', openingNarrative: '' })));
      expect(fetcher).not.toHaveBeenCalled();
    } finally { store.currentWorld = previousWorld; store.identityOptions = previousOptions; vi.mocked(loadIdentityOptions).mockReturnValue(identityOptions); vi.unstubAllGlobals(); }
  });
  it('does not re-enter an old world when its identity index finishes after a world switch', async () => {
    const previousWorld = store.currentWorld;
    let finish!: () => void; store.setPhase.mockClear();
    store.updatePlaythroughMeta.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
    render(React.createElement(IdentitySelect));
    fireEvent.click(await screen.findByRole('button', { name: '选择身份：朝雾' }));
    fireEvent.click(screen.getByRole('button', { name: '进入裂隙之城' }));
    try {
      store.currentWorld = { ...previousWorld, id: 'different-world' };
      await act(async () => { finish(); });
      expect(store.setPhase).not.toHaveBeenCalled();
    } finally { store.currentWorld = previousWorld; }
  });
  it('records a role-specific entry and preserves authored names instead of replacing every occurrence', async () => {
    store.addToHistory.mockClear(); store.setEntryContext.mockClear();
    render(React.createElement(IdentitySelect));
    fireEvent.click(await screen.findByRole('button', { name: '选择身份：朝雾' }));
    fireEvent.change(screen.getByLabelText('角色名字'), { target: { value: '小雾' } });
    fireEvent.click(screen.getByRole('button', { name: '进入裂隙之城' }));
    await waitFor(() => expect(store.addToHistory).toHaveBeenCalledTimes(1));
    expect(store.setEntryContext).toHaveBeenCalledWith(expect.objectContaining({ playerName: '小雾', canonicalName: '朝雾', openingNarrative: '朝雾整理着随身的笔记。' }));
    expect(store.addToHistory.mock.calls[0][0].aiResponse).toBe('朝雾整理着随身的笔记。');
  });
  it('does not fabricate a custom arrival and prevents duplicate confirmation while the index is saving', async () => {
    store.addToHistory.mockClear();
    let finish!: () => void;
    store.updatePlaythroughMeta.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
    render(React.createElement(IdentitySelect));
    fireEvent.click(await screen.findByRole('button', { name: '自定义身份' }));
    fireEvent.change(screen.getByLabelText('自定义身份描述'), { target: { value: '卖茶的老人' } });
    fireEvent.click(screen.getByRole('button', { name: '确认身份，继续' }));
    fireEvent.change(screen.getByLabelText('角色名字'), { target: { value: '阿宁' } });
    const enter = screen.getByRole('button', { name: '进入裂隙之城' });
    fireEvent.click(enter); fireEvent.click(enter);
    expect(store.addToHistory).toHaveBeenCalledTimes(1);
    expect(store.addToHistory.mock.calls[0][0].aiResponse).toBe('');
    expect(store.setEntryContext).toHaveBeenLastCalledWith(expect.objectContaining({ source: 'custom', identityDescription: '卖茶的老人' }));
    await act(async () => { finish(); });
  });
  it('fills the selected character name and keeps the field editable', async () => {
    render(React.createElement(IdentitySelect));
    fireEvent.click(await screen.findByRole('button', { name: '选择身份：朝雾' }));
    const input = screen.getByLabelText('角色名字') as HTMLInputElement;
    expect(input.value).toBe('朝雾');
    fireEvent.change(input, { target: { value: '小雾' } });
    expect(input.value).toBe('小雾');
    expect((screen.getByRole('button', { name: '进入裂隙之城' }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: '重新选择' }));
    fireEvent.click(screen.getByRole('button', { name: '选择身份：上城贵族观测员' }));
    expect((screen.getByLabelText('角色名字') as HTMLInputElement).value).toBe('上城贵族观测员');
  });
  it('does not carry a preset name into a custom identity', async () => {
    render(React.createElement(IdentitySelect));
    fireEvent.click(await screen.findByRole('button', { name: '选择身份：朝雾' }));
    fireEvent.click(screen.getByRole('button', { name: '重新选择' }));
    fireEvent.click(screen.getByRole('button', { name: '自定义身份' }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '一个旅人' } });
    fireEvent.click(screen.getByRole('button', { name: '确认身份，继续' }));
    expect((screen.getByLabelText('角色名字') as HTMLInputElement).value).toBe('');
  });
  it("renders identities as Eidos dossier cards", async () => {
    render(React.createElement(IdentitySelect));

    const region = await screen.findByRole("region", { name: "身份档案选择" });
    expect(region.className).toContain("eidos-identity-screen");

    expect(screen.getByRole("list", { name: "进入世界的步骤" }).querySelector('[aria-current="step"]')?.textContent).toContain("选择身份");
    expect(screen.getByRole("button", { name: /选择身份：上城贵族观测员/ }).className).toContain("eidos-identity-card");
    expect(screen.getByRole("button", { name: /自定义身份/ }).className).toContain("eidos-identity-card--custom");
  });

  it("uses readable paper controls on the callsign entry step", async () => {
    render(React.createElement(IdentitySelect));

    fireEvent.click(await screen.findByRole("button", { name: /选择身份：上城贵族观测员/ }));

    expect(screen.getByPlaceholderText("输入角色名字...").className).toContain("eidos-identity-field--callsign");
    expect(screen.getByRole("button", { name: "重新选择" }).className).toContain("eidos-identity-action--paper");
    expect(screen.getByRole("button", { name: /进入裂隙之城/ }).className).toContain("eidos-identity-action--enter");
  });

  it("uses the current world's first real scene for custom identities", () => {
    expect(getDefaultStartingScene({
      id: "custom-world",
      name: "玩家世界",
      regions: {
        core: {
          id: "core",
          description: "核心区域",
          scenes: {
            scene_awakening: { id: "scene_awakening", name: "觉醒室" },
          },
        },
      },
    } as any)).toBe("scene_awakening");
  });
});
