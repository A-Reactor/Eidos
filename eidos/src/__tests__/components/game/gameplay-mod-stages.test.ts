// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import React from 'react';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { GameplayModStages } from '@/components/game/GameplayModStages';
import { useGameStore } from '@/store/game-store';
import { buildRiftCityStartState } from '@/lib/test/fixtures';
import { parseGameplayPlugins } from '@/lib/game/plugins/manifest';
import { readFileSync } from 'node:fs';
const reading = { segments: [], index: 0, displayedText: '', complete: true, loading: false };
const draft = { format: 'eidos-gameplay-plugin', version: 1, id: 'reader', name: '常驻阅读', description: '测试', tags: [], prompts: { creation: '', action: '', review: '' }, rules: [], ui: { html: '<p>reader</p>', reading: 'replace' } };
beforeEach(() => {
  const { world } = buildRiftCityStartState();
  useGameStore.setState({ ...useGameStore.getInitialState(), currentWorld: { ...world, gameplayPlugins: parseGameplayPlugins([draft, { ...draft, id: 'court', name: '临时法庭', activation: { requires: { hearing: true } } }]) }, gameplayModState: { reader: {}, court: {} } });
});
afterEach(cleanup);
it('mixes all native mechanics and file tools with one map without mounting extra player frames', () => {
  const packages = ['continuous-novel', 'last-post', 'cross-examination', 'debate-room', 'secrets-trial', 'social-minds', 'palimpsest-stage', 'folded-desk', 'chinese-room']
    .map(name => JSON.parse(readFileSync(`mods/dist/${name}.eidos-plugin.json`, 'utf8')));
  useGameStore.setState(s => ({ currentWorld: { ...s.currentWorld!, gameplayPlugins: parseGameplayPlugins(packages) } }));
  const { container } = render(React.createElement(GameplayModStages, { reading, onSubmit: vi.fn(), onAdvance: vi.fn() }));
  expect(container.querySelectorAll('iframe')).toHaveLength(1);
  expect(screen.getByTitle('文字地图与角色扮演')).toBeDefined();
  expect(screen.queryByRole('status')).toBeNull();
});
it('native text packages never create a player frame or compete with the map', () => {
  const native = { ...draft, id: 'letters', name: 'Meta 字迹', ui: { html: '<button>作者工具</button>', reading: 'inherit', presentation: 'native-text' } };
  useGameStore.setState(s => ({ currentWorld: { ...s.currentWorld!, gameplayPlugins: parseGameplayPlugins([native]) } }));
  const active = vi.fn();
  const { container } = render(React.createElement(GameplayModStages, { reading, onSubmit: vi.fn(), onAdvance: vi.fn(), onActiveChange: active }));
  expect(container.innerHTML).toBe(''); expect(active).toHaveBeenLastCalledWith(false);
  act(() => useGameStore.setState(s => ({ currentWorld: { ...s.currentWorld!, gameplayPlugins: parseGameplayPlugins([native, draft]) } })));
  expect(screen.getByTitle('常驻阅读')).toBeDefined(); expect(screen.queryByTitle('Meta 字迹')).toBeNull();
  expect(screen.queryByRole('status')).toBeNull();
});
function send(frame: HTMLIFrameElement, extra: object) { act(() => window.dispatchEvent(new MessageEvent('message', { source: frame.contentWindow, data: { channel: 'eidos-mod', token: frame.dataset.session, scope: frame.dataset.scope, ...extra } }))); }
it('keeps the reader frame suspended behind an activity, rejects its mutations and restores it after release', async () => {
  const submit = vi.fn(); render(React.createElement(GameplayModStages, { reading, onSubmit: submit, onAdvance: () => undefined }));
  const reader = screen.getByTitle('常驻阅读') as HTMLIFrameElement, token = reader.dataset.session;
  act(() => useGameStore.setState({ worldFlags: { 'gameplay.court.hearing': true } }));
  const court = screen.getByTitle('临时法庭') as HTMLIFrameElement;
  expect(screen.getByTitle('常驻阅读')).toBe(reader);
  expect(reader.closest('[data-stage-owner]')?.getAttribute('hidden')).not.toBeNull();
  const post = vi.spyOn(reader.contentWindow!, 'postMessage');
  send(reader, { command: 'rpc', id: 'hidden-write', method: 'files.write', params: { path: 'letter.txt', text: 'invalid' } });
  await waitFor(() => expect(post.mock.calls.some(c => c[0].id === 'hidden-write' && c[0].ok === false)).toBe(true));
  send(reader, { command: 'submit', action: '后台不应发起正文' });
  expect(submit).not.toHaveBeenCalled();
  expect(useGameStore.getState().gameplayModState.reader).toEqual({});
  send(court, { command: 'release' });
  expect(reader.dataset.session).toBe(token);
  expect(reader.closest('[data-stage-owner]')?.hasAttribute('hidden')).toBe(false);
});
it('falls back to the reader when the active temporary stage fails', () => {
  act(() => useGameStore.setState({ worldFlags: { 'gameplay.court.hearing': true } }));
  render(React.createElement(GameplayModStages, { reading, onSubmit: () => undefined, onAdvance: () => undefined }));
  const court = screen.getByTitle('临时法庭') as HTMLIFrameElement;
  send(court, { command: 'failed' });
  const reader = screen.getByTitle('常驻阅读') as HTMLIFrameElement;
  expect(reader.closest('[data-stage-owner]')?.hasAttribute('hidden')).toBe(false);
});
it('keeps the retiring frame alive long enough to acknowledge a rule that deactivates its own stage', async () => {
  const s = useGameStore.getState(), world = s.currentWorld!;
  useGameStore.setState({ currentPlaythroughId: crypto.randomUUID(), worldFlags: { 'gameplay.court.hearing': true },
    currentWorld: { ...world, gameplayPlugins: parseGameplayPlugins([draft, { ...draft, id: 'court', name: '临时法庭', activation: { requires: { hearing: true } }, rules: [{ id: 'leave', description: '休庭', requires: { hearing: true }, sets: { hearing: false }, once: false }] }]) } });
  await useGameStore.getState().initWorldLine(useGameStore.getState().currentPlaythroughId!, world.id);
  render(React.createElement(GameplayModStages, { reading, onSubmit: () => undefined, onAdvance: () => undefined }));
  const court = screen.getByTitle('临时法庭') as HTMLIFrameElement, post = vi.spyOn(court.contentWindow!, 'postMessage');
  send(court, { command: 'rpc', id: 'exit', method: 'gameplay.perform', params: { ruleId: 'leave', id: 'leave-one', expectedRevision: 0, narrate: false } });
  await waitFor(() => expect(post.mock.calls.some(c => c[0].id === 'exit' && c[0].ok)).toBe(true));
  expect(screen.getByTitle('临时法庭')).toBe(court);
  expect(court.closest('[data-stage-owner]')?.hasAttribute('hidden')).toBe(true);
  expect(screen.getByTitle('常驻阅读').closest('[data-stage-owner]')?.hasAttribute('hidden')).toBe(false);
});

it('marks scene maps separately so native records and dialogue can remain visible',async()=>{const map={...draft,id:'map',name:'地点地图',ui:{html:'<div>地图</div>',reading:'inherit',presentation:'scene-map'}};useGameStore.setState(s=>({currentWorld:{...s.currentWorld!,gameplayPlugins:parseGameplayPlugins([map])}}));const change=vi.fn(),active=vi.fn();render(React.createElement(GameplayModStages,{reading,onSubmit:vi.fn(),onAdvance:vi.fn(),onActiveChange:active,onPresentationChange:change}));const frame=screen.getByTitle('地点地图') as HTMLIFrameElement;send(frame,{command:'ready'});await waitFor(()=>expect(change).toHaveBeenLastCalledWith('scene-map'));expect(active).toHaveBeenLastCalledWith(true);expect(frame.closest('section')?.dataset.presentation).toBe('scene-map');});
