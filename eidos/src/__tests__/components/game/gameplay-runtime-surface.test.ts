// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { webcrypto } from 'node:crypto';
import React from 'react';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { GameplayModSurface } from '@/components/game/GameplayModSurface';
import { useGameStore } from '@/store/game-store';
import { buildRiftCityStartState } from '@/lib/test/fixtures';
import { parseGameplayPlugins } from '@/lib/game/plugins/manifest';
import { abortActiveStream } from '@/lib/game/stream-lifecycle';
import { gameplayLedger } from '@/lib/game/plugins/gameplay-state';

const initial = useGameStore.getState();
const reading = { segments: [], index: 0, displayedText: '', complete: true, loading: false, typing: false, paused: false };
beforeEach(async () => {
  vi.stubGlobal('crypto', webcrypto); abortActiveStream();
  const { world, snapshot } = buildRiftCityStartState();
  useGameStore.setState({ ...initial, phase: 'playing', currentWorld: { ...world, gameplayPlugins: parseGameplayPlugins([{ format: 'eidos-gameplay-plugin', version: 1, id: 'trial', name: '质询', tags: [],
    prompts: { creation: '', action: '', review: '' }, description: '质询测试', rules: [], ui: { html: '<p>trial</p>', reading: 'inherit' } }]) },
    currentPlaythroughId: crypto.randomUUID(), currentSceneId: snapshot.currentSceneId, gameplayModState: { trial: {} },
    history: [], worldLine: null, currentNode: null, allNodes: {}, sandboxMode: false });
  await useGameStore.getState().initWorldLine(useGameStore.getState().currentPlaythroughId!, world.id);
});
afterEach(() => { cleanup(); abortActiveStream(); vi.unstubAllGlobals(); });
it('acknowledges a committed result to the same frame and protects it from later presentation writes', async () => {
  render(React.createElement(GameplayModSurface, { reading, onSubmit: () => undefined, onAdvance: () => undefined }));
  const frame = screen.getByTitle('质询') as HTMLIFrameElement;
  const token = frame.dataset.session, post = vi.spyOn(frame.contentWindow!, 'postMessage');
  const send = (extra: object) => act(() => window.dispatchEvent(new MessageEvent('message', { source: frame.contentWindow, data: { channel: 'eidos-mod', token, scope: frame.dataset.scope, ...extra } })));
  send({ command: 'rpc', id: 'commit', method: 'gameplay.commit', params: { id: 'break-line-1', expectedRevision: 0, summary: '第一句已被推翻', state: { index: 1 }, facts: { broken: 'line-1' } } });
  await waitFor(() => expect(post.mock.calls.find(c => c[0].id === 'commit')?.[0]).toMatchObject({ ok: true, result: { id: 'break-line-1', revision: 1 } }));
  expect(screen.getByTitle('质询')).toBe(frame); expect(frame.dataset.session).toBe(token);
  expect(useGameStore.getState().history).toHaveLength(1);
  send({ command: 'state', state: { index: 1, selected: 'next', _eidosGameplay: { revision: 999 } } });
  expect(gameplayLedger(useGameStore.getState().gameplayModState.trial)?.revision).toBe(1);
});
