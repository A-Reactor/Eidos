import { createRoot } from 'react-dom/client';
import { TitleScreen } from '@/components/game/TitleScreen';
import { SettingsScreen } from '@/components/game/SettingsScreen';
import { ReadingScreen } from '@/components/game/ReadingScreen';
import { InventoryScreen } from '@/components/game/InventoryScreen';
import { MapScreen } from '@/components/game/MapScreen';
import { WorldSelectScreen } from '@/components/game/WorldSelectScreen';
import { WorldCreateScreen } from '@/components/game/WorldCreateScreen';
import { IdentitySelect } from '@/components/game/IdentitySelect';
import { EidosShell } from '@/components/shell/EidosShell';
import { hudWorld } from '@/__tests__/lib/game/gameplay-resource-fixtures';
import { GameScreen } from '@/components/game/GameScreen';
import { NpcDossierScreen } from '@/components/game/NpcDossierScreen';
import { useGameStore } from '@/store/game-store';
import { buildRiftCityStartState } from '@/lib/test/fixtures';
import { getSceneById } from '@/lib/game/scene-utils';
import { parseGameplayPlugins } from '@/lib/game/plugins/manifest';
import { saveSettings } from '@/lib/game/settings';
import { DEFAULT_SETTINGS, type WorldLineNode } from '@/lib/game/types';
import type { AIGameResponse, StorySegment } from '@/lib/ai/types';
import '@/app/globals.css';

// A separate port isolates preview storage. Every network request has a deterministic response.
const { world } = buildRiftCityStartState();
const paragraphs: StorySegment[] = [
  { type: 'narration', text: '雨停了。渡口的石阶上留下一道水线，街巷深处传来钟声。' },
  { type: 'dialogue', speaker: '船夫', text: '沿着河岸走，你会经过旧钟楼。那里有你要找的人。' },
  { type: 'narration', text: '你收起地图，望向街口。沿途的灯火依次亮起，下一段路已经清晰可见。' },
];
if (new URLSearchParams(location.search).get('case') === 'long') {
  paragraphs[0].text = ('雨水沿着钟楼的石墙流下。你停在门口，听见屋内传来轻轻的翻书声。她抬起头，像是等了很久，又仿佛只是偶然相遇。').repeat(18);
  for (let i = 0; i < 30; i++) paragraphs.push({ type: 'narration', text: `沿着河岸继续前行，第 ${i + 4} 段。` });
}
if (new URLSearchParams(location.search).has('hud')) Object.assign(world, hudWorld());
const modMode = new URLSearchParams(location.search).get('mod');
if (modMode === 'inherit' || modMode === 'replace') world.gameplayPlugins = [...(world.gameplayPlugins ?? []), ...parseGameplayPlugins([{
  format: 'eidos-gameplay-plugin', version: 1, id: 'phone-stage', name: '手机舞台示例', description: '检查原文与附加界面的空间分配', tags: ['阅读'],
  prompts: { creation: '', action: '', review: '' }, rules: [], ui: { reading: modMode, html: `<style>body{margin:0;padding:16px;background:#f3f1ef;color:#222;font:16px/1.8 sans-serif}button{min-height:44px;padding:8px 16px;color:#900;background:white;border:1px solid #ccc}h3{margin:0}</style><h3>模组交互区</h3><p id="line">等待正文…</p><button onclick="Eidos.advance()">继续</button><script>Eidos.onContext(c=>{document.getElementById('line').textContent=c.reading.displayedText || '当前正文显示在下方';});</script>` }
}])];
const choices = ['询问船夫', '沿河前往集市', '歇息到傍晚'];
let nodes: Record<string, WorldLineNode> = {};
const nodeSegments = new Map<string, StorySegment[]>();
let requests = 0;
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

window.fetch = async (_url, init) => {
  requests++; listeners.forEach(listener => listener(requests));
  const url = String(_url);
  if (url.startsWith('/generated/')) return new Response(null, { status: 404 });
  const body = typeof init?.body === 'string' ? JSON.parse(init.body) : {};
  const input = body.playerInput ?? body.messages?.find((m: { role: string }) => m.role === 'user')?.content ?? '';
  const response = responseFor(input);
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
  const time = { day: 3, hour: 14, minute: 30 };
  const text = paragraphs.map(s => s.type === 'dialogue' ? `「${s.speaker}：${s.text}」` : s.text).join('\n\n');
  const base: WorldLineNode = { id: 'parent', parentId: null, childIds: ['cached'], stepNumber: 7, playerInput: '观察渡口四周', aiResponse: text, summary: '', snapshotHash: '', segmentHash: '', gameTime: time, sceneId: 'central_plaza', sceneName: '中央广场', dayNumber: 3, createdAt: 1, timeSpent: { day: 0, hour: 0, minute: 5 }, worldImpacts: [], generationComplete: true, availableActions: choices };
  if (scenario === 'npc') base.playerVisibleText = text;
  nodes = { parent: base, cached: { ...base, id: 'cached', parentId: 'parent', childIds: [], stepNumber: 8, playerInput: '询问船夫', availableActions: ['沿河前往集市'] } };
  nodeSegments.clear(); nodeSegments.set('parent', paragraphs); nodeSegments.set('cached', paragraphs);
  localStorage.setItem('eidos_record_collapsed', 'false');
  localStorage.setItem('eidos_stream_mode', 'true');
  saveSettings({ ...DEFAULT_SETTINGS, interfaceTheme: new URLSearchParams(location.search).get('theme') === 'dark' ? 'dark' : 'light', aliceApiKey: 'preview-only', keiApiKey: 'preview-only', uzqApiKey: 'preview-only', autoAdvance: false, autoSelect: false });
  const state = useGameStore.getState();
  useGameStore.setState({ phase: 'playing', currentWorld: world, currentPlaythroughId: 'preview', currentScene: getSceneById(world, 'central_plaza'), currentSceneId: 'central_plaza', worldLine: null, history: [], isLoading: false,
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
      const node = { ...base, ...action, id, parentId: parent.id, childIds: [], stepNumber: parent.stepNumber + 1, generationComplete: true };
      nodes[parent.id] = { ...parent, childIds: [...parent.childIds, id] }; nodes[id] = node;
      nodeSegments.set(id, segments ?? []); useGameStore.setState({ currentNode: node, allNodes: { ...nodes } }); return node;
    },
  });
  enterNode('parent', scenario === 'reading');
  if (scenario === 'npc') useGameStore.setState({ phase: 'npc_dossiers', navigationStack: ['playing'] });
}

const initialScenario = new URLSearchParams(location.search).get('case') ?? 'reading';
document.documentElement.dataset.theme = new URLSearchParams(location.search).get('theme') === 'light' ? 'light' : 'dark';
seed(initialScenario);


const requestedPage = new URLSearchParams(location.search).get('page');
if (requestedPage) useGameStore.getState().setPhase(requestedPage as never);
function Preview() {
  const phase = useGameStore(s => s.phase);
  const overlay = phase === 'title' ? <TitleScreen /> : phase === 'settings' ? <SettingsScreen /> : phase === 'world_line_view' || phase === 'reading' ? <ReadingScreen />
    : phase === 'inventory' ? <InventoryScreen /> : phase === 'map' ? <MapScreen /> : phase === 'npc_dossiers' ? <NpcDossierScreen />
    : phase === 'world_select' ? <WorldSelectScreen /> : phase === 'world_create' ? <WorldCreateScreen /> : phase === 'identity' ? <IdentitySelect /> : null;
  return <EidosShell><main style={{ flex: 1, minHeight: 0, position: 'relative' }}>
    <div className={overlay ? 'hidden' : 'contents'}><GameScreen /></div>
    {overlay && <div className="absolute inset-0">{overlay}</div>}
  </main></EidosShell>;
}
createRoot(document.getElementById('root')!).render(<Preview />);
