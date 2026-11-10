// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { GameplayPluginPicker } from '@/components/game/creation/GameplayPluginPicker';
import { resourceWorld } from '../../lib/game/gameplay-resource-fixtures';
import { useGameStore } from '@/store/game-store';
import { buildRiftCityStartState } from '@/lib/test/fixtures';

const review = { summary: '检查完成', findings: [{ pluginId: 'supplies', ruleId: 'eat', severity: 'warning', message: '注意补给消耗', suggestion: '提供补给路径' }] };
const usage = { model: 'uzq', callType: 'uzq_gameplay_design', promptTokens: 100, completionTokens: 10, totalTokens: 110, elapsedMs: 10 };
const props = () => ({ selected: ['supplies'], custom: resourceWorld().gameplayPlugins, disabled: false, onSelect: vi.fn(), onCustom: vi.fn() });
beforeEach(() => { localStorage.clear(); useGameStore.setState({ aiCalls: [], tokensUsed: 0, worldTokenUsage: {}, currentWorld: buildRiftCityStartState().world }); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
it('reviews only on demand, renders suggestions and records exactly one UZQ request', async () => {
  const model = vi.fn(async (_url, init: RequestInit) => {
    const body = JSON.parse(String(init.body)); expect(body.gameplayPlugins[0].id).toBe('supplies');
    return Response.json({ review, usage });
  });
  vi.stubGlobal('fetch', model);
  render(React.createElement(GameplayPluginPicker, props()));
  expect(model).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '检查玩法设计' }));
  await screen.findByText('注意补给消耗');
  expect(screen.getByText('提供补给路径')).toBeDefined();
  expect(useGameStore.getState().tokensUsed).toBe(110);
  expect(useGameStore.getState().aiCalls).toHaveLength(1);
  expect(useGameStore.getState().aiCalls[0]).toMatchObject({ model: 'uzq', callType: 'uzq_gameplay_design' });
  expect(useGameStore.getState().worldTokenUsage).toEqual({});
});
it('displays an analysis failure while leaving plugin selection usable and retaining known billing', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: '模型输出格式无效', usage: { ...usage, success: false } }, { status: 502 })));
  render(React.createElement(GameplayPluginPicker, props()));
  fireEvent.click(screen.getByRole('button', { name: '检查玩法设计' }));
  expect((await screen.findByRole('alert')).textContent).toContain('模型输出格式无效');
  expect((screen.getByRole('button', { name: '旅途补给 · supplies.json · v2' }) as HTMLButtonElement).disabled).toBe(false);
  expect(useGameStore.getState().aiCalls).toHaveLength(1);
});
it('cancels on changed selection and ignores late suggestions while keeping known billed usage', async () => {
  let finish!: (r: Response) => void, signal: AbortSignal | undefined;
  vi.stubGlobal('fetch', vi.fn((_url, init: RequestInit) => { signal = init.signal as AbortSignal; return new Promise<Response>(resolve => { finish = resolve; }); }));
  const p = props(), view = render(React.createElement(GameplayPluginPicker, p));
  fireEvent.click(screen.getByRole('button', { name: '检查玩法设计' }));
  await waitFor(() => expect(signal).toBeDefined());
  view.rerender(React.createElement(GameplayPluginPicker, { ...p, selected: [] }));
  expect(signal!.aborted).toBe(true);
  finish(Response.json({ review, usage }));
  await waitFor(() => expect(useGameStore.getState().aiCalls).toHaveLength(1));
  expect(screen.queryByText('注意补给消耗')).toBeNull();
});
it('lets the user stop a running check without making plugin import unavailable', async () => {
  let signal: AbortSignal | undefined;
  vi.stubGlobal('fetch', vi.fn((_url, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
    signal = init.signal as AbortSignal; signal.addEventListener('abort', () => reject(signal!.reason), { once: true });
  })));
  render(React.createElement(GameplayPluginPicker, props()));
  fireEvent.click(screen.getByRole('button', { name: '检查玩法设计' }));
  fireEvent.click(await screen.findByRole('button', { name: '停止检查' }));
  await waitFor(() => expect((screen.getByRole('button', { name: '检查玩法设计' }) as HTMLButtonElement).disabled).toBe(false));
  expect(signal!.aborted).toBe(true);
  expect((screen.getByLabelText('导入玩法插件 JSON') as HTMLInputElement).disabled).toBe(false);
});
