// @vitest-environment jsdom
import React, { useState } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { WorldCreateScreen } from '@/components/game/WorldCreateScreen';
import { GameplayPluginPicker } from '@/components/game/creation/GameplayPluginPicker';
import type { GameplayPlugin } from '@/lib/game/plugins/types';
import { parseGameplayPlugins } from '@/lib/game/plugins/manifest';
import { savePluginLibrary } from '@/lib/game/plugins/library';
afterEach(cleanup);
beforeEach(() => localStorage.clear());
const Harness: React.FC<{ disabled?: boolean }> = ({ disabled = false }) => {
  const [selected, select] = useState<string[]>([]), [custom, change] = useState<GameplayPlugin[]>([]);
  return React.createElement(GameplayPluginPicker, { selected, custom, disabled, onSelect: select, onCustom: change });
}
it('imports a data-only plugin and lets the creator select or remove it', async () => {
  render(React.createElement(Harness));
  const file = new File([''], 'puzzle.json', { type: 'application/json' });
  Object.defineProperty(file, 'text', { value: async () => JSON.stringify({ format: 'eidos-gameplay-plugin', version: 1, id: 'custom-puzzle', name: '自定义谜题', description: '一个新玩法', tags: ['谜题'], prompts: { creation: '设计谜题', action: '按照证据回应', review: '检查证据' } }) });
  fireEvent.change(screen.getByLabelText('导入玩法插件 JSON'), { target: { files: [file] } });
  await waitFor(() => expect(screen.getByRole('button', { name: /^自定义谜题/ }).getAttribute('aria-pressed')).toBe('true'));
  fireEvent.click(screen.getByRole('button', { name: /^查看自定义谜题/ }));
  expect(screen.queryByText('编辑作者声明')).toBeNull();
  expect(screen.queryByLabelText('上传自定义谜题介绍图片')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '移除插件：自定义谜题' }));
  expect(screen.queryByRole('button', { name: /^自定义谜题/ })).toBeNull();
});
it('rejects unsupported executable declarations with a visible error', async () => {
  render(React.createElement(Harness));
  const file = new File([''], 'invalid.json');
  Object.defineProperty(file, 'text', { value: async () => '{"script":"fetch()"}' });
  fireEvent.change(screen.getByLabelText('导入玩法插件 JSON'), { target: { files: [file] } });
  await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/插件/));
});
it('remembers dropped files and retains changed content with the same release', async () => {
  const manifest = { format: 'eidos-gameplay-plugin', version: 1, id: 'custom-puzzle', name: '可分享谜题', description: '原版规则', tags: [], prompts: { creation: '', action: '', review: '' } };
  const file = (description: string) => {
    const result = new File([''], 'puzzle.json', { type: 'application/json' });
    Object.defineProperty(result, 'text', { value: async () => JSON.stringify({ ...manifest, description }) });
    return result;
  };
  const first = render(React.createElement(Harness));
  fireEvent.drop(screen.getByRole('button', { name: '拖入或选择玩法插件' }), { dataTransfer: { files: [file('原版规则')] } });
  await waitFor(() => expect(screen.getByRole('button', { name: /^可分享谜题/ }).getAttribute('aria-pressed')).toBe('true'));
  first.unmount();
  render(React.createElement(Harness));
  await waitFor(() => expect(screen.getByRole('button', { name: /^可分享谜题/ }).getAttribute('aria-pressed')).toBe('false'));
  fireEvent.click(screen.getByRole('button', { name: /^可分享谜题/ }));
  expect(screen.getByRole('button', { name: /^可分享谜题/ }).getAttribute('aria-pressed')).toBe('true');
  fireEvent.drop(screen.getByRole('button', { name: '拖入或选择玩法插件' }), { dataTransfer: { files: [file('新版规则')] } });
  await waitFor(() => expect(screen.getAllByRole('button', { name: /^可分享谜题/ })).toHaveLength(2));
  const versions = screen.getAllByRole('button', { name: /^可分享谜题/ });
  expect(versions.map(button => button.getAttribute('aria-label'))).toEqual(expect.arrayContaining([
    expect.stringMatching(/custom-puzzle\.json · v1 · .+/),
  ]));
  expect(versions[0].getAttribute('aria-label')).not.toBe(versions[1].getAttribute('aria-label'));
  expect(versions.map(button => button.getAttribute('aria-pressed'))).toEqual(['false', 'true']);
  fireEvent.click(versions[0]);
  expect(screen.getAllByRole('button', { name: /^可分享谜题/ })).toEqual(versions);
  expect(versions.map(button => button.getAttribute('aria-pressed'))).toEqual(['true', 'false']);
  expect(JSON.parse(localStorage.getItem('eidos_gameplay_plugin_library_v1')!).plugins).toHaveLength(2);
});
it('rejects multiple dropped files and malformed JSON without altering selection', async () => {
  render(React.createElement(Harness));
  const zone = screen.getByRole('button', { name: '拖入或选择玩法插件' });
  fireEvent.drop(zone, { dataTransfer: { files: [new File(['{}'], 'one.json'), new File(['{}'], 'two.json')] } });
  await screen.findByRole('alert');
  expect(screen.getByRole('alert').textContent).toContain('一个文件');
  const malformed = new File(['x'.repeat(200001)], 'big.json');
  Object.defineProperty(malformed, 'text', { value: async () => 'x'.repeat(200001) });
  fireEvent.drop(zone, { dataTransfer: { files: [malformed] } });
  await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/JSON|Unexpected token/));
  expect(screen.queryByRole('button', { name: '检查玩法设计' })).toBeNull();
});
it('does not apply or persist a delayed file once world creation has locked the form', async () => {
  let finish!: (value: string) => void;
  const file = new File([''], 'slow.json');
  Object.defineProperty(file, 'text', { value: () => new Promise<string>(resolve => { finish = resolve; }) });
  const view = render(React.createElement(Harness));
  fireEvent.drop(screen.getByRole('button', { name: '拖入或选择玩法插件' }), { dataTransfer: { files: [file] } });
  view.rerender(React.createElement(Harness, { disabled: true }));
  await act(async () => finish(JSON.stringify({ format: 'eidos-gameplay-plugin', version: 1, id: 'late', name: '晚到插件', description: '', tags: [], prompts: { creation: '', action: '', review: '' } })));
  expect(screen.queryByRole('button', { name: /^晚到插件/ })).toBeNull();
  expect(localStorage.getItem('eidos_gameplay_plugin_library_v1')).toBeNull();
});
it('makes additional game modes available in the real world creator', async () => {
  localStorage.clear();
  render(React.createElement(WorldCreateScreen));
  fireEvent.click(screen.getByRole('button', { name: /玩法与模组/ }));
  expect(screen.getByRole('button', { name: '证据收集与推理' })).toBeDefined();
  expect(screen.queryByRole('button', { name: /生存探索|记忆物品/ })).toBeNull();
  expect(screen.getByRole('button', { name: '人物关系与日常互动' })).toBeDefined();
});

it('imports and remembers a valid package larger than the former file limit', async () => {
  render(React.createElement(Harness));
  const html = '<main>' + '大插件'.repeat(100000) + '</main>';
  const source = JSON.stringify({ format: 'eidos-gameplay-plugin', version: 1, id: 'large-reader', name: '大型阅读器', description: '完整舞台', tags: [], prompts: { creation: '', action: '', review: '' }, ui: { html, reading: 'replace' } });
  const file = new File([source], 'large.json', { type: 'application/json' }); Object.defineProperty(file, 'text', { value: async () => source });
  fireEvent.drop(screen.getByRole('button', { name: '拖入或选择玩法插件' }), { dataTransfer: { files: [file] } });
  await waitFor(() => expect(screen.getByRole('button', { name: /^大型阅读器/ }).getAttribute('aria-pressed')).toBe('true'));
  expect(JSON.parse(localStorage.getItem('eidos_gameplay_plugin_library_v1')!).plugins[0].ui.html).toBe(html);
});

it('imports more than sixteen plugins and can reselect them all', async () => {
  render(React.createElement(Harness));
  const source = JSON.stringify(Array.from({ length: 17 }, (_, i) => ({ format: 'eidos-gameplay-plugin', version: 1, id: `batch-${i}`, name: `批量插件 ${i}`, description: '玩法内容', tags: [], prompts: { creation: '', action: '', review: '' } })));
  const file = new File([source], 'batch.json'); Object.defineProperty(file, 'text', { value: async () => source });
  fireEvent.change(screen.getByLabelText('导入玩法插件 JSON'), { target: { files: [file] } });
  await waitFor(() => expect(screen.getByRole('button', { name: /^批量插件 16 / }).getAttribute('aria-pressed')).toBe('true'));
  fireEvent.click(screen.getByRole('button', { name: /^批量插件 16 / }));
  fireEvent.click(screen.getByRole('button', { name: /^批量插件 16 / }));
  expect(screen.getByRole('button', { name: /^批量插件 16 / }).getAttribute('aria-pressed')).toBe('true');
  expect(JSON.parse(localStorage.getItem('eidos_gameplay_plugin_library_v1')!).plugins).toHaveLength(17);
});

it('shows the selected preset version alongside the different local version without duplicating identical content', async () => {
  const [original] = parseGameplayPlugins([{ format: 'eidos-gameplay-plugin', version: 1,
    id: 'versioned-reader', name: '版本阅读器', description: '预设中的原版', release: '1.0', tags: [],
    prompts: { creation: '', action: '', review: '' } }]);
  savePluginLibrary([{ ...original, release: '2.0', description: '本机库里的新版' }]);
  const select = vi.fn(), change = vi.fn();
  render(React.createElement(GameplayPluginPicker, {
    selected: [original.id], custom: [original], preset: [original], disabled: false, onSelect: select, onCustom: change,
  }));
  const old = screen.getByRole('button', { name: /^版本阅读器.*versioned-reader\.json · v1\.0$/ });
  const next = screen.getByRole('button', { name: /^版本阅读器.*versioned-reader\.json · v2\.0$/ });
  expect(old.getAttribute('aria-pressed')).toBe('true');
  expect(next.getAttribute('aria-pressed')).toBe('false');
  expect(screen.getAllByRole('button', { name: /^版本阅读器/ })).toHaveLength(2);
  fireEvent.click(next);
  expect(change).toHaveBeenCalledWith([{ ...original, release: '2.0', description: '本机库里的新版' }]);
  expect(select).toHaveBeenCalledWith([original.id]);
});
