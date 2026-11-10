import { createRoot } from 'react-dom/client';
import { useEffect, useState } from 'react';
import { GameScreen } from '@/components/game/GameScreen';
import { SettingsScreen } from '@/components/game/SettingsScreen';
import { EidosShell } from '@/components/shell/EidosShell';
import { useGameStore } from '@/store/game-store';
import { buildRiftCityStartState } from '@/lib/test/fixtures';
import { parseGameplayPlugins } from '@/lib/game/plugins/manifest';
import { gameplayLedger } from '@/lib/game/plugins/gameplay-state';
import { claimInitialActionAttempt } from '@/lib/game/stream-lifecycle';
import { processPlayerAction } from '@/lib/ai/action-handler';
import { saveSettings, loadSettings } from '@/lib/game/settings';
import packaged from '../../mods/dist/secrets-trial.eidos-plugin.json';
import '@/app/globals.css';

// Transport fixtures only. No request can reach a real model or backend in this preview.
const originalFetch = window.fetch.bind(window);
let calls = 0, failNext = false;
let changed: () => void = () => undefined;
const modelSettings = { aliceProviderId: 'custom-openai-compatible', aliceEndpoint: 'https://offline-eidos.invalid/v1', aliceModel: 'offline-fixture', aliceApiKey: 'offline-fixture-only' };
window.fetch = async (input, init) => {
  const url = String(input);
  if (url === '/api/game/action') {
    if (failNext) { failNext = false; throw new Error('离线演练：正文暂未完成，已确认玩法仍然保留。'); }
    const request = JSON.parse(String(init?.body));
    try { return Response.json(await processPlayerAction({ ...request, clientSettings: modelSettings })); }
    catch (error) { return Response.json({ error: error instanceof Error ? error.message : '离线错误' }, { status: 500 }); }
  }
  if (url.startsWith('https://offline-eidos.invalid/')) {
    calls++; changed();
    const state = useGameStore.getState(), receipt = gameplayLedger(state.gameplayModState[packaged.id] ?? {})?.last;
    return Response.json({ choices: [{ message: { content: JSON.stringify({ validity: { isPossible: true }, segments: [{ type: 'narration', text: `【离线固定正文】${receipt?.summary ?? '现场保持着刚刚确认的结果。'} 众人重新核对了案卷，接下来的决定仍留给你。` }], summary: receipt?.summary, availableActions: [], timeSpent: { day: 0, hour: 0, minute: 0 } }) }, finish_reason: 'stop' }], usage: { prompt_tokens: 6000, completion_tokens: 100, total_tokens: 6100 } });
  }
  if (url.startsWith('/api/')) return Response.json({ running: false });
  return originalFetch(input, init);
};
saveSettings({ ...loadSettings(), ...modelSettings, keiApiKey: '', uzqApiKey: '', autoAdvance: false, autoSelect: false, enableSpeculation: false, enableContentReview: false });
localStorage.setItem('eidos_stream_mode', 'false');
const { world, snapshot } = buildRiftCityStartState();
useGameStore.getState().setCurrentWorld({ ...world, name: '雾灯审判 · 原创短案', gameplayPlugins: parseGameplayPlugins([packaged]) });
useGameStore.setState({ phase: 'playing', currentPlaythroughId: `runtime-preview-${crypto.randomUUID()}`, currentSceneId: snapshot.currentSceneId, sceneNarrative: '请从日常关系或现场调查开始。',
  history: [], savedSegments: [], savedIsShowingSegments: false, currentNode: null, worldLine: null, allNodes: {}, worldFlags: {},
  midoriSettings: { ...useGameStore.getState().midoriSettings, enabled: false }, momoiSettings: { ...useGameStore.getState().momoiSettings, enabled: false } });
claimInitialActionAttempt(useGameStore.getState());
await useGameStore.getState().initWorldLine(useGameStore.getState().currentPlaythroughId!, world.id);

function Preview() {
  const state = useGameStore(), [, tick] = useState(0);
  useEffect(() => { changed = () => tick(n => n + 1); return () => { changed = () => undefined; }; }, []);
  const ledger = gameplayLedger(state.gameplayModState[packaged.id] ?? {});
  return <EidosShell><div className="flex h-screen flex-col"><div className="flex flex-wrap items-center gap-3 bg-[#152524] px-5 py-2 text-xs text-white">
    <b>离线固定响应 · 无真实模型调用</b><span>玩法版本 {ledger?.revision ?? 0} · 正文 {ledger?.last.narration ?? '无'} · 固定响应 {calls} 次</span>
    <button className="border px-2 py-1" onClick={() => { failNext = true; }}>下一次正文模拟失败</button>
    <button className="border px-2 py-1" onClick={() => { const parent = state.currentNode?.parentId; if (parent) void state.backtrackToNode(parent); }}>回溯上一节点</button>
    <button className="border px-2 py-1" onClick={() => state.setPhase(state.phase === 'settings' ? 'playing' : 'settings')}>{state.phase === 'settings' ? '返回游玩' : '作者工具 / 设置'}</button>
  </div><div className="min-h-0 flex-1">{state.phase === 'settings' ? <SettingsScreen /> : <GameScreen />}</div></div></EidosShell>;
}
createRoot(document.getElementById('root')!).render(<Preview />);
