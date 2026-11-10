// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { VoiceInstallationProvider } from '@/components/game/momoi/VoiceInstallation';
import { VoiceMaterial } from '@/components/game/momoi/VoiceMaterial';
import { useGameStore } from '@/store/game-store';
import { DEFAULT_VOICE_CONFIG } from '@/lib/game/momoi/model';
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it('ignores an old inspection that finishes after the selected weights change', async () => {
  useGameStore.getState().setVoiceConfig(DEFAULT_VOICE_CONFIG);
  let finish!: (response: Response) => void;
  const report = (languages: string[]) => ({ checks: [], languageResources: languages.map(id => ({ id, ready: true })), models: [{ languages, ready: true }] });
  vi.stubGlobal('fetch', vi.fn().mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockResolvedValue(Response.json(report(['zh', 'ja']))));
  render(React.createElement(VoiceInstallationProvider, null, React.createElement(VoiceMaterial)));
  const select = screen.getByLabelText('语音生成材料') as HTMLSelectElement;
  await act(async () => { useGameStore.getState().setVoiceConfig({ gptWeights: '/new.ckpt', sovitsWeights: '/new.pth' }); });
  await waitFor(() => expect(select.querySelector('option[value="ja"]')).toBeTruthy());
  await act(async () => { finish(Response.json(report(['ko']))); });
  expect(select.querySelector('option[value="ko"]')).toBeNull();
  expect(select.querySelector('option[value="ja"]')).toBeTruthy();
});
