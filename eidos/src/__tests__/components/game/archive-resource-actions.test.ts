// @vitest-environment jsdom
import React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { saveLocalDocument } from '@/lib/game/documents/ingest';
import { currentDocumentScope } from '@/lib/game/model-documents';
import { ArchiveResourceActions } from '@/components/game/ArchiveResourceActions';
import { useGameStore } from '@/store/game-store';
import { buildRiftCityStartState } from '@/lib/test/fixtures';
import { bindMidoriAsset, createEmptyMidoriAssetRegistry } from '@/lib/game/midori/asset-registry';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
beforeEach(() => {
  const { world } = buildRiftCityStartState();
  useGameStore.setState({ currentWorld: world, midoriAssetRegistry: createEmptyMidoriAssetRegistry() });
});
const show = () => render(React.createElement(ArchiveResourceActions, { onGallery: vi.fn(), onMomoi: vi.fn(), onDocuments: vi.fn() }));
it('counts unique current-world generated and bound images together', async () => {
  const worldId = useGameStore.getState().currentWorld!.id;
  let registry = createEmptyMidoriAssetRegistry();
  for (const [targetId, imageUrl, world] of [['a', '/one.png', worldId], ['b', '/upload.png', worldId], ['c', '/foreign.png', 'other']]) {
    registry = bindMidoriAsset(registry, { worldId: world, targetType: 'scene', targetId, slot: 'background', imageUrl, source: 'uploaded' });
  }
  useGameStore.setState({ midoriAssetRegistry: registry });
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({
    sceneImages: [{ sceneId: 'square', weather: '晴', timeOfDay: '12h', url: '/one.png' }],
    detailImages: [{ sceneId: 'square', regionId: 'sign', url: '/two.png' }], illustrations: [],
    npcImages: [{ name: '林_neutral', url: '/npc.png' }], regionImages: [{ sceneId: 'regions', regionId: 'upper', url: '/region.png' }],
  }) }));
  show();
  const card = screen.getByRole('button', { name: '打开图像管理' });
  await waitFor(() => expect(card.querySelector('b')?.textContent).toBe('5'));
});
it('shows zero only for a successful empty inventory', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ sceneImages: [], detailImages: [], illustrations: [] }) }));
  show();
  await waitFor(() => expect(screen.getByRole('button', { name: '打开图像管理' }).querySelector('b')?.textContent).toBe('0'));
});
it('keeps the gallery reachable when its count cannot be loaded', async () => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
  show();
  await screen.findByText('数量读取失败 · 打开资源库');
  const card = screen.getByRole('button', { name: '打开图像管理' }) as HTMLButtonElement;
  expect(card.disabled).toBe(false);
  expect(card.querySelector('b')?.textContent).toBe('—');
});

it('offers image, audio and document management as three sibling entries', async () => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
  show();
  const images = screen.getByRole('button', { name: '打开图像管理' });
  const audio = screen.getByRole('button', { name: 'MOMOI 音频管理' });
  const documents = screen.getByRole('button', { name: '打开文档管理' });
  await screen.findByText('数量读取失败 · 打开资源库');
  expect(images.parentElement).toBe(audio.parentElement);
  expect(documents.parentElement).toBe(audio.parentElement);
});

it('shows the current document count and refreshes it when a document is saved', async () => {
  useGameStore.setState({ currentPlaythroughId: 'count-docs', sandboxMode: false });
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
  show();
  const button = screen.getByRole('button', { name: '打开文档管理' });
  await waitFor(() => expect(button.querySelector('b')?.textContent).toBe('0'));
  await saveLocalDocument(currentDocumentScope(useGameStore.getState())!, { title: '记录', format: 'text', content: '正文' });
  await waitFor(() => expect(button.querySelector('b')?.textContent).toBe('1'));
});
