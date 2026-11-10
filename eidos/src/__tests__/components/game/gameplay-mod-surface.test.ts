// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, act, waitFor } from '@testing-library/react';
import { GameplayModSurface } from '@/components/game/GameplayModSurface';
import { useGameStore } from '@/store/game-store';
import { buildRiftCityStartState } from '@/lib/test/fixtures';
import { parsePluginFile } from '@/lib/game/plugins/manifest';
import { HOST_SHORTCUT_EVENT } from '@/lib/game/keyboard-shortcuts';

const plugin = { format: 'eidos-gameplay-plugin', version: 1, id: 'surface', name: '自定义主舞台', description: '测试界面', tags: [], prompts: { creation: '', action: '', review: '' }, rules: [], ui: { html: '<main>作者界面</main>', reading: 'replace', initialState: {} } };
beforeEach(() => { useGameStore.setState(useGameStore.getInitialState()); useGameStore.getState().setCurrentWorld({ ...buildRiftCityStartState().world, gameplayPlugins: parsePluginFile(plugin) }); });
afterEach(cleanup);
const reading = { segments: [{ type: 'narration' as const, text: '已经读到的字' }], index: 0, displayedText: '已经', complete: false, loading: false, error: null };
it('forwards shortcuts only from the current active frame and rejects stale or suspended messages', () => {
  const listener = vi.fn(); window.addEventListener(HOST_SHORTCUT_EVENT, listener);
  const props = { reading, onSubmit: vi.fn(), onAdvance: vi.fn() };
  try {
    const view = render(React.createElement(GameplayModSurface, props));
    const frame = screen.getByTitle('自定义主舞台') as HTMLIFrameElement;
    const send = (scope = frame.dataset.scope) => act(() => window.dispatchEvent(new MessageEvent('message', {
      source: frame.contentWindow, data: { channel: 'eidos-mod', token: frame.dataset.session, scope, command: 'shortcut', action: 'status' },
    })));
    send(); expect(listener).toHaveBeenCalledOnce();
    expect((listener.mock.calls[0][0] as CustomEvent).detail).toBe('status');
    send('old-scope'); expect(listener).toHaveBeenCalledOnce();
    view.rerender(React.createElement(GameplayModSurface, { ...props, suspended: true }));
    send(); expect(listener).toHaveBeenCalledOnce();
  } finally { window.removeEventListener(HOST_SHORTCUT_EVENT, listener); }
});
it('blocks analysis, native operations and iframe network in an offline author rehearsal', async () => {
  const network = vi.spyOn(globalThis, 'fetch');
  render(React.createElement(GameplayModSurface, { reading, offline: true, onSubmit: vi.fn(), onAdvance: vi.fn() }));
  const frame = screen.getByTitle('自定义主舞台') as HTMLIFrameElement, post = vi.spyOn(frame.contentWindow!, 'postMessage');
  expect(frame.srcdoc).toContain("connect-src 'none'");
  for (const method of ['resources.inspect', 'files.checkout', 'files.reload', 'stages.open']) {
    act(() => window.dispatchEvent(new MessageEvent('message', { source: frame.contentWindow, data: { channel: 'eidos-mod', token: frame.dataset.session, scope: frame.dataset.scope, command: 'rpc', id: method, method, params: { path: 'a.txt', mode: 'native' } } })));
    await waitFor(() => expect(post).toHaveBeenCalledWith(expect.objectContaining({ id: method, ok: false, error: expect.stringContaining('离线') }), '*'));
  }
  expect(network).not.toHaveBeenCalled(); network.mockRestore();
});
it('rotates frame authority when the installed package changes even at the same node', () => {
  const submit = vi.fn(); render(React.createElement(GameplayModSurface, { reading, onSubmit: submit, onAdvance: vi.fn() }));
  const frame = screen.getByTitle('自定义主舞台') as HTMLIFrameElement;
  const old = { token: frame.dataset.session, scope: frame.dataset.scope, source: frame.contentWindow };
  act(() => useGameStore.setState(s => ({ currentWorld: { ...s.currentWorld!, gameplayPlugins: parsePluginFile({ ...plugin, release: 'new', ui: { ...plugin.ui, html: '<main>新版界面</main>' } }) } })));
  expect((screen.getByTitle('自定义主舞台') as HTMLIFrameElement).dataset.session).not.toBe(old.token);
  act(() => window.dispatchEvent(new MessageEvent('message', { source: old.source, data: { channel: 'eidos-mod', token: old.token, scope: old.scope, command: 'submit', action: '旧代码的行动' } })));
  expect(submit).not.toHaveBeenCalled();
});
it('returns file receipts through the real iframe boundary and preserves host files across author state updates', async () => {
  render(React.createElement(GameplayModSurface, { reading, onSubmit: vi.fn(), onAdvance: vi.fn() }));
  const frame = screen.getByTitle('自定义主舞台') as HTMLIFrameElement;
  const post = vi.spyOn(frame.contentWindow!, 'postMessage');
  const send = (extra: object) => act(() => window.dispatchEvent(new MessageEvent('message', { source: frame.contentWindow, data: { channel: 'eidos-mod', token: frame.dataset.session, scope: frame.dataset.scope, ...extra } })));
  send({ command: 'rpc', id: 'write', method: 'files.write', params: { path: 'letter.txt', text: 'actual file' } });
  await waitFor(() => expect(post.mock.calls.some(call => call[0].channel === 'eidos-mod-result' && call[0].id === 'write' && call[0].ok)).toBe(true));
  const workspace = useGameStore.getState().gameplayModState.surface._eidosWorkspace;
  send({ command: 'state', state: { authored: 'changed', _eidosWorkspace: {} } });
  expect(useGameStore.getState().gameplayModState.surface).toEqual({ authored: 'changed', _eidosWorkspace: workspace });
  send({ command: 'rpc', id: 'read', method: 'files.read', params: { path: 'letter.txt' } });
  await waitFor(() => expect(post.mock.calls.find(call => call[0].id === 'read')?.[0].result.text).toBe('actual file'));
});
it('passes an actor narration request through the real isolated frame boundary', () => {
  const submit = vi.fn();
  render(React.createElement(GameplayModSurface, { reading, onSubmit: submit, onAdvance: vi.fn() }));
  const frame = screen.getByTitle('自定义主舞台') as HTMLIFrameElement;
  const request = { kind: 'choice', frame: { kind: 'cutaway', actor: '白槿', location: '车厢' }, choice: '藏信' };
  act(() => window.dispatchEvent(new MessageEvent('message', { source: frame.contentWindow, data: { channel: 'eidos-mod', token: frame.dataset.session, scope: frame.dataset.scope, command: 'narrate', request } })));
  expect(submit).toHaveBeenCalledWith('剧情选择：白槿（车厢）选择“藏信”。', request);
});
it('runs only commands from the current frame and restores state in snapshots', () => {
  const submit = vi.fn(), advance = vi.fn();
  render(React.createElement(GameplayModSurface, { reading, onSubmit: submit, onAdvance: advance }));
  const frame = screen.getByTitle('自定义主舞台') as HTMLIFrameElement;
  expect(frame.getAttribute('sandbox')).toBe('allow-scripts');
  const token = frame.dataset.session!;
  const scope = frame.dataset.scope!;
  const send = (source: Window | null, extra: object) => act(() => { window.dispatchEvent(new MessageEvent('message', { source, data: { channel: 'eidos-mod', token, scope, ...extra } })); });
  send(window, { command: 'state', state: { forged: true } });
  expect(useGameStore.getState().gameplayModState.surface).toEqual({});
  send(frame.contentWindow, { command: 'submit', action: '质询记录', state: { inspected: ['clock'] } });
  expect(submit).toHaveBeenCalledWith('质询记录');
  expect(useGameStore.getState().createSnapshot().gameplayModState?.surface).toEqual({ inspected: ['clock'] });
  // Synchronous duplicate clicks cannot outrun React's loading render.
  send(frame.contentWindow, { command: 'submit', action: '再质询' });
  expect(submit).toHaveBeenCalledTimes(1);
  send(frame.contentWindow, { command: 'advance' });
  expect(advance).toHaveBeenCalledTimes(1);
});
it('does not transmit hidden world secrets or unrevealed story text to author frames', () => {
  render(React.createElement(GameplayModSurface, { reading: { ...reading, segments: [...reading.segments, { type: 'narration', text: '尚未读到的剧透' }] }, onSubmit: vi.fn(), onAdvance: vi.fn() }));
  const frame = screen.getByTitle('自定义主舞台') as HTMLIFrameElement;
  const post = vi.spyOn(frame.contentWindow!, 'postMessage');
  act(() => { window.dispatchEvent(new MessageEvent('message', { source: frame.contentWindow, data: { channel: 'eidos-mod', token: frame.dataset.session, command: 'connect' } })); });
  const context = post.mock.calls.at(-1)?.[0].context;
  expect(context.reading.segments[0].text).toBe('已经');
  expect(JSON.stringify(context)).not.toContain('尚未读到的剧透');
  expect(context.plugin.ui).toBeUndefined();
  expect(context.world.secrets).toBeUndefined();
  expect(context.clues.every((clue: { discovered: boolean }) => clue.discovered)).toBe(true);
});
it('restores default reading when the author consumer fails after connection', () => {
  const active = vi.fn();
  render(React.createElement(GameplayModSurface, { reading, onSubmit: vi.fn(), onAdvance: vi.fn(), onActiveChange: active }));
  const frame = screen.getByTitle('自定义主舞台') as HTMLIFrameElement;
  act(() => { window.dispatchEvent(new MessageEvent('message', { source: frame.contentWindow, data: { channel: 'eidos-mod', token: frame.dataset.session, command: 'failed' } })); });
  expect(screen.getByRole('alert').textContent).toContain('恢复默认阅读');
  expect(active).toHaveBeenCalledWith(false);
  expect(screen.queryByTitle('自定义主舞台')).toBeNull();
});
it('does not attach the previous beat typewriter text to a newly selected segment', () => {
  render(React.createElement(GameplayModSurface, { reading: { ...reading, index: 1, segments: [{ type: 'narration', text: '上一段已经读完。' }, { type: 'dialogue', speaker: '白槿', text: '新一句话。' }], displayedText: '上一段已经读完。' }, onSubmit: vi.fn(), onAdvance: vi.fn() }));
  const frame = screen.getByTitle('自定义主舞台') as HTMLIFrameElement;
  const post = vi.spyOn(frame.contentWindow!, 'postMessage');
  act(() => { window.dispatchEvent(new MessageEvent('message', { source: frame.contentWindow, data: { channel: 'eidos-mod', token: frame.dataset.session, command: 'connect' } })); });
  const context = post.mock.calls.at(-1)?.[0].context;
  expect(context.reading.segments[0].text).toBe('上一段已经读完。');
  expect(context.reading.segments[1].text).toBe('');
});
it('ignores a frame from the previous branch even before it is unmounted', () => {
  const submit = vi.fn();
  render(React.createElement(GameplayModSurface, { reading, onSubmit: submit, onAdvance: vi.fn() }));
  const frame = screen.getByTitle('自定义主舞台') as HTMLIFrameElement;
  const token = frame.dataset.session!, scope = frame.dataset.scope!;
  act(() => { useGameStore.setState({ currentSceneId: 'different-scene' }); });
  act(() => { window.dispatchEvent(new MessageEvent('message', { source: frame.contentWindow, data: { channel: 'eidos-mod', token, scope, command: 'submit', action: '旧场景发言' } })); });
  expect(submit).not.toHaveBeenCalled();
});

it('mounts a conditional stage at the right story time, releases it, and restores it after a new scene scope', () => {
  const active = vi.fn();
  const conditional = parsePluginFile({ ...plugin, activation: { requires: { hearing: true } } })[0];
  useGameStore.setState({ currentWorld: { ...useGameStore.getState().currentWorld!, gameplayPlugins: [conditional] }, worldFlags: {} });
  render(React.createElement(GameplayModSurface, { reading, onSubmit: vi.fn(), onAdvance: vi.fn(), onActiveChange: active }));
  expect(screen.queryByTitle('自定义主舞台')).toBeNull();
  act(() => useGameStore.setState({ worldFlags: { 'gameplay.surface.hearing': true } }));
  const frame = screen.getByTitle('自定义主舞台') as HTMLIFrameElement;
  const send = (command: string, extra: object = {}) => act(() => window.dispatchEvent(new MessageEvent('message', { source: frame.contentWindow, data: { channel: 'eidos-mod', token: frame.dataset.session, scope: frame.dataset.scope, command, ...extra } })));
  send('ready'); expect(active).toHaveBeenLastCalledWith(true);
  send('release', { state: { inspected: 'clock' } });
  expect(screen.queryByTitle('自定义主舞台')).toBeNull(); expect(active).toHaveBeenLastCalledWith(false);
  expect(useGameStore.getState().gameplayModState.surface).toEqual({ inspected: 'clock' });
  act(() => useGameStore.setState({ currentSceneId: 'next' }));
  expect(screen.getByTitle('自定义主舞台')).toBeTruthy();
  act(() => useGameStore.setState({ worldFlags: { 'gameplay.surface.hearing': false } }));
  expect(screen.queryByTitle('自定义主舞台')).toBeNull();
});
it('lets a conditional operation take over a permanent reader, then return to it', () => {
  useGameStore.setState({ currentWorld: { ...useGameStore.getState().currentWorld!, gameplayPlugins: parsePluginFile([plugin, { ...plugin, id: 'trial', name: '临时庭审', activation: { requires: { open: true } } }]) }, worldFlags: {} });
  render(React.createElement(GameplayModSurface, { reading, onSubmit: vi.fn(), onAdvance: vi.fn() }));
  expect(screen.getByTitle('自定义主舞台')).toBeTruthy();
  act(() => useGameStore.setState({ worldFlags: { 'gameplay.trial.open': true } }));
  expect(screen.getByTitle('临时庭审')).toBeTruthy(); expect(screen.queryByTitle('自定义主舞台')).toBeNull();
  act(() => useGameStore.setState({ worldFlags: { 'gameplay.trial.open': false } }));
  expect(screen.getByTitle('自定义主舞台')).toBeTruthy();
});

it('passes only this author’s declared preferences to the isolated frame', () => {
  localStorage.setItem('eidos_settings', JSON.stringify({ aliceApiKey: 'never-send-this-key', modPreferences: { surface: { hints: false }, foreign: { private: 'never-send-other-pref' } } }));
  useGameStore.setState({ currentWorld: { ...useGameStore.getState().currentWorld!, gameplayPlugins: parsePluginFile({ ...plugin, settings: [{ id: 'hints', label: '提示', type: 'boolean', default: true }] }) } });
  render(React.createElement(GameplayModSurface, { reading, onSubmit: vi.fn(), onAdvance: vi.fn() }));
  const frame = screen.getByTitle('自定义主舞台') as HTMLIFrameElement;
  const post = vi.spyOn(frame.contentWindow!, 'postMessage');
  act(() => window.dispatchEvent(new MessageEvent('message', { source: frame.contentWindow, data: { channel: 'eidos-mod', token: frame.dataset.session, command: 'connect' } })));
  const context = post.mock.calls.at(-1)?.[0].context;
  expect(context.settings).toEqual({ hints: false });
  expect(JSON.stringify(context)).not.toMatch(/never-send/);
  localStorage.clear();
});

it('rotates the author session when switching into a sandbox dossier', () => {
  const submit = vi.fn();
  render(React.createElement(GameplayModSurface, { reading, onSubmit: submit, onAdvance: vi.fn() }));
  const frame = screen.getByTitle('自定义主舞台') as HTMLIFrameElement;
  const old = { window: frame.contentWindow, token: frame.dataset.session, scope: frame.dataset.scope };
  act(() => useGameStore.setState({ sandboxMode: true, sandboxDossierId: '003' }));
  expect((screen.getByTitle('自定义主舞台') as HTMLIFrameElement).dataset.scope).not.toBe(old.scope);
  act(() => window.dispatchEvent(new MessageEvent('message', { source: old.window, data: { channel: 'eidos-mod', token: old.token, scope: old.scope, command: 'submit', action: '旧舞台的行动' } })));
  expect(submit).not.toHaveBeenCalled();
});

it('syncs only presentation tokens into a live frame without resetting its session or game state', async () => {
  const root = document.documentElement, oldStyle = root.getAttribute('style'), oldTheme = root.getAttribute('data-theme');
  try {
    root.dataset.theme = 'light';
    root.style.setProperty('--eidos-palette-background', '#fafafa');
    root.style.setProperty('--eidos-palette-accent', '#9e0000');
    root.style.setProperty('--font-geist-sans', '"PingFang SC", sans-serif');
    root.style.setProperty('--private-token', 'never-send-style-secrets');
    useGameStore.setState({ gameplayModState: { surface: { turn: 7 } } });
    render(React.createElement(GameplayModSurface, { reading, onSubmit: vi.fn(), onAdvance: vi.fn() }));
    const frame = screen.getByTitle('自定义主舞台') as HTMLIFrameElement, token = frame.dataset.session;
    const post = vi.spyOn(frame.contentWindow!, 'postMessage');
    act(() => window.dispatchEvent(new MessageEvent('message', { source: frame.contentWindow, data: { channel: 'eidos-mod', token, scope: frame.dataset.scope, command: 'ready' } })));
    expect(post.mock.calls.filter(call => call[0].channel === 'eidos-mod-context').at(-1)?.[0].context.theme).toMatchObject({ mode: 'light', background: '#fafafa', accent: '#9e0000', fontSans: '"PingFang SC", sans-serif' });
    act(() => {
      root.dataset.theme = 'dark';
      root.style.setProperty('--eidos-palette-background', '#111e2a');
      root.style.setProperty('--eidos-palette-accent', '#8cc9ed');
    });
    await waitFor(() => expect(post.mock.calls.filter(call => call[0].channel === 'eidos-mod-context').at(-1)?.[0].context.theme).toMatchObject({ mode: 'dark', background: '#111e2a', accent: '#8cc9ed' }));
    expect(screen.getByTitle('自定义主舞台')).toBe(frame);
    expect(frame.dataset.session).toBe(token);
    expect(useGameStore.getState().gameplayModState.surface).toEqual({ turn: 7 });
    expect(JSON.stringify(post.mock.calls.filter(call => call[0].channel === 'eidos-mod-context').at(-1)?.[0].context.theme)).not.toContain('never-send-style-secrets');
  } finally {
    cleanup();
    if (oldStyle === null) root.removeAttribute('style'); else root.setAttribute('style', oldStyle);
    if (oldTheme === null) root.removeAttribute('data-theme'); else root.setAttribute('data-theme', oldTheme);
  }
});
