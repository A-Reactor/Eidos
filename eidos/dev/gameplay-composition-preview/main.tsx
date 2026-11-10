import { createRoot } from 'react-dom/client';
import { useEffect, useState } from 'react';
import { GameScreen } from '@/components/game/GameScreen';
import { EidosShell } from '@/components/shell/EidosShell';
import { useGameStore } from '@/store/game-store';
import { buildRiftCityStartState } from '@/lib/test/fixtures';
import { parseGameplayPlugins } from '@/lib/game/plugins/manifest';
import { gameplayLedger } from '@/lib/game/plugins/gameplay-state';
import { abortActiveStream, claimInitialActionAttempt } from '@/lib/game/stream-lifecycle';
import { hashAndStore } from '@/lib/game/cas-storage';
import { getSceneById } from '@/lib/game/scene-utils';
import { processPlayerAction } from '@/lib/ai/action-handler';
import { saveSettings, loadSettings } from '@/lib/game/settings';
import trial from '../../mods/dist/secrets-trial.eidos-plugin.json';
import reader from '../../mods/dist/continuous-novel.eidos-plugin.json';
import hearing from '../../mods/dist/harbor-hearing.eidos-plugin.json';
import desk from '../../mods/dist/folded-desk.eidos-plugin.json';
import '@/app/globals.css';

const scenarios = { trial: [trial], handoff: [reader, hearing], desk: [desk] };
let calls = 0, latestInput = '';
let changed: () => void = () => undefined;
const transport = { aliceProviderId: 'custom-openai-compatible', aliceEndpoint: 'https://offline-eidos.invalid/v1', aliceModel: 'offline-fixture', aliceApiKey: 'offline-fixture-only' };
// Only the actual provider boundary returns fixtures. No request reaches a real model.
const originalFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const url = String(input);
  if (url === '/api/game/action') {
    const request = JSON.parse(String(init?.body)); latestInput = request.playerInput;
    try { return Response.json(await processPlayerAction({ ...request, clientSettings: transport })); }
    catch (error) { return Response.json({ error: error instanceof Error ? error.message : '离线错误' }, { status: 500 }); }
  }
  if (url.startsWith('https://offline-eidos.invalid/')) {
    calls++; changed();
    const events = latestInput.includes('开始质询') ? [{ pluginId: 'harbor-hearing', ruleId: 'enter-hearing' }]
      : latestInput.includes('检查灯芯') ? [{ pluginId: 'secrets-trial', ruleId: 'discover-wick-fiber' }]
      : latestInput.includes('检查铃线') ? [{ pluginId: 'secrets-trial', ruleId: 'discover-bell-thread' }] : [];
    const response = { validity: { isPossible: true }, segments: [{ type: 'narration', text: `【离线固定正文】${latestInput}。现场资料已经核对，已接受的结果会同步到案卷。` }],
      summary: latestInput, pluginEvents: events, availableActions: [], timeSpent: { day: 0, hour: 0, minute: 0 } };
    return Response.json({ choices: [{ message: { content: JSON.stringify(response) }, finish_reason: 'stop' }], usage: { prompt_tokens: 6000, completion_tokens: 100, total_tokens: 6100 } });
  }
  if (url.startsWith('/api/')) return Response.json({ running: false });
  return originalFetch(input, init);
};
saveSettings({ ...loadSettings(), ...transport, keiApiKey: '', uzqApiKey: '', autoAdvance: false, autoSelect: false, enableSpeculation: false, enableContentReview: false });
localStorage.setItem('eidos_stream_mode', 'false');
async function reset(scenario: keyof typeof scenarios) {
  abortActiveStream(); calls = 0;
  const { world, snapshot } = buildRiftCityStartState();
  useGameStore.getState().setCurrentWorld({ ...world, name: '模组联动 · 离线样例', gameplayPlugins: parseGameplayPlugins(scenarios[scenario]) });
  useGameStore.setState({ phase: 'playing', currentPlaythroughId: crypto.randomUUID(), currentSceneId: snapshot.currentSceneId,
    currentScene: getSceneById(world, snapshot.currentSceneId), gameTime: snapshot.currentGameTime,
    sceneNarrative: '离线演练：可以自由输入检查灯芯，或开始质询。', history: [], savedSegments: [], savedIsShowingSegments: false,
    currentNode: null, worldLine: null, allNodes: {}, worldFlags: {}, isLoading: false,
    midoriSettings: { ...useGameStore.getState().midoriSettings, enabled: false }, momoiSettings: { ...useGameStore.getState().momoiSettings, enabled: false } });
  claimInitialActionAttempt(useGameStore.getState());
  await useGameStore.getState().initWorldLine(useGameStore.getState().currentPlaythroughId!, world.id);
  const s = useGameStore.getState(), node = s.currentNode!, snapshotHash = await hashAndStore('snapshot', s.createSnapshot());
  useGameStore.setState({ allNodes: { ...s.allNodes, [node.id]: { ...node, snapshotHash } } });
}
await reset('trial');
function Preview() {
  const state = useGameStore(), [, tick] = useState(0), [scenario, setScenario] = useState<keyof typeof scenarios>('trial');
  useEffect(() => { changed = () => tick(n => n + 1); return () => { changed = () => undefined; }; }, []);
  return <EidosShell><div className="flex h-screen flex-col"><div className="flex flex-wrap items-center gap-3 bg-[#152524] px-5 py-2 text-xs text-white">
    <b>离线固定响应 · 无真实模型调用</b><span>固定响应 {calls} 次</span>
    <select aria-label="验收场景" className="bg-[#152524]" value={scenario} onChange={e => { const value = e.target.value as typeof scenario; setScenario(value); void reset(value); }}>
      <option value="trial">自由输入同步案卷</option><option value="handoff">小说与临时质询交接</option><option value="desk">折页工作台正式结果</option>
    </select>
    <button className="border px-2 py-1" onClick={() => { const parent = state.currentNode?.parentId; if (parent) void state.backtrackToNode(parent); }}>回溯上一节点</button>
    <span>{Object.entries(state.gameplayModState).map(([id, value]) => `${id}: v${gameplayLedger(value)?.revision ?? 0}`).join(' · ')}</span>
  </div><div className="min-h-0 flex-1"><GameScreen key={state.currentPlaythroughId} /></div></div></EidosShell>;
}
createRoot(document.getElementById('root')!).render(<Preview />);
