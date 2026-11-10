// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SettingsScreen } from '@/components/game/SettingsScreen';
import { EidosShell } from '@/components/shell/EidosShell';
import { exportAiConfig } from '@/lib/ai/config-document';
import { DEFAULT_SETTINGS } from '@/lib/game/types';
import { useGameStore } from '@/store/game-store';

beforeEach(() => {
  localStorage.clear(); localStorage.setItem('eidos_settings', JSON.stringify({ ...DEFAULT_SETTINGS, aliceApiKey: 'saved-key', keiApiKey: 'saved-key', uzqApiKey: 'saved-key' }));
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  // Any accidental connection test in this workflow fails without reaching a real model.
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('No network during configuration import'); }));
  useGameStore.setState({ currentWorld: null, history: [], phase: 'settings', navigationStack: [] });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
function open() {
  render(React.createElement(EidosShell, null, React.createElement(SettingsScreen)));
  fireEvent.click(screen.getByRole('button', { name: 'AI 接入' }));
}
async function importLocal() {
  const doc = JSON.parse(exportAiConfig(DEFAULT_SETTINGS));
  for (const role of ['alice', 'kei', 'uzq']) doc.roles[role] = { ...doc.roles[role], providerId: 'ollama', endpoint: 'http://127.0.0.1:11434/v1', model: 'my-local-model' };
  const file = new File([JSON.stringify(doc)], 'local.json', { type: 'application/json' });
  Object.defineProperty(file, 'text', { value: async () => JSON.stringify(doc) });
  fireEvent.change(screen.getByLabelText('导入 AI 配置文件'), { target: { files: [file] } });
  await screen.findByText(/配置已载入草稿/);
}
it('imports all connections into a reviewable draft, then saves without a network call', async () => {
  open(); await importLocal();
  expect((screen.getByLabelText('ALICE 模型名称') as HTMLInputElement).value).toBe('my-local-model');
  expect((screen.getByLabelText('ALICE API 密钥') as HTMLInputElement).value).toBe('');
  expect(JSON.parse(localStorage.getItem('eidos_settings')!).aliceProviderId).toBe('deepseek');
  fireEvent.click(screen.getByRole('button', { name: '保存设置' }));
  expect(JSON.parse(localStorage.getItem('eidos_settings')!)).toMatchObject({ aliceProviderId: 'ollama', keiModel: 'my-local-model', uzqModel: 'my-local-model', aliceApiKey: '' });
  expect(fetch).not.toHaveBeenCalled();
});
it('discards an imported configuration with the existing discard control', async () => {
  open(); await importLocal();
  fireEvent.click(screen.getByRole('button', { name: '放弃更改' }));
  await waitFor(() => expect(screen.getByText((_, element) => element?.tagName === 'P' && element.textContent === 'ALICE · deepseek-v4-flash · deepseek')).toBeTruthy());
  expect(JSON.parse(localStorage.getItem('eidos_settings')!)).toMatchObject({ aliceProviderId: 'deepseek', aliceApiKey: 'saved-key' });
});
it('lets a shared local connection use a player supplied model ID and optional key', () => {
  open();
  fireEvent.change(screen.getByLabelText('供应商'), { target: { value: 'lm-studio' } });
  fireEvent.change(screen.getByLabelText('本地或自定义模型 ID'), { target: { value: 'loaded-model' } });
  fireEvent.change(screen.getByLabelText('质量档位'), { target: { value: 'quality' } });
  fireEvent.click(screen.getByRole('button', { name: '保存设置' }));
  expect(JSON.parse(localStorage.getItem('eidos_settings')!)).toMatchObject({ aliceProviderId: 'lm-studio', aliceApiKey: '', aliceModel: 'loaded-model', keiModel: 'loaded-model', uzqModel: 'loaded-model' });
});
