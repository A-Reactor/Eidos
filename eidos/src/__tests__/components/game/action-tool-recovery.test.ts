import { actionEvidence } from '@/lib/test/action-context';
// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { GameScreen } from '@/components/game/GameScreen';
import { useGameStore } from '@/store/game-store';
import { buildRiftCityStartState } from '@/lib/test/fixtures';
import { currentDocumentScope } from '@/lib/game/model-documents';
import { loadDocuments } from '@/lib/game/documents/repository';
import * as documentRepository from '@/lib/game/documents/repository';
import { loadSettings, saveSettings } from '@/lib/game/settings';
import { abortActiveStream } from '@/lib/game/stream-lifecycle';
import { speculativeEngine } from '@/lib/ai/speculation';

vi.mock('@/lib/game/momoi/use-momoi-playback', () => ({ useMomoiPlayback: () => ({ isPlaying: false, isGenerating: false, replay() {}, stop() {} }) }));
vi.mock('@/lib/game/momoi/service-status', () => ({ useVoiceServiceMonitor() {}, voiceStatusLabel: () => '关闭' }));
vi.mock('@/lib/game/midori/image-manager', () => ({ ensureImage: async () => null }));
beforeEach(() => {
  localStorage.clear(); abortActiveStream(); speculativeEngine.cancel();
  const { world, snapshot } = buildRiftCityStartState();
  useGameStore.setState({ ...useGameStore.getInitialState(), currentWorld: world, currentPlaythroughId: crypto.randomUUID(), phase: 'playing',
    currentSceneId: snapshot.currentSceneId, currentScene: null, savedSegments: [], savedIsShowingSegments: false, currentNode: null, allNodes: {},
    midoriSettings: { ...useGameStore.getState().midoriSettings, enabled: false }, momoiSettings: { ...useGameStore.getState().momoiSettings, enabled: false } });
  saveSettings({ ...loadSettings(), autoAdvance: false, autoSelect: false, enableSpeculation: false, aliceApiKey: '' });
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({})));
});
afterEach(() => { vi.restoreAllMocks(); cleanup(); abortActiveStream(); speculativeEngine.cancel(); vi.unstubAllGlobals(); });

it.each([false, true])('keeps an honest file failure as one accepted story node, streaming=%s', async streaming => {
  const state = useGameStore.getState(); await state.initWorldLine(state.currentPlaythroughId!, state.currentWorld!.id);
  localStorage.setItem('eidos_stream_mode', String(streaming)); saveSettings({ ...loadSettings(), aliceApiKey: 'offline-only' });
  const scope = currentDocumentScope(useGameStore.getState())!; let calls = 0;
  vi.stubGlobal('fetch', vi.fn(async (url, options) => {
    if (!String(url).includes('/api/game/action')) return Response.json({});
    const body = JSON.parse(String(options?.body)); calls++;
    const data = calls === 1 ? { segments: [{ type: 'narration', text: '她走向桌边。' }], toolRequest: { method: 'files.write', params: { path: 'library/private/source.txt', expectedVersion: null, text: '未获授权' } } }
      : { fileOutcome: 'failed', segments: [{ type: 'narration', text: '没有获得写入授权，原稿仍在原处。' }], timeSpent: { day: 0, hour: 0, minute: 0 } };
    if (calls > 1) expect(body.workspaceContext.results.at(-1).status).toBe('denied');
    return streaming ? new Response(`data: ${JSON.stringify({ type: 'done', ...data })}\n\n`, { headers: { 'Content-Type': 'text/event-stream' } }) : Response.json(data);
  }));
  render(React.createElement(GameScreen));
  fireEvent.change(screen.getByRole('textbox', { name: '行动输入' }), { target: { value: '尝试修改原稿' } }); fireEvent.click(screen.getByRole('button', { name: '发送行动' }));
  await waitFor(() => expect(useGameStore.getState().currentNode?.workspaceBranch?.attempts?.[0].status).toBe('denied'));
  await waitFor(() => expect(useGameStore.getState().isLoading).toBe(false));
  expect(useGameStore.getState().history[0].aiResponse).toContain('没有获得写入授权');
  expect(useGameStore.getState().history[0].aiResponse).toContain('她走向桌边');
  expect(calls).toBe(2); expect(await loadDocuments(scope)).toHaveLength(0);
  const { getActionDiagnostics } = await import('@/lib/game/action-diagnostics');
  expect(getActionDiagnostics().at(-1)?.operations?.some(r => r.status === 'denied' && r.error && r.method === 'files.write')).toBe(true);
  expect(screen.queryByRole('alert')).toBeNull();
  expect(useGameStore.getState().currentNode?.workspaceBranch?.attempts?.[0].status).toBe('denied');
});

it('returns a bad final file receipt to the model and accepts its corrected report without replaying the tool', async () => {
  const state = useGameStore.getState(); await state.initWorldLine(state.currentPlaythroughId!, state.currentWorld!.id);
  localStorage.setItem('eidos_stream_mode', 'false'); saveSettings({ ...loadSettings(), aliceApiKey: 'offline-only' }); let calls = 0;
  vi.stubGlobal('fetch', vi.fn(async (url, options) => {
    if (!String(url).includes('/api/game/action')) return Response.json({});
    const body = JSON.parse(String(options?.body)); calls++;
    if (calls === 1) return Response.json({ workspaceRequest: { method: 'files.write', params: { path: `${body.workspaceContext.draftRoot}/report.txt`, expectedVersion: null, text: '真实草稿全文' } } });
    const receipt = body.workspaceContext.results[0];
    if (calls === 2) return Response.json({ segments: [{ type: 'narration', text: '不能接受的关联。', workspaceEffects: ['invented'] }] });
    expect(actionEvidence(body)).toContain('回执'); expect(body.workspaceContext.results).toHaveLength(1);
    return Response.json({ segments: [{ type: 'narration', text: '她留下[报告](document:report)。', workspaceEffects: [receipt.operationId] }], documents: [{ key: 'report', title: '报告', format: 'text', artifactRef: { path: receipt.path, version: receipt.afterVersion } }], timeSpent: { day: 0, hour: 0, minute: 0 } });
  }));
  render(React.createElement(GameScreen));
  fireEvent.change(screen.getByRole('textbox', { name: '行动输入' }), { target: { value: '写报告' } }); fireEvent.click(screen.getByRole('button', { name: '发送行动' }));
  await waitFor(() => expect(useGameStore.getState().currentNode?.outputDocuments).toHaveLength(1));
  await waitFor(() => expect(useGameStore.getState().isLoading).toBe(false));
  expect(calls).toBe(3); expect(useGameStore.getState().history).toHaveLength(1);
  expect(useGameStore.getState().history[0].aiResponse).not.toContain('不能接受');
});

it.each([false, true])('returns an unavailable inline document link for correction before publishing the document, streaming=%s', async streaming => {
  const state = useGameStore.getState(); await state.initWorldLine(state.currentPlaythroughId!, state.currentWorld!.id);
  localStorage.setItem('eidos_stream_mode', String(streaming)); saveSettings({ ...loadSettings(), aliceApiKey: 'offline-only' }); let calls = 0;
  const scope = currentDocumentScope(useGameStore.getState())!;
  vi.stubGlobal('fetch', vi.fn(async (url, options) => {
    if (!String(url).includes('/api/game/action')) return Response.json({});
    const body = JSON.parse(String(options?.body)); calls++;
    if (calls > 1) { expect(actionEvidence(body)).toContain('不可用的文档'); expect(await loadDocuments(scope)).toHaveLength(0); }
    const data = { segments: [{ type: 'narration', text: calls === 1 ? '她写下[报告](document:missing)。' : '她写下[报告](document:report)。' }], documents: [{ key: 'report', title: '报告', format: 'text', content: '完整内容' }], timeSpent: { day: 0, hour: 0, minute: 0 } };
    if (!streaming) return Response.json(data);
    const { segments, ...metadata } = data;
    return new Response(`data: ${JSON.stringify({ type: 'segments', segments, lastIsDraft: false })}\n\ndata: ${JSON.stringify({ type: 'done', ...metadata })}\n\n`, { headers: { 'Content-Type': 'text/event-stream' } });
  }));
  render(React.createElement(GameScreen));
  fireEvent.change(screen.getByRole('textbox', { name: '行动输入' }), { target: { value: '生成报告' } }); fireEvent.click(screen.getByRole('button', { name: '发送行动' }));
  await waitFor(() => expect(useGameStore.getState().currentNode?.outputDocuments).toHaveLength(1));
  await waitFor(() => expect(useGameStore.getState().isLoading).toBe(false));
  expect(calls).toBe(2); expect(screen.queryByRole('alert')).toBeNull();
});

it.each([false,true])('corrects a terminal document object instead of rejecting the node, streaming=%s',async streaming=>{
 const state=useGameStore.getState();await state.initWorldLine(state.currentPlaythroughId!,state.currentWorld!.id);
 localStorage.setItem('eidos_stream_mode',String(streaming));saveSettings({...loadSettings(),aliceApiKey:'offline-only'});let calls=0;
 vi.stubGlobal('fetch',vi.fn(async(url,options)=>{
  if(!String(url).includes('/api/game/action'))return Response.json({});calls++;
  const data={segments:[{type:'narration',text:'她写下报告。'}],documents:calls===1?{key:'report',title:'报告',format:'text',content:'正文'}:[{key:'report',title:'报告',format:'text',content:'正文'}]};
  if(calls===2)expect(actionEvidence(JSON.parse(String(options?.body)))).toContain('列表');
  return streaming?new Response(`data: ${JSON.stringify({type:'done',...data})}\n\n`,{headers:{'Content-Type':'text/event-stream'}}):Response.json(data);
 }));
 render(React.createElement(GameScreen));fireEvent.change(screen.getByRole('textbox',{name:'行动输入'}),{target:{value:'创建报告'}});fireEvent.click(screen.getByRole('button',{name:'发送行动'}));
 await waitFor(()=>expect(useGameStore.getState().currentNode?.outputDocuments).toHaveLength(1));
 expect(calls).toBe(2);expect(screen.queryByRole('alert')).toBeNull();
});

it.each([false, true])('repairs output formatting privately without saving or opening a recovered file, streaming=%s', async streaming => {
  const state = useGameStore.getState(); await state.initWorldLine(state.currentPlaythroughId!, state.currentWorld!.id);
  localStorage.setItem('eidos_stream_mode', String(streaming)); saveSettings({ ...loadSettings(), aliceApiKey: 'offline-only' });
  const scope = currentDocumentScope(useGameStore.getState())!;
  const raw = 'INTERNAL_FORMAT_EVIDENCE {"workspaceRequest": incomplete'; let calls = 0;
  vi.stubGlobal('fetch', vi.fn(async (url, options) => {
    if (!String(url).includes('/api/game/action')) return Response.json({});
    calls++;
    const body = JSON.parse(String(options?.body));
    if (calls > 1) {
      expect(actionEvidence(body)).toContain(JSON.stringify(raw));
      expect(actionEvidence(body)).toContain('格式');
      expect(useGameStore.getState().phase).toBe('playing');
      expect(await loadDocuments(scope)).toHaveLength(0);
    }
    const data = calls === 1 ? { toolError: { kind: 'format', message: '行动响应格式无效，请修复后重发', rawOutput: raw }, segments: [] }
      : { segments: [{ type: 'narration', text: '她把图片说明收好。' }], timeSpent: { day: 0, hour: 0, minute: 0 } };
    return streaming ? new Response(`data: ${JSON.stringify({ type: 'done', ...data })}\n\n`, { headers: { 'Content-Type': 'text/event-stream' } }) : Response.json(data);
  }));
  render(React.createElement(GameScreen));
  fireEvent.change(screen.getByRole('textbox', { name: '行动输入' }), { target: { value: '查看图片说明' } }); fireEvent.click(screen.getByRole('button', { name: '发送行动' }));
  await waitFor(() => expect(useGameStore.getState().isLoading).toBe(false));
  expect(calls).toBe(2);
  expect(useGameStore.getState().history).toHaveLength(1);
  expect(useGameStore.getState().history[0].aiResponse).toBe('她把图片说明收好。');
  expect(useGameStore.getState().phase).toBe('playing');
  expect(useGameStore.getState().documentSelection).toBeNull();
  expect(await loadDocuments(scope)).toHaveLength(0);
  const { loadModelDocuments } = await import('@/lib/game/model-documents');
  expect(await loadModelDocuments(scope)).toHaveLength(0);
  expect(document.body.textContent).not.toContain(raw);
  expect(screen.queryByRole('alert')).toBeNull();
});
