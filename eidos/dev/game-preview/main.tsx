import { workspaceOf } from '@/lib/game/plugins/workspace';
import { documentPreviewResponse } from './document-responses';
import { matchesActionInput } from '@/lib/game/documents/action-draft';
import { currentDocumentScope } from '@/lib/game/model-documents';
import { loadDocuments } from '@/lib/game/documents/repository';
import { hashAndStore } from '@/lib/game/cas-storage';
import { importDocument, saveLocalDocument } from '@/lib/game/documents/ingest';
import { storeResource } from '@/lib/game/workspace/resources';
import { parsePluginFile } from '@/lib/game/plugins/manifest';
import { EidosShell } from '@/components/shell/EidosShell';
import { LibraryPreview } from './library-preview';
import { createRoot } from 'react-dom/client';
import { useEffect, useState } from 'react';
import { DocumentsScreen } from '@/components/game/DocumentsScreen';
import { GalleryScreen } from '@/components/game/GalleryScreen';
import { GameScreen } from '@/components/game/GameScreen';
import { AudioScreen } from '@/components/game/MomoiPanel';
import { NpcDossierScreen } from '@/components/game/NpcDossierScreen';
import { InventoryScreen } from '@/components/game/InventoryScreen';
import { SettingsScreen } from '@/components/game/SettingsScreen';
import { MapScreen } from '@/components/game/MapScreen';
import { ReadingScreen } from '@/components/game/ReadingScreen';
import { WorldLibraryFlow } from '@/components/game/WorldLibraryFlow';
import { IdentitySelect } from '@/components/game/IdentitySelect';
import { useGameStore } from '@/store/game-store';
import { buildRiftCityStartState } from '@/lib/test/fixtures';
import { getSceneById } from '@/lib/game/scene-utils';
import { saveSettings } from '@/lib/game/settings';
import { DEFAULT_SETTINGS, type WorldLineNode } from '@/lib/game/types';
import { createWorldCreationSession, WORLD_CREATION_FIELDS } from '@/lib/game/world-creation-session';
import { loadWorldAssetRegistry } from '@/lib/game/midori/asset-library';
import { seedTaggedImages } from './image-resources';
import { seedDialogueLayout } from './dialogue-layout';
import { seedExpressionInterfaces } from './expression-interfaces';
import { seedNpcProfileReview, npcProfilePreviewResponse } from './npc-profile-review';
import { seedHistoryBranch } from './history-branch';
import { seedModelAnalyticsPreview } from './model-analytics';
import { audioLayoutResponse, seedAudioLayout } from './audio-layout';
import { seedPluginUpgrade } from './plugin-upgrade';
import { previewPendingReply, finishPendingPreview } from './pending-reply';
import type { AIGameResponse, StorySegment } from '@/lib/ai/types';
import '@/app/globals.css';

// A separate port isolates preview storage. Narrative requests are deterministic; voice training uses the local backend.
const { world } = buildRiftCityStartState();
const paragraphs: StorySegment[] = [
  { type: 'narration', text: '雨停了。渡口的石阶上留下一道水线，街巷深处传来钟声。' },
  { type: 'dialogue', speaker: '船夫', text: '沿着河岸走，你会经过旧钟楼。那里有你要找的人。' },
  { type: 'narration', text: '你收起地图，望向街口。沿途的灯火依次亮起，下一段路已经清晰可见。' },
];
const choices = ['询问船夫', '沿河前往集市', '歇息到傍晚'];
let nodes: Record<string, WorldLineNode> = {};
const nodeSegments = new Map<string, StorySegment[]>();
let requests = 0;
let modelRequests = 0;
const nodeSnapshots = new Map<string, ReturnType<ReturnType<typeof useGameStore.getState>['createSnapshot']>>();
const listeners = new Set<(count: number) => void>();

function responseFor(input: string): AIGameResponse {
  const now = useGameStore.getState().gameTime;
  const impossible = /瞬移|月亮/.test(input);
  const resting = /歇息|休息|傍晚/.test(input);
  return {
    validity: { isPossible: !impossible, fantasyResponse: impossible ? '你望向月亮。这一刻你还没有瞬移的能力，换个方式试试。' : null, reason: impossible ? '当前角色没有该能力' : null },
    segments: impossible ? [{ type: 'narration', text: '你还无法瞬移到月亮。' }] : resting
      ? [{ type: 'narration', text: '你在渡口歇息。夕阳慢慢沉向河岸，钟楼响起傍晚的钟声。' }]
      : paragraphs,
    timeAfter: resting ? { day: now.day, hour: 18, minute: 30 } : undefined,
    timeSpent: { day: 0, hour: 0, minute: impossible ? 0 : 5 },
    availableActions: impossible ? [] : choices,
    sceneChanges: [], discoveredSecrets: [], npcsReacted: [], summary: '渡口的行动',
    itemsGained: [], itemsUsed: [], cluesDiscovered: [], worldImpacts: [],
  };
}

const nativeFetch = window.fetch.bind(window);
let previewVoiceRunning = true;
window.fetch = async (_url, init) => {
  if (new URLSearchParams(location.search).get('case') === 'audio-layout') {
    const response = audioLayoutResponse(String(_url), init);
    if (response) return response;
  }
  if (String(_url).startsWith('/api/momoi/training') || String(_url).startsWith('/api/momoi/installation')) return nativeFetch(_url, init);
  requests++; listeners.forEach(listener => listener(requests));
  const url = String(_url);
  if (url.includes('/api/midori/list-images')) return Response.json({ sceneImages: [], detailImages: [], illustrations: [] });
  if (url === '/api/midori/check-image') return Response.json({ cached: false, url: null });
  if (url === '/api/midori/upload-image' && init?.body instanceof FormData) {
    const file = init.body.get('file');
    if (!(file instanceof File)) return Response.json({ error: '请选择图片' }, { status: 400 });
    const imageUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(reader.error); reader.readAsDataURL(file);
    });
    return Response.json({ ok: true, imageUrl });
  }
  if (url.startsWith('/generated/')) return new Response(null, { status: 404 });
  const body = typeof init?.body === 'string' ? JSON.parse(init.body) : {};
  if (new URLSearchParams(location.search).get('case') === 'npc-profile-review' && url === '/api/game/npc/profile') return Response.json({ approved: true, reason: '固定测试回执：变更符合管理员明确补充要求，保留既有人设。' });
  if (url === '/api/momoi/status') return Response.json({ status: previewVoiceRunning ? 'ready' : 'offline', hint: previewVoiceRunning ? '预览模型已就绪' : '预览模型已关闭' });
  if (url === '/api/momoi/start' || url === '/api/momoi/stop') {
    previewVoiceRunning = url.endsWith('/start');
    return Response.json({ ok: true, status: previewVoiceRunning ? 'ready' : 'stopped' });
  }
  if (url === '/api/world/create/stream') {
    const previous = body.conversation ?? createWorldCreationSession();
    const resumed = previous.messages.length || previous.pendingText;
    const conversation = { ...previous, pendingText: '', complete: Boolean(resumed),
      fields: resumed ? Object.fromEntries(WORLD_CREATION_FIELDS.filter(key => key in world).map(key => [key, world[key as keyof typeof world]])) : { name: world.name, timeline: world.timeline.slice(0, 2) },
      messages: resumed ? [...previous.messages, { role: 'assistant', content: '{"toolRequest":{"method":"world.finish","params":{}}}' }] : [{ role: 'assistant', content: '{"toolRequest":{"method":"world.update","params":{"fields":{"name":"裂隙之城","timeline":[]}}}}' }, { role: 'user', content: '字段已保存，可继续补充和修正' }] };
    const prefix = JSON.stringify({ name: world.name, subtitle: world.subtitle, overview: '一座建在裂隙边缘的城市。' }).slice(0, -1) + ',"regions":{';
    const resumedConversation = { ...previous, pendingText: '', complete: false };
    const events = resumed ? [{ type: 'checkpoint', conversation: resumedConversation }, { type: 'delta', delta: JSON.stringify(world) }, { type: 'progress', fields: Object.keys(conversation.fields), eventCount: world.timeline.length, message: 'KEI正在推敲' }, { type: 'checkpoint', conversation }, { type: 'done', world: { ...world, id: conversation.worldId } }]
      : [{ type: 'checkpoint', conversation: { ...previous, fields: {}, messages: [], pendingText: '', complete: false } }, { type: 'delta', delta: prefix }, { type: 'error', message: '模拟连接中断，用于检查同一对话恢复' }];
    const previewGeneration = new URLSearchParams(location.search).get('generation');
    if (previewGeneration === 'fill' || previewGeneration === 'review') {
      const held = [{ type: 'checkpoint', conversation: { ...previous, fields: {}, messages: [], pendingText: '', complete: false } },
        { type: 'delta', delta: previewGeneration === 'fill' ? prefix : JSON.stringify(world) },
        ...(previewGeneration === 'review' ? [{ type: 'progress', fields: WORLD_CREATION_FIELDS, eventCount: world.timeline.length, message: 'KEI正在推敲' }] : [])];
      return new Response(new ReadableStream({ start(stream) { held.forEach(event => stream.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`))); } }), { headers: { 'Content-Type': 'text/event-stream' } });
    }
    let cancelled = false;
    if (previewGeneration === 'slow') return new Response(new ReadableStream({ async start(stream) {
      for (const event of events) {
        await new Promise(resolve => setTimeout(resolve, 1800));
        if (cancelled || init?.signal?.aborted) return;
        stream.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`));
      }
      stream.close();
    }, cancel() { cancelled = true; } }), { headers: { 'Content-Type': 'text/event-stream' } });
    return new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join(''), { headers: { 'Content-Type': 'text/event-stream' } });
  }
  const input = body.playerInput ?? body.messages?.find((m: { role: string }) => m.role === 'user')?.content ?? '';
  if (url.includes('/api/game/action') || url.includes('/chat/completions')) modelRequests++;
  if (input.includes('慢速')) await new Promise(resolve => setTimeout(resolve, 1600));
  if (url.includes('/api/game/action') && input.includes('慢速失败')) return Response.json({ error: '模拟请求失败，请重试。' }, { status: 503 });
  const candidate = new URLSearchParams(location.search).get('case') === 'npc-profile-review' && url.includes('/api/game/action')
    ? npcProfilePreviewResponse(body._longMemoryContext) : documentPreviewResponse(input, body.workspaceContext);
  if (new URLSearchParams(location.search).get('case') === 'documents-conflict' && input.includes('冲突演示') && candidate?.workspaceEffects?.length) {
    const scope = currentDocumentScope(useGameStore.getState())!;
    const doc = (await loadDocuments(scope))[0];
    if (doc) await saveLocalDocument(scope, { title: doc.title, content: '共同记录\n玩家添加：保留渡口灯火的约定。', format: 'text', previous: { documentId: doc.id, revision: doc.currentRevision } });
  }
  const response = candidate?.workspaceRequest || candidate?.toolRequest ? candidate : { ...responseFor(input), ...candidate };
  const held = previewPendingReply(url, response);
  if (held) return held;
  if (url.includes('/chat/completions')) return Response.json({ choices: [{ message: { content: JSON.stringify(response) }, finish_reason: 'stop' }], usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 } });
  if (url.includes('/api/game/action/stream')) {
    const events = [...(response.segments?.length ? [{ type: 'segments', segments: response.segments }] : []), { type: 'done', ...response,
      segments: response.segments?.length ? undefined : response.segments,
      narrative: response.segments?.length ? undefined : response.narrative,
      dialogue: response.segments?.length ? undefined : response.dialogue }];
    return new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join(''), { headers: { 'Content-Type': 'text/event-stream' } });
  }
  if (url.includes('/api/game/action')) return Response.json(response);
  return Response.json({ assets: [], library: [], presets: [], status: 'stopped' });
};

function enterNode(id: string, playing = false) {
  const node = nodes[id];
  useGameStore.setState({ currentNode: node, allNodes: { ...nodes }, gameTime: node.gameTime, sceneNarrative: node.aiResponse,
    savedSegments: [...(nodeSegments.get(id) ?? paragraphs)], savedSegmentIndex: 0, savedIsShowingSegments: playing, availableActions: node.availableActions ?? choices });
}

function seed(scenario: string) {
  const time = { day: 3, hour: 14, minute: 30 };
  const text = paragraphs.map(s => s.type === 'dialogue' ? `「${s.speaker}：${s.text}」` : s.text).join('\n\n');
  const base: WorldLineNode = { id: 'parent', parentId: null, childIds: ['cached'], stepNumber: 7, playerInput: '观察渡口四周', aiResponse: text, summary: '', snapshotHash: '', segmentHash: '', gameTime: time, sceneId: 'central_plaza', sceneName: '中央广场', dayNumber: 3, createdAt: 1, timeSpent: { day: 0, hour: 0, minute: 5 }, worldImpacts: [], generationComplete: true, availableActions: choices };
  if (scenario === 'npc') base.playerVisibleText = text;
  nodes = { parent: base, cached: { ...base, id: 'cached', parentId: 'parent', childIds: [], stepNumber: 8, playerInput: '询问船夫', availableActions: ['沿河前往集市'] } };
  nodeSegments.clear(); nodeSegments.set('parent', paragraphs); nodeSegments.set('cached', paragraphs);
  if (scenario === 'record-edges') {
    for (const id of ['parent', 'cached']) {
      const label = id === 'parent' ? '上一节点' : '下一节点';
      const long: StorySegment[] = Array.from({ length: 10 }, (_, i) => ({ type: 'narration', text: `${label} · 第${i + 1}段。` + '河岸的灯火映在水中，你沿着石阶观察渡口的来往人物。'.repeat(5) }));
      nodeSegments.set(id, long); nodes[id] = { ...nodes[id], aiResponse: long.map(segment => segment.text).join('\n\n') };
    }
  }
  localStorage.setItem('eidos_record_collapsed', 'false');
  localStorage.setItem('eidos_stream_mode', 'true');
  saveSettings({ ...DEFAULT_SETTINGS, interfaceLanguage: new URLSearchParams(location.search).get('lang') === 'en' ? 'en' : 'zh-CN', aliceApiKey: 'preview-only', keiApiKey: '', uzqApiKey: '', autoAdvance: false, autoSelect: false, interfaceTheme: new URLSearchParams(location.search).get('theme') === 'dark' ? 'dark' : 'light', enableSpeculation: !['plugin-upgrade', 'npc-profile-review', 'expression-interfaces', 'web-citations', 'record-edges', 'global-plugins', 'documents-workspace', 'documents-meta', 'documents-interactions', 'documents-conflict'].includes(scenario) });
  const state = useGameStore.getState();
  useGameStore.setState({ phase: 'playing', currentWorld: world, currentPlaythroughId: scenario === 'documents-conflict' ? (new URLSearchParams(location.search).get('fixture') === 'ui' ? 'document-ui-verification-v1' : 'document-conflicts-verification-v1') : scenario === 'documents-interactions' ? 'document-interactions-verification-v1' : scenario.startsWith('documents-') ? 'document-workspace-playback-verification-v2' : 'preview', gameplayModState: {}, metaChannelManifest: null, workspaceState: {}, currentScene: getSceneById(world, 'central_plaza'), currentSceneId: 'central_plaza', worldLine: null, history: [], isLoading: false,
    playerName: '林',
    cachedSaveSlots: [{ id: 'preview-manual', type: 'manual', name: '钟楼前的约定', worldId: world.id, worldName: world.name, playthroughId: 'preview', playerName: '林', currentSceneName: '中央广场', createdAt: 1700000000000, updatedAt: 1700000000000, gameTime: time, actionCount: 7, preview: '雨停了。渡口的石阶上留下一道水线。', playDuration: 45 }],
    pendingInput: scenario === 'invalid' ? '瞬移到月亮' : scenario === 'rest' ? '歇息到傍晚' : '',
    inventory: [{ id: 'preview-map', name: '渡口地图', category: 'document', quantity: 1, description: '纸上标出了渡口、旧钟楼与沿河集市。折痕处有一行小字：沿着灯火前行。', acquiredAt: time, acquiredFrom: '船夫', consumable: false, value: 0 }],
    encyclopedia: [{ id: 'npc-boatman', name: '船夫', type: 'npc', description: '渡口的船夫，熟悉河岸与旧钟楼之间的道路。',
      knowledge: [{ text: '他说旧钟楼里有你要找的人，尚待亲自核实。', source: 'ai', addedAt: time, importance: 50 }], firstEncountered: time, lastUpdated: time, relatedEntries: ['clocktower'] },
      { id: 'clocktower', name: '旧钟楼', type: 'location', description: '河岸路上的旧钟楼，船夫提到的目的地。', knowledge: [], firstEncountered: time, lastUpdated: time, relatedEntries: [] }],
    midoriAssetRegistry: loadWorldAssetRegistry(world), midoriSettings: { ...state.midoriSettings, enabled: false }, momoiSettings: { ...state.momoiSettings, enabled: false },
    worldTokenUsage: { [world.id]: { tokensUsed: 314542, estimatedCost: .51, tokenDetail: state.tokenDetail } },
    worldAliceContext: { [world.id]: { modelId: 'deepseek-v4-flash', providerId: 'deepseek', inputTokens: 286540, windowTokens: 1000000, estimated: false } },
    backtrackToNode: async id => { const snapshot = nodeSnapshots.get(id); if (snapshot) useGameStore.getState().restoreSnapshot(snapshot); enterNode(id); },
    tryMatchChildNode: async (input, identity) => { const node = useGameStore.getState().currentNode; const match = node?.childIds.map(id => nodes[id]).find(child => matchesActionInput(child, input, identity)); if (!match) return null; enterNode(match.id, true); return match; },
    addActionNode: async (action, _snapshot, segments) => {
      const parent = useGameStore.getState().currentNode!;
      const id = `preview-${Object.keys(nodes).length}`;
      const segmentHash = await hashAndStore('segments', segments ?? []);
      const snapshotHash = scenario === 'npc-profile-review' ? await hashAndStore('snapshot', _snapshot) : base.snapshotHash;
      const node = { ...base, ...action, snapshotHash, segmentHash, actionId: action.id, id, parentId: parent.id, childIds: [], stepNumber: parent.stepNumber + 1, generationComplete: true };
      nodes[parent.id] = { ...parent, childIds: [...parent.childIds, id] }; nodes[id] = node;
      nodeSnapshots.set(id, structuredClone(_snapshot));
      nodeSegments.set(id, segments ?? []); useGameStore.setState({ currentNode: node, allNodes: { ...nodes } }); return node;
    },
  });
  nodeSnapshots.clear(); nodeSnapshots.set('parent', useGameStore.getState().createSnapshot());
  if (scenario.startsWith('documents-')) {
    useGameStore.setState({ documentDraft: null, documentHeads: [], workspaceState: {}, pendingInput: scenario === 'documents-conflict' ? '进行文档冲突演示' : scenario === 'documents-meta' ? '请铃音处理书信' : '核对资料里的签名并生成报告' });
    const scope = currentDocumentScope(useGameStore.getState())!;
    void loadDocuments(scope).then(docs => docs.length ? undefined : importDocument(scope, new File(['签名：渡口的船夫。\n调查结论尚待核实。\n完整资料末尾。'], '渡口调查资料——包含签名和完整结尾的长文件名.txt')));
    if (scenario === 'documents-meta') void storeResource({ name: 'letter.txt', mimeType: 'text/plain', text: '原始书信：请照看渡口的灯。' }).then(resource => {
      const plugins = parsePluginFile({ format: 'eidos-gameplay-plugin', version: 1, id: 'desk', name: '书桌', description: '角色文件', tags: [], prompts: { creation: '', action: '', review: '' }, rules: [], ui: { html: '<p>书桌</p>', reading: 'inherit' } });
      useGameStore.setState({ currentWorld: { ...world, gameplayPlugins: plugins }, gameplayModState: { desk: { _eidosWorkspace: { files: { 'letters/letter.txt': resource }, stages: [], events: [], interpretations: {} } } }, metaChannelManifest: { id: 'letters', title: '角色书信', tone: 'mysterious', forbiddenMoves: [], channels: [{ id: 'letters', kind: 'text', promptToPlayer: '', worldInterpretation: '', allowedConsumers: ['铃音'], consequenceTemplate: '', refusalFallback: '', workspaceGrants: [{ mountId: 'desk', pathPrefix: 'letters', npcIds: ['铃音'], operations: ['read', 'write'] }] }] } });
      nodeSnapshots.set('parent', useGameStore.getState().createSnapshot());
    });
  }
  if (scenario === 'dialogue-layout') {
    const segments = seedDialogueLayout();
    nodeSegments.set('parent', segments);
    nodes.parent = { ...nodes.parent, aiResponse: segments.map(segment => segment.text).join('\n\n') };
  }
  if (scenario === 'web-citations') {
    const segments: StorySegment[] = [{ type: 'dialogue', speaker: '船夫', text: '我查过了，[TypeScript 官方文档](https://www.typescriptlang.org/docs/?from=search)按入门、手册和参考资料组织内容。你可以从这里继续查阅。',
      searchSources: [{ label: 'TypeScript 官方文档', url: 'https://www.typescriptlang.org/docs/' }, { label: 'TypeScript 手册', url: 'https://www.typescriptlang.org/docs/handbook/' }, { label: 'TypeScript 入门', url: 'https://www.typescriptlang.org/docs/handbook/typescript-from-scratch.html' }] },
      { type: 'narration', text: '另一个来源：https://example.com/article_(guide)。网址已收起，正文仍可正常阅读。' }];
    nodeSegments.set('parent', segments);
    nodes.parent = { ...nodes.parent, aiResponse: segments.map(segment => segment.text).join('\n\n') };
  }
  if (scenario === 'expression-interfaces') {
    const segments = seedExpressionInterfaces();
    nodeSegments.set('parent', segments);
    nodes.parent = { ...nodes.parent, aiResponse: segments.map(segment => segment.text).join('\n\n') };
  }
  if (scenario === 'npc-profile-review') {
    const segments = seedNpcProfileReview();
    nodeSegments.set('parent', segments);
    nodes.parent = { ...nodes.parent, aiResponse: '「蓝色鱼：先给我白饭。」' };
  }
  enterNode(scenario === 'record-edges' ? 'cached' : 'parent', scenario === 'reading');
  if (scenario === 'history-branch') {
    useGameStore.setState({ currentPlaythroughId: 'history-branch-preview' });
    void seedHistoryBranch();
  }
  if (scenario === 'plugin-upgrade') void seedPluginUpgrade();
  if (scenario === 'global-plugins') useGameStore.setState({ phase: 'world_select', navigationStack: [] });
  if (scenario.startsWith('analytics')) seedModelAnalyticsPreview(scenario, world.id);
  if (scenario === 'resources') useGameStore.setState({ galleryWorld: world, galleryTab: 'scenes', documentSelection: null, phase: 'documents', navigationStack: ['playing'] });
  if (scenario === 'gallery' || scenario === 'gallery-tags') {
    if (scenario === 'gallery-tags') seedTaggedImages();
    useGameStore.setState({ galleryWorld: world, galleryTab: scenario === 'gallery-tags' ? 'npcs' : 'scenes', phase: 'gallery', navigationStack: ['playing'] });
  }
  if (scenario === 'create') useGameStore.setState({ phase: 'world_create', navigationStack: ['world_select'] });
  if (scenario === 'audio') useGameStore.setState({ phase: 'audio', navigationStack: ['playing'] });
  if (scenario === 'audio-layout') void seedAudioLayout();
  if (scenario === 'map') useGameStore.setState({ phase: 'map', navigationStack: ['playing'] });
  if (scenario === 'npc') useGameStore.setState({ phase: 'npc_dossiers', navigationStack: ['playing'] });
  if (scenario === 'worldline') {
    nodes = {};
    let created = 0;
    const add = (id: string, parentId: string | null, day: number) => {
      const step = parentId ? nodes[parentId].stepNumber + 1 : 0;
      nodes[id] = { ...base, id, parentId, childIds: [], createdAt: created++, stepNumber: step, dayNumber: day, gameTime: { day, hour: 8, minute: step % 60 }, playerInput: `第${step}步：${id}`, playerVisibleText: text };
      if (parentId) nodes[parentId].childIds.push(id);
      return id;
    };
    let main = add('root', null, 0);
    const mainIds = [main];
    for (let i = 1; i <= 140; i++) { main = add(`main-${i}`, main, i < 110 ? 0 : 1); mainIds.push(main); }
    for (const [fork, length, day] of [[8, 80, 0], [38, 100, 1], [8, 35, 0]] as const) {
      let parent = mainIds[fork];
      for (let i = 0; i < length; i++) parent = add(`branch-${created}`, parent, day);
    }
    enterNode(main);
    useGameStore.setState({ phase: 'reading', navigationStack: ['playing'] });
  }
}

const slowMotion = new URLSearchParams(location.search).get('motion') === 'slow';
const initialScenario = new URLSearchParams(location.search).get('case') ?? 'reading';
document.documentElement.dataset.theme = new URLSearchParams(location.search).get('theme') === 'light' ? 'light' : 'dark';
seed(initialScenario);

function Preview() {
  const upgradeProof=useGameStore(s=>`当前节点 ${s.currentNode?.id ?? '无'} · 步数 ${s.currentNode?.stepNumber ?? 0} · 节点 ${Object.keys(s.allNodes).length} · 行动记录 ${s.history.length} · 插件 ${s.currentWorld?.gameplayPlugins?.[0]?.release ?? '无'} · 阅读位置 ${s.gameplayModState['maintenance-reader']?.bookmark ?? s.gameplayModState['maintenance-reader']?.page ?? '无'}`);
  const metaVersion = useGameStore(s => workspaceOf(s.gameplayModState.desk ?? {}).files['letters/letter.txt']?.id ?? '无');
  const fileEffects = useGameStore(s => s.currentNode?.workspaceEffects?.length ?? 0);
  const branchProof = useGameStore(s => {
    const node = s.currentNode, parent = node?.parentId ? s.allNodes[node.parentId] : null;
    return `${node?.playerInput ?? ''} · 父节点 ${parent?.id ?? '无'} · 分支来源 ${node?.entry?.sourceNodeId ?? '无'} · 原路线 ${s.allNodes['history-tower'] ? '保留' : '无'}`;
  });
  const phase = useGameStore(s => s.phase);
  const [scenario, setScenario] = useState(initialScenario);
  const [revision, setRevision] = useState(0);
  const [count, setCount] = useState(requests);
  const [motionProof, setMotionProof] = useState('');
  useEffect(() => {
    if (!slowMotion) return;
    const capture = (event: AnimationEvent) => {
      const page = event.target;
      if (!(page instanceof HTMLElement) || !page.matches('.eidos-map-screen')) return;
      const style = getComputedStyle(page);
      const animation = page.getAnimations().find(item => item.effect?.getComputedTiming().duration === 2400);
      const frames = (animation?.effect as KeyframeEffect | null)?.getKeyframes() ?? [];
      setMotionProof(`${style.animationName} ${style.animationDuration}: ${frames[0]?.transform ?? 'none'} → ${frames.at(-1)?.transform ?? 'none'}; ${page.dataset.mobileDirectory}`);
    };
    const captureTransition = (event: TransitionEvent) => {
      const element = event.target;
      if (!(element instanceof HTMLElement) || !element.matches('.eidos-map-screen .eidos-directory-index, .eidos-map-screen .eidos-directory-index ~ main') || event.propertyName !== 'transform') return;
      const transition = element.getAnimations().find(item => item instanceof CSSTransition);
      const frames = (transition?.effect as KeyframeEffect | null)?.getKeyframes() ?? [];
      setMotionProof(previous => `${previous}; ${element.tagName}: ${frames[0]?.transform ?? 'none'} → ${frames.at(-1)?.transform ?? 'none'}`);
    };
    document.addEventListener('animationstart', capture);
    document.addEventListener('transitionstart', captureTransition);
    return () => { document.removeEventListener('animationstart', capture); document.removeEventListener('transitionstart', captureTransition); };
  }, []);
  useEffect(() => { listeners.add(setCount); return () => { listeners.delete(setCount); }; }, []);
  return <div style={{ height: '100dvh', display: 'flex', flexDirection: 'column' }}>
    {scenario==='plugin-upgrade' && <output aria-label="维护操作叙事边界验证" style={{position:'fixed',bottom:8,left:16,zIndex:1000,background:'#fff',color:'#222',fontSize:11}}>{upgradeProof}</output>}
    {scenario === 'history-branch' && <output aria-label="分支接续验证" style={{ position: 'fixed', bottom: 8, left: 16, zIndex: 1000, background: '#fff', color: '#222', fontSize: 11 }}>{branchProof}</output>}
    {scenario === 'documents-meta' && <output aria-label="角色文件回执" style={{ position: 'fixed', left: 16, bottom: 72, zIndex: 50, background: '#faf8f3', color: '#222', padding: 8, fontSize: 11 }}>书信版本 {metaVersion} · 本节点已接受文件效果 {fileEffects}</output>}
    {slowMotion && <output aria-label="地图动画诊断" style={{ position: 'fixed', bottom: 0, left: 0, zIndex: 1000, fontSize: 10, background: '#fff', color: '#222' }}>{motionProof}</output>}
    {slowMotion && <style>{'.eidos-swipe-page:not(.eidos-library-screen) { animation-duration: 2400ms !important; }'}</style>}
    <div style={{ flexShrink: 0, height: 32, background: '#eee', color: '#222', display: 'flex', alignItems: 'center', gap: 16, padding: '0 12px', fontSize: 12 }}>
      <label>开发预览 <select aria-label="预览场景" value={scenario} onChange={event => { const value = event.target.value; setScenario(value); seed(value); setRevision(n => n + 1); }}>
        <option value="analytics">数据统计 / 当前世界</option><option value="analytics-total">数据统计 / 总计</option><option value="analytics-empty">数据统计 / 空数据</option>
        <option value="audio-layout">音频管理 / 密集内容预览</option>
        <option value="dialogue-layout">图像对话 / 比例与长文本</option>
        <option value="web-citations">联网引用 / 收起网址</option>
        <option value="expression-interfaces">表情标签 / 文件展示</option>
        <option value="npc-profile-review">人设补录 / 实际回执</option>
        <option value="history-branch">历史输入 / 真实分支接续</option>
        <option value="plugin-upgrade">插件维护 / 不新增叙事</option>
        <option value="record-edges">长记录 / 上下节点落点</option><option value="reading">阅读中 / 已有分支</option><option value="invalid">不合理行动</option><option value="rest">14:30 休息到傍晚</option><option value="map">地图</option><option value="library">世界详情</option><option value="create">创造世界</option><option value="audio">语音控制</option><option value="global-plugins">选择世界 / 全局插件</option><option value="resources">文档管理</option><option value="gallery">图像管理 / 统一导入</option><option value="documents-conflict">文件冲突 / 比较与合并</option><option value="documents-interactions">文档引用 / 光标与更名</option><option value="documents-workspace">文档工作区 / 固定工具响应</option><option value="documents-meta">Meta 书信 / 固定文件响应</option><option value="npc">人物档案</option><option value="worldline">世界线分叉 / 跨日</option>
      </select></label>
      <button onClick={() => { seed(scenario); setRevision(n => n + 1); }}>重置场景</button>
      {new URLSearchParams(location.search).get('reply') === 'hold' && <><button onClick={() => finishPendingPreview()}>完成模拟回复</button><button onClick={() => finishPendingPreview(true)}>模拟生成失败</button></>}
      <output aria-label="模拟请求次数">模拟请求 {count} · 模型请求 {modelRequests}</output>
      <span>叙事使用固定响应 · 训练连接本机</span>
    </div>
    <div style={{ flex: 1, minHeight: 0, position: 'relative' }}><div className={phase !== 'playing' ? 'eidos-game-underlay' : 'contents'} inert={phase !== 'playing'}>{scenario === 'library' ? <LibraryPreview /> : <GameScreen key={revision} />}</div>{phase !== 'playing' && <div className="absolute inset-0 z-10">{phase === 'world_create' || phase === 'world_select' ? <WorldLibraryFlow /> : phase === 'identity' ? <IdentitySelect /> : phase === 'documents' ? <DocumentsScreen /> : phase === 'gallery' ? <GalleryScreen /> : phase === 'npc_dossiers' ? <NpcDossierScreen /> : phase === 'inventory' ? <InventoryScreen /> : phase === 'settings' ? <SettingsScreen /> : phase === 'audio' ? <AudioScreen /> : phase === 'map' ? <MapScreen /> : ['world_line_view', 'reading'].includes(phase) ? <ReadingScreen /> : null}</div>}</div>
  </div>;
}
createRoot(document.getElementById('root')!).render(<EidosShell><Preview /></EidosShell>);
