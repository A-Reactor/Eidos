// @vitest-environment jsdom
import React from 'react';
import 'fake-indexeddb/auto';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DocumentsScreen } from '@/components/game/DocumentsScreen';
import { useGameStore } from '@/store/game-store';
import { buildRiftCityStartState } from '@/lib/test/fixtures';
import { currentDocumentScope, saveModelDocument } from '@/lib/game/model-documents';
let run = 0;
beforeEach(() => {
  const { world } = buildRiftCityStartState();
  useGameStore.setState({ currentWorld: world, currentPlaythroughId: `documents-page-${++run}`, phase: 'documents', navigationStack: ['playing'], documentSelection: null, sandboxMode: false, galleryWorld: null });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it('reads complete documents independently of images and returns through the document directory', async () => {
  const fetcher = vi.fn().mockRejectedValue(new Error('image service unavailable'));
  vi.stubGlobal('fetch', fetcher);
  const scope = currentDocumentScope(useGameStore.getState())!;
  const content = '完整资料。'.repeat(300) + '末尾证据';
  await saveModelDocument(scope, { title: '阅读笔记', format: 'markdown', content }, '整理资料');
  const before = useGameStore.getState().createSnapshot();
  render(React.createElement(DocumentsScreen));
  fireEvent.click(await screen.findByRole('button', { name: /阅读笔记/ }));
  await waitFor(() => expect(screen.getByLabelText('文档正文').textContent).toBe(content));
  expect(screen.getByRole('button', { name: '引用到行动' }).closest('footer')?.parentElement).toBe(screen.getByLabelText('文档正文').closest('main')?.parentElement);
  expect(fetcher).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '返回文档列表' }));
  expect(screen.getByRole('heading', { name: '文档管理' })).toBeTruthy();
  expect(screen.getByRole('list', { name: '已保存文档' }).textContent).toContain('阅读笔记');
  expect(useGameStore.getState().phase).toBe('documents');
  expect(useGameStore.getState().createSnapshot()).toEqual(before);
  fireEvent.click(screen.getByRole('button', { name: '返回上一级' }));
  expect(useGameStore.getState().phase).toBe('playing');
});
it('does not open a selected document from another playthrough', async () => {
  const scope = currentDocumentScope(useGameStore.getState())!;
  const saved = await saveModelDocument(scope, { title: '私有周目笔记', format: 'markdown', content: '仅属于原周目。' }, '整理');
  useGameStore.setState({ currentPlaythroughId: 'another-playthrough', documentSelection: { scope, initialId: saved.id } });
  render(React.createElement(DocumentsScreen));
  await screen.findByText('还没有文档。');
  expect(screen.queryByText('私有周目笔记')).toBeNull();
  expect(screen.getByRole('heading', { name: '文档管理' })).toBeTruthy();
});

it('animates a phone swipe back to the document list before returning to the resource directory', async () => {
  vi.stubGlobal('matchMedia', vi.fn((query: string) => ({ matches: query.includes('max-width'), addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  const scope = currentDocumentScope(useGameStore.getState())!;
  await saveModelDocument(scope, { title: '手势笔记', format: 'markdown', content: '完整正文' }, '整理');
  render(React.createElement(DocumentsScreen));
  fireEvent.click(await screen.findByRole('button', { name: /手势笔记/ }));
  const article = await screen.findByLabelText('文档正文');
  const reader = article.closest<HTMLElement>('[data-mobile-slide]')!;
  Object.defineProperty(reader, 'clientWidth', { configurable: true, value: 390 });
  const finger = (x: number) => ({ identifier: 1, clientX: x, clientY: 250 });
  fireEvent.touchStart(article, { touches: [finger(40)] });
  fireEvent.touchMove(article, { touches: [finger(190)] });
  expect(reader.style.getPropertyValue('--swipe-x')).toBe('150px');
  fireEvent.touchEnd(article, { touches: [], changedTouches: [finger(190)] });
  expect(reader.dataset.mobileLeaving).toBe('true');
  expect(useGameStore.getState().phase).toBe('documents');
  fireEvent.transitionEnd(reader, { propertyName: 'transform' });
  expect(screen.getByRole('list', { name: '已保存文档' }).textContent).toContain('手势笔记');
  expect(useGameStore.getState().phase).toBe('documents');
});
