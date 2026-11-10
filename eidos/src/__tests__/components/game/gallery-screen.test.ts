// @vitest-environment jsdom
import React from 'react';
import 'fake-indexeddb/auto';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { GalleryScreen } from '@/components/game/GalleryScreen';
import { useGameStore } from '@/store/game-store';
import { buildRiftCityStartState } from '@/lib/test/fixtures';
import { bindMidoriAsset, createEmptyMidoriAssetRegistry } from '@/lib/game/midori/asset-registry';
import { imageResourceId } from '@/lib/game/midori/image-resource';
import { loadWorldAssetRegistry } from '@/lib/game/midori/asset-library';

const image = { sceneId: 'central_plaza', weather: '晴', timeOfDay: '12:00', url: '/offline-scene.png', fileSize: 100, lastModified: 1 };
const fetcher = vi.fn();
let run = 0;
beforeEach(() => {
  localStorage.clear();
  useGameStore.setState(useGameStore.getInitialState());
  vi.stubGlobal('fetch', fetcher);
  fetcher.mockReset().mockImplementation(async () => Response.json({ sceneImages: [image], detailImages: [], illustrations: [] }));
  const { world } = buildRiftCityStartState();
  useGameStore.setState({ currentWorld: world, currentPlaythroughId: `gallery-docs-${++run}`, phase: 'gallery', galleryTab: 'scenes', documentSelection: null, sandboxMode: false, galleryWorld: world, visitedScenes: ['central_plaza'], midoriAssetRegistry: createEmptyMidoriAssetRegistry(), midoriSettings: { ...useGameStore.getState().midoriSettings, enabled: false } });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it('browses categories and empty resources without invoking image generation or changing bindings', async () => {
  render(React.createElement(GalleryScreen));
  await screen.findByRole('navigation', { name: '图像分类' });
  const before = useGameStore.getState().midoriAssetRegistry;
  fireEvent.click(screen.getByRole('button', { name: '人物' }));
  expect(screen.getByRole('button', { name: '人物' }).getAttribute('aria-current')).toBe('page');
  await waitFor(() => expect(screen.getAllByLabelText(/上传 .* 的立绘/).length).toBeGreaterThan(0));
  fireEvent.click(screen.getByRole('button', { name: '插图' }));
  expect(screen.getByText('暂无插图')).toBeTruthy();
  expect(useGameStore.getState().midoriAssetRegistry.bindings).toEqual(before.bindings);
  expect(fetcher.mock.calls).toHaveLength(1);
  expect(fetcher.mock.calls.every(([url, init]) => String(url).includes('/list-images?') && !init?.method)).toBe(true);
});

it('expands a scene and views existing images without offering AI generation', async () => {
  render(React.createElement(GalleryScreen));
  const scene = await screen.findByRole('button', { name: '查看场景图像：中央广场' });
  fireEvent.click(scene);
  expect(scene.getAttribute('aria-pressed')).toBe('true');
  expect(screen.getByLabelText('上传 中央广场 的背景图')).toBeTruthy();
  fireEvent.click(screen.getByRole('img', { name: '中央广场 · 晴 · 正午' }));
  expect(screen.getByRole('dialog', { name: '查看图像' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: /重绘|重新生成/ })).toBeNull();
  expect(fetcher.mock.calls.some(([url]) => String(url).includes('/generate-image'))).toBe(false);
});

it('keeps categories above the resource directory and shows only the selected scene in the detail pane', async () => {
  render(React.createElement(GalleryScreen));
  const scene = await screen.findByRole('button', { name: '查看场景图像：裂隙观测局' });
  const directory = scene.closest('aside')!;
  expect(directory).not.toBeNull();
  expect(directory.contains(screen.getByRole('navigation', { name: '图像分类' }))).toBe(true);
  fireEvent.click(scene);
  expect(scene.getAttribute('aria-pressed')).toBe('true');
  expect(screen.getByRole('main').querySelector('h2')?.textContent).toBe('裂隙观测局');
  expect(screen.getByLabelText('上传 裂隙观测局 的背景图')).toBeDefined();
  expect(screen.queryByLabelText('上传 中央广场 的背景图')).toBeNull();
  expect(useGameStore.getState().galleryTab).toBe('scenes');
});

it('keeps phone category changes in the index until a resource is selected', async () => {
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('max-width'), addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  const { container } = render(React.createElement(GalleryScreen));
  const page = container.querySelector('.eidos-gallery-screen')!;
  await screen.findByRole('button', { name: '查看场景图像：中央广场' });
  fireEvent.click(screen.getByRole('button', { name: '人物' }));
  expect(page.getAttribute('data-mobile-directory')).toBe('index');
  const character = screen.getAllByRole('button', { name: /^查看人物图像：/ })[0];
  fireEvent.click(character);
  expect(page.getAttribute('data-mobile-directory')).toBe('detail');
  expect(screen.getByRole('main').getAttribute('aria-hidden')).toBe('false');
});

it('shows a recoverable load failure and a distinct missing-world state', async () => {
  fetcher.mockResolvedValue(Response.json({}, { status: 503 }));
  const view = render(React.createElement(GalleryScreen));
  await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('HTTP 503'));
  expect(screen.getByRole('button', { name: '重试' })).toBeTruthy();
  view.unmount();
  useGameStore.setState({ galleryWorld: null });
  render(React.createElement(GalleryScreen));
  expect(screen.getByRole('heading', { name: '世界数据未加载' })).toBeTruthy();
  expect(screen.getByRole('button', { name: '返回' })).toBeTruthy();
});


it('uploads a background, binds it to the scene and allows unbinding without AI requests', async () => {
  fetcher.mockImplementation(async (url) => String(url).includes('/upload-image')
    ? Response.json({ imageUrl: '/uploaded-background.png' })
    : Response.json({ sceneImages: [], detailImages: [], illustrations: [] }));
  render(React.createElement(GalleryScreen));
  fireEvent.click(await screen.findByRole('button', { name: '查看场景图像：中央广场' }));
  const file = new File(['image'], 'scene.png', { type: 'image/png' });
  fireEvent.change(screen.getByLabelText('上传 中央广场 的背景图'), { target: { files: [file] } });
  await waitFor(() => expect(useGameStore.getState().midoriAssetRegistry.bindings['scene:central_plaza:background']?.imageUrl).toBe('/uploaded-background.png'));
  expect(screen.getByRole('img', { name: '中央广场' }).getAttribute('src')).toBe('/uploaded-background.png');
  const [, request] = fetcher.mock.calls.find(([url]) => String(url).includes('/upload-image'))!;
  expect(request.body.get('file').name).toBe('scene.png');
  expect(request.body.get('targetId')).toBe('central_plaza');
  fireEvent.click(screen.getByRole('img', { name: '中央广场' }));
  fireEvent.click(screen.getByRole('button', { name: '解除绑定' }));
  await waitFor(() => expect(useGameStore.getState().midoriAssetRegistry.bindings['scene:central_plaza:background']).toBeUndefined());
  expect(screen.queryByRole('button', { name: /重绘|重新生成/ })).toBeNull();
});

it('imports a dropped background through the shared zone and binds the selected scene only once', async () => {
  let finish!: (response: Response) => void;
  fetcher.mockImplementation(async url => String(url).includes('/upload-image')
    ? new Promise<Response>(resolve => { finish = resolve; })
    : Response.json({ sceneImages: [], detailImages: [], illustrations: [] }));
  render(React.createElement(GalleryScreen));
  fireEvent.click(await screen.findByRole('button', { name: '查看场景图像：中央广场' }));
  const zone = screen.getByRole('button', { name: '导入 中央广场 的背景图' });
  const file = new File(['image'], 'dropped.png', { type: 'image/png' });
  fireEvent.drop(zone, { dataTransfer: { files: [file] } });
  fireEvent.drop(zone, { dataTransfer: { files: [file] } });
  await waitFor(() => expect(fetcher.mock.calls.filter(([url]) => String(url).includes('/upload-image'))).toHaveLength(1));
  finish(Response.json({ imageUrl: '/dropped-background.png' }));
  await waitFor(() => expect(useGameStore.getState().midoriAssetRegistry.bindings['scene:central_plaza:background']?.imageUrl).toBe('/dropped-background.png'));
  expect(Object.keys(useGameStore.getState().midoriAssetRegistry.bindings)).toEqual(['scene:central_plaza:background']);
});

it('contains focus in the shared image dialog, switches images by keyboard and returns focus on close', async () => {
  fetcher.mockImplementation(async () => Response.json({ sceneImages: [image, { ...image, weather: '雨', url: '/rain.png' }], detailImages: [], illustrations: [] }));
  render(React.createElement(GalleryScreen));
  fireEvent.click(await screen.findByRole('button', { name: '查看场景图像：中央广场' }));
  const preview = screen.getByRole('img', { name: '中央广场 · 晴 · 正午' }).closest('button')!;
  preview.focus(); fireEvent.click(preview);
  const dialog = screen.getByRole('dialog', { name: '查看图像' });
  expect(dialog.contains(document.activeElement)).toBe(true);
  fireEvent.keyDown(document.activeElement!, { key: 'ArrowRight' });
  expect(dialog.querySelector('img')?.getAttribute('src')).toBe('/rain.png');
  fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
  expect(screen.queryByRole('dialog', { name: '查看图像' })).toBeNull();
  expect(document.activeElement).toBe(preview);
});

it('reports upload errors without blocking another upload attempt', async () => {
  fetcher.mockImplementation(async (url) => String(url).includes('/upload-image')
    ? Response.json({ error: '图片过大' }, { status: 413 })
    : Response.json({ sceneImages: [], detailImages: [], illustrations: [] }));
  render(React.createElement(GalleryScreen));
  fireEvent.click(await screen.findByRole('button', { name: '查看场景图像：中央广场' }));
  fireEvent.change(screen.getByLabelText('上传 中央广场 的背景图'), { target: { files: [new File(['image'], 'scene.png', { type: 'image/png' })] } });
  await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('图片过大'));
  expect(screen.getByLabelText('上传 中央广场 的背景图').hasAttribute('disabled')).toBe(false);
  expect(Object.keys(useGameStore.getState().midoriAssetRegistry.bindings)).toHaveLength(0);
});

it('limits image management to image categories', async () => {
  render(React.createElement(GalleryScreen));
  await screen.findByRole('heading', { name: '图像管理' });
  expect(screen.getByRole('navigation', { name: '图像分类' }).textContent).toBe('场景人物插图');
  expect(screen.queryByRole('button', { name: '文档' })).toBeNull();
});

it('retries a failed or malformed listing without reloading the application', async () => {
  fetcher.mockResolvedValueOnce(Response.json({ sceneImages: null }));
  render(React.createElement(GalleryScreen));
  await screen.findAllByRole('alert');
  expect(screen.getByRole('alert').textContent).toContain('格式不完整');
  fireEvent.click(screen.getByRole('button', { name: '重试' }));
  await screen.findByRole('button', { name: '查看场景图像：中央广场' });
  expect(screen.queryByRole('alert')).toBeNull();
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it('aligns runtime NPC uploads with the actual speaker name rather than the initial world dictionary', async () => {
  useGameStore.setState({ encyclopedia: [{ id: 'npc_runtime_1', type: 'npc', name: '新结识的旅人', description: '路上的朋友', knowledge: [], firstEncountered: { day: 0, hour: 8, minute: 0 }, lastUpdated: { day: 0, hour: 8, minute: 0 }, relatedEntries: [] }] });
  fetcher.mockImplementation(async url => String(url).includes('/upload-image') ? Response.json({ imageUrl: '/traveller.png' }) : Response.json({ sceneImages: [], detailImages: [], illustrations: [] }));
  render(React.createElement(GalleryScreen));
  await screen.findByRole('button', { name: '查看场景图像：中央广场' });
  fireEvent.click(screen.getByRole('button', { name: '人物' }));
  fireEvent.click(screen.getByRole('button', { name: '查看人物图像：新结识的旅人' }));
  fireEvent.change(screen.getByLabelText('上传 新结识的旅人 的立绘'), { target: { files: [new File(['png'], 'npc.png', { type: 'image/png' })] } });
  await screen.findByRole('img', { name: '新结识的旅人' });
  expect(useGameStore.getState().midoriAssetRegistry.bindings['character:新结识的旅人:portrait'].imageUrl).toBe('/traveller.png');
  const request = fetcher.mock.calls.find(([url]) => String(url).includes('upload-image'))![1];
  expect(request.body.get('targetId')).toBe('新结识的旅人');
});

it('ignores old world list and upload responses after navigating to a different world', async () => {
  let finishList!: (response: Response) => void, finishUpload!: (response: Response) => void;
  const world = useGameStore.getState().currentWorld!;
  fetcher.mockImplementation(async url => String(url).includes('/upload-image') ? new Promise<Response>(resolve => { finishUpload = resolve; }) :
    String(url).includes('other-world') ? Response.json({ sceneImages: [], detailImages: [], illustrations: [] }) :
      new Promise<Response>(resolve => { finishList = resolve; }));
  render(React.createElement(GalleryScreen));
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
  await act(async () => { finishList(Response.json({ sceneImages: [image], detailImages: [], illustrations: [] })); });
  await screen.findByLabelText('上传 中央广场 的背景图');
  fireEvent.change(screen.getByLabelText('上传 中央广场 的背景图'), { target: { files: [new File(['png'], 'scene.png', { type: 'image/png' })] } });
  act(() => useGameStore.setState({ galleryWorld: { ...world, id: 'other-world', name: '另一个世界', npcs: { '另世界的人': '描述' } } }));
  await waitFor(() => expect(fetcher.mock.calls.filter(([url]) => String(url).includes('list-images'))).toHaveLength(2));
  await act(async () => { finishUpload(Response.json({ imageUrl: '/late.png' })); });
  expect(useGameStore.getState().midoriAssetRegistry.bindings).toEqual({});
  expect(screen.queryByRole('img', { name: '中央广场 · 晴 · 正午' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '人物' }));
  await screen.findByRole('button', { name: '查看人物图像：另世界的人' });
});

it('retains a detail after deletion fails, then deletes its exact listed path on retry', async () => {
  const detail = { sceneId: 'town_square', regionId: 'region_with_id', url: '/details.png', relativePath: 'details/revisions/town_square_region_with_id.png', fileSize: 10, lastModified: 1 };
  let attempts = 0;
  fetcher.mockImplementation(async url => String(url).includes('delete-image') ? ++attempts === 1 ? Response.json({ ok: false, error: '文件占用' }, { status: 500 }) : Response.json({ ok: true }) : Response.json({ sceneImages: [], detailImages: [detail], illustrations: [] }));
  render(React.createElement(GalleryScreen));
  await screen.findByRole('button', { name: '查看场景图像：中央广场' });
  fireEvent.click(screen.getByRole('button', { name: '插图' }));
  fireEvent.click(screen.getByRole('img', { name: 'town_square / region_with_id' }));
  fireEvent.click(screen.getByRole('button', { name: '删除' }));
  await waitFor(() => expect(screen.getAllByRole('alert').some(alert => alert.textContent?.includes('文件占用'))).toBe(true));
  expect(screen.getAllByRole('img', { name: 'town_square / region_with_id' }).length).toBeGreaterThan(0);
  fireEvent.click(screen.getByRole('button', { name: '删除' }));
  await screen.findByText('暂无插图');
  const request = fetcher.mock.calls.find(([url]) => String(url).includes('delete-image'))![1];
  expect(JSON.parse(request.body).relativePath).toBe(detail.relativePath);
  expect(fetcher.mock.calls.filter(([url]) => String(url).includes('list-images'))).toHaveLength(1);
});

it('discards a pending old listing when the world changes', async () => {
  let finishOld!: (response: Response) => void;
  fetcher.mockImplementationOnce(() => new Promise<Response>(resolve => { finishOld = resolve; }));
  render(React.createElement(GalleryScreen));
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
  const other = { ...useGameStore.getState().galleryWorld!, id: 'new-world', name: '新世界' };
  fetcher.mockResolvedValue(Response.json({ sceneImages: [], detailImages: [], illustrations: [] }));
  act(() => useGameStore.setState({ galleryWorld: other }));
  await screen.findByRole('button', { name: '查看场景图像：中央广场' });
  await act(async () => { finishOld(Response.json({ sceneImages: [image], detailImages: [], illustrations: [] })); });
  expect(screen.queryByRole('img', { name: '中央广场 · 晴 · 正午' })).toBeNull();
  expect(fetcher.mock.calls).toHaveLength(2);
});

it('puts new images first, fills expression slots, and saves editable tags without replacing older pictures', async () => {
  let uploads = 0;
  fetcher.mockImplementation(async url => String(url).includes('/upload-image') ? Response.json({ imageUrl: `/cat-${++uploads}.png` }) : Response.json({ sceneImages: [], detailImages: [], illustrations: [] }));
  render(React.createElement(GalleryScreen));
  await screen.findByRole('button', { name: '查看场景图像：中央广场' });
  fireEvent.click(screen.getByRole('button', { name: '人物' }));
  fireEvent.click(screen.getByRole('button', { name: '查看人物图像：神秘猫' }));
  const upload = (label: string) => fireEvent.change(screen.getByLabelText(label), { target: { files: [new File(['png'], 'cat.png', { type: 'image/png' })] } });
  upload('上传 神秘猫 的立绘');
  await screen.findByRole('img', { name: '神秘猫' });
  const nextUpload = '上传 神秘猫 的开心 立绘';
  await waitFor(() => expect(screen.getByLabelText<HTMLInputElement>(nextUpload).disabled).toBe(false));
  upload(nextUpload);
  await waitFor(() => expect(Object.keys(useGameStore.getState().midoriAssetRegistry.images!)).toHaveLength(2));
  const grid = document.querySelector('.eidos-gallery-resource-grid')!;
  expect(grid.firstElementChild?.getAttribute('aria-label')).toBe('导入 神秘猫 的立绘');
  expect(grid.querySelectorAll('article')[0].querySelector('img')?.getAttribute('src')).toBe('/cat-1.png');
  expect(grid.querySelectorAll('article')[1].querySelector('img')?.getAttribute('src')).toBe('/cat-2.png');
  expect(screen.queryByLabelText('上传 神秘猫 的开心 立绘')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '查看图像：神秘猫 · 开心' }));
  const field = screen.getByRole('textbox', { name: '新标签' });
  fireEvent.change(field, { target: { value: '夜间礼服' } });
  fireEvent.submit(field.closest('form')!);
  await screen.findByRole('button', { name: '删除标签：夜间礼服' });
  expect(screen.getByRole('dialog').textContent).toContain('2 / 2');
  fireEvent.click(screen.getByRole('button', { name: '删除标签：开心' }));
  await waitFor(() => expect(screen.queryByRole('button', { name: '删除标签：开心' })).toBeNull());
  const description = screen.getByRole('textbox', { name: '图像描述' });
  fireEvent.change(description, { target: { value: '穿着蓝色礼服，戴着月亮挂饰。' } }); fireEvent.blur(description);
  fireEvent.keyDown(field, { key: 'ArrowLeft' });
  expect(screen.getByRole('dialog').querySelector('img')?.getAttribute('src')).toBe('/cat-2.png');
  fireEvent.click(screen.getByRole('button', { name: '关闭' }));
  const registry = loadWorldAssetRegistry(useGameStore.getState().currentWorld!);
  await waitFor(() => expect(loadWorldAssetRegistry(useGameStore.getState().currentWorld!).images![imageResourceId('/cat-2.png')]).toMatchObject({ tags: ['夜间礼服'], description: '穿着蓝色礼服，戴着月亮挂饰。' }));
  expect(registry.bindings['character:神秘猫:portrait'].imageUrl).toBe('/cat-1.png');
  expect(screen.queryByText('导入立绘')).toBeNull();
  expect(screen.queryByText(/拖入图片.*点击选择/)).toBeNull();
  expect(screen.getByText('PNG / JPEG / WebP / GIF · 最大 32 MB')).toBeTruthy();
});

it('keeps a legacy illustration out of the character directory and lets players correct its category', async () => {
  fetcher.mockResolvedValue(Response.json({ sceneImages: [], detailImages: [], illustrations: [], npcImages: [{ name: '月光下的码头', url: '/moon.png', fileSize: 1, lastModified: 1 }] }));
  render(React.createElement(GalleryScreen));
  await screen.findByRole('button', { name: '查看场景图像：中央广场' });
  fireEvent.click(screen.getByRole('button', { name: '人物' }));
  expect(screen.queryByRole('button', { name: '查看人物图像：月光下的码头' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '插图' }));
  fireEvent.click(screen.getByRole('button', { name: '查看图像：月光下的码头' }));
  fireEvent.change(screen.getByLabelText('图像类别'), { target: { value: 'scene' } });
  fireEvent.change(screen.getByLabelText('图像所属对象'), { target: { value: 'central_plaza' } });
  fireEvent.click(screen.getByRole('button', { name: '关闭' }));
  await waitFor(() => expect(screen.queryByRole('button', { name: '查看插图：月光下的码头' })).toBeNull());
  fireEvent.click(screen.getByRole('button', { name: '场景' }));
  expect(screen.getByRole('img', { name: '月光下的码头' }).getAttribute('src')).toBe('/moon.png');
  expect(useGameStore.getState().midoriAssetRegistry.bindings['scene:central_plaza:background'].imageUrl).toBe('/moon.png');
});

it('rejects oversized files locally and keeps a failed metadata edit retryable', async () => {
  render(React.createElement(GalleryScreen));
  await screen.findByRole('button', { name: '查看场景图像：中央广场' });
  const file = new File(['png'], 'too-large.png', { type: 'image/png' });
  Object.defineProperty(file, 'size', { value: 32 * 1024 * 1024 + 1 });
  fireEvent.change(screen.getByLabelText('上传 中央广场 的背景图'), { target: { files: [file] } });
  await screen.findByText('图片不能超过 32 MB');
  expect(fetcher.mock.calls.filter(([url]) => String(url).includes('upload-image'))).toHaveLength(0);
  fireEvent.click(screen.getByRole('img', { name: '中央广场 · 晴 · 正午' }));
  const input = screen.getByRole('textbox', { name: '新标签' });
  const full = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementationOnce(() => { throw new DOMException('database full', 'QuotaExceededError'); });
  fireEvent.change(input, { target: { value: '灯火' } }); fireEvent.submit(input.closest('form')!);
  await screen.findAllByRole('alert');
  expect(screen.queryByRole('button', { name: '删除标签：灯火' })).toBeNull();
  full.mockRestore(); fireEvent.submit(input.closest('form')!);
  await screen.findByRole('button', { name: '删除标签：灯火' });
});

it('saves an active description when closing the inspector with Escape', async () => {
  render(React.createElement(GalleryScreen));
  await screen.findByRole('button', { name: '查看场景图像：中央广场' });
  fireEvent.click(await screen.findByRole('img', { name: '中央广场 · 晴 · 正午' }));
  const description = screen.getByRole('textbox', { name: '图像描述' }); description.focus();
  fireEvent.change(description, { target: { value: '傍晚的广场与灯火' } });
  fireEvent.keyDown(description, { key: 'Escape' });
  expect(screen.queryByRole('dialog')).toBeNull();
  await waitFor(() => expect(loadWorldAssetRegistry(useGameStore.getState().currentWorld!).images![imageResourceId(image.url)].description).toBe('傍晚的广场与灯火'));
});

it('shows a persisted reaction-named portrait under the original NPC and omits the duplicate heading', async () => {
  const name = '蓝色大肥鱼', reaction = '蓝色大肥鱼：一睁眼就向管理员讨饭吃';
  const state = useGameStore.getState(), world = { ...state.currentWorld!, npcs: { ...state.currentWorld!.npcs, [name]: '玩家创建的人物' } };
  useGameStore.setState({ currentWorld: world, galleryWorld: world, npcStates: { [reaction]: 'reacted' },
    encyclopedia: [{ id: 'legacy-fish', name: reaction, type: 'npc', description: '反应摘要误建档', knowledge: [], firstEncountered: state.gameTime, lastUpdated: state.gameTime, relatedEntries: [] }],
    midoriAssetRegistry: bindMidoriAsset(createEmptyMidoriAssetRegistry(), { worldId: world.id, targetType: 'character', targetId: reaction,
      slot: 'portrait', imageUrl: '/fish-portrait.png', source: 'uploaded' }) });
  render(React.createElement(GalleryScreen));
  await screen.findByRole('button', { name: '查看场景图像：中央广场' });
  fireEvent.click(screen.getByRole('button', { name: '人物' }));
  expect(screen.queryByRole('button', { name: `查看人物图像：${reaction}` })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: `查看人物图像：${name}` }));
  expect(screen.getByRole('main').querySelector('h2')?.textContent).toBe(name);
  expect(screen.getByRole('img', { name }).getAttribute('src')).toBe('/fish-portrait.png');
});
