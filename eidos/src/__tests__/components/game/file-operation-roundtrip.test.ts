// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import React from 'react';
import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextRequest } from 'next/server';
import { POST as action } from '@/app/api/game/action/route';
import { POST as stream } from '@/app/api/game/action/stream/route';
import { callAi, callAiStream } from '@/lib/ai/client';
import { GameScreen } from '@/components/game/GameScreen';
import { useGameStore } from '@/store/game-store';
import { buildRiftCityStartState } from '@/lib/test/fixtures';
import { currentDocumentScope } from '@/lib/game/model-documents';
import { loadDocuments, readDocument } from '@/lib/game/documents/repository';
import { saveLocalDocument } from '@/lib/game/documents/ingest';
import { loadSettings, saveSettings } from '@/lib/game/settings';
import { abortActiveStream } from '@/lib/game/stream-lifecycle';
import { speculativeEngine } from '@/lib/ai/speculation';
import { getActionDiagnostics } from '@/lib/game/action-diagnostics';

vi.mock('@/lib/ai/client', async original => ({ ...await original<typeof import('@/lib/ai/client')>(), callAi: vi.fn(), callAiStream: vi.fn() }));
vi.mock('@/lib/game/momoi/use-momoi-playback', () => ({ useMomoiPlayback: () => ({ isPlaying: false, isGenerating: false, replay() {}, stop() {} }) }));
vi.mock('@/lib/game/momoi/service-status', () => ({ useVoiceServiceMonitor() {}, voiceStatusLabel: () => '关闭' }));
vi.mock('@/lib/game/midori/image-manager', () => ({ ensureImage: async () => null }));
const usage: import('@/lib/ai/types').TokenUsage = { model: 'alice', promptTokens: 10, completionTokens: 10, cachedTokens: 0, totalTokens: 20, elapsedMs: 1, finishReason: 'stop' as const };
let providerReply = '';
beforeEach(async () => {
  localStorage.clear(); abortActiveStream(); speculativeEngine.cancel(); vi.stubGlobal('crypto',webcrypto);
  const { world, snapshot } = buildRiftCityStartState();
  const initial = useGameStore.getInitialState();
  useGameStore.setState({ ...initial, currentWorld: world, currentPlaythroughId: crypto.randomUUID(), phase: 'playing',
    currentSceneId: snapshot.currentSceneId, currentScene: null, savedSegments: [], savedIsShowingSegments: false, currentNode: null, allNodes: {},
    sandboxMode:true,sandboxDossierId:'002', availableActions:['测试'],
    midoriSettings: {...initial.midoriSettings,enabled:false},momoiSettings:{...initial.momoiSettings,enabled:false} });
  saveSettings({ ...loadSettings(),autoAdvance:false,autoSelect:false,enableSpeculation:false,enableContentReview:false,aliceApiKey:'offline-only',keiApiKey:'' });
  const state=useGameStore.getState();await state.initWorldLine(state.currentPlaythroughId!,world.id);
  vi.mocked(callAi).mockImplementation(async()=>({content:providerReply,usage,elapsedMs:1}));
  vi.mocked(callAiStream).mockImplementation(async req=>{req.onChunk(providerReply);req.onDone(providerReply,usage);});
});
afterEach(()=>{cleanup();abortActiveStream();speculativeEngine.cancel();vi.restoreAllMocks();vi.unstubAllGlobals();});

it.each([false,true])('creates, patches and publishes a draft through the real API and playback in 002, SSE=%s',async streaming=>{
  localStorage.setItem('eidos_stream_mode',String(streaming));
  const scope=currentDocumentScope(useGameStore.getState())!;let calls=0;
  vi.stubGlobal('fetch',vi.fn(async(url,options)=>{
    if(!String(url).includes('/api/game/action'))return Response.json({});
    const body=JSON.parse(String(options?.body));calls++;
    const path=`${body.workspaceContext.draftRoot}/report.txt`,last=body.workspaceContext.results.at(-1);
    providerReply=JSON.stringify(calls===1?{segments:[{type:'narration',text:'她走到桌边。'}],toolRequest:{method:'files.write',params:{path,expectedVersion:null,text:'初稿第一行\n保留第二行'}}}
      :calls===2?{toolRequest:{method:'files.patch',params:{path,expectedVersion:last.afterVersion,oldText:'初稿第一行',newText:'定稿第一行'}}}
      :{segments:[{type:'narration',text:'她收好[报告](document:report)。',workspaceEffects:[last.operationId]}],documents:[{key:'report',title:'报告',format:'text',artifactRef:{path,version:calls===3?'invalid':last.afterVersion},segmentIndex:0}],timeSpent:{day:0,hour:0,minute:0}});
    return (streaming?stream:action)(new NextRequest(`http://localhost${url}`,{method:options?.method,headers:options?.headers,body:options?.body}));
  }));
  render(React.createElement(GameScreen));
  fireEvent.change(screen.getByRole('textbox',{name:'行动输入'}),{target:{value:'写好报告并保留第二行'}});fireEvent.click(screen.getByRole('button',{name:'发送行动'}));
  await waitFor(()=>expect(useGameStore.getState().currentNode?.outputDocuments).toHaveLength(1));
  await waitFor(()=>expect(useGameStore.getState().isLoading).toBe(false));
  expect(calls).toBe(4);expect(useGameStore.getState().history).toHaveLength(1);
  expect(await loadDocuments(scope)).toHaveLength(0);
  fireEvent.click(screen.getByRole('button',{name:'播放第 2 段'}));
  await waitFor(async()=>expect(await loadDocuments(scope)).toHaveLength(1));
  const doc=(await loadDocuments(scope))[0];
  expect((await readDocument(scope,{documentId:doc.id,revision:doc.currentRevision})).resource.text).toBe('定稿第一行\n保留第二行');
  expect(screen.queryByRole('alert')).toBeNull();
});

it.each([false,true])('renames then patches the selected existing library document through the real API in 002, SSE=%s',async streaming=>{
 localStorage.setItem('eidos_stream_mode',String(streaming));
 const scope=currentDocumentScope(useGameStore.getState())!;
 const doc=await saveLocalDocument(scope,{title:'旧文件.txt',content:'旧正文\n保留行',format:'text'});
 useGameStore.setState({documentDraft:{scope,links:[doc]}});let calls=0;
 vi.stubGlobal('fetch',vi.fn(async(url,options)=>{
  if(!String(url).includes('/api/game/action'))return Response.json({});
  const body=JSON.parse(String(options?.body));calls++;
  const context=body.workspaceContext,last=context.results.at(-1),target=context.mounts.find((e:{path:string})=>e.path.startsWith('library/'));
  providerReply=JSON.stringify(calls===1?{toolRequest:{method:'files.rename',params:{path:target.path,expectedVersion:target.version,newName:'新文件.txt'}}}
   :calls===2?{toolRequest:{method:'files.patch',params:{path:last.path,expectedVersion:last.afterVersion,oldText:'旧正文',newText:'新正文'}}}
   :{segments:[{type:'narration',text:`她放下[新文件](document:${doc.documentId})。`,workspaceEffects:context.results.filter((r:{operationId?:string})=>r.operationId).map((r:{operationId:string})=>r.operationId)}],timeSpent:{day:0,hour:0,minute:0}});
  return (streaming?stream:action)(new NextRequest(`http://localhost${url}`,{method:options?.method,headers:options?.headers,body:options?.body}));
 }));
 render(React.createElement(GameScreen));
 fireEvent.change(screen.getByRole('textbox',{name:'行动输入'}),{target:{value:'把引用的文件更名，并修改第一行'}});fireEvent.click(screen.getByRole('button',{name:'发送行动'}));
 await waitFor(()=>expect(useGameStore.getState().currentNode?.workspaceBranch?.mergedThrough).toBe(0));
 expect((await loadDocuments(scope))[0].title).toBe('新文件.txt');
 const updated=(await loadDocuments(scope))[0];
 expect((await readDocument(scope,{documentId:doc.documentId,revision:updated.currentRevision})).resource.text).toBe('新正文\n保留行');
 expect(calls).toBe(3);expect(useGameStore.getState().history).toHaveLength(1);
 const diagnostic=getActionDiagnostics().find(record=>record.scope.playthroughId===scope.playthroughId && record.input==='把引用的文件更名，并修改第一行');
 expect(diagnostic?.selectedFileEffects).toEqual(useGameStore.getState().currentNode!.workspaceBranch!.effects.map(effect=>effect.operationId));
 expect(diagnostic?.operations?.find(operation=>operation.method==='files.rename')?.result).toMatchObject({beforeVersion:doc.revision});
});
