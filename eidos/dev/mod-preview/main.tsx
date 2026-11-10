import { protectNarrativeResponse, type NarrativeRequest } from '@/lib/game/narrative';
import { createRoot } from 'react-dom/client';
import { useEffect, useState } from 'react';
import { GameScreen } from '@/components/game/GameScreen';
import { SettingsScreen } from '@/components/game/SettingsScreen';
import { MapScreen } from '@/components/game/MapScreen';
import { EidosShell } from '@/components/shell/EidosShell';
import { evaluatePluginEvents } from '@/lib/game/plugins/runtime';
import { NpcDossierScreen } from '@/components/game/NpcDossierScreen';
import { useGameStore } from '@/store/game-store';
import { buildRiftCityStartState } from '@/lib/test/fixtures';
import { getSceneById } from '@/lib/game/scene-utils';
import { saveSettings, loadSettings, applyFontSize } from '@/lib/game/settings';
import { DEFAULT_SETTINGS, type WorldLineNode, type Scene } from '@/lib/game/types';
import type { AIGameResponse, StorySegment } from '@/lib/ai/types';
import '@/app/globals.css';
import { normalizeGameplayModState } from '@/lib/game/plugins/mod-ui';
import { parsePluginFile } from '@/lib/game/plugins/manifest';
import novel from '../../mods/dist/continuous-novel.eidos-plugin.json';
import debate from '../../mods/dist/debate-room.eidos-plugin.json';
import court from '../../mods/dist/cross-examination.eidos-plugin.json';
import witch from '../../mods/dist/secrets-trial.eidos-plugin.json';
import desk from '../../mods/dist/folded-desk.eidos-plugin.json';
import chineseRoom from '../../mods/dist/chinese-room.eidos-plugin.json';
import palimpsest from '../../mods/dist/palimpsest-stage.eidos-plugin.json';
import socialMinds from '../../mods/dist/social-minds.eidos-plugin.json';
const packages = { novel, debate, court, witch, desk, 'chinese-room': chineseRoom, palimpsest, 'social-minds': socialMinds };
const modId = new URLSearchParams(location.search).get('mod') ?? 'novel';
const previewCase = new URLSearchParams(location.search).get('case') ?? 'reading';
const requestedFont = Number(new URLSearchParams(location.search).get('font'));
const previewFont = ([1, 2, 3, 4].includes(requestedFont) ? requestedFont : DEFAULT_SETTINGS.fontSize) as typeof DEFAULT_SETTINGS.fontSize;
const selected = parsePluginFile(packages[modId as keyof typeof packages] ?? novel)[0];
if (new URLSearchParams(location.search).has('broken') && selected.ui) {
  selected.ui.html = '<!doctype html><html><head></head><body><script>throw new Error("offline broken-author fixture")</script></body></html>';
}

// A separate port isolates preview storage. Every network request has a deterministic response.
const { world } = buildRiftCityStartState();
world.gameplayPlugins = [selected];
const temporaryStage = parsePluginFile({ format: 'eidos-gameplay-plugin', version: 1, id: 'scene-stage', name: '临时质询', description: '仅在剧情开庭时出现，完成后归还连续阅读。', tags: [], prompts: { creation: '', action: '开庭时逐项质询，休庭后回到日常叙事。', review: '' }, activation: { requires: { hearing: true } }, rules: [
  { id: 'enter', description: '宣布开庭', requires: { hearing: false }, sets: { hearing: true }, once: false },
  { id: 'leave', description: '宣布休庭', requires: { hearing: true }, sets: { hearing: false }, once: false },
], settings: [
  { id: 'hints', label: '显示质询提示', description: '作者自己的辅助提示，修改后舞台会即时采用已保存的偏好。', type: 'boolean', default: true },
  { id: 'layout', label: '质询排版', type: 'select', default: '宽松', options: ['宽松', '紧凑'] },
], ui: { reading: 'inherit', initialState: { inspected: 0 }, html: `<!doctype html><html><head><style>body{margin:0;padding:24px;background:#f5f5f0;color:#222;font:15px system-ui}h2{font-size:25px}button{border:0;padding:12px 18px;background:#386c6c;color:white;cursor:pointer;margin-right:12px}p{line-height:1.8}</style></head><body><h2>临时质询</h2><p id="hint"></p><p id="state"></p><button id="inspect">核对证词</button><button id="release">结束本次质询</button><script>let c;Eidos.onContext(ctx=>{c=ctx;document.getElementById('hint').textContent=ctx.settings.hints?'开庭后才会出现。核对内容不会改变玩家的剧情偏好。':'';document.getElementById('state').textContent='已核对 '+(ctx.state.inspected||0)+' 次 · '+ctx.settings.layout;document.body.style.padding=ctx.settings.layout==='紧凑'?'12px':'24px'});document.getElementById('inspect').onclick=()=>Eidos.setState({...c.state,inspected:(c.state.inspected||0)+1});document.getElementById('release').onclick=()=>Eidos.release({...c.state,completed:true});</script></body></html>` } })[0];
world.gameplayPlugins.push(temporaryStage);
world.id = 'mod-preview-' + selected.id;
world.name = modId === 'palimpsest' ? '裂隙之城' : selected.name;
const authoredClues = (selected.data?.case as { clues?: Array<{id:string;name:string;summary?:string}> })?.clues ?? [];
world.clues = authoredClues.map(clue => ({ id: clue.id, name: clue.name, description: clue.summary ?? '', sceneId: 'central_plaza', detailThreshold: 0, prerequisiteClues: [], relatedContradiction: '', unlocksClues: [], discovered: false, discoveredAt: null }));
const originalRegions = world.regions;
const paragraphs: StorySegment[] = [
  { type: 'narration', text: '雨停了。渡口的石阶上留下一道水线，街巷深处传来钟声。' },
  { type: 'dialogue', speaker: '船夫', text: '沿着河岸走，你会经过旧钟楼。那里有你要找的人。' },
  { type: 'narration', text: '你收起地图，望向街口。沿途的灯火依次亮起，下一段路已经清晰可见。' },
];
const choices = ['询问船夫', '沿河前往集市', '歇息到傍晚'];
if (modId === 'palimpsest') {
  paragraphs.splice(0, paragraphs.length,
    { type: 'narration', text: '广场上的钟刚敲过两点。埃琳娜把登记簿推到你面前，纸页还带着阳光晒过的温度。' },
    { type: 'dialogue', speaker: '埃琳娜', text: '明天我还会在这里。你只要记得我的名字，就能找到我。', textEffects: [
      { kind: 'mask', quote: '明天', delayMs: 900 },
      { kind: 'color', quote: '记得我的名字', value: 'accent', delayMs: 900 },
    ] },
    { type: 'narration', text: '你低头核对登记簿。埃琳娜的名字仍在原处，刚刚落下的那一笔却像是从纸背透出来的。', textEffects: [
      { kind: 'erase', quote: '埃琳娜', delayMs: 500 },
      { kind: 'aside', quote: '那一笔', value: '别把我留在这一页', delayMs: 1200 },
      { kind: 'replace', target: 'choice', quote: '记住她的名字', value: '忘了她的名字', delayMs: 900 },
    ] });
  choices.splice(0, choices.length, '记住她的名字', '询问登记簿的来历', '离开广场');
  if (new URLSearchParams(location.search).get('meta') === 'layout') {
    paragraphs.splice(0, paragraphs.length,
      { type: 'narration', text: '窗边的旧信纸上留着连续的字迹。'.repeat(18), textEffects: [{ kind: 'mask', afterSegments: -1 }] },
      { type: 'narration', text: '下一段应保持原来的记录宽度；遮罩在正文区域内换行，框选复制得到乱码。' });
  }
  if (new URLSearchParams(location.search).get('meta') === 'lighting') {
    paragraphs.splice(0, paragraphs.length,
      { type: 'narration', text: '灯光暗下，接下来的话仍在原来的房间里继续。', textEffects: [{ kind: 'dim', brightness: 0.25, afterSegments: -1 }] },
      { type: 'narration', text: '第二段没有新的亮度命令，画面应该继续保持昏暗。' },
      { type: 'narration', text: '她重新打开灯。读完这段后，画面恢复正常亮度。', textEffects: [{ kind: 'dim', brightness: 1, transitionMs: 600 }] });
  }
  if (new URLSearchParams(location.search).get('meta') === 'quiet') paragraphs.forEach(segment => { delete segment.textEffects; });
}
if (modId === 'novel') paragraphs[2].text += '〔关键抉择：陪她等到末班车｜独自沿河去找那封信〕';
const originalParagraphs = paragraphs.map(segment => ({ ...segment }));
let nodes: Record<string, WorldLineNode> = {};
const nodeSegments = new Map<string, StorySegment[]>();
let requests = 0;
const listeners = new Set<(count: number) => void>();

function responseFor(input: string, request?: NarrativeRequest): AIGameResponse {
  if (request?.kind === 'return') return { ...responseFor('普通行动'), narrativeFrame: { kind: 'protagonist' }, segments: [{ type: 'narration', text: '你仍站在渡口。末班车的汽笛穿过海雾，你不知道空车厢里刚才发生了什么。' }] };
  if (request) {
    const frame = request.frame ?? { kind: 'cutaway' as const, actor: '白槿', location: '返潮号 · 空车厢', timeLabel: '与此同时' };
    const text = request.kind === 'choice' ? `白槿选择了“${request.choice}”。她把那封信留在车厢，站台上的旅客对此毫不知情。` : '白槿独自站在空车厢里。掌心的信封已被雨水浸透，她听见检票员的脚步越来越近。〔关键抉择：把信藏进座椅｜把信交给检票员〕';
    return protectNarrativeResponse({ ...responseFor('普通行动'), narrativeFrame: frame, segments: [{ type: 'narration', text }], summary: text, cluesDiscovered: ['letter'], sceneChanges: ['night-train'] }, useGameStore.getState().gameTime, request);
  }
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
    itemsGained: [], itemsUsed: [], cluesDiscovered: /调查/.test(input) ? useGameStore.getState().clues.filter(clue => !clue.discovered).slice(0, 1).map(clue => clue.name) : [], worldImpacts: [],
  };
}

window.fetch = async (_url, init) => {
  requests++; listeners.forEach(listener => listener(requests));
  const url = String(_url);
  const body = typeof init?.body === 'string' ? JSON.parse(init.body) : {};
  const input = body.playerInput ?? body.messages?.find((m: { role: string }) => m.role === 'user')?.content ?? '';
  const response = responseFor(input, body.narrativeRequest);
  if (url.includes('/api/game/mod-resource')) {
    const material = typeof body.resource?.text === 'string' ? JSON.parse(body.resource.text) : null;
    return Response.json({ content: material?.example?.format === 'eidos-scene-map' ? JSON.stringify(material.example) : '离线固定分析：已收到真实材料通路请求。此预览不判断图片或文档内容。', usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0, model: 'uzq', callType: 'uzq_mod_resource' } });
  }
  if (url.includes('/chat/completions')) return Response.json({ choices: [{ message: { content: JSON.stringify(response) }, finish_reason: 'stop' }], usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 } });
  if (url.includes('/api/game/action/stream')) return new Response(`data: ${JSON.stringify({ type: 'segments', segments: response.segments })}\n\ndata: ${JSON.stringify({ type: 'done', ...response })}\n\n`, { headers: { 'Content-Type': 'text/event-stream' } });
  if (url.includes('/api/game/action')) return Response.json(response);
  return Response.json({ assets: [], library: [], presets: [], status: 'stopped' });
};

function enterNode(id: string, playing = false) {
  const node = nodes[id];
  useGameStore.setState({ currentNode: node, allNodes: { ...nodes }, gameTime: node.gameTime, sceneNarrative: node.aiResponse,
    savedSegments: [...(nodeSegments.get(id) ?? paragraphs)], savedSegmentIndex: 0, savedIsShowingSegments: playing, availableActions: node.availableActions ?? choices });
}

function seed(scenario: string) {
  paragraphs.splice(0, paragraphs.length, ...originalParagraphs.map(segment => ({ ...segment })));
  world.regions = originalRegions;
  let visited = ['central_plaza'];
  if (scenario === 'perspective') {
    const view = { kind: 'cutaway' as const, actor: '白槿', location: '返潮号 · 空车厢', timeLabel: '与此同时' };
    paragraphs.splice(0, paragraphs.length, { type: 'narration', view, text: '白槿独自站在空车厢里。雨滴沿窗框滑落，站台上的旅客还不知道她手中握着什么。〔关键抉择：把信藏进座椅｜把信交给检票员〕' });
  }
  if (scenario === 'map') {
    const regions = ['河岸', '旧城', '北山'];
    const names = ['渡口', '钟楼', '市场', '旅馆', '茶室', '旧书店', '坡道', '剧场', '花园', '桥头', '车站', '档案室'];
    world.regions = Object.fromEntries(regions.map((name, r) => [`atlas-${r}`, { id: `atlas-${r}`, description: name, scenes: Object.fromEntries(names.map((n, i) => {
      const id = r === 0 && i === 0 ? 'central_plaza' : `place-${r}-${i}`;
      const next = i < 11 ? `place-${r}-${i+1}` : r < 2 ? `place-${r+1}-0` : 'central_plaza';
      const scene = { id, name: `${name}${n}`, region: name, connections: [next], initialDescription: '尚未阅读的地点内容', npcs: [], secrets: [], discoveredSecrets: [], detailLevel: 0 } as Scene;
      return [id, scene];
    })) }]));
    visited = Object.values(world.regions).flatMap(r => Object.keys(r.scenes));
  }
  const time = { day: 3, hour: 14, minute: 30 };
  const text = paragraphs.map(s => s.type === 'dialogue' ? `「${s.speaker}：${s.text}」` : s.text).join('\n\n');
  const base: WorldLineNode = { id: 'parent', parentId: null, childIds: ['cached'], stepNumber: 7, playerInput: '观察渡口四周', aiResponse: text, summary: '', snapshotHash: '', segmentHash: '', gameTime: time, sceneId: 'central_plaza', sceneName: '中央广场', dayNumber: 3, createdAt: 1, timeSpent: { day: 0, hour: 0, minute: 5 }, worldImpacts: [], generationComplete: true, availableActions: choices };
  if (scenario === 'npc') base.playerVisibleText = text;
  nodes = { parent: base, cached: { ...base, id: 'cached', parentId: 'parent', childIds: [], stepNumber: 8, playerInput: '询问船夫', availableActions: ['沿河前往集市'] } };
  nodeSegments.clear(); nodeSegments.set('parent', paragraphs); nodeSegments.set('cached', paragraphs);
  localStorage.setItem('eidos_record_collapsed', 'false');
  localStorage.setItem('eidos_stream_mode', 'true');
  saveSettings({ ...DEFAULT_SETTINGS, fontSize: previewFont, interfaceTheme: new URLSearchParams(location.search).get('theme') === 'light' ? 'light' : 'dark', autoSaveInterval: 0, modPreferences: loadSettings().modPreferences, aiProviderMode: 'advanced', aliceApiKey: 'preview-only', keiApiKey: '', uzqApiKey: '', autoAdvance: false, autoSelect: false });
  const state = useGameStore.getState();
  useGameStore.setState({ phase: scenario === 'settings' ? 'settings' : scenario === 'map' ? 'map' : 'playing', navigationStack: ['playing'], visitedScenes: visited, currentWorld: world, currentPlaythroughId: 'preview', currentScene: getSceneById(world, 'central_plaza'), currentSceneId: 'central_plaza', worldLine: null, history: [], isLoading: false, clues: world.clues.map(clue => ({...clue})), gameplayModState: normalizeGameplayModState(world), gameplayResources: {}, worldFlags: {},
    pendingInput: scenario === 'invalid' ? '瞬移到月亮' : scenario === 'rest' ? '歇息到傍晚' : '',
    encyclopedia: [{ id: 'npc-boatman', name: '船夫', type: 'npc', description: '渡口的船夫，熟悉河岸与旧钟楼之间的道路。',
      knowledge: [{ text: '他说旧钟楼里有你要找的人，尚待亲自核实。', source: 'ai', addedAt: time, importance: 50 }], firstEncountered: time, lastUpdated: time, relatedEntries: ['clocktower'] },
      { id: 'clocktower', name: '旧钟楼', type: 'location', description: '河岸路上的旧钟楼，船夫提到的目的地。', knowledge: [], firstEncountered: time, lastUpdated: time, relatedEntries: [] }],
    midoriSettings: { ...state.midoriSettings, enabled: false }, momoiSettings: { ...state.momoiSettings, enabled: false },
    worldTokenUsage: { [world.id]: { tokensUsed: 314542, estimatedCost: .51, tokenDetail: state.tokenDetail } },
    worldAliceContext: { [world.id]: { modelId: 'deepseek-v4-flash', providerId: 'deepseek', inputTokens: 286540, windowTokens: 1000000, estimated: false } },
    backtrackToNode: async id => { enterNode(id); },
    tryMatchChildNode: async input => { const node = useGameStore.getState().currentNode; const match = node?.childIds.map(id => nodes[id]).find(child => child.playerInput === input); if (!match) return null; enterNode(match.id, true); return match; },
    addActionNode: async (action, _snapshot, segments) => {
      const parent = useGameStore.getState().currentNode!;
      const id = `preview-${Object.keys(nodes).length}`;
      const node = { ...base, ...action, id, actionId: action.id, parentId: parent.id, childIds: [], stepNumber: parent.stepNumber + 1, generationComplete: true };
      nodes[parent.id] = { ...parent, childIds: [...parent.childIds, id] }; nodes[id] = node;
      nodeSegments.set(id, segments ?? []); useGameStore.setState({ currentNode: node, allNodes: { ...nodes } }); return node;
    },
  });
  enterNode('parent', scenario === 'reading');
  if (scenario === 'npc') useGameStore.setState({ phase: 'npc_dossiers', navigationStack: ['playing'] });
}

const initialScenario = previewCase;
document.documentElement.dataset.theme = new URLSearchParams(location.search).get('theme') === 'light' ? 'light' : 'dark';
seed(initialScenario);
applyFontSize(previewFont);

function Preview() {
  const phase = useGameStore(s => s.phase);
  const [scenario, setScenario] = useState(initialScenario);
  const [revision, setRevision] = useState(0);
  const [count, setCount] = useState(requests);
  useEffect(() => { listeners.add(setCount); return () => { listeners.delete(setCount); }; }, []);
  return <div style={{ height: '100dvh', display: 'flex', flexDirection: 'column' }}>
    <div style={{ flexShrink: 0, height: 32, background: '#eee', color: '#222', display: 'flex', alignItems: 'center', gap: 16, padding: '0 12px', fontSize: 12 }}>
      <label>模组 <select aria-label="选择测试模组" value={modId} onChange={event => { location.href = '?mod=' + event.target.value; }}><option value="novel">连续阅读与剧情选择</option><option value="debate">证据对照与群体辩论</option><option value="court">逐句追问与证据质询</option><option value="witch">人物调查与秘密审判</option><option value="desk">文件交互与跨分支解谜</option><option value="chinese-room">文字地图与角色扮演</option><option value="palimpsest">Meta 演出与文本改写</option><option value="social-minds">人物心智与承诺互动</option></select></label><label>状态 <select aria-label="预览场景" value={scenario} onChange={event => { const value = event.target.value; setScenario(value); seed(value); setRevision(n => n + 1); }}>
        <option value="perspective">视觉小说 · 异地幕间</option><option value="explore">地图自由探索</option><option value="reading">阅读中 / 已有分支</option><option value="invalid">不合理行动</option><option value="rest">14:30 休息到傍晚</option><option value="npc">人物档案</option><option value="settings">分页设置 / 作者偏好</option><option value="map">36 地点图册</option><option value="lifecycle">剧情启用 / 释放</option>
      </select></label>
      <button onClick={() => { seed(scenario); setRevision(n => n + 1); }}>重置场景</button>
      <output aria-label="模拟请求次数">模拟请求 {count}</output>
      <span>所有请求使用固定响应</span>
      {scenario === 'lifecycle' && <><button onClick={() => { const s = useGameStore.getState(); useGameStore.setState({ worldFlags: { ...s.worldFlags, ...evaluatePluginEvents(world, s.worldFlags, [{ pluginId: 'scene-stage', ruleId: 'enter' }]) } }); }}>剧情：开庭</button><button onClick={() => { const s = useGameStore.getState(); useGameStore.setState({ worldFlags: { ...s.worldFlags, ...evaluatePluginEvents(world, s.worldFlags, [{ pluginId: 'scene-stage', ruleId: 'leave' }]) } }); }}>剧情：休庭</button></>}
    </div>
    <div style={{ flex: 1, minHeight: 0, position: 'relative' }}><div className={phase === 'playing' ? 'contents' : 'hidden'}><GameScreen key={revision} /></div>{phase === 'npc_dossiers' && <div className="absolute inset-0"><NpcDossierScreen /></div>}{phase === 'settings' && <div className="absolute inset-0"><SettingsScreen /></div>}{phase === 'map' && <div className="absolute inset-0"><MapScreen /></div>}</div>
  </div>;
}
createRoot(document.getElementById('root')!).render(<EidosShell><Preview /></EidosShell>);
