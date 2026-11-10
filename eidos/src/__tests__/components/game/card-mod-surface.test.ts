// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { GameplayModSurface } from '@/components/game/GameplayModSurface';
import { mountCardWorld } from '@/lib/game/cards/binding';
import { parseCardBytes } from '@/lib/game/cards/parser';
import { cardAdapterId, cardLedger } from '@/lib/game/cards/adapter';
import { useGameStore } from '@/store/game-store';
import { buildRiftCityStartState } from '@/lib/test/fixtures';
import { parsePluginFile } from '@/lib/game/plugins/manifest';
import { abortActiveStream, setStreamBusy } from '@/lib/game/stream-lifecycle';
afterEach(() => { cleanup(); abortActiveStream(); });

it('coexists with the main mod and sends only public card values through the existing iframe', () => {
  const id = 'b'.repeat(64), bytes = new TextEncoder().encode(JSON.stringify({ name: '条件卡', character_book: { entries: [{ comment: '[InitVar]', enabled: false, content: '{"trust":20,"secret":"绝不显示"}' }] }, extensions: { eidos: { publicVariables: ['trust'] } } }));
  const asset = { ...parseCardBytes(bytes, 'card.json'), id, originalBytes: bytes, filename: 'card.json', createdAt: 1 };
  const base = { ...buildRiftCityStartState().world, gameplayPlugins: parsePluginFile({ format: 'eidos-gameplay-plugin', version: 1, id: 'main', name: '主模组', description: '已有主舞台', tags: [], prompts: { creation: '', action: '', review: '' }, rules: [], ui: { html: '主界面', reading: 'replace' } }) };
  useGameStore.setState(useGameStore.getInitialState()); useGameStore.getState().setCurrentWorld(mountCardWorld({ asset, role: 'world', world: base }));
  const onSubmit = vi.fn(), props = { reading: { segments: [], index: 0, displayedText: '', complete: true, loading: false }, onSubmit, onAdvance: vi.fn() };
  render(React.createElement(React.Fragment, null, React.createElement(GameplayModSurface, props), React.createElement(GameplayModSurface, { ...props, pluginId: cardAdapterId(id) })));
  expect(screen.getByTitle('主模组')).toBeTruthy();
  const frame = screen.getByTitle('条件卡 · 变量') as HTMLIFrameElement, post = vi.spyOn(frame.contentWindow!, 'postMessage');
  const send = (command: string, extra: object = {}) => act(() => window.dispatchEvent(new MessageEvent('message', { source: frame.contentWindow, data: { channel: 'eidos-mod', token: frame.dataset.session, scope: frame.dataset.scope, command, ...extra } })));
  send('connect'); const context = post.mock.calls.at(-1)?.[0].context;
  expect(context.state.publicVariables).toEqual([{ path: 'trust', value: 20 }]); expect(JSON.stringify(context)).not.toContain('绝不显示');
  send('state', { state: { _eidosCard: { variables: {}, revision: 77 } } });
  expect(cardLedger(useGameStore.getState().gameplayModState, id)?.revision).toBe(0);
  send('submit', { action: '询问城门' }); expect(onSubmit).toHaveBeenCalledWith('询问城门');
});

it('shares the submission boundary across two simultaneous card panels', () => {
  const base = buildRiftCityStartState().world;
  let world = base;
  for (const id of ['a'.repeat(64), 'b'.repeat(64)]) {
    const originalBytes = new TextEncoder().encode(JSON.stringify({ name: id[0], character_book: { entries: [{ comment: '[InitVar]', enabled: false, content: '{"trust":20}' }] } }));
    world = mountCardWorld({ world, role: 'world', asset: { ...parseCardBytes(originalBytes, 'card.json'), id, originalBytes, filename: 'card.json', createdAt: 1 } });
  }
  useGameStore.setState(useGameStore.getInitialState()); useGameStore.getState().setCurrentWorld(world);
  const submit = vi.fn(() => { setStreamBusy(true); return new Promise<void>(() => {}); });
  const props = { reading: { segments: [], index: 0, displayedText: '', complete: true, loading: false }, onSubmit: submit, onAdvance: vi.fn() };
  render(React.createElement(React.Fragment, null, ...world.gameplayPlugins!.map(p => React.createElement(GameplayModSurface, { ...props, pluginId: p.id, key: p.id }))));
  for (const name of ['a · 变量', 'b · 变量']) {
    const frame = screen.getByTitle(name) as HTMLIFrameElement;
    act(() => window.dispatchEvent(new MessageEvent('message', { source: frame.contentWindow, data: { channel: 'eidos-mod', token: frame.dataset.session, scope: frame.dataset.scope, command: 'submit', action: '询问' } })));
  }
  expect(submit).toHaveBeenCalledTimes(1);
});
