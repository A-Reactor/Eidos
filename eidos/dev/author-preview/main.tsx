import { createRoot } from 'react-dom/client';
import { useState } from 'react';
import { SettingsScreen } from '@/components/game/SettingsScreen';
import { EidosShell } from '@/components/shell/EidosShell';
import { useGameStore } from '@/store/game-store';
import { importCardAsset } from '@/lib/game/cards/storage';
import { mountCardWorld } from '@/lib/game/cards/binding';
import { buildCardActionContext } from '@/lib/game/cards/context';
import { processPlayerAction } from '@/lib/ai/action-handler';
import { prepareCardVariableTransition } from '@/lib/game/cards/variable-updates';
import { cardLedger } from '@/lib/game/cards/adapter';
import { createStreamRequestScope } from '@/lib/game/stream-lifecycle';
import { recordActionDiagnostics } from '@/lib/game/action-diagnostics';
import { saveSettings, loadSettings } from '@/lib/game/settings';
import sample from '../../examples/cards/gatekeeper.v2.json';
import '@/app/globals.css';

// Every model request is a fixed fixture. Non-model dev assets keep the normal fetch path.
const originalFetch = window.fetch.bind(window);
let requests = 0, currentAssetId = '';
window.fetch = async (input, init) => {
  if (String(input).startsWith('https://offline-eidos.invalid/')) {
    requests++;
    return Response.json({ choices: [{ message: { content: JSON.stringify({ validity: { isPossible: true }, segments: [{ type: 'narration', text: '门灯修好了。守卫点头让你通过。' }], summary: '帮助守卫修好门灯', timeSpent: { day: 0, hour: 0, minute: 2 }, availableActions: [],
      cardVariableUpdates: [{ assetId: currentAssetId, expectedRevision: 0, changes: [{ path: 'Gate.Trust[0]', oldValue: 20, newValue: 65 }] }] }) }, finish_reason: 'stop' }], usage: { prompt_tokens: 6200, completion_tokens: 200, total_tokens: 6400, prompt_tokens_details: { cached_tokens: 4000 } } });
  }
  return originalFetch(input, init);
};
saveSettings({ ...loadSettings(), autoAdvance: false, autoSelect: false });
function Preview() {
  const [status, setStatus] = useState('还未生成离线诊断'), [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      const asset = await importCardAsset(new TextEncoder().encode(JSON.stringify(sample)), 'gatekeeper.v2.json');
      currentAssetId = asset.id;
      const world = mountCardWorld({ asset, role: 'world', publicVariables: ['Gate.Trust[0]'] });
      useGameStore.getState().setCurrentWorld(world);
      useGameStore.setState({ currentPlaythroughId: 'author-preview', history: [], currentNode: null, worldLine: null, currentSceneId: 'card_start', phase: 'settings' });
      const s = useGameStore.getState(), snapshot = s.createSnapshot(), scope = createStreamRequestScope(s);
      const cards = await buildCardActionContext({ world, snapshot, playerInput: '帮助修好门灯' });
      const result = await processPlayerAction({ world, snapshot, playerInput: '帮助修好门灯', cardContext: cards, clientSettings: { aliceProviderId: 'custom-openai-compatible', aliceEndpoint: 'https://offline-eidos.invalid/v1', aliceModel: 'offline-fixture', aliceApiKey: 'offline-fixture-only' } });
      const next = prepareCardVariableTransition({ world, state: s.gameplayModState, mode: 'action', updates: result.cardVariableUpdates });
      useGameStore.setState({ gameplayModState: next });
      recordActionDiagnostics(scope, { input: '帮助修好门灯', status: 'accepted', context: result._contextDiagnostics, usage: result._tokenUsage, variableUpdates: result.cardVariableUpdates });
      setStatus(`离线固定响应 ${requests} 次，信任 ${String((cardLedger(next, asset.id)?.variables.Gate as { Trust: unknown[] }).Trust[0])}；无真实模型调用`);
    } catch (error) { setStatus(error instanceof Error ? error.message : '预览失败'); }
    finally { setBusy(false); }
  };
  return <EidosShell><div className="flex h-screen flex-col"><div className="flex items-center gap-4 bg-[#152524] px-5 py-3 text-sm text-white"><button className="border px-3 py-1 disabled:opacity-40" disabled={busy} onClick={() => void run()}>生成离线诊断示例</button><span role="status">{status}</span></div><div className="min-h-0 flex-1"><SettingsScreen /></div></div></EidosShell>;
}
createRoot(document.getElementById('root')!).render(<Preview />);
