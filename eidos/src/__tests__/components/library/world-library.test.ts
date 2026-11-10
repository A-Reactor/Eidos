// @vitest-environment jsdom

import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { WorldLibrary, type WorldLibraryManagement, type WorldLibraryProps } from "@/components/library/WorldLibrary";
import { useGameStore } from "@/store/game-store";
import { LocaleProvider } from "@/components/shell/LocaleProvider";
import type { PlaythroughMeta, SaveSlot, WorldDefinition } from "@/lib/game/types";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it('uses Escape to collapse world details before leaving the desktop collection', () => {
  const back = vi.fn();
  function Collection() {
    const [expandedWorldId, setWorld] = React.useState<string | null>('world-a');
    const [expandedContinuityId, setContinuity] = React.useState<string | null>('pt-a');
    return view(props({ expandedWorldId, expandedContinuityId, onBack: back,
      onToggleWorld: () => setWorld(null), onToggleContinuity: () => setContinuity(null) }));
  }
  render(React.createElement(Collection));
  expect(screen.getByRole('textbox', { name: '世界名称' })).toBeTruthy();
  fireEvent.keyDown(window, { key: 'Escape' });
  expect(screen.queryByRole('textbox', { name: '世界名称' })).toBeNull();
  expect(back).not.toHaveBeenCalled();
  fireEvent.keyDown(window, { key: 'Escape' });
  expect(back).toHaveBeenCalledOnce();
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

const world = {
  id: "world-a",
  name: "纸城",
  subtitle: "折叠的历史",
  overview: "一座由档案构成的城市。",
  isPlayerCreated: true,
} as WorldDefinition;

const continuity = {
  id: "pt-a",
  worldId: world.id,
  name: "第一连续性",
  updatedAt: 2,
  playerName: "林",
  gameTime: { day: 1, hour: 8, minute: 0 },
  actionCount: 3,
  status: "active",
} as PlaythroughMeta;

const save = {
  id: "save-a",
  worldId: world.id,
  playthroughId: continuity.id,
  name: "入口",
  updatedAt: 3,
  gameTime: continuity.gameTime,
  currentSceneName: "门厅",
  actionCount: 3,
  preview: "推开档案馆的门。",
} as SaveSlot;

function management(overrides: Partial<WorldLibraryManagement> = {}): WorldLibraryManagement {
  return {
    onRenameWorld: vi.fn().mockResolvedValue(true),
    onDeleteWorld: vi.fn().mockResolvedValue(true),
    onDeleteContinuity: vi.fn().mockResolvedValue(true),
    onDeleteSave: vi.fn().mockResolvedValue(true),
    onCreateInitialSave: vi.fn().mockResolvedValue(true),
    onExportWorld: vi.fn().mockResolvedValue(true),
    onExportWorldArchive: vi.fn().mockResolvedValue(true),
    ...overrides,
  };
}

function props(overrides: Partial<WorldLibraryProps> = {}): WorldLibraryProps {
  return {
    items: [{ world, continuityCount: 1, historyNodeCount: 3, saveCount: 1, latestSave: save, activeContinuity: continuity, continuities: [{ ...continuity, saves: [save] }] }],
    notice: null,
    loadError: null,
    expandedWorldId: null,
    expandedContinuityId: null,
    onContinue: vi.fn().mockResolvedValue(true),
    onNewContinuity: vi.fn().mockResolvedValue(true),
    onCreateWorld: vi.fn(),
    onImportWorldFiles: vi.fn().mockResolvedValue(true),
    onOpenGallery: vi.fn(),
    onOpenSettings: vi.fn(),
    onBack: vi.fn(),
    onToggleWorld: vi.fn(),
    onToggleContinuity: vi.fn(),
    management: management(),
    ...overrides,
  };
}

function view(input: WorldLibraryProps, locale: "zh-CN" | "en" = "zh-CN") {
  const Provider = LocaleProvider as React.ComponentType<{
    locale?: "zh-CN" | "en";
    children?: React.ReactNode;
  }>;
  return React.createElement(Provider, { locale }, React.createElement(WorldLibrary, input));
}

function editHeading(label: string, value?: string) {
  const field = screen.getByRole<HTMLElement>('textbox', { name: label });
  act(() => field.focus());
  if (value !== undefined) { field.textContent = value; fireEvent.input(field); }
  return field;
}
function finishHeading() { fireEvent.click(document.body); }

describe("WorldLibrary", () => {
  it('treats every world alike and reserves header whitespace for collapsing', async () => {
    const input = props({ expandedWorldId: world.id });
    input.items[0].world = { ...world, isPlayerCreated: false };
    render(view(input));
    expect(screen.queryByText('内置世界')).toBeNull();
    expect(screen.queryByText('玩家创建')).toBeNull();
    expect(screen.getByRole('button', { name: '从书库移除' })).not.toBeNull();
    const title = editHeading('世界名称', '统一的世界');
    fireEvent.click(title);
    expect(input.onToggleWorld).not.toHaveBeenCalled();
    fireEvent.click(title.closest('h2')!);
    await waitFor(() => expect(input.management.onRenameWorld).toHaveBeenCalledWith(world.id, '统一的世界', world.subtitle));
    await waitFor(() => expect(input.onToggleWorld).toHaveBeenCalledWith(world.id));
  });
  it("reflects controlled expansion and requests a toggle", () => {
    const onToggleWorld = vi.fn();
    const input = props({ onToggleWorld });
    const rendered = render(view(input));
    const toggle = screen.getByRole("button", { name: "展开 纸城" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(toggle);
    expect(onToggleWorld).toHaveBeenCalledWith(world.id);
    rendered.rerender(view({ ...input, expandedWorldId: world.id }));
    expect(screen.queryByRole("button", { name: "收起 纸城" })).toBeNull();
    expect(screen.getByRole("textbox", { name: "世界名称" })).not.toBeNull();
  });

  it("requires two clicks before destructive management", async () => {
    const onDeleteWorld = vi.fn().mockResolvedValue(true);
    render(view(props({ expandedWorldId: world.id, management: management({ onDeleteWorld }) })));
    fireEvent.click(screen.getByRole("button", { name: "从书库移除" }));
    expect(onDeleteWorld).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "确认移出书库" }));
    await waitFor(() => expect(onDeleteWorld).toHaveBeenCalledTimes(1));
  });

  it("passes an empty subtitle and keeps failed edits open until success", async () => {
    const onRenameWorld = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    render(view(props({ expandedWorldId: world.id, management: management({ onRenameWorld }) })));
    editHeading('副标题', '');
    finishHeading();
    await screen.findByRole('alert');
    expect(onRenameWorld).toHaveBeenLastCalledWith(world.id, world.name, '');
    expect(screen.getByRole('textbox', { name: '副标题' }).textContent).toBe('');
    editHeading('副标题');
    finishHeading();
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    expect(onRenameWorld).toHaveBeenCalledTimes(2);
  });

  it("disables a pending continue and prevents duplicate invocation", async () => {
    const pending = deferred<boolean>();
    const onContinue = vi.fn(() => pending.promise);
    render(view(props({ onContinue })));
    const button = screen.getByRole("button", { name: /继续最近进度/ });
    fireEvent.click(button);
    fireEvent.click(button);
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(onContinue).toHaveBeenCalledTimes(1);
    pending.resolve(true);
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
  });

  it("locks the card while a confirmed save deletion is pending", async () => {
    const pending = deferred<boolean>();
    const onDeleteSave = vi.fn(() => pending.promise);
    const onDeleteContinuity = vi.fn().mockResolvedValue(true);
    const onContinue = vi.fn().mockResolvedValue(true);
    render(view(props({
      expandedWorldId: world.id,
      expandedContinuityId: continuity.id,
      onContinue,
      management: management({ onDeleteSave, onDeleteContinuity }),
    })));
    fireEvent.click(screen.getByRole("button", { name: "删除存档" }));
    expect(onDeleteSave).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "确认删除" }));
    const load = screen.getByRole("button", { name: /^入口/ });
    const deleteContinuity = screen.getByRole("button", { name: "删除连续性" });
    expect((load as HTMLButtonElement).disabled).toBe(true);
    expect((deleteContinuity as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(load);
    fireEvent.click(deleteContinuity);
    expect(onContinue).not.toHaveBeenCalled();
    expect(onDeleteContinuity).not.toHaveBeenCalled();
    pending.resolve(false);
    await screen.findByRole("alert");
    await waitFor(() => expect((load as HTMLButtonElement).disabled).toBe(false));
    expect(screen.getByRole("button", { name: "确认删除" })).not.toBeNull();
  });

  it("prevents duplicate new-continuity requests and reports false", async () => {
    const pending = deferred<boolean>();
    const onNewContinuity = vi.fn(() => pending.promise);
    render(view(props({ expandedWorldId: world.id, onNewContinuity })));
    const button = screen.getByRole("button", { name: "开始新的连续性" });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(onNewContinuity).toHaveBeenCalledTimes(1);
    expect((button as HTMLButtonElement).disabled).toBe(true);
    pending.resolve(false);
    await screen.findByRole("alert");
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
  });

  it("passes dropped import files to the world import handler", async () => {
    const onImportWorldFiles = vi.fn().mockResolvedValue(true);
    render(view(props({ onImportWorldFiles })));
    const file = new File([JSON.stringify({ name: "纸城" })], "world.json", {
      type: "application/json",
    });

    fireEvent.drop(screen.getByLabelText("导入世界文件"), {
      dataTransfer: { files: [file] },
    });

    await waitFor(() => expect(onImportWorldFiles).toHaveBeenCalledWith([file]));
  });

  it("accepts webview file items and rejects a second drop while importing", async () => {
    const pending = deferred<boolean>();
    const onImportWorldFiles = vi.fn(() => pending.promise);
    render(view(props({ onImportWorldFiles })));
    const file = new File(["{}"], "world.json", { type: "application/json" });
    const zone = screen.getByLabelText("导入世界文件");
    fireEvent.dragEnter(zone, { dataTransfer: { types: ["Files"] } });
    expect(zone.getAttribute("data-drag-active")).toBe("true");
    const drop = { dataTransfer: { files: [], items: [{ kind: "file", getAsFile: () => file }] } };
    fireEvent.drop(zone, drop);
    fireEvent.drop(zone, drop);
    expect(onImportWorldFiles).toHaveBeenCalledTimes(1);
    expect(onImportWorldFiles).toHaveBeenCalledWith([file]);
    expect(zone.getAttribute("data-drag-active")).toBeNull();
    pending.resolve(true);
    await waitFor(() => expect(zone.getAttribute("aria-disabled")).toBe("false"));
    expect(screen.queryByRole("button", { name: "选择生成预设" })).toBeNull();
  });

  it("passes dropped eidos zip packages to the world import handler", async () => {
    const onImportWorldFiles = vi.fn().mockResolvedValue(true);
    render(view(props({ onImportWorldFiles })));
    const file = new File(["zip"], "paper-city.eidos.zip", {
      type: "application/zip",
    });

    fireEvent.drop(screen.getByLabelText("导入世界文件"), {
      dataTransfer: { files: [file] },
    });

    await waitFor(() => expect(onImportWorldFiles).toHaveBeenCalledWith([file]));
  });

  it("offers world export actions from the expanded archive controls", async () => {
    const onExportWorld = vi.fn().mockResolvedValue(true);
    const onExportWorldArchive = vi.fn().mockResolvedValue(true);
    render(view(props({
      expandedWorldId: world.id,
      management: management({ onExportWorld, onExportWorldArchive }),
    })));

    fireEvent.click(screen.getByRole("button", { name: "导出设定" }));
    await waitFor(() => expect(onExportWorld).toHaveBeenCalledWith(world));

    fireEvent.click(screen.getByRole("button", { name: "导出世界与周目" }));
    await waitFor(() =>
      expect(onExportWorldArchive).toHaveBeenCalledWith(
        expect.objectContaining({ world }),
      ),
    );
  });

  it("shows an isolated empty sandbox archive while reusing create and import actions", () => {
    render(view(props({
      items: [],
      sandboxMode: true,
      sandboxDossierId: "002",
    })));

    expect(screen.getByText("沙箱卷宗尚未装载世界")).not.toBeNull();
    expect(screen.getAllByRole("button", { name: "创造一个世界" }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: "导入世界" }).length).toBeGreaterThan(0);
    expect(screen.getByLabelText("导入世界文件")).not.toBeNull();
  });

  it("reports a rejected new-continuity request", async () => {
    const onNewContinuity = vi.fn().mockRejectedValue(new Error("offline"));
    render(view(props({ expandedWorldId: world.id, onNewContinuity })));
    fireEvent.click(screen.getByRole("button", { name: "开始新的连续性" }));
    expect((await screen.findByRole("alert")).textContent).toContain("操作失败");
  });

  it("keeps failed continuity deletion confirmed and actionable", async () => {
    const onDeleteContinuity = vi.fn().mockResolvedValue(false);
    render(view(props({ expandedWorldId: world.id, management: management({ onDeleteContinuity }) })));
    fireEvent.click(screen.getByRole("button", { name: "删除连续性" }));
    expect(onDeleteContinuity).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "确认删除" }));
    await screen.findByRole("alert");
    expect(onDeleteContinuity).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "确认删除" })).not.toBeNull();
  });

  it("runs the visible identity-setup action for an empty continuity", async () => {
    const onCreateInitialSave = vi.fn().mockResolvedValue(true);
    const item = { world, continuityCount: 1, historyNodeCount: 3, saveCount: 0, latestSave: null, activeContinuity: continuity, continuities: [{ ...continuity, saves: [] }] };
    render(view(props({ items: [item], expandedWorldId: world.id, expandedContinuityId: continuity.id, management: management({ onCreateInitialSave }) })));
    fireEvent.click(screen.getByRole("button", { name: /继续身份选择/ }));
    await waitFor(() => expect(onCreateInitialSave).toHaveBeenCalledWith(expect.objectContaining({ id: continuity.id }), world));
  });

  it("localizes core labels and renders load errors accessibly", () => {
    const input = props({ loadError: "损坏的存档" });
    const rendered = render(view(input));
    expect(screen.getByText("世界集合")).not.toBeNull();
    expect(screen.getByRole("alert").textContent).toContain("损坏的存档");
    rendered.rerender(view({ ...input, loadError: "Broken save" }, "en"));
    expect(screen.getByText("Choose a world")).not.toBeNull();
    expect(screen.getByRole("alert").textContent).toContain("Broken save");
  });
});

 describe("world management scopes", () => {
  it("keeps world actions and return available without playthroughs", () => {
    const input = props({ expandedWorldId: world.id, items: [{ world, continuityCount: 0, historyNodeCount: 0, saveCount: 0, latestSave: null, activeContinuity: null, continuities: [] }] });
    render(view(input));
    expect(screen.queryByRole("button", { name: "收起 纸城" })).toBeNull();
    expect(screen.getByRole("button", { name: "导出设定" })).not.toBeNull();
    expect(screen.getByRole("textbox", { name: "世界名称" })).not.toBeNull();
  });
  it("keeps autosaves out of the manual save list and expands them locally", () => {
    const automatic = { ...save, id: "autosave_pt-a", name: "自动保护" };
    render(view(props({ expandedWorldId: world.id, items: [{ world, continuityCount: 1, historyNodeCount: 3, saveCount: 2, latestSave: automatic, activeContinuity: continuity, continuities: [{ ...continuity, saves: [automatic, save] }] }] })));
    expect(screen.queryByRole("button", { name: /自动存档.*载入/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /自动恢复点/ }));
    expect(screen.getByRole("button", { name: /自动存档.*载入/ })).not.toBeNull();
    expect(screen.queryByRole("button", { name: "收起 纸城" })).toBeNull();
  });
 });

it('shows total usage beside world search and toggles precision',()=>{
 useGameStore.setState({tokensUsed:314542,estimatedCost:.51});
 render(view(props()));const counter=screen.getByRole('button',{name:'总 AI 用量'});
 expect(counter.textContent).toBe('Total 314.5K token - 0.5¥');
 fireEvent.click(counter);expect(counter.textContent).toBe('Total 314542 token - 0.51¥');
 fireEvent.click(counter);expect(counter.textContent).toBe('Total 314.5K token - 0.5¥');
});

it('expands desktop world management inside the card and keeps page return unchanged', () => {
  const input = props({ expandedWorldId: world.id });
  const rendered = render(view(input));
  expect(screen.queryByRole('region', { name: '世界详情' })).toBeNull();
  const list = rendered.container.querySelector('.eidos-library-worlds')!;
  expect(list.textContent).toContain('手动存档');
  expect(list.querySelector('li[data-expanded="true"]')).not.toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '返回标题画面' }));
  expect(input.onBack).toHaveBeenCalledOnce();
  expect(input.onToggleWorld).not.toHaveBeenCalled();
});

it('uses a separate detail page only on phones and restores inline expansion when widened', () => {
  let mobile = true;
  const listeners = new Set<() => void>();
  vi.stubGlobal('matchMedia', vi.fn(() => ({ get matches() { return mobile; },
    addEventListener: (_event: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_event: string, listener: () => void) => listeners.delete(listener),
  })));
  const input = props({ expandedWorldId: world.id });
  const rendered = render(view(input));
  const details = screen.getByRole('region', { name: '世界详情' });
  expect(details.textContent).toContain('手动存档');
  const list = rendered.container.querySelector('.eidos-library-worlds')!;
  expect(list.textContent).not.toContain('手动存档');
  expect(list.textContent).toContain('一座由档案构成的城市。');
  fireEvent.click(screen.getByRole('button', { name: '返回世界集合' }));
  expect(input.onToggleWorld).toHaveBeenCalledWith(world.id);
  expect(input.onBack).not.toHaveBeenCalled();
  act(() => { mobile = false; listeners.forEach(listener => listener()); });
  expect(screen.queryByRole('region', { name: '世界详情' })).toBeNull();
  expect(list.textContent).toContain('手动存档');
});

it('drags the phone detail over the still-mounted collection and closes after its exit transition', () => {
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('max-width'), addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  const input = props({ expandedWorldId: world.id });
  const rendered = render(view(input));
  const details = screen.getByRole('region', { name: '世界详情' });
  const page = details.closest<HTMLElement>('[data-mobile-slide]')!;
  expect(page).not.toBe(rendered.container.querySelector('.eidos-library-screen'));
  const finger = (x: number) => ({ identifier: 1, clientX: x, clientY: 200 });
  fireEvent.touchStart(details, { touches: [finger(80)] });
  fireEvent.touchMove(details, { touches: [finger(200)] });
  expect(page.style.getPropertyValue('--swipe-x')).toBe('120px');
  fireEvent.touchEnd(details, { touches: [], changedTouches: [finger(200)] });
  expect(input.onToggleWorld).not.toHaveBeenCalled();
  expect(page.dataset.mobileLeaving).toBe('true');
  fireEvent.transitionEnd(page, { propertyName: 'transform' });
  expect(input.onToggleWorld).toHaveBeenCalledWith(world.id);
});

it('saves phone heading edits before leaving without a discard dialog', async () => {
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('max-width'), addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  const pending = deferred<boolean>();
  const rename = vi.fn(() => pending.promise);
  const input = props({ expandedWorldId: world.id, management: management({ onRenameWorld: rename }) });
  render(view(input));
  const page = screen.getByRole('region', { name: '世界详情' });
  editHeading('世界名称', '自动保存的新名称');
  fireEvent.click(screen.getByRole('button', { name: '返回世界集合' }));
  expect(page.getAttribute('data-mobile-leaving')).toBeNull();
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(rename).toHaveBeenCalledTimes(1);
  pending.resolve(true);
  await waitFor(() => expect(page.getAttribute('data-mobile-leaving')).toBe('true'));
  fireEvent.transitionEnd(page, { propertyName: 'transform' });
  expect(input.onToggleWorld).toHaveBeenCalledWith(world.id);
});


it('places the phone collection menu after its heading and uses an accessible settings icon', () => {
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('max-width'), addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  const input = props();
  const view = render(React.createElement(WorldLibrary, input));
  const header = view.container.querySelector('.eidos-library-screen > header')!;
  const menu = header.querySelector('.eidos-archive-navigation')!;
  expect(menu.previousElementSibling?.classList.contains('eidos-archive-heading')).toBe(true);
  const settings = screen.getByRole('button', { name: '设置' });
  expect(settings.querySelector('svg')).not.toBeNull();
  fireEvent.click(settings);
  expect(input.onOpenSettings).toHaveBeenCalledOnce();
});


it.each([false, true])('autosaves headings in place without changing their elements (mobile=%s), keeping failed drafts', async mobile => {
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: mobile && query.includes('max-width'), addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  const rename = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
  const input = props({ expandedWorldId: world.id, management: management({ onRenameWorld: rename }) });
  const rendered = render(view(input));
  const originalHeading = rendered.container.querySelector('.eidos-library-world-header h2');
  expect(screen.queryByRole('button', { name: /编辑名称|修改世界名称|保存|取消|收起 纸城/ })).toBeNull();
  const name = editHeading('世界名称', '纸城新篇');
  editHeading('副标题', '新的副标题');
  expect(rename).not.toHaveBeenCalled();
  expect(rendered.container.querySelector('.eidos-library-world-header h2')).toBe(originalHeading);
  expect(rendered.container.querySelector('.eidos-library-world-header input')).toBeNull();
  finishHeading();
  await screen.findByRole('alert');
  expect(name.textContent).toBe('纸城新篇');
  expect(rename).toHaveBeenLastCalledWith(world.id, '纸城新篇', '新的副标题');
  editHeading('世界名称'); finishHeading();
  await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  expect(rename).toHaveBeenCalledTimes(2);
  expect(rendered.container.querySelector('.eidos-library-world-header h2')).toBe(originalHeading);
  expect(input.onToggleWorld).not.toHaveBeenCalled();
});

it.each([false, true])('keeps subtitle focus and ends editing on an outside click (mobile=%s)', async mobile => {
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: mobile && query.includes('max-width'), addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  const input = props({ expandedWorldId: world.id });
  render(view(input));
  const subtitle = editHeading('副标题', '新的副标题');
  expect(document.activeElement).toBe(subtitle);
  finishHeading();
  await waitFor(() => expect(input.management.onRenameWorld).toHaveBeenCalledWith(world.id, world.name, '新的副标题'));
  expect(document.activeElement).not.toBe(subtitle);
  expect(input.onToggleWorld).not.toHaveBeenCalled();
});

it('does not save untouched headings and rejects an empty title', async () => {
  const input = props({ expandedWorldId: world.id }); render(view(input));
  editHeading('世界名称'); finishHeading();
  expect(input.management.onRenameWorld).not.toHaveBeenCalled();
  editHeading('世界名称', '   '); finishHeading();
  await screen.findByRole('alert');
  expect(input.management.onRenameWorld).not.toHaveBeenCalled();
});

it('waits for the heading autosave before continuing a playthrough and coalesces blur and clicks', async () => {
  const pending = deferred<boolean>(), rename = vi.fn(() => pending.promise);
  const input = props({ expandedWorldId: world.id, management: management({ onRenameWorld: rename }) });
  render(view(input)); editHeading('世界名称', '新的世界名称');
  fireEvent.click(screen.getByRole('button', { name: /继续此周目/ }));
  expect(rename).toHaveBeenCalledTimes(1);
  expect(input.onContinue).not.toHaveBeenCalled();
  pending.resolve(true);
  await waitFor(() => expect(input.onContinue).toHaveBeenCalledWith(save.id));
  expect(rename).toHaveBeenCalledTimes(1);
});

it('commits on Enter while keeping IME confirmation inside the heading', async () => {
  const input = props({ expandedWorldId: world.id }); render(view(input));
  const name = editHeading('世界名称', '输入法中的名称');
  fireEvent.keyDown(name, { key: 'Enter', isComposing: true, keyCode: 229 });
  expect(document.activeElement).toBe(name);
  expect(input.management.onRenameWorld).not.toHaveBeenCalled();
  fireEvent.keyDown(name, { key: 'Enter' });
  await waitFor(() => expect(input.management.onRenameWorld).toHaveBeenCalledWith(world.id, '输入法中的名称', world.subtitle));
  expect(document.activeElement).not.toBe(name);
});

it('normalizes multiline paste into a plain single-line heading', async () => {
  const input = props({ expandedWorldId: world.id }); render(view(input));
  const name = editHeading('世界名称');
  const selection = window.getSelection()!, range = document.createRange();
  range.selectNodeContents(name); selection.removeAllRanges(); selection.addRange(range);
  fireEvent.paste(name, { clipboardData: { getData: () => '第一行\n第二行' } });
  expect(name.textContent).toBe('第一行 第二行');
  finishHeading();
  await waitFor(() => expect(input.management.onRenameWorld).toHaveBeenCalledWith(world.id, '第一行 第二行', world.subtitle));
  selection.removeAllRanges();
});

it('keeps a heading editable and permits retry after a synchronous save exception', async () => {
  const rename = vi.fn().mockImplementationOnce(() => { throw new Error('write failed'); }).mockResolvedValueOnce(true);
  const input = props({ expandedWorldId: world.id, management: management({ onRenameWorld: rename }) });
  render(view(input)); editHeading('世界名称', '修改后的名称'); finishHeading();
  await screen.findByRole('alert');
  expect(screen.getByRole('textbox', { name: '世界名称' }).textContent).toBe('修改后的名称');
  editHeading('世界名称'); finishHeading();
  await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  expect(rename).toHaveBeenCalledTimes(2);
});

it('does not leave the desktop collection until autosave succeeds', async () => {
  const pending = deferred<boolean>();
  const rename = vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValueOnce(true);
  const input = props({ expandedWorldId: world.id, management: management({ onRenameWorld: rename }) });
  render(view(input)); editHeading('世界名称', '离开前保存');
  fireEvent.click(screen.getByRole('button', { name: '返回标题画面' }));
  expect(input.onBack).not.toHaveBeenCalled();
  pending.resolve(false);
  await screen.findByRole('alert');
  expect(input.onBack).not.toHaveBeenCalled();
  editHeading('世界名称');
  fireEvent.click(screen.getByRole('button', { name: '返回标题画面' }));
  await waitFor(() => expect(input.onBack).toHaveBeenCalledTimes(1));
  expect(rename).toHaveBeenCalledTimes(2);
});

it.each(['definition', 'archive', 'playthrough'] as const)('uses the newly saved title when the outside click starts %s', async destination => {
  const controls = management();
  const input = props({ expandedWorldId: world.id, management: controls });
  render(view(input)); editHeading('世界名称', '应当导出的新名称');
  fireEvent.click(screen.getByRole('button', { name: destination === 'definition' ? '导出设定' : destination === 'archive' ? '导出世界与周目' : '开始新的连续性' }));
  const action = destination === 'definition' ? controls.onExportWorld : destination === 'archive' ? controls.onExportWorldArchive : input.onNewContinuity;
  await waitFor(() => expect(action).toHaveBeenCalledTimes(1));
  expect(action).toHaveBeenCalledWith(expect.objectContaining(destination === 'archive' ? { world: expect.objectContaining({ name: '应当导出的新名称' }) } : { name: '应当导出的新名称' }));
});
