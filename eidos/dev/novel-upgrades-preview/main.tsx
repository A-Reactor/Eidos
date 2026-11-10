import { createRoot } from 'react-dom/client';
import { useState } from 'react';
import { GameScreen } from '@/components/game/GameScreen';
import { EidosShell } from '@/components/shell/EidosShell';
import { useGameStore } from '@/store/game-store';
import { buildRiftCityStartState } from '@/lib/test/fixtures';
import { parseGameplayPlugins } from '@/lib/game/plugins/manifest';
import { abortActiveStream, claimInitialActionAttempt } from '@/lib/game/stream-lifecycle';
import { hashAndStore } from '@/lib/game/cas-storage';
import { getSceneById } from '@/lib/game/scene-utils';
import { processPlayerAction } from '@/lib/ai/action-handler';
import { saveSettings, loadSettings } from '@/lib/game/settings';
import type { NarrativeRequest } from '@/lib/game/narrative';
import type { NarrativeBeat } from '@/lib/game/narrative-beat';
import story from '../../mods/dist/night-voyage-short.eidos-plugin.json';
import legacy from './legacy-reader.eidos-plugin.json';
import '@/app/globals.css';

let calls = 0, request: NarrativeRequest | undefined, progress: NarrativeBeat | null = null;
const transport = { aliceProviderId: 'custom-openai-compatible', aliceEndpoint: 'https://offline-eidos.invalid/v1', aliceModel: 'offline-fixture', aliceApiKey: 'offline-fixture-only' };
const originalFetch = window.fetch.bind(window);
function response() {
  const first = { id: 'platform', title: '第一章 · 最后一盏灯' }, second = { id: 'carriage', title: '第二章 · 没有寄件人的信' }, third = { id: 'dawn', title: '第三章 · 天亮以后' };
  const common = { validity: { isPossible: true }, availableActions: [], timeSpent: { day: 0, hour: 0, minute: 0 } };
  if (!progress?.chapter) return { ...common, narrativeFrame: { kind: 'protagonist' },
    segments: [{ type: 'narration', text: '旧港最后一盏灯还亮着。白槿将一枚空白邮戳放到你掌心，没有催你登车。\n\n“迟到的信也可以慢慢寄。”她说。你们在站台坐了一会儿，直到海雾中的车门再次打开。' }], summary: '旅客与白槿在夜车前相处，决定先看清这趟旅程。',
    narrativeBeat: { chapter: first, recap: '旅客在旧港遇见白槿，拿到空白邮戳，夜车等候。', threads: ['迟到的信是否还要寄出？'], boundary: 'chapter' } };
  if (progress.chapter.id === 'platform') return { ...common, narrativeFrame: { kind: 'cutaway', actor: '白槿', location: '空车厢', timeLabel: '与此同时' },
    segments: [{ type: 'narration', text: '旅客仍在站台。空车厢里，白槿取出那封写了很多年的信。信纸边缘已经发白，只有收信人的名字还清晰。\n\n检票员停在门边，伸出手，却没有催促。白槿知道，这一次决定只能属于她自己。' }], summary: '读者看到白槿独自面对寄信的决定，旅客尚未知情。',
    narrativeChoices: [{ id: 'forward', label: '把信交给检票员转寄' }, { id: 'keep', label: '暂时把信留在自己手里' }],
    narrativeBeat: { chapter: second, recap: '白槿独自在空车厢取出旧信，旅客没有见到这一幕。', threads: ['白槿如何面对这封信？'] } };
  if (progress.chapter.id === 'carriage' && request?.kind === 'choice') {
    const forwarded = request.choiceId === 'forward';
    return { ...common, narrativeFrame: request.frame, segments: [{ type: 'narration', text: forwarded ? '白槿将信放进检票员手里。她没有立刻松开，等到纸张被稳稳接住，才低声说：“请慢一点，让它在天亮后到达。”\n\n门合上时，她第一次空着手站在窗前。' : '白槿把信收回衣袋。“今天先让我带着它走一段。”检票员点点头。她没有将犹豫伪装成答案，只是允许自己再等一个清晨。' }], summary: forwarded ? '白槿选择把信交给检票员。' : '白槿选择暂留信件。',
      narrativeBeat: { chapter: second, recap: forwarded ? '白槿已把信交给检票员转寄，旅客尚未知情。' : '白槿暂留旧信，旅客尚未知情。', threads: ['她会怎样向旅客告别？'], boundary: 'chapter' } };
  }
  const forwarded = progress.recap?.includes('交给');
  return { ...common, narrativeFrame: { kind: 'protagonist' }, segments: [{ type: 'narration', text: forwarded ? '天光落到站台时，白槿回到你身边。“我寄出了一封信。”这是她亲口告诉你的，你才知道方才那段沉默的去向。\n\n你将空白邮戳还给她。她笑了笑，和你一起等海雾散开。那封信会迟到，却已经在路上。' : '天光落到站台时，白槿回到你身边。“还有一封信，我想再带它走一段。”你没有追问她未说出的部分。\n\n空白邮戳在你们之间转了一圈。没有谁保证下一站会有答案，但这一次，你们愿意一起等到天亮。' }], summary: '白槿亲口告知自己的决定，旅客与她在黎明相见，本篇收束。',
    narrativeBeat: { chapter: third, recap: forwarded ? '白槿寄出旧信并亲口告知旅客，两人在黎明告别。' : '白槿暂留旧信并亲口告知旅客，两人接受尚未完成的告别。', threads: [], boundary: 'ending' } };
}
window.fetch = async (input, init) => {
  const url = String(input);
  if (url === '/api/game/action') {
    const body = JSON.parse(String(init?.body)); request = body.narrativeRequest; progress = body.snapshot.narrativeProgress;
    try { return Response.json(await processPlayerAction({ ...body, clientSettings: transport })); }
    catch (error) { return Response.json({ error: error instanceof Error ? error.message : '离线错误' }, { status: 500 }); }
  }
  if (url.startsWith('https://offline-eidos.invalid/')) {
    calls++;
    return Response.json({ choices: [{ message: { content: JSON.stringify(response()) }, finish_reason: 'stop' }], usage: { prompt_tokens: 6000, completion_tokens: 200, total_tokens: 6200 } });
  }
  if (url.startsWith('/api/')) return Response.json({ running: false });
  return originalFetch(input, init);
};
saveSettings({ ...loadSettings(), ...transport, keiApiKey: '', uzqApiKey: '', autoAdvance: false, autoSelect: false, enableSpeculation: false, enableContentReview: false,
  modPreferences: { 'night-voyage-short': { auto_continue: true } } });
localStorage.setItem('eidos_stream_mode', 'false');
async function reset(mode: 'story' | 'upgrade') {
  abortActiveStream(); calls = 0;
  const { world, snapshot } = buildRiftCityStartState();
  useGameStore.getState().setCurrentWorld({ ...world, name: '雾灯之后 · 离线验收', gameplayPlugins: parseGameplayPlugins([mode === 'story' ? story : legacy]) });
  useGameStore.setState({ phase: 'playing', currentPlaythroughId: crypto.randomUUID(), currentSceneId: snapshot.currentSceneId, currentScene: getSceneById(world, snapshot.currentSceneId), gameTime: snapshot.currentGameTime,
    playerName: '旅客', sceneNarrative: mode === 'story' ? '输入“开始短篇”阅读第一章。' : '旧版阅读器已有一页阅读记录。可在世界状态中导入新版连续小说包。', history: [], savedSegments: [], savedIsShowingSegments: false,
    currentNode: null, worldLine: null, allNodes: {}, isLoading: false, narrativeProgress: null,
    ...(mode === 'upgrade' ? { gameplayModState: { 'continuous-novel': { autoRead: true, readHistory: [{ scope: 'old-page', scene: '旧港站台', text: '这是一页升级前已经读过的正文。', decision: '' }] } } } : {}),
    midoriSettings: { ...useGameStore.getState().midoriSettings, enabled: false }, momoiSettings: { ...useGameStore.getState().momoiSettings, enabled: false } });
  claimInitialActionAttempt(useGameStore.getState());
  await useGameStore.getState().initWorldLine(useGameStore.getState().currentPlaythroughId!, world.id);
  const s = useGameStore.getState(), node = s.currentNode!, snapshotHash = await hashAndStore('snapshot', s.createSnapshot());
  useGameStore.setState({ allNodes: { ...s.allNodes, [node.id]: { ...node, snapshotHash } } });
}
await reset('story');
function Preview() {
  const state = useGameStore(), [mode, setMode] = useState<'story' | 'upgrade'>('story');
  return <EidosShell><div className="flex h-screen flex-col"><div className="flex flex-wrap gap-3 bg-[#152524] px-5 py-2 text-xs text-white">
    <b>离线固定响应 · 无真实模型调用</b><span>固定响应 {calls} 次</span>
    <select aria-label="验收场景" value={mode} className="bg-[#152524]" onChange={e => { const value = e.target.value as typeof mode; setMode(value); void reset(value); }}><option value="story">三章短篇</option><option value="upgrade">旧包升级</option></select>
    <button onClick={() => { const parent = state.currentNode?.parentId; if (parent) void state.backtrackToNode(parent); }}>回溯上一节点</button>
    <span>{state.narrativeProgress?.chapter?.title ?? '尚未开始'} · {state.narrativeProgress?.boundary ?? '阅读中'} · 包版本 {state.currentWorld?.gameplayPlugins?.[0]?.release ?? '旧版'}</span>
  </div><div className="min-h-0 flex-1"><GameScreen key={state.currentPlaythroughId} /></div></div></EidosShell>;
}
createRoot(document.getElementById('root')!).render(<Preview />);
