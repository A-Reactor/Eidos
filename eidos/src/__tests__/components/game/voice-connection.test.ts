// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { VoiceConnection } from '@/components/game/momoi/VoiceConnection';
import { useGameStore } from '@/store/game-store';

vi.mock('@/components/game/momoi/VoiceCasting', () => ({ VoiceCasting: () => null }));
vi.mock('@/components/game/momoi/VoicePresets', () => ({ VoicePresets: () => null }));
vi.mock('@/lib/game/momoi/presets', () => ({ loadVoicePresets: async () => {}, rememberVoiceDraft: async () => {} }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it('lets the ready control shut down the model and offers startup again', async () => {
  useGameStore.setState({ ...useGameStore.getInitialState(), momoiStatus: 'ready' });
  const fetch = vi.fn().mockResolvedValue(Response.json({ ok: true, status: 'stopped' }));
  vi.stubGlobal('fetch', fetch);
  render(React.createElement(VoiceConnection, { speaker: '', onSpeakerChange: vi.fn(), onInstallation: vi.fn() }));
  const button = screen.getByRole('button', { name: '模型已就绪' });
  expect(button).toHaveProperty('disabled', false);
  fireEvent.click(button);
  await screen.findByRole('button', { name: '启动本地模型' });
  await waitFor(() => expect(fetch).toHaveBeenCalledOnce());
  expect(fetch.mock.calls[0][0]).toBe('/api/momoi/stop');
});
